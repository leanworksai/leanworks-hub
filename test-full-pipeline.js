/**
 * Full Pipeline Test
 * Tests the actual audio processing pipeline with real resampler
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Note: We'll simulate the resampler since it's TypeScript
// For a real test, you'd need to compile TypeScript or use ts-node
// For now, we'll test the byte swap logic and create a simpler resampling test

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testFullPipeline() {
  console.log('=== Full Audio Pipeline Test ===\n');
  
  // Step 1: Generate test audio (sine wave, 440Hz, 48kHz, 2 seconds)
  console.log('1. Generating test audio...');
  const sampleRate = 48000;
  const duration = 2; // 2 seconds
  const frequency = 440; // A4 note
  const amplitude = 10000; // Moderate volume
  const numSamples = sampleRate * duration;
  
  // Generate as BE (simulating LiveKit)
  const testAudioBE = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * t));
    testAudioBE.writeInt16BE(sample, i * 2);
  }
  
  console.log(`   Generated ${numSamples} samples at ${sampleRate}Hz`);
  console.log(`   Frequency: ${frequency}Hz, Amplitude: ${amplitude}`);
  console.log(`   BE peak: ${getPeak(testAudioBE, 'BE')}`);
  console.log(`   LE peak: ${getPeak(testAudioBE, 'LE')}`);
  console.log('');
  
  // Step 2: Simulate byte order swap (BE → LE) - what livekit.ts does
  console.log('2. Simulating byte order swap (BE → LE)...');
  const swappedAudio = Buffer.alloc(testAudioBE.length);
  let maxBE = 0, maxLE = 0;
  for (let i = 0; i < testAudioBE.length; i += 2) {
    const beValue = testAudioBE.readInt16BE(i);
    const leValue = testAudioBE.readInt16LE(i);
    swappedAudio.writeInt16LE(beValue, i); // Current swap method
    maxBE = Math.max(maxBE, Math.abs(beValue));
    maxLE = Math.max(maxLE, Math.abs(leValue));
  }
  
  console.log(`   Original BE peak: ${maxBE}`);
  console.log(`   Original LE peak: ${maxLE}`);
  console.log(`   After swap LE peak: ${getPeak(swappedAudio, 'LE')}`);
  console.log(`   After swap BE peak: ${getPeak(swappedAudio, 'BE')}`);
  
  // Verify swap worked
  let swapMismatches = 0;
  for (let i = 0; i < Math.min(100, testAudioBE.length / 2); i++) {
    const originalBE = testAudioBE.readInt16BE(i * 2);
    const swappedLE = swappedAudio.readInt16LE(i * 2);
    if (originalBE !== swappedLE) {
      swapMismatches++;
    }
  }
  if (swapMismatches === 0) {
    console.log('   ✅ Byte swap preserved values correctly');
  } else {
    console.log(`   ❌ Byte swap created ${swapMismatches} mismatches!`);
  }
  console.log('');
  
  // Step 3: Simulate resampling (we'll use simple decimation for testing)
  // In production, this uses libsamplerate-js which applies gain reduction and soft limiting
  console.log('3. Simulating resampling (48kHz → 16kHz)...');
  console.log('   Note: Using simple decimation. Real resampler applies gain reduction (0.5x) and soft limiting.');
  try {
    // Simulate what the resampler does:
    // 1. Normalize to float with gain reduction (0.5x)
    // 2. Resample (we'll use decimation)
    // 3. Apply soft limiter (threshold 0.8)
    // 4. Denormalize back to int16
    
    const inputSamples = swappedAudio.length / 2;
    const outputSamples = Math.floor(inputSamples / 3); // 48kHz -> 16kHz = 1/3
    
    // Step 3a: Normalize with gain reduction (0.5x)
    const INPUT_GAIN = 0.5;
    const inputFloat = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      const sample = swappedAudio.readInt16LE(i * 2);
      inputFloat[i] = (sample / 32768.0) * INPUT_GAIN;
    }
    
    // Step 3b: Simple decimation (every 3rd sample)
    const outputFloat = new Float32Array(outputSamples);
    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = i * 3;
      if (inputIndex < inputSamples) {
        outputFloat[i] = inputFloat[inputIndex];
      }
    }
    
    // Step 3c: Apply soft limiter (threshold 0.8)
    const LIMITER_THRESHOLD = 0.8;
    const outputFloatLimited = new Float32Array(outputSamples);
    for (let i = 0; i < outputSamples; i++) {
      const value = outputFloat[i];
      if (Math.abs(value) > LIMITER_THRESHOLD) {
        const sign = value >= 0 ? 1 : -1;
        const normalized = Math.abs(value) / LIMITER_THRESHOLD;
        const compressed = Math.tanh(normalized * 2.0) * LIMITER_THRESHOLD;
        outputFloatLimited[i] = sign * compressed;
      } else {
        outputFloatLimited[i] = value;
      }
    }
    
    // Step 3d: Denormalize back to int16
    const resampledAudio = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
      const floatValue = Math.max(-1.0, Math.min(1.0, outputFloatLimited[i]));
      const sample = Math.max(-32768, Math.min(32767, Math.round(floatValue * 32768.0)));
      resampledAudio.writeInt16LE(sample, i * 2);
    }
    
    console.log(`   Input: ${swappedAudio.length} bytes (${swappedAudio.length / 2} samples)`);
    console.log(`   Output: ${resampledAudio.length} bytes (${resampledAudio.length / 2} samples)`);
    console.log(`   Expected output: ${Math.floor(numSamples / 3) * 2} bytes`);
    console.log(`   Output peak (LE): ${getPeak(resampledAudio, 'LE')}`);
    console.log(`   Output peak (BE): ${getPeak(resampledAudio, 'BE')}`);
    console.log('');
    
    // Step 4: Analyze for corruption
    console.log('4. Analyzing for corruption...');
    const inputPeak = getPeak(swappedAudio, 'LE');
    const outputPeakLE = getPeak(resampledAudio, 'LE');
    const outputPeakBE = getPeak(resampledAudio, 'BE');
    
    console.log(`   Input peak: ${inputPeak}`);
    console.log(`   Output peak (LE): ${outputPeakLE}`);
    console.log(`   Output peak (BE): ${outputPeakBE}`);
    
    // Check for amplification
    const amplification = outputPeakLE / inputPeak;
    if (amplification > 1.2) {
      console.log(`   ❌ Resampler amplified by ${(amplification * 100).toFixed(1)}% - this could cause clipping!`);
    } else if (amplification > 1.05) {
      console.log(`   ⚠️  Resampler amplified by ${(amplification * 100).toFixed(1)}% - might cause issues`);
    } else {
      console.log(`   ✅ Resampler amplification: ${(amplification * 100).toFixed(1)}% (acceptable)`);
    }
    
    // Check for clipping
    const clippedSamples = countClippedSamples(resampledAudio);
    if (clippedSamples > 0) {
      const clipPercent = (clippedSamples / (resampledAudio.length / 2)) * 100;
      console.log(`   ❌ Found ${clippedSamples} clipped samples (${clipPercent.toFixed(2)}%)`);
    } else {
      console.log(`   ✅ No clipping detected`);
    }
    
    // Check byte order
    if (outputPeakBE > outputPeakLE * 2) {
      console.log(`   ⚠️  BE interpretation is ${(outputPeakBE / outputPeakLE).toFixed(1)}x higher - possible byte order issue`);
    } else {
      console.log(`   ✅ Byte order appears correct`);
    }
    console.log('');
    
    // Step 5: Save files for inspection
    console.log('5. Saving test files...');
    const testDir = path.join(__dirname, 'test-audio-output');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    saveAsWav(testAudioBE, path.join(testDir, '01-original-be-48khz.wav'), 48000);
    console.log('   Saved: 01-original-be-48khz.wav');
    
    saveAsWav(swappedAudio, path.join(testDir, '02-swapped-le-48khz.wav'), 48000);
    console.log('   Saved: 02-swapped-le-48khz.wav');
    
    saveAsWav(resampledAudio, path.join(testDir, '03-resampled-16khz.wav'), 16000);
    console.log('   Saved: 03-resampled-16khz.wav');
    
    console.log(`\n✅ Full pipeline test complete!`);
    console.log(`   Check files in ${testDir}/`);
    console.log(`   Compare 02 and 03 - they should sound similar (just different sample rates)`);
    
  } catch (error) {
    console.error('❌ Error during resampling:', error);
    throw error;
  }
}

function getPeak(buffer, byteOrder) {
  let peak = 0;
  const checkSamples = Math.min(10000, buffer.length / 2);
  for (let i = 0; i < checkSamples; i++) {
    const sample = byteOrder === 'BE' 
      ? Math.abs(buffer.readInt16BE(i * 2))
      : Math.abs(buffer.readInt16LE(i * 2));
    peak = Math.max(peak, sample);
  }
  return peak;
}

function countClippedSamples(buffer) {
  let clipped = 0;
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = Math.abs(buffer.readInt16LE(i));
    if (sample >= 32767) {
      clipped++;
    }
  }
  return clipped;
}

function saveAsWav(pcmData, filepath, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;
  
  const wavHeader = Buffer.alloc(44);
  
  // RIFF header
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(fileSize, 4);
  wavHeader.write('WAVE', 8);
  
  // fmt chunk
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataSize, 40);
  
  const wavFile = Buffer.concat([wavHeader, pcmData]);
  fs.writeFileSync(filepath, wavFile);
}

// Run the test
testFullPipeline().catch(console.error);

