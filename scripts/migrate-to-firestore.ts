import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as serviceAccount from '../gcp_credential.json';
import { projects } from '../src/data/projectsData';
import { tasks } from '../src/data/tasksData';
import { defaultTeams, defaultTeamData } from '../src/data/teamsData';

// Initialize Firebase Admin SDK
// Use project_id from the credential file
if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount as any),
    projectId: serviceAccount.project_id,
  });
}

// Get Firestore instance for the 'leanworks-test' database
// If 'leanworks-test' is a named database, specify it; otherwise use default
const db = getFirestore(undefined, 'leanworks-test');

async function migrateProjects() {
  console.log('Migrating projects...');
  const batch = db.batch();
  
  for (const project of projects) {
    const projectRef = db.collection('projects').doc(project.name);
    batch.set(projectRef, project);
  }
  
  await batch.commit();
  console.log(`✓ Migrated ${projects.length} projects`);
}

async function migrateTasks() {
  console.log('Migrating tasks...');
  const batch = db.batch();
  
  for (const task of tasks) {
    const taskRef = db.collection('tasks').doc(task.id);
    batch.set(taskRef, task);
  }
  
  await batch.commit();
  console.log(`✓ Migrated ${tasks.length} tasks`);
}

async function migrateTeams() {
  console.log('Migrating teams...');
  const teamsBatch = db.batch();
  const teamDetailsBatch = db.batch();
  
  // Migrate teams
  for (const team of defaultTeams) {
    const teamRef = db.collection('teams').doc(team.name);
    teamsBatch.set(teamRef, team);
  }
  
  // Migrate team details
  for (const [teamName, teamDetail] of Object.entries(defaultTeamData)) {
    const teamDetailRef = db.collection('teamDetails').doc(teamName);
    teamDetailsBatch.set(teamDetailRef, teamDetail);
  }
  
  await teamsBatch.commit();
  await teamDetailsBatch.commit();
  console.log(`✓ Migrated ${defaultTeams.length} teams and ${Object.keys(defaultTeamData).length} team details`);
}

async function main() {
  try {
    console.log('Starting Firestore migration...\n');
    
    await migrateProjects();
    await migrateTasks();
    await migrateTeams();
    
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

main();

