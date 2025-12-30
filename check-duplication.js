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
    const numSamples = chunkSize / 2;
    
    console.log('=== Checking for Sample Duplication ===\n');
    console.log(`Total samples: ${numSamples}`);
    console.log(`Checking if audio is 16kHz duplicated to 48kHz...\n`);
    
    // Check if samples repeat every 3 samples (16kHz -> 48kHz duplication)
    // If audio is 16kHz duplicated 3x, samples at positions 0,1,2 should be similar
    // and then samples at 3,4,5 should be similar, etc.
    
    // Find a section with actual audio (skip initial silence)
    let audioStart = 0;
    for (let i = 1000; i < numSamples - 100; i++) {
      const offset = pcmDataStart + (i * 2);
      if (Math.abs(buffer.readInt16LE(offset)) > 100) {
        audioStart = i;
        break;
      }
    }
    
    console.log(`Found audio starting at sample ${audioStart}\n`);
    
    // Check for 3x duplication pattern
    let tripleMatches = 0;
    let tripleMismatches = 0;
    const checkSamples = 100; // Check 100 groups
    
    for (let group = 0; group < checkSamples; group++) {
      const baseIdx = audioStart + (group * 3);
      if (baseIdx + 2 >= numSamples) break;
      
      const s0 = buffer.readInt16LE(pcmDataStart + (baseIdx * 2));
      const s1 = buffer.readInt16LE(pcmDataStart + ((baseIdx + 1) * 2));
      const s2 = buffer.readInt16LE(pcmDataStart + ((baseIdx + 2) * 2));
      
      // Check if s0, s1, s2 are similar (within 5% or 50 units)
      const avg = (Math.abs(s0) + Math.abs(s1) + Math.abs(s2)) / 3;
      const threshold = Math.max(50, avg * 0.05);
      
      const diff01 = Math.abs(s0 - s1);
      const diff12 = Math.abs(s1 - s2);
      const diff02 = Math.abs(s0 - s2);
      
      if (diff01 < threshold && diff12 < threshold && diff02 < threshold) {
        tripleMatches++;
      } else {
        tripleMismatches++;
      }
      
      if (group < 10) {
        console.log(`Group ${group} (samples ${baseIdx}-${baseIdx+2}): [${s0}, ${s1}, ${s2}] - diffs: [${diff01}, ${diff12}, ${diff02}]`);
      }
    }
    
    console.log(`\n=== Results ===`);
    console.log(`Triple matches (samples 0,1,2 similar): ${tripleMatches}/${checkSamples} (${(tripleMatches/checkSamples*100).toFixed(1)}%)`);
    console.log(`Triple mismatches: ${tripleMismatches}/${checkSamples} (${(tripleMismatches/checkSamples*100).toFixed(1)}%)`);
    
    if (tripleMatches > checkSamples * 0.7) {
      console.log(`\n❌ CRITICAL: Audio appears to be 16kHz duplicated 3x to match 48kHz header!`);
      console.log(`   This would cause playback at 1/3 speed (deep voice)`);
      console.log(`   Actual sample rate: ~16kHz`);
      console.log(`   Header claims: 48kHz`);
      console.log(`   Playback speed: 16kHz/48kHz = 0.333x (3x slower)`);
    } else {
      // Check if it's actually 16kHz audio (every 3rd sample is different)
      // If it's real 48kHz, samples should vary smoothly
      // If it's 16kHz duplicated, every 3rd sample should be identical
      
      console.log(`\nChecking if every 3rd sample is identical (16kHz -> 48kHz duplication)...`);
      let identicalMatches = 0;
      let identicalMismatches = 0;
      
      for (let i = 0; i < checkSamples * 3; i += 3) {
        const idx = audioStart + i;
        if (idx + 3 >= numSamples) break;
        
        const s0 = buffer.readInt16LE(pcmDataStart + (idx * 2));
        const s1 = buffer.readInt16LE(pcmDataStart + ((idx + 1) * 2));
        const s2 = buffer.readInt16LE(pcmDataStart + ((idx + 2) * 2));
        const s3 = buffer.readInt16LE(pcmDataStart + ((idx + 3) * 2));
        
        // If duplicated, s0 should equal s3 (next group's first sample)
        if (s0 === s3) {
          identicalMatches++;
        } else {
          identicalMismatches++;
        }
      }
      
      console.log(`Every-3rd-sample identical: ${identicalMatches}/${checkSamples} (${(identicalMatches/checkSamples*100).toFixed(1)}%)`);
      
      if (identicalMatches > checkSamples * 0.5) {
        console.log(`\n❌ CRITICAL: Audio is 16kHz duplicated to 48kHz!`);
        console.log(`   Pattern: sample[i] == sample[i+3] (every 3rd sample repeats)`);
        console.log(`   Actual sample rate: 16kHz`);
        console.log(`   Header claims: 48kHz`);
        console.log(`   This causes 3x slower playback (deep voice)`);
      } else {
        console.log(`\n✅ Audio appears to be genuine 48kHz (no obvious duplication pattern)`);
        console.log(`   However, the "deep voice" issue might be caused by:`);
        console.log(`   1. Resampling artifacts`);
        console.log(`   2. Byte order issues`);
        console.log(`   3. Playback software interpreting the file incorrectly`);
      }
    }
    
    // Calculate actual sample rate if we assume it's duplicated
    if (tripleMatches > checkSamples * 0.7) {
      const actualSampleRate = 48000 / 3; // If duplicated 3x
      console.log(`\n=== Actual Sample Rate ===`);
      console.log(`If duplicated 3x: Actual = ${actualSampleRate} Hz`);
      console.log(`Header says: 48000 Hz`);
      console.log(`Mismatch factor: ${48000 / actualSampleRate}x`);
    }
    
    break;
  }
  
  dataOffset += 8 + chunkSize;
  if (chunkSize % 2 === 1) dataOffset++;
}

