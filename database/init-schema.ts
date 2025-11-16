import { initializeSchema, testConnection, closePool } from './config.js';

async function main() {
  console.log('🚀 Initializing PostgreSQL schema...\n');
  
  try {
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      console.error('❌ Could not connect to PostgreSQL');
      process.exit(1);
    }
    
    // Initialize schema
    await initializeSchema();
    
    console.log('\n✅ Schema initialization completed successfully!');
  } catch (error) {
    console.error('\n❌ Schema initialization failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();

