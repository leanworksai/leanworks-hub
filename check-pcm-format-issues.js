#!/usr/bin/env node
/**
 * Check PCM format issues that can cause audio to sound "wrong"
 * 
 * Checks for:
 * 1. Sample rate mismatch (48k vs 16k) → chipmunk/slow
 * 2. Channels/interleaving (stereo interpreted as mono) → weird artifacts
 * 3. Signed vs unsigned (PCM16 should be signed) → harsh distortion
 * 
 * Usage:
 *   node check-pcm-format-issues.js <file-path>
 *   OR pipe data: cat audio.bin | node check-pcm-format-issues.js
 */

const fs = require('fs');

function checkPCMFormatIssues(buffer, chunkDurationMs = 20) {
  console.log('\n📊 PCM Format Issue Analysis:');
  console.log(`   Buffer size: ${buffer.length} bytes`);
  console.log(`   Assumed chunk duration: ${chunkDurationMs}ms\n`);
  
  // Issue 1: Sample rate detection (assumes MONO)
  console.log('1️⃣ Sample Rate Detection (assumes MONO):');
  const samplesMono = buffer.length / 2; // 16-bit = 2 bytes per sample
  const durationSeconds = chunkDurationMs / 1000;
  const detectedRateMono = Math.round(samplesMono / durationSeconds);
  
  // If stereo, sample rate would be 2x
  const samplesStereo = buffer.length / 4; // Stereo: 2 channels * 2 bytes
  const detectedRateStereo = Math.round(samplesStereo / durationSeconds);
  
  console.log(`   If MONO: ${samplesMono} samples → ${detectedRateMono} Hz`);
  console.log(`   If STEREO: ${samplesStereo} samples → ${detectedRateStereo} Hz`);
  
  const standardRates = [8000, 16000, 22050, 44100, 48000];
  const closestMono = standardRates.reduce((prev, curr) => 
    Math.abs(curr - detectedRateMono) < Math.abs(prev - detectedRateMono) ? curr : prev
  );
  const closestStereo = standardRates.reduce((prev, curr) => 
    Math.abs(curr - detectedRateStereo) < Math.abs(prev - detectedRateStereo) ? curr : prev
  );
  
  console.log(`   Closest standard rate (MONO): ${closestMono} Hz`);
  console.log(`   Closest standard rate (STEREO): ${closestStereo} Hz`);
  
  // Check if size suggests stereo
  const expectedMono48kHz = 48000 * chunkDurationMs / 1000 * 2; // 1920 bytes for 20ms @ 48kHz mono
  const expectedStereo48kHz = 48000 * chunkDurationMs / 1000 * 2 * 2; // 3840 bytes for 20ms @ 48kHz stereo
  const expectedMono16kHz = 16000 * chunkDurationMs / 1000 * 2; // 640 bytes for 20ms @ 16kHz mono
  const expectedStereo16kHz = 16000 * chunkDurationMs / 1000 * 2 * 2; // 1280 bytes for 20ms @ 16kHz stereo
  
  const diffMono48 = Math.abs(buffer.length - expectedMono48kHz);
  const diffStereo48 = Math.abs(buffer.length - expectedStereo48kHz);
  const diffMono16 = Math.abs(buffer.length - expectedMono16kHz);
  const diffStereo16 = Math.abs(buffer.length - expectedStereo16kHz);
  
  const minDiff = Math.min(diffMono48, diffStereo48, diffMono16, diffStereo16);
  
  if (minDiff === diffStereo48 || minDiff === diffStereo16) {
    console.log(`\n   ❌ WARNING: Chunk size suggests STEREO format!`);
    console.log(`      Size: ${buffer.length} bytes`);
    console.log(`      Expected stereo 48kHz: ${expectedStereo48kHz} bytes (diff: ${diffStereo48})`);
    console.log(`      Expected stereo 16kHz: ${expectedStereo16kHz} bytes (diff: ${diffStereo16})`);
    console.log(`      Expected mono 48kHz: ${expectedMono48kHz} bytes (diff: ${diffMono48})`);
    console.log(`      Expected mono 16kHz: ${expectedMono16kHz} bytes (diff: ${diffMono16})`);
    console.log(`      → If treated as mono, sample rate will be detected as 2x too high!`);
    console.log(`      → This causes chipmunk/slow playback issues!`);
  } else {
    console.log(`\n   ✅ Chunk size suggests MONO format (expected)`);
  }
  
  // Issue 2: Check for stereo interleaving pattern
  console.log('\n2️⃣ Stereo Interleaving Check:');
  if (buffer.length >= 8) {
    // Check if samples alternate (stereo interleaving: L, R, L, R...)
    const sample0 = buffer.readInt16LE(0);
    const sample1 = buffer.readInt16LE(2);
    const sample2 = buffer.readInt16LE(4);
    const sample3 = buffer.readInt16LE(6);
    
    // If stereo, sample0 and sample2 should be similar (left channel)
    // and sample1 and sample3 should be similar (right channel)
    const leftDiff = Math.abs(sample0 - sample2);
    const rightDiff = Math.abs(sample1 - sample3);
    const crossDiff1 = Math.abs(sample0 - sample1);
    const crossDiff2 = Math.abs(sample2 - sample3);
    
    console.log(`   First 4 samples: [${sample0}, ${sample1}, ${sample2}, ${sample3}]`);
    console.log(`   Left channel diff (0 vs 2): ${leftDiff}`);
    console.log(`   Right channel diff (1 vs 3): ${rightDiff}`);
    console.log(`   Cross-channel diff (0 vs 1): ${crossDiff1}`);
    console.log(`   Cross-channel diff (2 vs 3): ${crossDiff2}`);
    
    if (leftDiff < crossDiff1 && rightDiff < crossDiff2 && leftDiff < 1000 && rightDiff < 1000) {
      console.log(`\n   ⚠️  WARNING: Pattern suggests STEREO interleaving!`);
      console.log(`      → Left channel samples (0, 2) are more similar than cross-channel`);
      console.log(`      → Right channel samples (1, 3) are more similar than cross-channel`);
      console.log(`      → If treated as mono, will cause weird artifacts!`);
    } else {
      console.log(`\n   ✅ Pattern suggests MONO format (expected)`);
    }
  }
  
  // Issue 3: Signed vs Unsigned
  console.log('\n3️⃣ Signed vs Unsigned PCM Check:');
  if (buffer.length >= 4) {
    const sample1Signed = buffer.readInt16LE(0);
    const sample2Signed = buffer.readInt16LE(2);
    const sample1Unsigned = buffer.readUInt16LE(0);
    const sample2Unsigned = buffer.readUInt16LE(2);
    
    console.log(`   Sample 1: signed=${sample1Signed}, unsigned=${sample1Unsigned}`);
    console.log(`   Sample 2: signed=${sample2Signed}, unsigned=${sample2Unsigned}`);
    
    const maxSigned = Math.max(Math.abs(sample1Signed), Math.abs(sample2Signed));
    const maxUnsigned = Math.max(sample1Unsigned, sample2Unsigned);
    
    // Check if unsigned interpretation makes more sense
    if (maxUnsigned > 32767 && maxSigned < 1000) {
      console.log(`\n   ❌ CRITICAL: Audio appears to be UNSIGNED PCM!`);
      console.log(`      Unsigned values: ${sample1Unsigned}, ${sample2Unsigned} (range: 0-65535)`);
      console.log(`      Signed values: ${sample1Signed}, ${sample2Signed} (range: -32768 to 32767)`);
      console.log(`      → If treated as signed, will cause harsh distortion!`);
      console.log(`      → Need to convert: signed = unsigned - 32768`);
    } else {
      console.log(`\n   ✅ Audio appears to be SIGNED PCM16 (expected)`);
      console.log(`      Values are in range -32768 to 32767`);
    }
  }
  
  // Summary
  console.log('\n📋 Summary:');
  const issues = [];
  
  if (minDiff === diffStereo48 || minDiff === diffStereo16) {
    issues.push('STEREO interpreted as MONO');
  }
  
  if (buffer.length >= 4) {
    const sample1Unsigned = buffer.readUInt16LE(0);
    const sample2Unsigned = buffer.readUInt16LE(2);
    const maxUnsigned = Math.max(sample1Unsigned, sample2Unsigned);
    const sample1Signed = buffer.readInt16LE(0);
    const sample2Signed = buffer.readInt16LE(2);
    const maxSigned = Math.max(Math.abs(sample1Signed), Math.abs(sample2Signed));
    
    if (maxUnsigned > 32767 && maxSigned < 1000) {
      issues.push('UNSIGNED interpreted as SIGNED');
    }
  }
  
  if (issues.length === 0) {
    console.log('   ✅ No format issues detected (assuming MONO, SIGNED PCM16)');
  } else {
    console.log(`   ❌ Issues detected:`);
    issues.forEach(issue => console.log(`      - ${issue}`));
  }
}

// Main execution
if (process.argv.length > 2) {
  // Read from file
  const filePath = process.argv[2];
  console.log(`Reading from file: ${filePath}`);
  
  try {
    const buffer = fs.readFileSync(filePath);
    console.log(`File size: ${buffer.length} bytes`);
    checkPCMFormatIssues(buffer);
  } catch (error) {
    console.error(`❌ Error reading file: ${error.message}`);
    process.exit(1);
  }
} else {
  // Read from stdin
  console.log('Reading from stdin (pipe data or press Ctrl+D to end)...');
  
  const chunks = [];
  process.stdin.on('data', (chunk) => {
    chunks.push(chunk);
  });
  
  process.stdin.on('end', () => {
    const buffer = Buffer.concat(chunks);
    console.log(`Received ${buffer.length} bytes from stdin`);
    checkPCMFormatIssues(buffer);
  });
  
  process.stdin.on('error', (error) => {
    console.error(`❌ Error reading from stdin: ${error.message}`);
    process.exit(1);
  });
}

