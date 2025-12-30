import { Storage } from '@google-cloud/storage';
import { join } from 'path';
import { existsSync } from 'fs';

// Analyze multiple chunks to verify byte order issue is consistent
const chunksToAnalyze = [
  'gs://leanworks-prod/orgs/yanfus_personal_workspace_mj6bu8a7/recordings/2025-12-29/dm-no-reply@leanworks.ai-yanfu@leanworks.ai-1767064962838/yanfu@leanworks.ai/chunk_0.wav',
  'gs://leanworks-prod/orgs/yanfus_personal_workspace_mj6bu8a7/recordings/2025-12-29/dm-no-reply@leanworks.ai-yanfu@leanworks.ai-1767064962838/yanfu@leanworks.ai/chunk_1.wav',
];

async function verifyByteOrder() {
  try {
    // Initialize GCS client
    const serviceAccountPath = join(process.cwd(), 'gcp_credential.json');
    let storage;
    
    if (existsSync(serviceAccountPath)) {
      storage = new Storage({ keyFilename: serviceAccountPath });
    } else {
      storage = new Storage();
    }
    
    console.log('=== Byte Order Verification ===\n');
    
    for (const gcsPath of chunksToAnalyze) {
      const [bucketName, ...pathParts] = gcsPath.replace('gs://', '').split('/');
      const filePath = pathParts.join('/');
      const file = storage.bucket(bucketName).file(filePath);
      
      const [exists] = await file.exists();
      if (!exists) {
        console.log(`⚠️  File not found: ${gcsPath}\n`);
        continue;
      }
      
      const [buffer] = await file.download();
      console.log(`📥 ${gcsPath}`);
      console.log(`   Size: ${buffer.length} bytes\n`);
      
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
        if (chunkSize % 2 === 1) dataOffset++;
      }
      
      if (pcmDataStart === 0) {
        console.log('   ❌ Could not find data chunk\n');
        continue;
      }
      
      // Analyze first 1000 samples
      const samplesToCheck = Math.min(1000, pcmDataSize / 2);
      let lePeak = 0;
      let bePeak = 0;
      let leAvg = 0;
      let beAvg = 0;
      let zeroCount = 0;
      
      for (let i = 0; i < samplesToCheck; i++) {
        const offset = pcmDataStart + (i * 2);
        if (offset + 1 >= buffer.length) break;
        
        const sampleLE = buffer.readInt16LE(offset);
        const sampleBE = buffer.readInt16BE(offset);
        
        if (sampleLE === 0) zeroCount++;
        
        const leAbs = Math.abs(sampleLE);
        const beAbs = Math.abs(sampleBE);
        
        lePeak = Math.max(lePeak, leAbs);
        bePeak = Math.max(bePeak, beAbs);
        leAvg += leAbs;
        beAvg += beAbs;
      }
      
      leAvg /= samplesToCheck;
      beAvg /= samplesToCheck;
      
      // Show first 10 samples
      console.log('   First 10 samples:');
      for (let i = 0; i < Math.min(10, samplesToCheck); i++) {
        const offset = pcmDataStart + (i * 2);
        if (offset + 1 < buffer.length) {
          const sampleLE = buffer.readInt16LE(offset);
          const sampleBE = buffer.readInt16BE(offset);
          console.log(`     Sample ${i}: LE=${sampleLE.toString().padStart(6)}, BE=${sampleBE.toString().padStart(6)}`);
        }
      }
      
      console.log(`\n   Statistics:`);
      console.log(`     Zero samples: ${zeroCount}/${samplesToCheck} (${(zeroCount/samplesToCheck*100).toFixed(1)}%)`);
      console.log(`     LE Peak: ${lePeak} (${lePeak > 0 ? (20 * Math.log10(lePeak / 32768)).toFixed(2) : '-Inf'} dB)`);
      console.log(`     BE Peak: ${bePeak} (${bePeak > 0 ? (20 * Math.log10(bePeak / 32768)).toFixed(2) : '-Inf'} dB)`);
      console.log(`     LE Avg: ${leAvg.toFixed(2)}`);
      console.log(`     BE Avg: ${beAvg.toFixed(2)}`);
      
      const ratio = bePeak > 0 ? lePeak / bePeak : 0;
      console.log(`     Peak ratio (LE/BE): ${ratio.toFixed(4)}`);
      
      // Verdict
      if (bePeak > lePeak * 2) {
        console.log(`\n   ❌ BYTE ORDER ISSUE: BE is ${(bePeak/lePeak).toFixed(2)}x larger - data appears to be in BE format!`);
      } else if (lePeak > bePeak * 2) {
        console.log(`\n   ✅ Byte order appears correct (LE is ${(lePeak/bePeak).toFixed(2)}x larger)`);
      } else {
        console.log(`\n   ⚠️  Ambiguous - both interpretations similar (might be silence)`);
      }
      
      console.log('\n');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

verifyByteOrder();

