import fs from 'fs';

const filePath = '/Users/yanfuzhu/Downloads/orgs_yanfus_personal_workspace_mj6bu8a7_recordings_2025-12-28_dm-no-reply@leanworks.ai-yanfu@leanworks.ai-1766959654234_yanfu@leanworks.ai_chunk_0.wav';

const buffer = fs.readFileSync(filePath);

// Find data chunk
let dataOffset = 36;
while (dataOffset < buffer.length) {
  const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
  const chunkSize = buffer.readUInt32LE(dataOffset + 4);
  
  if (chunkId === 'data') {
    const pcmDataStart = dataOffset + 8;
    const pcmDataSize = chunkSize;
    
    console.log('=== Detailed Audio Analysis ===\n');
    
    // Analyze samples throughout the file
    const numSamples = pcmDataSize / 2;
    const samplesToCheck = Math.min(1000, numSamples);
    
    let zeroCount = 0;
    let maxSample = 0;
    let minSample = 0;
    let samples = [];
    
    // Check first 100 samples
    console.log('First 50 samples (as little-endian):');
    for (let i = 0; i < Math.min(50, numSamples); i++) {
      const offset = pcmDataStart + (i * 2);
      if (offset + 1 < buffer.length) {
        const sampleLE = buffer.readInt16LE(offset);
        const sampleBE = buffer.readInt16BE(offset);
        samples.push({ le: sampleLE, be: sampleBE });
        if (sampleLE === 0) zeroCount++;
        maxSample = Math.max(maxSample, Math.abs(sampleLE));
        minSample = Math.min(minSample, sampleLE);
      }
    }
    
    samples.slice(0, 20).forEach((s, i) => {
      console.log(`  Sample ${i}: LE=${s.le.toString().padStart(6)}, BE=${s.be.toString().padStart(6)}`);
    });
    
    // Check middle samples
    console.log('\nMiddle 20 samples (around sample ' + Math.floor(numSamples / 2) + '):');
    const middleStart = Math.floor(numSamples / 2);
    for (let i = 0; i < 20; i++) {
      const offset = pcmDataStart + ((middleStart + i) * 2);
      if (offset + 1 < buffer.length) {
        const sampleLE = buffer.readInt16LE(offset);
        const sampleBE = buffer.readInt16BE(offset);
        console.log(`  Sample ${middleStart + i}: LE=${sampleLE.toString().padStart(6)}, BE=${sampleBE.toString().padStart(6)}`);
      }
    }
    
    // Check last samples
    console.log('\nLast 20 samples:');
    const lastStart = numSamples - 20;
    for (let i = 0; i < 20; i++) {
      const offset = pcmDataStart + ((lastStart + i) * 2);
      if (offset + 1 < buffer.length) {
        const sampleLE = buffer.readInt16LE(offset);
        const sampleBE = buffer.readInt16BE(offset);
        console.log(`  Sample ${lastStart + i}: LE=${sampleLE.toString().padStart(6)}, BE=${sampleBE.toString().padStart(6)}`);
      }
    }
    
    // Calculate statistics
    let lePeak = 0;
    let bePeak = 0;
    let leAvg = 0;
    let beAvg = 0;
    let leNonZero = 0;
    let beNonZero = 0;
    
    for (let i = 0; i < samplesToCheck; i++) {
      const offset = pcmDataStart + (i * 2);
      if (offset + 1 < buffer.length) {
        const le = Math.abs(buffer.readInt16LE(offset));
        const be = Math.abs(buffer.readInt16BE(offset));
        lePeak = Math.max(lePeak, le);
        bePeak = Math.max(bePeak, be);
        leAvg += le;
        beAvg += be;
        if (le > 0) leNonZero++;
        if (be > 0) beNonZero++;
      }
    }
    
    leAvg /= samplesToCheck;
    beAvg /= samplesToCheck;
    
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
    
    if (bePeak > lePeak * 2) {
      console.log(`\n⚠️  WARNING: Big-endian values are ${(bePeak/lePeak).toFixed(2)}x larger!`);
      console.log(`   This suggests the audio might be in big-endian format but being read as little-endian.`);
    } else if (lePeak > bePeak * 2) {
      console.log(`\n✅ Little-endian appears correct (LE peak is ${(lePeak/bePeak).toFixed(2)}x larger)`);
    } else {
      console.log(`\n⚠️  Both interpretations are similar - might be silence or low-level noise`);
    }
    
    // Check for patterns that suggest wrong sample rate
    console.log('\n=== Sample Rate Verification ===');
    console.log(`Total samples: ${numSamples}`);
    console.log(`If 48kHz: duration = ${(numSamples / 48000).toFixed(3)}s`);
    console.log(`If 16kHz: duration = ${(numSamples / 16000).toFixed(3)}s`);
    console.log(`If 8kHz: duration = ${(numSamples / 8000).toFixed(3)}s`);
    
    // Check if audio looks like it was recorded at 16kHz but header says 48kHz
    // If audio is 16kHz but header says 48kHz, we'd expect 3x fewer samples
    // But we have 720k samples which matches 48kHz for 15s
    
    // However, if the audio was recorded at 16kHz and then padded/duplicated to match 48kHz header,
    // we might see repeating patterns
    console.log('\n=== Pattern Detection (checking for sample duplication) ===');
    let patternMatches = 0;
    const patternLength = 160; // 160 samples = 10ms at 16kHz, 3.33ms at 48kHz
    for (let i = 0; i < Math.min(100, numSamples - patternLength * 2); i++) {
      let matches = 0;
      for (let j = 0; j < patternLength; j++) {
        const offset1 = pcmDataStart + ((i + j) * 2);
        const offset2 = pcmDataStart + ((i + patternLength + j) * 2);
        if (offset1 + 1 < buffer.length && offset2 + 1 < buffer.length) {
          const sample1 = buffer.readInt16LE(offset1);
          const sample2 = buffer.readInt16LE(offset2);
          if (Math.abs(sample1 - sample2) < 10) matches++; // Allow small differences
        }
      }
      if (matches > patternLength * 0.9) patternMatches++;
    }
    
    if (patternMatches > 5) {
      console.log(`⚠️  Found ${patternMatches} repeating patterns - might indicate sample duplication`);
    } else {
      console.log(`✅ No obvious repeating patterns detected`);
    }
    
    break;
  }
  
  dataOffset += 8 + chunkSize;
  if (chunkSize % 2 === 1) dataOffset++;
}

