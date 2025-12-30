#!/usr/bin/env node
/**
 * Check audio format from LiveKit egress
 * 
 * This script checks if audio data starts with "OggS" header,
 * which indicates Ogg/Opus format instead of PCM16.
 * 
 * Usage:
 *   node check-audio-format.js <file-path>
 *   OR pipe data: cat audio.bin | node check-audio-format.js
 */

const fs = require('fs');
const readline = require('readline');

function checkFormat(buffer) {
  if (buffer.length < 4) {
    console.log('❌ Buffer too small to check format (need at least 4 bytes)');
    return;
  }
  
  const header = buffer.toString('ascii', 0, 4);
  const headerHex = buffer.slice(0, 4).toString('hex');
  const headerBytes = Array.from(buffer.slice(0, 4)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ');
  
  console.log('\n📊 Format Analysis:');
  console.log(`   First 4 bytes (ASCII): "${header}"`);
  console.log(`   First 4 bytes (hex): ${headerHex}`);
  console.log(`   First 4 bytes (decimal): ${headerBytes}`);
  
  if (header === 'OggS') {
    console.log('\n❌ CRITICAL: Stream is OGG/OPUS format!');
    console.log('   This is NOT PCM16. The code is incorrectly treating compressed Opus data as raw PCM16.');
    console.log('   This will cause severe audio corruption.');
    console.log('   Solution: Need to decode Opus, not byte-swap.');
    return 'ogg-opus';
  } else {
    console.log('\n✅ Stream does NOT start with "OggS"');
    console.log('   Assuming PCM16 format (expected for LiveKit egress).');
    
    // Check if it looks like PCM16 (should have reasonable sample values)
    if (buffer.length >= 4) {
      const sample1LE = buffer.readInt16LE(0);
      const sample1BE = buffer.readInt16BE(0);
      const sample2LE = buffer.readInt16LE(2);
      const sample2BE = buffer.readInt16BE(2);
      
      console.log('\n📊 Sample Analysis (first 2 samples):');
      console.log(`   Sample 1 (LE): ${sample1LE} (0x${sample1LE.toString(16)})`);
      console.log(`   Sample 1 (BE): ${sample1BE} (0x${sample1BE.toString(16)})`);
      console.log(`   Sample 2 (LE): ${sample2LE} (0x${sample2LE.toString(16)})`);
      console.log(`   Sample 2 (BE): ${sample2BE} (0x${sample2BE.toString(16)})`);
      
      const leMax = Math.max(Math.abs(sample1LE), Math.abs(sample2LE));
      const beMax = Math.max(Math.abs(sample1BE), Math.abs(sample2BE));
      
      // PCM16 samples should be in range -32768 to 32767
      // If BE values are much larger than LE, might be wrong byte order
      if (beMax > leMax * 2 && leMax < 1000) {
        console.log(`\n⚠️  WARNING: Big-endian values are ${(beMax/leMax).toFixed(2)}x larger!`);
        console.log('   This might indicate wrong byte order, but could also be valid PCM16.');
      } else if (leMax > beMax * 2) {
        console.log(`\n✅ Little-endian appears correct (LE max is ${(leMax/beMax).toFixed(2)}x larger)`);
      }
    }
    
    return 'pcm16';
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
    checkFormat(buffer);
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
    checkFormat(buffer);
  });
  
  process.stdin.on('error', (error) => {
    console.error(`❌ Error reading from stdin: ${error.message}`);
    process.exit(1);
  });
}

