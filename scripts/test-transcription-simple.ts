/**
 * Simple test to verify Google Speech-to-Text streaming API format
 * This tests the exact format needed
 */

import { SpeechClient } from '@google-cloud/speech';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testSimple() {
  console.log('🧪 Testing Google Speech-to-Text streaming format...\n');

  try {
    // Initialize client
    const serviceAccountPath = join(__dirname, '../gcp_credential.json');
    if (!existsSync(serviceAccountPath)) {
      throw new Error('GCP credentials not found');
    }
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    const client = new SpeechClient({
      credentials: serviceAccount,
      projectId: serviceAccount.project_id,
    });

    console.log('✅ Speech client initialized\n');

    // Create streaming recognize stream
    const recognizeStream = client.streamingRecognize();

    // Set up event handlers
    recognizeStream.on('error', (error: any) => {
      console.error('❌ Stream error:', error.message || error);
    });

    recognizeStream.on('data', (data: any) => {
      console.log('📝 Received data:', JSON.stringify(data, null, 2));
    });

    // Send config message FIRST
    console.log('📤 Sending config message...');
    const configMessage = {
      streamingConfig: {
        config: {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: 16000,
          languageCode: 'en-US',
        },
        interimResults: true,
      },
    };
    
    console.log('Config message structure:', JSON.stringify(configMessage, null, 2));
    recognizeStream.write(configMessage);
    console.log('✅ Config sent\n');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send a small audio chunk
    console.log('📤 Sending audio chunk...');
    const testAudio = Buffer.alloc(3200); // 0.1s of 16kHz mono 16-bit PCM
    const audioMessage = {
      audioContent: testAudio,
    };
    
    console.log('Audio message structure:', {
      hasAudioContent: 'audioContent' in audioMessage,
      hasStreamingConfig: 'streamingConfig' in audioMessage,
      audioSize: audioMessage.audioContent.length,
    });
    
    recognizeStream.write(audioMessage);
    console.log('✅ Audio sent\n');

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 2000));

    // End stream
    recognizeStream.end();
    console.log('✅ Stream ended\n');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message || error);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testSimple().catch(console.error);

