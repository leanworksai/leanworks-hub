# Audio Format Check - LiveKit TrackEgress

## Problem Statement

According to LiveKit documentation, **TrackEgress exports tracks "as is" (no transcoding)**. For audio tracks, this means:
- **Opus tracks → Ogg/Opus format** (compressed)
- **NOT PCM16** (raw uncompressed)

If you start TrackEgress on an Opus track and then treat the bytes as PCM16, it will look like garbage (and tools may label/guess weird "endianness" because it's compressed, not raw PCM).

## Quick Check

**Does the stream start with "OggS"?**
- **YES** → It's Ogg/Opus, you must decode Opus, not byte-swap
- **NO** → It's likely PCM16 (expected format)

## Additional PCM Format Issues

Even with correct PCM format, these issues can cause audio to sound "wrong":

1. **Sample rate mismatch** (48k vs 16k) → chipmunk/slow
2. **Channels/interleaving** (stereo interpreted as mono) → weird artifacts
3. **Signed vs unsigned** (PCM16 should be signed) → harsh distortion

## Current Code Status

### ✅ What Was Added

1. **Format Detection** (`server/endpoints/livekit.ts`):
   - Added check for "OggS" header on first chunk
   - Logs critical error if Ogg/Opus format is detected
   - Logs debug message if PCM16 format is detected (expected)

2. **Diagnostic Script** (`check-audio-format.js`):
   - Standalone script to check audio format
   - Can read from file or stdin
   - Shows format analysis and sample interpretation

### ⚠️ Current Issues

The code currently:

1. **Assumes PCM16 format** (line 1790-1793 in `livekit.ts`)
   - Directly reads as Int16Array without format detection
   - Does NOT decode Opus if the stream is Ogg/Opus
   - If LiveKit is sending Ogg/Opus, it will treat compressed Opus data as raw PCM16 → severe audio corruption

2. **Assumes MONO audio** (line 1211 in `livekit.ts`)
   - Sample rate detection assumes 1 channel (mono)
   - If audio is stereo, sample rate will be detected as 2x too high
   - Example: 48kHz stereo → detected as 96kHz → causes chipmunk/slow playback

3. **Assumes SIGNED PCM16** (line 1792 in `livekit.ts`)
   - Uses `readInt16LE` (signed: -32768 to 32767)
   - If audio is unsigned (0-65535), will cause harsh distortion
   - No conversion from unsigned to signed

All these issues are now detected and logged, but not yet fixed.

## Next Steps

### If Ogg/Opus format is detected:

1. **Install Opus decoder library**:
   ```bash
   npm install @discordjs/opus node-opus opusscript
   ```

2. **Add Opus decoding** before processing as PCM16:
   - Detect Ogg/Opus format
   - Decode Opus to PCM16
   - Then proceed with resampling

3. **Alternative**: Configure LiveKit to send PCM16 instead of Opus
   - Check LiveKit egress configuration
   - May require different egress settings

### If Stereo audio is detected:

1. **Detect number of channels** from chunk size or metadata
2. **Handle stereo interleaving**:
   - Stereo: L, R, L, R, L, R...
   - Convert to mono: average L+R or take one channel
   - Adjust sample rate calculation: `samples = chunkSize / 4` (for stereo)

### If Unsigned PCM is detected:

1. **Convert unsigned to signed**:
   - Unsigned: 0-65535
   - Signed: -32768 to 32767
   - Conversion: `signed = unsigned - 32768`

## Testing

To check if your audio stream is Ogg/Opus:

```bash
# Check a file
node check-audio-format.js path/to/audio.bin

# Or pipe data
cat audio.bin | node check-audio-format.js
```

The script will:
- Show the first 4 bytes
- Detect "OggS" header
- Analyze sample values if PCM16
- Warn about potential byte order issues

## References

- LiveKit TrackEgress documentation
- Ogg format specification: Ogg files start with "OggS" (0x4F 0x67 0x67 0x53)
- Opus codec documentation

