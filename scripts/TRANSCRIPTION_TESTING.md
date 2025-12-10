# AssemblyAI Transcription Testing Guide

## Quick Start

Run the test script:
```bash
npm run test:transcription
```

## Prerequisites

### 1. Get AssemblyAI API Key

1. Sign up for an AssemblyAI account at https://www.assemblyai.com/
2. Get your API key from the dashboard
3. Set it in one of these ways:
   - **Environment variable** (recommended):
     ```bash
     export ASSEMBLYAI_API_KEY=your_api_key_here
     ```
   - **Local file**: Create `assemblyai_api_key.txt` in the project root with your API key
   - **GCP Secret Manager** (for production): Store as `assemblyai-api-key` secret

### 2. Verify Audio Format

AssemblyAI expects:
- **Format**: PCM16 (16-bit linear PCM)
- **Sample Rate**: 16kHz
- **Channels**: Mono

## Test Results

The test script will:
1. ✅ Start a transcription session with AssemblyAI
2. ✅ Send mock audio chunks (sine wave - won't produce real transcripts)
3. ✅ Finalize the session

**Note**: Mock audio (sine waves) won't produce real transcripts. AssemblyAI requires actual speech audio.

## Testing with Real Audio

To test with real audio:

1. Create a test audio file in 16kHz, 16-bit PCM format:
   ```bash
   # Convert an audio file to the required format using ffmpeg
   ffmpeg -i input.wav -ar 16000 -ac 1 -f s16le test-audio.pcm
   ```

2. Place `test-audio.pcm` in the project root

3. Run the test again - it will automatically use the real audio file

## Expected Behavior

### With API Key Set:
- ✅ Transcription session starts successfully
- ✅ WebSocket connections established
- ✅ Audio chunks are processed
- ⚠️ Mock audio won't produce transcripts (expected)

### With Real Speech Audio:
- ✅ Transcription session starts
- ✅ Audio chunks are processed
- ✅ AssemblyAI returns transcripts in real-time
- ✅ Transcripts are formatted with speaker labels

## Troubleshooting

### Error: "AssemblyAI API key not found"
- **Solution**: Set `ASSEMBLYAI_API_KEY` environment variable or create `assemblyai_api_key.txt` file

### Error: "Connection failed" or WebSocket errors
- **Check**: API key is valid and has credits
- **Check**: Network connectivity to AssemblyAI servers
- **Check**: API key has real-time transcription enabled

### No Transcripts Received
- **Expected** with mock audio (sine waves)
- **Solution**: Use real speech audio files for testing

### Audio Format Errors
- **Check**: Audio is 16kHz, 16-bit PCM, mono
- **Check**: Audio chunks are sent in correct format

## AssemblyAI vs Google Speech-to-Text

**Advantages of AssemblyAI:**
- ✅ Simpler API (WebSocket-based)
- ✅ Better real-time transcription support
- ✅ Built-in speaker diarization (optional)
- ✅ No complex protobuf message formatting
- ✅ Easier to test locally

**Setup:**
- Requires AssemblyAI account and API key
- Free tier available for testing
- Pay-as-you-go pricing

## Next Steps

1. Get AssemblyAI API key and set it
2. Test with real audio files
3. Test with actual LiveKit calls (once egress is configured)
4. Verify note creation after calls end

## Production Setup

For production, store the API key in GCP Secret Manager:
1. Create secret: `assemblyai-api-key`
2. Store your API key as the secret value
3. The service will automatically fetch it from Secret Manager
