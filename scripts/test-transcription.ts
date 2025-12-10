/**
 * Test script for AssemblyAI transcription service
 * Simulates audio chunks and tests the transcription flow
 */

import { startTranscriptionSession, processAudioChunk, finalizeTranscriptionSession, formatTranscriptWithSpeakers } from '../server/services/transcription.js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate a simple test audio buffer (sine wave tone)
 * This simulates 16kHz, 16-bit PCM audio
 * Note: This won't produce real transcripts - it's just for testing the service flow
 */
function generateTestAudio(durationMs: number): Buffer {
  const sampleRate = 16000; // 16kHz
  const bytesPerSample = 2; // 16-bit = 2 bytes
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(numSamples * bytesPerSample);
  
  // Generate simple sine wave (440Hz tone) for testing
  // In real usage, this would be actual speech audio data
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate);
    const intSample = Math.floor(sample * 32767);
    buffer.writeInt16LE(intSample, i * 2);
  }
  
  return buffer;
}

/**
 * Load audio from file if available (for more realistic testing)
 */
function loadAudioFile(filePath: string): Buffer | null {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath);
    }
  } catch (error) {
    // File doesn't exist or can't be read
  }
  return null;
}

async function testTranscription() {
  console.log('🧪 Starting AssemblyAI transcription test...\n');

  // Load GCP credentials for Secret Manager
  const serviceAccountPath = join(__dirname, '../gcp_credential.json');
  let serviceAccount;
  let secretManagerClient: SecretManagerServiceClient | undefined;
  let projectId: string | undefined;

  try {
    if (existsSync(serviceAccountPath)) {
      serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      console.log('✅ Loaded GCP credentials from:', serviceAccountPath);
      
      // Initialize Secret Manager client
      secretManagerClient = new SecretManagerServiceClient({
        credentials: serviceAccount,
        projectId: serviceAccount.project_id,
      });
      projectId = serviceAccount.project_id;
      console.log('✅ Secret Manager client initialized');
      console.log(`   Project ID: ${projectId}\n`);
    } else {
      console.log('⚠️  GCP credentials not found, will try environment variable or local file\n');
    }
  } catch (error) {
    console.error('❌ Failed to load GCP credentials:', error);
    console.log('   Will try environment variable or local file\n');
  }

  const callId = `test-call-${Date.now()}`;
  const roomName = 'test-room';
  const participants = [
    { email: 'user1@example.com', name: 'Alice' },
    { email: 'user2@example.com', name: 'Bob' }
  ];

  try {
    // Step 1: Start transcription session
    console.log('📝 Step 1: Starting transcription session...');
    await startTranscriptionSession(callId, roomName, participants, secretManagerClient, projectId);
    console.log('✅ Transcription session started');
    
    // Wait a moment for connection to be established
    console.log('   - Waiting for connection to be established...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ Ready to send audio\n');

    // Step 2: Simulate audio chunks from participants
    console.log('🎤 Step 2: Sending mock audio chunks...');
    console.log('   Note: Using synthetic audio (sine wave) - won\'t produce real transcripts');
    console.log('   For real transcripts, use actual speech audio files\n');
    
    // Try to load real audio file if available
    const testAudioFile = loadAudioFile('./test-audio.pcm');
    const useRealAudio = testAudioFile !== null;
    
    if (useRealAudio) {
      console.log('   ✅ Found test-audio.pcm - using real audio data');
      // Split into chunks and send
      const chunkSize = 3200; // ~200ms at 16kHz
      for (let i = 0; i < Math.min(10, Math.floor(testAudioFile.length / chunkSize)); i++) {
        const chunk = testAudioFile.slice(i * chunkSize, (i + 1) * chunkSize);
        processAudioChunk(callId, 'user1@example.com', chunk);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      // Simulate Alice speaking (send a few chunks)
      console.log('   - Sending synthetic audio from Alice...');
      for (let i = 0; i < 5; i++) {
        const audioChunk = generateTestAudio(200); // 200ms chunks
        processAudioChunk(callId, 'user1@example.com', audioChunk);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Simulate Bob speaking
      console.log('   - Sending synthetic audio from Bob...');
      for (let i = 0; i < 5; i++) {
        const audioChunk = generateTestAudio(200);
        processAudioChunk(callId, 'user2@example.com', audioChunk);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Wait for processing (give AssemblyAI time to process)
    console.log('   - Waiting for transcription processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✅ Audio chunks sent\n');

    // Step 3: Finalize transcription
    console.log('📝 Step 3: Finalizing transcription...');
    const transcripts = await finalizeTranscriptionSession(callId);
    
    if (transcripts.size === 0) {
      console.log('⚠️  No transcripts received.');
      console.log('   This is expected because:');
      console.log('   1. Mock audio (sine waves) won\'t produce real transcripts');
      console.log('   2. There may be a format issue with the test setup');
      console.log('   3. Real audio from LiveKit may work differently\n');
    } else {
      console.log('✅ Transcripts received:\n');
      
      // Format and display transcripts
      const participantMap = new Map(
        participants.map(p => [p.email.toLowerCase(), p])
      );
      const formatted = formatTranscriptWithSpeakers(transcripts, participantMap);
      console.log(formatted);
      console.log('\n');
    }

    console.log('✅ Test completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Test with real audio data from a LiveKit call');
    console.log('   2. Verify AssemblyAI API key is set (ASSEMBLYAI_API_KEY env var or assemblyai_api_key.txt)');
    console.log('   3. Check that audio format matches (16kHz, 16-bit PCM)');

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testTranscription().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
