import { Storage } from '@google-cloud/storage';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// GCS path: gs://leanworks-prod/orgs/yanfus_personal_workspace_mj6bu8a7/recordings/2025-12-29/dm-no-reply@leanworks.ai-yanfu@leanworks.ai-1767066148771/yanfu@leanworks.ai/chunk_0.wav
const gcsPath = process.argv[2] || 'gs://leanworks-prod/orgs/yanfus_personal_workspace_mj6bu8a7/recordings/2025-12-29/dm-no-reply@leanworks.ai-yanfu@leanworks.ai-1767066148771/yanfu@leanworks.ai/chunk_0.wav';

async function downloadAndAnalyze() {
  try {
    // Initialize GCS client
    const serviceAccountPath = join(process.cwd(), 'gcp_credential.json');
    let storage;
    
    if (existsSync(serviceAccountPath)) {
      storage = new Storage({
        keyFilename: serviceAccountPath,
      });
      console.log('✅ Using GCP credentials from:', serviceAccountPath);
    } else {
      storage = new Storage();
      console.log('✅ Using default GCP credentials');
    }
    
    // Parse GCS path
    const [bucketName, ...pathParts] = gcsPath.replace('gs://', '').split('/');
    const filePath = pathParts.join('/');
    
    console.log(`📥 Downloading: ${gcsPath}`);
    console.log(`   Bucket: ${bucketName}`);
    console.log(`   Path: ${filePath}\n`);
    
    const file = storage.bucket(bucketName).file(filePath);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`File does not exist: ${gcsPath}`);
    }
    
    // Download file
    const [buffer] = await file.download();
    console.log(`✅ Downloaded ${buffer.length} bytes\n`);
    
    // Analyze the WAV file
    analyzeWav(buffer);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function analyzeWav(buffer) {
  console.log('=== WAV File Analysis ===\n');
  
  // Check WAV header
  if (buffer.length < 44) {
    console.error('❌ File too small to be a valid WAV file');
    return;
  }
  
  const riffId = buffer.toString('ascii', 0, 4);
  const waveId = buffer.toString('ascii', 8, 12);
  
  if (riffId !== 'RIFF') {
    console.error(`❌ Invalid RIFF header: ${riffId}`);
    return;
  }
  
  if (waveId !== 'WAVE') {
    console.error(`❌ Invalid WAVE header: ${waveId}`);
    return;
  }
  
  console.log('✅ Valid WAV file format');
  
  // Read WAV header
  const fileSize = buffer.readUInt32LE(4);
  const audioFormat = buffer.readUInt16LE(20);
  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const byteRate = buffer.readUInt32LE(28);
  const blockAlign = buffer.readUInt16LE(32);
  const bitsPerSample = buffer.readUInt16LE(34);
  
  console.log('\n=== WAV Header Information ===');
  console.log(`File size (from header): ${fileSize + 8} bytes`);
  console.log(`Audio format: ${audioFormat} (1 = PCM)`);
  console.log(`Channels: ${numChannels}`);
  console.log(`Sample rate: ${sampleRate} Hz`);
  console.log(`Byte rate: ${byteRate} bytes/sec`);
  console.log(`Block align: ${blockAlign} bytes`);
  console.log(`Bits per sample: ${bitsPerSample}`);
  
  // Find data chunk
  let dataOffset = 36;
  let pcmDataStart = 0;
  let pcmDataSize = 0;
  
  while (dataOffset < buffer.length) {
    const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);
    
    if (chunkId === 'data') {
      pcmDataStart = dataOffset + 8;
      pcmDataSize = chunkSize;
      break;
    }
    
    dataOffset += 8 + chunkSize;
    if (chunkSize % 2 === 1) dataOffset++; // Pad to even boundary
  }
  
  if (pcmDataStart === 0) {
    console.error('❌ Could not find data chunk');
    return;
  }
  
  console.log(`\n=== PCM Data ===`);
  console.log(`Data chunk offset: ${pcmDataStart}`);
  console.log(`PCM data size: ${pcmDataSize} bytes`);
  console.log(`Expected samples: ${pcmDataSize / 2} (16-bit mono)`);
  console.log(`Expected duration: ${(pcmDataSize / 2 / sampleRate).toFixed(3)} seconds`);
  
  // Analyze samples
  const numSamples = pcmDataSize / 2;
  const samplesToCheck = Math.min(10000, numSamples);
  
  let zeroCount = 0;
  let maxSample = 0;
  let minSample = 0;
  let lePeak = 0;
  let bePeak = 0;
  let leAvg = 0;
  let beAvg = 0;
  let leNonZero = 0;
  let beNonZero = 0;
  let invalidSamples = 0;
  
  console.log(`\n=== Sample Analysis (checking ${samplesToCheck} samples) ===`);
  
  for (let i = 0; i < samplesToCheck; i++) {
    const offset = pcmDataStart + (i * 2);
    if (offset + 1 >= buffer.length) break;
    
    const sampleLE = buffer.readInt16LE(offset);
    const sampleBE = buffer.readInt16BE(offset);
    
    if (sampleLE === 0) zeroCount++;
    if (Math.abs(sampleLE) > 32767) invalidSamples++;
    
    maxSample = Math.max(maxSample, Math.abs(sampleLE));
    minSample = Math.min(minSample, sampleLE);
    
    const leAbs = Math.abs(sampleLE);
    const beAbs = Math.abs(sampleBE);
    
    lePeak = Math.max(lePeak, leAbs);
    bePeak = Math.max(bePeak, beAbs);
    leAvg += leAbs;
    beAvg += beAbs;
    
    if (leAbs > 0) leNonZero++;
    if (beAbs > 0) beNonZero++;
  }
  
  leAvg /= samplesToCheck;
  beAvg /= samplesToCheck;
  
  // Show first 20 samples
  console.log('\nFirst 20 samples (as little-endian):');
  for (let i = 0; i < Math.min(20, numSamples); i++) {
    const offset = pcmDataStart + (i * 2);
    if (offset + 1 < buffer.length) {
      const sampleLE = buffer.readInt16LE(offset);
      const sampleBE = buffer.readInt16BE(offset);
      console.log(`  Sample ${i}: LE=${sampleLE.toString().padStart(6)}, BE=${sampleBE.toString().padStart(6)}`);
    }
  }
  
  // Show middle samples
  if (numSamples > 40) {
    console.log('\nMiddle 20 samples:');
    const middleStart = Math.floor(numSamples / 2);
    for (let i = 0; i < 20; i++) {
      const offset = pcmDataStart + ((middleStart + i) * 2);
      if (offset + 1 < buffer.length) {
        const sampleLE = buffer.readInt16LE(offset);
        const sampleBE = buffer.readInt16BE(offset);
        console.log(`  Sample ${middleStart + i}: LE=${sampleLE.toString().padStart(6)}, BE=${sampleBE.toString().padStart(6)}`);
      }
    }
  }
  
  // Statistics
  console.log('\n=== Statistics ===');
  console.log(`Zero samples: ${zeroCount}/${samplesToCheck} (${(zeroCount/samplesToCheck*100).toFixed(1)}%)`);
  console.log(`Invalid samples (>32767): ${invalidSamples}`);
  console.log(`Min sample: ${minSample}`);
  console.log(`Max sample: ${maxSample}`);
  
  // Byte order analysis
  console.log('\n=== Byte Order Analysis ===');
  console.log(`Little-endian interpretation:`);
  console.log(`  Peak: ${lePeak} (${lePeak > 0 ? (20 * Math.log10(lePeak / 32768)).toFixed(2) : '-Inf'} dB)`);
  console.log(`  Average: ${leAvg.toFixed(2)}`);
  console.log(`  Non-zero samples: ${leNonZero}/${samplesToCheck} (${(leNonZero/samplesToCheck*100).toFixed(1)}%)`);
  console.log(`\nBig-endian interpretation:`);
  console.log(`  Peak: ${bePeak} (${bePeak > 0 ? (20 * Math.log10(bePeak / 32768)).toFixed(2) : '-Inf'} dB)`);
  console.log(`  Average: ${beAvg.toFixed(2)}`);
  console.log(`  Non-zero samples: ${beNonZero}/${samplesToCheck} (${(beNonZero/samplesToCheck*100).toFixed(1)}%)`);
  
  const ratio = bePeak > 0 ? lePeak / bePeak : 0;
  console.log(`\nPeak ratio (LE/BE): ${ratio.toFixed(3)}`);
  
  // Quality assessment
  console.log('\n=== Quality Assessment ===');
  
  if (invalidSamples > 0) {
    console.log(`❌ CRITICAL: Found ${invalidSamples} invalid samples (exceed 16-bit range)`);
  }
  
  if (bePeak > lePeak * 2) {
    console.log(`⚠️  WARNING: Big-endian values are ${(bePeak/lePeak).toFixed(2)}x larger!`);
    console.log(`   This suggests the audio might be in big-endian format but being read as little-endian.`);
    console.log(`   This would cause distorted/unintelligible audio.`);
  } else if (lePeak > bePeak * 2) {
    console.log(`✅ Little-endian appears correct (LE peak is ${(lePeak/bePeak).toFixed(2)}x larger)`);
  } else {
    console.log(`⚠️  Both interpretations are similar - might be silence or low-level noise`);
  }
  
  if (lePeak === 0) {
    console.log(`❌ CRITICAL: Audio is completely silent (all zeros)`);
  } else if (lePeak < 100) {
    console.log(`⚠️  WARNING: Audio is very quiet (peak=${lePeak}, ${(20 * Math.log10(lePeak / 32768)).toFixed(2)} dB)`);
  } else if (lePeak > 30000) {
    console.log(`⚠️  WARNING: Audio is very loud (peak=${lePeak}, ${(20 * Math.log10(lePeak / 32768)).toFixed(2)} dB) - might be clipping`);
  } else {
    console.log(`✅ Audio level appears normal (peak=${lePeak}, ${(20 * Math.log10(lePeak / 32768)).toFixed(2)} dB)`);
  }
  
  // Check for patterns that might indicate issues
  console.log('\n=== Pattern Detection ===');
  let repeatingPatterns = 0;
  const patternLength = 160; // 160 samples = 10ms at 16kHz
  for (let i = 0; i < Math.min(100, numSamples - patternLength * 2); i++) {
    let matches = 0;
    for (let j = 0; j < patternLength; j++) {
      const offset1 = pcmDataStart + ((i + j) * 2);
      const offset2 = pcmDataStart + ((i + patternLength + j) * 2);
      if (offset1 + 1 < buffer.length && offset2 + 1 < buffer.length) {
        const sample1 = buffer.readInt16LE(offset1);
        const sample2 = buffer.readInt16LE(offset2);
        if (Math.abs(sample1 - sample2) < 10) matches++;
      }
    }
    if (matches > patternLength * 0.9) repeatingPatterns++;
  }
  
  if (repeatingPatterns > 5) {
    console.log(`⚠️  Found ${repeatingPatterns} repeating patterns - might indicate sample duplication or corruption`);
  } else {
    console.log(`✅ No obvious repeating patterns detected`);
  }
  
  // Sample rate verification
  console.log('\n=== Sample Rate Verification ===');
  console.log(`Header sample rate: ${sampleRate} Hz`);
  console.log(`Total samples: ${numSamples}`);
  console.log(`If 48kHz: duration = ${(numSamples / 48000).toFixed(3)}s`);
  console.log(`If 16kHz: duration = ${(numSamples / 16000).toFixed(3)}s`);
  console.log(`If 8kHz: duration = ${(numSamples / 8000).toFixed(3)}s`);
  
  if (sampleRate === 16000) {
    const expectedDuration = numSamples / 16000;
    console.log(`✅ Sample rate matches expected 16kHz (duration: ${expectedDuration.toFixed(3)}s)`);
  } else if (sampleRate === 48000) {
    console.log(`⚠️  Sample rate is 48kHz - should be 16kHz for transcription`);
  } else {
    console.log(`⚠️  Unexpected sample rate: ${sampleRate} Hz`);
  }
  
  // Final verdict
  console.log('\n=== Final Verdict ===');
  const issues = [];
  if (invalidSamples > 0) issues.push('Invalid samples detected');
  if (bePeak > lePeak * 2) issues.push('Possible byte order issue');
  if (lePeak === 0) issues.push('Audio is silent');
  if (lePeak < 100 && lePeak > 0) issues.push('Audio is very quiet');
  if (repeatingPatterns > 5) issues.push('Repeating patterns detected');
  if (sampleRate !== 16000) issues.push(`Sample rate is ${sampleRate}Hz (expected 16kHz)`);
  
  if (issues.length === 0) {
    console.log('✅ Audio file appears to be normal and should sound correct');
  } else {
    console.log('⚠️  Issues detected:');
    issues.forEach(issue => console.log(`   - ${issue}`));
    console.log('\n❌ Audio file may have quality issues');
  }
}

downloadAndAnalyze();

