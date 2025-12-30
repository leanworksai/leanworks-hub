import fs from 'fs';

const filePath = '/Users/yanfuzhu/Downloads/orgs_yanfus_personal_workspace_mj6bu8a7_recordings_2025-12-29_dm-no-reply@leanworks.ai-yanfu@leanworks.ai-1767033723173_yanfu@leanworks.ai_chunk_0.wav';

const buffer = fs.readFileSync(filePath);

// Read WAV header
const riffId = buffer.toString('ascii', 0, 4);
const fileSize = buffer.readUInt32LE(4);
const waveId = buffer.toString('ascii', 8, 12);

// fmt chunk
const fmtChunkSize = buffer.readUInt32LE(16);
const audioFormat = buffer.readUInt16LE(20);
const numChannels = buffer.readUInt16LE(22);
const sampleRateHeader = buffer.readUInt32LE(24); // Sample rate from header
const byteRate = buffer.readUInt32LE(28);
const blockAlign = buffer.readUInt16LE(32);
const bitsPerSample = buffer.readUInt16LE(34);

// Find data chunk
let dataOffset = 36;
while (dataOffset < buffer.length) {
  const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
  const chunkSize = buffer.readUInt32LE(dataOffset + 4);
  
  if (chunkId === 'data') {
    const pcmDataSize = chunkSize;
    const pcmDataStart = dataOffset + 8;
    const pcmDataEnd = pcmDataStart + pcmDataSize;
    
    // Calculate actual sample rate from PCM data
    const totalSamples = pcmDataSize / (bitsPerSample / 8) / numChannels;
    
    // Try to estimate duration from file (if we know it's 15 seconds from metadata)
    // Or calculate from expected vs actual
    const expectedDuration48kHz = totalSamples / 48000;
    const expectedDuration16kHz = totalSamples / 16000;
    
    // Calculate what sample rate would give us the actual data
    // If metadata says 15 seconds, use that
    const metadataDuration = 15; // seconds (from your metadata)
    const actualSampleRate = totalSamples / metadataDuration;
    
    console.log('=== WAV File Analysis ===');
    console.log(`RIFF ID: ${riffId}`);
    console.log(`WAVE ID: ${waveId}`);
    console.log(`File size: ${fileSize + 8} bytes`);
    console.log(`\n=== Header Information ===`);
    console.log(`Audio format: ${audioFormat} (1 = PCM)`);
    console.log(`Channels: ${numChannels} (${numChannels === 1 ? 'Mono' : 'Stereo'})`);
    console.log(`Sample rate (header): ${sampleRateHeader} Hz`);
    console.log(`Byte rate: ${byteRate} bytes/sec`);
    console.log(`Block align: ${blockAlign} bytes`);
    console.log(`Bits per sample: ${bitsPerSample}`);
    console.log(`\n=== PCM Data ===`);
    console.log(`PCM data size: ${pcmDataSize} bytes`);
    console.log(`Total samples: ${totalSamples}`);
    console.log(`\n=== Sample Rate Analysis ===`);
    console.log(`Header claims: ${sampleRateHeader} Hz`);
    console.log(`If played at ${sampleRateHeader} Hz, duration would be: ${expectedDuration48kHz.toFixed(3)} seconds`);
    console.log(`If played at 16kHz, duration would be: ${expectedDuration16kHz.toFixed(3)} seconds`);
    console.log(`\n=== Actual Sample Rate Calculation ===`);
    console.log(`If duration is 15 seconds (from metadata):`);
    console.log(`  Actual sample rate = ${totalSamples} samples / 15 seconds = ${actualSampleRate.toFixed(2)} Hz`);
    console.log(`\n=== Verification ===`);
    
    // Check if header matches actual
    const sampleRateDiff = Math.abs(sampleRateHeader - actualSampleRate);
    const sampleRateDiffPercent = (sampleRateDiff / actualSampleRate) * 100;
    
    if (sampleRateDiffPercent > 1) {
      console.log(`❌ MISMATCH DETECTED!`);
      console.log(`   Header says: ${sampleRateHeader} Hz`);
      console.log(`   Actual data: ${actualSampleRate.toFixed(2)} Hz`);
      console.log(`   Difference: ${sampleRateDiffPercent.toFixed(2)}%`);
      console.log(`\n   This will cause playback at wrong speed!`);
      if (sampleRateHeader > actualSampleRate) {
        const speedMultiplier = sampleRateHeader / actualSampleRate;
        console.log(`   Audio will play ${speedMultiplier.toFixed(2)}x SLOWER (deep voice)`);
      } else {
        const speedMultiplier = actualSampleRate / sampleRateHeader;
        console.log(`   Audio will play ${speedMultiplier.toFixed(2)}x FASTER (chipmunk voice)`);
      }
    } else {
      console.log(`✅ Sample rate matches!`);
    }
    
    // Sample some audio data to verify
    console.log(`\n=== Audio Data Sample (first 10 samples) ===`);
    for (let i = 0; i < Math.min(10, totalSamples); i++) {
      const offset = pcmDataStart + (i * blockAlign);
      if (offset + 1 < buffer.length) {
        const sample = buffer.readInt16LE(offset);
        console.log(`  Sample ${i}: ${sample}`);
      }
    }
    
    // Calculate actual sample rate from data size alone (without duration assumption)
    console.log(`\n=== Alternative Calculation (without duration assumption) ===`);
    console.log(`PCM data: ${pcmDataSize} bytes`);
    console.log(`For 16-bit mono: ${pcmDataSize / 2} samples`);
    console.log(`\nIf this is 48kHz audio:`);
    console.log(`  Duration = ${(pcmDataSize / 2) / 48000} seconds`);
    console.log(`\nIf this is 16kHz audio:`);
    console.log(`  Duration = ${(pcmDataSize / 2) / 16000} seconds`);
    console.log(`\nIf this is 8kHz audio:`);
    console.log(`  Duration = ${(pcmDataSize / 2) / 8000} seconds`);
    
    break;
  }
  
  dataOffset += 8 + chunkSize;
  if (chunkSize % 2 === 1) dataOffset++; // Align to word boundary
}

