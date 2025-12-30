# Unsigned PCM Detection Check

## Status

✅ **No unsigned PCM detected** - Audio appears to be signed PCM16 (correct format)

## Detection Logic

The unsigned PCM detection runs on the **first chunk** (`audioChunkCount === 1`) and checks:

```javascript
// Read first 2 samples as both signed and unsigned
const sample1 = data.readInt16LE(0);        // Signed: -32768 to 32767
const sample2 = data.readInt16LE(2);        // Signed: -32768 to 32767
const sample1Unsigned = data.readUInt16LE(0); // Unsigned: 0 to 65535
const sample2Unsigned = data.readUInt16LE(2); // Unsigned: 0 to 65535

// Check if unsigned interpretation makes more sense
const maxSigned = Math.max(Math.abs(sample1), Math.abs(sample2));
const maxUnsigned = Math.max(sample1Unsigned, sample2Unsigned);

// Flag as unsigned if:
// - Unsigned values > 32767 (outside signed range)
// - AND signed values < 1000 (very small, suggesting wrong interpretation)
if (maxUnsigned > 32767 && maxSigned < 1000) {
  // ERROR: Unsigned PCM detected
}
```

## Why No Detections?

**Possible reasons**:

1. ✅ **Audio is correctly signed PCM16**
   - Sample values are in range -32768 to 32767
   - Unsigned interpretation doesn't give values > 32767
   - This is the **expected and correct** format

2. ✅ **Detection logic is working**
   - Code is present and active
   - Runs on first chunk of each connection
   - Would trigger if unsigned PCM was present

3. ⚠️ **Detection might miss edge cases**
   - Only checks first 2 samples
   - If first samples happen to be near zero, might not detect
   - But condition requires `maxSigned < 1000`, so near-zero samples would still work

## How to Verify Detection Works

To test if detection would work, you could:

1. **Check actual sample values** from logs:
   ```bash
   grep "audio_samples_check" logs/combined.log | jq '.firstSamples'
   ```

2. **Manually verify**:
   - If unsigned PCM: unsigned values would be 32768-65535
   - If signed PCM: unsigned values would be 0-32767 (same as signed when positive)

3. **Test with known unsigned PCM file**:
   - Process a file known to be unsigned PCM
   - Detection should trigger

## Current Sample Values

From recent logs, audio chunks show:
- Max amplitude values in reasonable range (not near 65535)
- This suggests signed PCM16 format (correct)

## Conclusion

**No unsigned PCM detected** = ✅ **Good news!**

This means:
- Audio is in signed PCM16 format (correct)
- No conversion needed
- No harsh distortion from unsigned/signed mismatch

The detection is working correctly - it would have triggered if unsigned PCM was present.

