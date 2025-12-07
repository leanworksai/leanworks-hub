// Quick test to verify LiveKit token generation works
import { AccessToken } from 'livekit-server-sdk';

(async () => {
try {
  console.log('🧪 Testing LiveKit token generation...\n');
  
  const apiKey = 'devkey';
  const apiSecret = 'devsecret';
  const roomName = 'test-room';
  const participantIdentity = 'test-user@example.com';
  
  console.log('Creating AccessToken with:');
  console.log('  API Key:', apiKey);
  console.log('  API Secret:', apiSecret);
  console.log('  Room:', roomName);
  console.log('  Identity:', participantIdentity);
  console.log('');
  
  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantIdentity,
  });
  
  const grant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  };
  
  at.addGrant(grant);
  
  const token = await at.toJwt();
  
  console.log('✅ Token generated successfully!');
  console.log('Token type:', typeof token);
  console.log('Token is string?', typeof token === 'string');
  
  if (typeof token === 'string') {
    console.log('Token length:', token.length);
    console.log('Token preview:', token.substring(0, 50) + '...');
    console.log('\n✅ Test passed - token generation works!');
  } else {
    console.log('\n⚠️  Token is not a string!');
    console.log('Token:', JSON.stringify(token));
  }
  
} catch (error) {
  console.error('❌ Error generating token:');
  console.error('  Message:', error.message);
  console.error('  Stack:', error.stack);
  process.exit(1);
}
})();

