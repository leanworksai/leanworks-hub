# Log Analysis - Audio Format Issues

## Critical Issues Found

### 1. ❌ Resampler Output Byte Order Issue (CRITICAL)

**Severity**: CRITICAL  
**Count**: 1,678+ instances in recent logs  
**Status**: ACTIVE - Audio files are being corrupted

**Problem**:
The resampler output appears to be in the wrong byte order. When checking the output:
- **Little-endian (LE) interpretation**: Peak values ~1,000-7,000 (relatively low)
- **Big-endian (BE) interpretation**: Peak values ~32,500-32,767 (near maximum)
- **BE/LE ratio**: 4-32x higher for BE interpretation

**Example from logs**:
```
LE peak=7393, BE peak=32758, LE avg=1485.2, BE avg=16316.0
peak ratio=4.43x, avg ratio=10.99x
```

**Impact**:
- Audio files saved to GCS are likely corrupted
- Playback will sound distorted or completely wrong
- Transcription quality will be severely affected

**Location**: `server/services/audio-processor.ts` - resampler output validation

**Root Cause**:
The resampler is outputting Float32Array which is then converted to Int16Array and written with `writeInt16LE()`. However, the byte order validation is detecting that big-endian interpretation gives much higher (and more reasonable) values, suggesting the data might actually be in big-endian format.

**Possible Causes**:
1. The resampler library might be outputting data in big-endian format
2. The Float32 → Int16 conversion might be introducing byte order issues
3. The write operation might be writing in wrong byte order despite using `writeInt16LE`

### 2. ⚠️ All-Zeros Input/Output (WARNING)

**Severity**: WARNING  
**Count**: Multiple instances

**Problem**:
- Input audio appears to be all zeros (silence or corrupted)
- Output samples are all zeros

**Impact**:
- May indicate muted track or wrong track being captured
- Could be legitimate silence, but worth investigating

### 3. ⚠️ Persistent Silence Detection (WARNING)

**Severity**: WARNING  
**Count**: Multiple instances

**Problem**:
Multiple consecutive chunks appear to be silence (11+ consecutive silence chunks)

**Impact**:
- May indicate egress is capturing wrong track
- May indicate muted track
- Could be legitimate silence periods

## Format Detection Status

### ✅ New Format Detection Code Status

The new format detection code I added is **not yet active** in the logs, which means:
1. Either the server hasn't been restarted with the new code
2. Or no audio has been received since the code was added
3. Or the format checks are passing (no issues detected)

**Expected log messages** (when active):
- `ogg_opus_format_detected` - If Ogg/Opus format is detected
- `pcm_format_detected` - When PCM format is confirmed
- `stereo_audio_detected` - If stereo format is detected
- `unsigned_pcm_detected` - If unsigned PCM is detected
- `unusual_sample_rate_detected` - If sample rate > 48kHz (possible stereo)

## Immediate Action Required

### Priority 1: Fix Resampler Byte Order Issue

The resampler byte order issue is **actively corrupting audio files**. This needs immediate investigation:

1. **Check resampler output format**:
   - Verify what byte order the resampler library outputs
   - Check if Float32Array → Int16Array conversion preserves byte order correctly

2. **Investigate write operation**:
   - Verify `writeInt16LE()` is actually writing little-endian
   - Check if there's any byte swapping happening

3. **Test with known good audio**:
   - Process a known good PCM16 file
   - Verify output byte order matches input

4. **Consider temporary fix**:
   - If resampler is outputting BE, convert to LE before writing
   - Or use `writeInt16BE()` if data is actually BE

### Priority 2: Verify Format Detection

Once server is restarted with new code:
1. Check logs for format detection messages
2. Verify no Ogg/Opus, stereo, or unsigned PCM issues
3. Monitor for any new format-related errors

## Recommendations

1. **Immediate**: Investigate and fix the resampler byte order issue
2. **Short-term**: Add more detailed logging around resampler output
3. **Medium-term**: Add unit tests for byte order handling
4. **Long-term**: Consider using a different resampler library if current one has byte order issues

## Log File Locations

- Main logs: `logs/combined.log`
- Audio pipeline: `logs/audio-pipeline.log`
- Errors: `logs/error.log`
- Transcription: `logs/transcription.log`

## Next Steps

1. Review `server/services/audio-processor.ts` resampler output handling
2. Check resampler library documentation for byte order behavior
3. Add debug logging to trace byte order through the pipeline
4. Test with known good audio samples
5. Fix byte order issue before processing more audio

