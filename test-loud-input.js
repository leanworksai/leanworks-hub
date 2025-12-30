/**
 * Test with Loud Input
 * Simulates the loud input scenario (peaks of 30721-32512) to reproduce the issue
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testLoudInput() {
  console.log('=== Testing Loud Input Scenario ===\n');
  
  // Simulate loud input (peaks of 30721-32512 as seen in logs)
  const testAmplitudes = [10000, 20000, 25000, 30000, 30721, 32512];
  
  for (const amplitude of testAmplitudes) {
    console.log(`\n--- Testing with amplitude: ${amplitude} ---`);
    
    // Generate sine wave at this amplitude
    const sampleRate = 48000;
    const duration = 1;
    const frequency = 440;
    const numSamples = sampleRate * duration;
    
    const testAudioBE = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * t));
      testAudioBE.writeInt16BE(sample, i * 2);
    }
    
    // Byte swap (BE → LE)
    const swappedAudio = Buffer.alloc(testAudioBE.length);
    for (let i = 0; i < testAudioBE.length; i += 2) {
      const beValue = testAudioBE.readInt16BE(i);
      swappedAudio.writeInt16LE(beValue, i);
    }
    
    const inputPeak = getPeak(swappedAudio, 'LE');
    console.log(`   Input peak: ${inputPeak}`);
    
    // Simulate processing pipeline
    const inputSamples = swappedAudio.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    
    // Normalize with gain reduction (0.5x)
    const INPUT_GAIN = 0.5;
    const inputFloat = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      const sample = swappedAudio.readInt16LE(i * 2);
      inputFloat[i] = (sample / 32768.0) * INPUT_GAIN;
    }
    
    const maxInputFloat = Math.max(...Array.from(inputFloat).map(Math.abs));
    console.log(`   Normalized peak (after 0.5x gain): ${(maxInputFloat * 32768).toFixed(0)}`);
    
    // Resample (simple decimation with potential amplification)
    const RESAMPLER_AMP = 1.10; // 10% amplification (worst case)
    const outputFloat = new Float32Array(outputSamples);
    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = i * 3;
      if (inputIndex < inputSamples) {
        outputFloat[i] = inputFloat[inputIndex] * RESAMPLER_AMP;
      }
    }
    
    const maxOutputFloat = Math.max(...Array.from(outputFloat).map(Math.abs));
    console.log(`   After resampler (10% amp): ${(maxOutputFloat * 32768).toFixed(0)}`);
    
    // Soft limiter (threshold 0.8)
    const LIMITER_THRESHOLD = 0.8;
    const outputFloatLimited = new Float32Array(outputSamples);
    let limitedCount = 0;
    for (let i = 0; i < outputSamples; i++) {
      const value = outputFloat[i];
      if (Math.abs(value) > LIMITER_THRESHOLD) {
        limitedCount++;
        const sign = value >= 0 ? 1 : -1;
        const normalized = Math.abs(value) / LIMITER_THRESHOLD;
        const compressed = Math.tanh(normalized * 2.0) * LIMITER_THRESHOLD;
        outputFloatLimited[i] = sign * compressed;
      } else {
        outputFloatLimited[i] = value;
      }
    }
    
    const maxLimited = Math.max(...Array.from(outputFloatLimited).map(Math.abs));
    console.log(`   After soft limiter (0.8): ${(maxLimited * 32768).toFixed(0)}`);
    if (limitedCount > 0) {
      console.log(`   Limiter triggered: ${limitedCount} samples (${(limitedCount/outputSamples*100).toFixed(1)}%)`);
    }
    
    // Denormalize
    const resampledAudio = Buffer.alloc(outputSamples * 2);
    let clippedCount = 0;
    let maxOutput = 0;
    for (let i = 0; i < outputSamples; i++) {
      const floatValue = Math.max(-1.0, Math.min(1.0, outputFloatLimited[i]));
      const sample = Math.max(-32768, Math.min(32767, Math.round(floatValue * 32768.0)));
      resampledAudio.writeInt16LE(sample, i * 2);
      maxOutput = Math.max(maxOutput, Math.abs(sample));
      if (Math.abs(sample) >= 32767) {
        clippedCount++;
      }
    }
    
    console.log(`   Final output peak: ${maxOutput}`);
    if (clippedCount > 0) {
      console.log(`   ❌ CLIPPING: ${clippedCount} samples (${(clippedCount/outputSamples*100).toFixed(2)}%)`);
    } else {
      console.log(`   ✅ No clipping`);
    }
    
    // Check if output is too loud
    if (maxOutput > 20000) {
      console.log(`   ⚠️  Output is very loud (${maxOutput}) - might sound distorted`);
    } else if (maxOutput > 15000) {
      console.log(`   ⚠️  Output is moderately loud (${maxOutput})`);
    } else {
      console.log(`   ✅ Output level is reasonable (${maxOutput})`);
    }
    
    // Save for inspection if it's a problematic case
    if (maxOutput > 20000 || clippedCount > 0) {
      const testDir = path.join(__dirname, 'test-audio-output');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      saveAsWav(resampledAudio, path.join(testDir, `loud-input-${amplitude}-output.wav`), 16000);
      console.log(`   Saved: loud-input-${amplitude}-output.wav`);
    }
  }
  
  console.log('\n✅ Loud input test complete!');
  console.log('   Check test-audio-output/ for saved files');
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

function saveAsWav(pcmData, filepath, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;
  
  const wavHeader = Buffer.alloc(44);
  
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(fileSize, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataSize, 40);
  
  const wavFile = Buffer.concat([wavHeader, pcmData]);
  fs.writeFileSync(filepath, wavFile);
}

testLoudInput().catch(console.error);

