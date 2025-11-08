import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read service account credentials
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

// Initialize Firebase Admin SDK
let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
} else {
  firebaseApp = getApps()[0];
}

const db = getFirestore(firebaseApp, 'leanworks-test');

function getCollectionPath(collectionName: string, domain: string): string {
  return `domains/${domain}/${collectionName}`;
}

// Extract domain from email
function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

async function migrateTeamOwners(domain?: string) {
  try {
    // If domain is provided, migrate only that domain
    // Otherwise, we need to find all domains
    const domains: string[] = [];
    
    if (domain) {
      domains.push(domain);
    } else {
      // Get all domains by querying the domains collection structure
      // Since we can't list collections directly, we'll need to know the domains
      // For now, we'll require domain to be provided
      console.error('Error: Domain must be provided. Usage: tsx scripts/migrate-team-owners.ts <domain>');
      console.error('Example: tsx scripts/migrate-team-owners.ts leanworks.ai');
      process.exit(1);
    }

    for (const dom of domains) {
      console.log(`\n🔄 Migrating teams for domain: ${dom}`);
      const teamsPath = getCollectionPath('teams', dom);
      const teamDetailsPath = getCollectionPath('teamDetails', dom);
      
      // Get all teams
      const teamsSnapshot = await db.collection(teamsPath).get();
      const teams = teamsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.id, ...doc.data() } as any));
      
      console.log(`Found ${teams.length} teams`);
      
      const results = {
        updated: [] as string[],
        skipped: [] as string[],
        errors: [] as string[],
      };
      
      // Process each team
      for (const team of teams) {
        try {
          const teamName = team.name || team.id;
          
          // Skip if team already has an ownerEmail
          if (team.ownerEmail) {
            console.log(`⏭️  Skipping ${teamName} - already has owner: ${team.ownerEmail}`);
            results.skipped.push(teamName);
            continue;
          }
          
          // Get team details to find members
          const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamName).get();
          
          if (!teamDetailDoc.exists) {
            console.log(`❌ ${teamName}: Team details not found`);
            results.errors.push(`${teamName}: Team details not found`);
            continue;
          }
          
          const teamDetail = teamDetailDoc.data();
          
          // Find the first member to set as owner
          let ownerEmail: string | null = null;
          
          if (teamDetail?.members && Array.isArray(teamDetail.members) && teamDetail.members.length > 0) {
            // Use the first member's email as the owner
            ownerEmail = teamDetail.members[0].email;
          }
          
          if (!ownerEmail) {
            console.log(`❌ ${teamName}: No members found to set as owner`);
            results.errors.push(`${teamName}: No members found to set as owner`);
            continue;
          }
          
          // Update both teams and teamDetails collections
          await db.collection(teamsPath).doc(teamName).update({
            ownerEmail: ownerEmail,
          });
          
          await db.collection(teamDetailsPath).doc(teamName).update({
            ownerEmail: ownerEmail,
          });
          
          console.log(`✅ Updated ${teamName} - set owner to ${ownerEmail}`);
          results.updated.push(teamName);
        } catch (error: any) {
          const teamName = team.name || team.id;
          console.log(`❌ ${teamName}: ${error.message}`);
          results.errors.push(`${teamName}: ${error.message}`);
        }
      }
      
      console.log(`\n📊 Migration Summary for ${dom}:`);
      console.log(`   ✅ Updated: ${results.updated.length}`);
      console.log(`   ⏭️  Skipped: ${results.skipped.length}`);
      console.log(`   ❌ Errors: ${results.errors.length}`);
      
      if (results.updated.length > 0) {
        console.log(`\n   Updated teams: ${results.updated.join(', ')}`);
      }
      if (results.errors.length > 0) {
        console.log(`\n   Errors:`);
        results.errors.forEach(err => console.log(`     - ${err}`));
      }
    }
    
    console.log('\n✨ Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Get domain from command line arguments
const domain = process.argv[2];

if (!domain) {
  console.error('Error: Domain is required');
  console.error('Usage: tsx scripts/migrate-team-owners.ts <domain>');
  console.error('Example: tsx scripts/migrate-team-owners.ts leanworks.ai');
  process.exit(1);
}

migrateTeamOwners(domain);

