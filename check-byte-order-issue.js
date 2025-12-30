#!/usr/bin/env node
/**
 * Check byte order issue in resampler output
 * 
 * This script helps diagnose the byte order issue by:
 * 1. Showing raw bytes (byte-level view, not word-grouped)
 * 2. Comparing LE vs BE interpretations
 * 3. Checking if the issue is in reading or writing
 * 
 * Usage:
 *   node check-byte-order-issue.js <file-path>
 */

const fs = require('fs');

function analyzeByteOrder(buffer, offset = 0, numSamples = 10) {
  console.log('\n📊 Byte-Level Analysis:');
  console.log('   Using byte-level view (not word-grouped) to avoid hexdump confusion\n');
  
  // Show raw bytes for first few samples
  console.log('Raw bytes (first 20 bytes = 10 samples):');
  const bytesToShow = Math.min(20, buffer.length - offset);
  const hexBytes = [];
  const decimalBytes = [];
  
  for (let i = 0; i < bytesToShow; i++) {
    const byte = buffer[offset + i];
    hexBytes.push(`0x${byte.toString(16).padStart(2, '0')}`);
    decimalBytes.push(byte.toString().padStart(3));
  }
  
  console.log(`   Hex:     ${hexBytes.join(' ')}`);
  console.log(`   Decimal: ${decimalBytes.join(' ')}`);
  console.log();
  
  // Analyze samples as LE and BE
  console.log('Sample Analysis (comparing LE vs BE interpretation):');
  console.log('   Offset | Bytes (hex) | LE Value | BE Value | LE Abs | BE Abs | Ratio');
  console.log('   ' + '-'.repeat(70));
  
  let leMax = 0;
  let beMax = 0;
  let leSum = 0;
  let beSum = 0;
  let count = 0;
  
  for (let i = 0; i < numSamples && (offset + i * 2 + 1) < buffer.length; i++) {
    const byteOffset = offset + i * 2;
    const byte0 = buffer[byteOffset];
    const byte1 = buffer[byteOffset + 1];
    
    const leValue = buffer.readInt16LE(byteOffset);
    const beValue = buffer.readInt16BE(byteOffset);
    const leAbs = Math.abs(leValue);
    const beAbs = Math.abs(beValue);
    
    leMax = Math.max(leMax, leAbs);
    beMax = Math.max(beMax, beAbs);
    leSum += leAbs;
    beSum += beAbs;
    count++;
    
    const ratio = beAbs > 0 ? (leAbs / beAbs).toFixed(2) : 'N/A';
    const bytesHex = `0x${byte0.toString(16).padStart(2, '0')} 0x${byte1.toString(16).padStart(2, '0')}`;
    
    console.log(`   ${byteOffset.toString().padStart(6)} | ${bytesHex} | ${leValue.toString().padStart(8)} | ${beValue.toString().padStart(8)} | ${leAbs.toString().padStart(6)} | ${beAbs.toString().padStart(6)} | ${ratio}x`);
  }
  
  const leAvg = leSum / count;
  const beAvg = beSum / count;
  const peakRatio = beMax > 0 ? (leMax / beMax).toFixed(2) : 'N/A';
  const avgRatio = beAvg > 0 ? (leAvg / beAvg).toFixed(2) : 'N/A';
  
  console.log();
  console.log('Summary:');
  console.log(`   LE Peak: ${leMax}, BE Peak: ${beMax}, Ratio: ${peakRatio}x`);
  console.log(`   LE Avg:  ${leAvg.toFixed(1)}, BE Avg:  ${beAvg.toFixed(1)}, Ratio: ${avgRatio}x`);
  
  // Determine which interpretation makes more sense
  console.log();
  if (beMax > leMax * 2 && leMax < 1000) {
    console.log('❌ CRITICAL: Big-endian interpretation gives much higher values!');
    console.log('   This suggests the data might actually be in BIG-ENDIAN format.');
    console.log('   But the code is reading/writing as LITTLE-ENDIAN.');
    console.log('   → This is the "monster/metallic" sound issue!');
    console.log('   → Need to check if code is using readInt16BE instead of readInt16LE');
    return 'BE_DATA_AS_LE';
  } else if (leMax > beMax * 2) {
    console.log('✅ Little-endian interpretation appears correct');
    console.log('   LE values are higher and more reasonable than BE values.');
    return 'LE_CORRECT';
  } else {
    console.log('⚠️  Both interpretations give similar values');
    console.log('   This might indicate the data is near-zero or has a specific pattern.');
    return 'UNCLEAR';
  }
}

// Check if this looks like a WAV file
function checkWavFile(buffer) {
  if (buffer.length < 44) {
    return null;
  }
  
  const riffId = buffer.toString('ascii', 0, 4);
  if (riffId !== 'RIFF') {
    return null;
  }
  
  // Find data chunk
  let dataOffset = 36;
  while (dataOffset < buffer.length) {
    const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);
    
    if (chunkId === 'data') {
      return dataOffset + 8; // Return start of PCM data
    }
    
    dataOffset += 8 + chunkSize;
    if (chunkSize % 2 === 1) dataOffset++; // Pad to even boundary
  }
  
  return null;
}

// Main execution
if (process.argv.length > 2) {
  const filePath = process.argv[2];
  console.log(`Reading from file: ${filePath}`);
  
  try {
    const buffer = fs.readFileSync(filePath);
    console.log(`File size: ${buffer.length} bytes`);
    
    // Check if it's a WAV file
    const pcmDataStart = checkWavFile(buffer);
    if (pcmDataStart) {
      console.log(`\n✅ Detected WAV file - PCM data starts at offset ${pcmDataStart}`);
      analyzeByteOrder(buffer, pcmDataStart, 20);
    } else {
      console.log(`\n⚠️  Not a WAV file (or too small) - analyzing from start`);
      analyzeByteOrder(buffer, 0, 20);
    }
  } catch (error) {
    console.error(`❌ Error reading file: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log('Usage: node check-byte-order-issue.js <file-path>');
  console.log('\nThis script helps diagnose byte order issues by:');
  console.log('1. Showing raw bytes (byte-level, not word-grouped)');
  console.log('2. Comparing LE vs BE interpretations');
  console.log('3. Identifying if data is BE but being read as LE');
  process.exit(1);
}

