/**
 * Test Audio Pipeline
 * Generates a known audio file and runs it through the processing pipeline
 * to detect corruption issues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the audio processing functions
// Note: We'll need to adjust imports based on your module system
async function testPipeline() {
  console.log('=== Audio Pipeline Test ===\n');
  
  // Step 1: Generate a known test audio file (sine wave at 440Hz, 48kHz, 1 second)
  console.log('1. Generating test audio...');
  const sampleRate = 48000;
  const duration = 1; // 1 second
  const frequency = 440; // A4 note
  const amplitude = 10000; // Moderate volume (not too loud, not too quiet)
  const numSamples = sampleRate * duration;
  
  // Generate sine wave as BE (simulating LiveKit sending BE)
  const testAudioBE = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * t));
    // Write as BE (simulating LiveKit)
    testAudioBE.writeInt16BE(sample, i * 2);
  }
  
  console.log(`   Generated ${numSamples} samples at ${sampleRate}Hz`);
  console.log(`   Frequency: ${frequency}Hz, Amplitude: ${amplitude}`);
  console.log(`   Expected peak: ${amplitude}`);
  console.log(`   BE peak: ${getPeak(testAudioBE, 'BE')}`);
  console.log(`   LE peak: ${getPeak(testAudioBE, 'LE')}`);
  console.log('');
  
  // Step 2: Simulate byte order swap (BE → LE)
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
  console.log(`   After swap (read as LE): ${getPeak(swappedAudio, 'LE')}`);
  console.log(`   After swap (read as BE): ${getPeak(swappedAudio, 'BE')}`);
  console.log('');
  
  // Step 3: Check if values are preserved
  console.log('3. Checking value preservation...');
  let valueMismatches = 0;
  let maxMismatch = 0;
  for (let i = 0; i < Math.min(100, testAudioBE.length / 2); i++) {
    const originalBE = testAudioBE.readInt16BE(i * 2);
    const swappedLE = swappedAudio.readInt16LE(i * 2);
    if (originalBE !== swappedLE) {
      valueMismatches++;
      maxMismatch = Math.max(maxMismatch, Math.abs(originalBE - swappedLE));
      if (valueMismatches <= 5) {
        console.log(`   Mismatch at sample ${i}: original BE=${originalBE}, swapped LE=${swappedLE}, diff=${Math.abs(originalBE - swappedLE)}`);
      }
    }
  }
  
  if (valueMismatches === 0) {
    console.log('   ✅ Values preserved correctly');
  } else {
    console.log(`   ❌ Found ${valueMismatches} value mismatches (max diff: ${maxMismatch})`);
  }
  console.log('');
  
  // Step 4: Simulate resampling (48kHz → 16kHz)
  console.log('4. Simulating resampling (48kHz → 16kHz)...');
  console.log('   Note: This requires the actual resampler library');
  console.log('   For now, we\'ll do simple decimation to test...');
  
  // Simple decimation (every 3rd sample)
  const outputSamples = Math.floor(numSamples / 3);
  const resampledAudio = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i++) {
    const inputIndex = i * 3;
    if (inputIndex < numSamples) {
      const sample = swappedAudio.readInt16LE(inputIndex * 2);
      resampledAudio.writeInt16LE(sample, i * 2);
    }
  }
  
  console.log(`   Resampled: ${numSamples} → ${outputSamples} samples`);
  console.log(`   Resampled peak (LE): ${getPeak(resampledAudio, 'LE')}`);
  console.log(`   Resampled peak (BE): ${getPeak(resampledAudio, 'BE')}`);
  console.log('');
  
  // Step 5: Check for corruption indicators
  console.log('5. Checking for corruption...');
  const resampledPeakLE = getPeak(resampledAudio, 'LE');
  const resampledPeakBE = getPeak(resampledAudio, 'BE');
  const expectedPeak = amplitude; // Should be similar to original
  
  console.log(`   Expected peak: ~${expectedPeak}`);
  console.log(`   Actual peak (LE): ${resampledPeakLE}`);
  console.log(`   Actual peak (BE): ${resampledPeakBE}`);
  
  if (Math.abs(resampledPeakLE - expectedPeak) < expectedPeak * 0.1) {
    console.log('   ✅ Peak value is reasonable (within 10%)');
  } else if (resampledPeakLE > expectedPeak * 1.5) {
    console.log('   ❌ Peak is too high - possible amplification or corruption');
  } else if (resampledPeakLE < expectedPeak * 0.5) {
    console.log('   ❌ Peak is too low - possible attenuation or corruption');
  }
  
  if (resampledPeakBE > resampledPeakLE * 2) {
    console.log('   ⚠️  BE interpretation is much higher - file might be stored in wrong byte order');
  }
  console.log('');
  
  // Step 6: Save test files for manual inspection
  console.log('6. Saving test files...');
  const testDir = path.join(__dirname, 'test-audio-output');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Save original BE as WAV
  saveAsWav(testAudioBE, path.join(testDir, '01-original-be.wav'), sampleRate);
  console.log('   Saved: 01-original-be.wav');
  
  // Save swapped LE as WAV
  saveAsWav(swappedAudio, path.join(testDir, '02-swapped-le.wav'), sampleRate);
  console.log('   Saved: 02-swapped-le.wav');
  
  // Save resampled as WAV
  saveAsWav(resampledAudio, path.join(testDir, '03-resampled-16khz.wav'), 16000);
  console.log('   Saved: 03-resampled-16khz.wav');
  
  console.log(`\n✅ Test complete! Check files in ${testDir}/`);
  console.log('   Play the files to hear if there\'s distortion or noise.');
}

function getPeak(buffer, byteOrder) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = byteOrder === 'BE' 
      ? Math.abs(buffer.readInt16BE(i))
      : Math.abs(buffer.readInt16LE(i));
    peak = Math.max(peak, sample);
  }
  return peak;
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
testPipeline().catch(console.error);

