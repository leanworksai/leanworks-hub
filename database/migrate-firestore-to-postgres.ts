import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPool, initializeSchema } from './config.js';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
} else {
  firebaseApp = getApps()[0];
}

const db = getFirestore(firebaseApp, 'leanworks-prod');

// Helper to convert Firestore Timestamp to JS Date
function timestampToDate(timestamp: any): Date | null {
  if (!timestamp) return null;
  if (timestamp?.toDate) return timestamp.toDate();
  if (timestamp instanceof Date) return timestamp;
  return null;
}

// Helper to get all domains from Firestore
async function getAllDomains(): Promise<string[]> {
  const domainsSnapshot = await db.collection('domains').listDocuments();
  return domainsSnapshot.map(doc => doc.id);
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

async function migrateUsers() {
  console.log('\n📊 Migrating users...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const usersSnapshot = await db.collection(`domains/${domain}/users`).get();
    
    console.log(`  Processing ${usersSnapshot.size} users from domain: ${domain}`);
    
    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = userDoc.data();
        const email = userDoc.id;
        
        await (await getPool()).query(`
          INSERT INTO users (
            email, password_hash, first_name, last_name, job_title,
            responsibilities, domain, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            job_title = EXCLUDED.job_title,
            responsibilities = EXCLUDED.responsibilities,
            updated_at = NOW()
        `, [
          email,
          userData.password || '',
          userData.firstName || '',
          userData.lastName || '',
          userData.jobTitle || '',
          userData.responsibilities || null,
          userData.domain || domain,
          timestampToDate(userData.createdAt) || new Date()
        ]);
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating user ${userDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} users (${errors} errors)`);
}

async function migrateTeams() {
  console.log('\n📊 Migrating teams...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const teamsSnapshot = await db.collection(`domains/${domain}/teams`).get();
    
    console.log(`  Processing ${teamsSnapshot.size} teams from domain: ${domain}`);
    
    for (const teamDoc of teamsSnapshot.docs) {
      try {
        const teamData = teamDoc.data();
        const teamId = teamDoc.id;
        
        // Insert team
        await (await getPool()).query(`
          INSERT INTO teams (
            id, name, description, avatar, domain, owner_email, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            avatar = EXCLUDED.avatar,
            owner_email = EXCLUDED.owner_email,
            updated_at = NOW()
        `, [
          teamId,
          teamData.name || teamId,
          teamData.description || null,
          teamData.avatar || null,
          domain,
          teamData.ownerEmail || null,
          new Date()
        ]);
        
        // Get team details for members
        const teamDetailDoc = await db.collection(`domains/${domain}/teamDetails`).doc(teamId).get();
        if (teamDetailDoc.exists) {
          const teamDetailData = teamDetailDoc.data();
          const members = teamDetailData?.members || [];
          
          // Insert team members
          for (const member of members) {
            try {
              await (await getPool()).query(`
                INSERT INTO team_members (
                  team_id, user_email, role, avatar
                ) VALUES ($1, $2, $3, $4)
                ON CONFLICT (team_id, user_email) DO UPDATE SET
                  role = EXCLUDED.role,
                  avatar = EXCLUDED.avatar
              `, [
                teamId,
                member.email,
                member.role || null,
                member.avatar || null
              ]);
            } catch (memberError) {
              console.error(`      ⚠️  Error migrating member ${member.email} for team ${teamId}:`, memberError);
            }
          }
        }
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating team ${teamDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} teams (${errors} errors)`);
}

async function migrateTeamJoinRequests() {
  console.log('\n📊 Migrating team join requests...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const requestsSnapshot = await db.collection(`domains/${domain}/teamJoinRequests`).get();
    
    console.log(`  Processing ${requestsSnapshot.size} join requests from domain: ${domain}`);
    
    for (const requestDoc of requestsSnapshot.docs) {
      try {
        const requestData = requestDoc.data();
        
        // Get team ID by name
        const teamResult = await (await getPool()).query(
          'SELECT id FROM teams WHERE name = $1 AND domain = $2',
          [requestData.teamName, domain]
        );
        
        if (teamResult.rows.length === 0) {
          console.warn(`    ⚠️  Team not found: ${requestData.teamName}`);
          continue;
        }
        
        const teamId = teamResult.rows[0].id;
        
        await (await getPool()).query(`
          INSERT INTO team_join_requests (
            team_id, user_email, user_name, status, owner_email, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          teamId,
          requestData.userEmail,
          requestData.userName || null,
          requestData.status || 'pending',
          requestData.ownerEmail,
          timestampToDate(requestData.createdAt) || new Date()
        ]);
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating join request ${requestDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} join requests (${errors} errors)`);
}

async function migrateTeamInvitations() {
  console.log('\n📊 Migrating team invitations...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const invitationsSnapshot = await db.collection(`domains/${domain}/teamInvitations`).get();
    
    console.log(`  Processing ${invitationsSnapshot.size} invitations from domain: ${domain}`);
    
    for (const invitationDoc of invitationsSnapshot.docs) {
      try {
        const invitationData = invitationDoc.data();
        
        // Get team ID by name
        const teamResult = await (await getPool()).query(
          'SELECT id FROM teams WHERE name = $1 AND domain = $2',
          [invitationData.teamName, domain]
        );
        
        if (teamResult.rows.length === 0) {
          console.warn(`    ⚠️  Team not found: ${invitationData.teamName}`);
          continue;
        }
        
        const teamId = teamResult.rows[0].id;
        
        await (await getPool()).query(`
          INSERT INTO team_invitations (
            team_id, team_description, invitee_email, inviter_email,
            inviter_name, status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          teamId,
          invitationData.teamDescription || null,
          invitationData.inviteeEmail,
          invitationData.inviterEmail,
          invitationData.inviterName || null,
          invitationData.status || 'pending',
          timestampToDate(invitationData.createdAt) || new Date()
        ]);
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating invitation ${invitationDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} invitations (${errors} errors)`);
}

async function migrateProjects() {
  console.log('\n📊 Migrating projects...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const projectsSnapshot = await db.collection(`domains/${domain}/projects`).get();
    
    console.log(`  Processing ${projectsSnapshot.size} projects from domain: ${domain}`);
    
    for (const projectDoc of projectsSnapshot.docs) {
      try {
        const projectData = projectDoc.data();
        const projectId = projectDoc.id;
        
        // Insert project
        await (await getPool()).query(`
          INSERT INTO projects (
            id, name, description, detailed_description, status, status_color,
            domain, team_count, due_date, created_date, created_at,
            summary_accomplishment, summary_decision, summary_risk, summary_direction
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            detailed_description = EXCLUDED.detailed_description,
            status = EXCLUDED.status,
            status_color = EXCLUDED.status_color,
            team_count = EXCLUDED.team_count,
            due_date = EXCLUDED.due_date,
            summary_accomplishment = EXCLUDED.summary_accomplishment,
            summary_decision = EXCLUDED.summary_decision,
            summary_risk = EXCLUDED.summary_risk,
            summary_direction = EXCLUDED.summary_direction,
            updated_at = NOW()
        `, [
          projectId,
          projectData.name || '',
          projectData.description || null,
          projectData.detailedDescription || null,
          projectData.status || null,
          projectData.statusColor || null,
          domain,
          projectData.team || 0,
          projectData.dueDate || null,
          projectData.createdDate || null,
          projectData.createdAt || null,
          projectData.summary?.accomplishment || null,
          projectData.summary?.decision || null,
          projectData.summary?.risk || null,
          projectData.summary?.direction || null
        ]);
        
        // Insert project members
        const members = projectData.members || [];
        for (const member of members) {
          try {
            await (await getPool()).query(`
              INSERT INTO project_members (
                project_id, user_email, role, avatar
              ) VALUES ($1, $2, $3, $4)
              ON CONFLICT (project_id, user_email) DO UPDATE SET
                role = EXCLUDED.role,
                avatar = EXCLUDED.avatar
            `, [
              projectId,
              member.id, // id is the email
              member.role || null,
              member.avatar || null
            ]);
          } catch (memberError) {
            console.error(`      ⚠️  Error migrating project member ${member.id}:`, memberError);
          }
        }
        
        // Insert progress updates
        const progressUpdates = projectData.progressUpdates || [];
        for (const update of progressUpdates) {
          try {
            await (await getPool()).query(`
              INSERT INTO project_progress_updates (
                id, project_id, member_name, member_avatar, date, update_text
              ) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (id) DO NOTHING
            `, [
              update.id || `${projectId}-update-${Date.now()}`,
              projectId,
              update.memberName || null,
              update.memberAvatar || null,
              update.date || null,
              update.update || null
            ]);
          } catch (updateError) {
            console.error(`      ⚠️  Error migrating progress update:`, updateError);
          }
        }
        
        // Insert comments
        const comments = projectData.comments || [];
        for (const comment of comments) {
          try {
            await (await getPool()).query(`
              INSERT INTO project_comments (
                id, project_id, member_name, member_avatar, date, comment
              ) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (id) DO NOTHING
            `, [
              comment.id || `${projectId}-comment-${Date.now()}`,
              projectId,
              comment.memberName || null,
              comment.memberAvatar || null,
              comment.date || null,
              comment.comment || null
            ]);
          } catch (commentError) {
            console.error(`      ⚠️  Error migrating comment:`, commentError);
          }
        }
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating project ${projectDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} projects (${errors} errors)`);
}

async function migrateTasks() {
  console.log('\n📊 Migrating tasks...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const tasksSnapshot = await db.collection(`domains/${domain}/tasks`).get();
    
    console.log(`  Processing ${tasksSnapshot.size} tasks from domain: ${domain}`);
    
    for (const taskDoc of tasksSnapshot.docs) {
      try {
        const taskData = taskDoc.data();
        const taskId = taskDoc.id;
        
        // Insert task
        await (await getPool()).query(`
          INSERT INTO tasks (
            id, title, description, status, priority, assignee_id, assignee_name,
            assignee_avatar, project_id, project_name, domain, created_by,
            due_date, created_date, created_at, estimated_hours, actual_hours,
            tags, reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            assignee_id = EXCLUDED.assignee_id,
            assignee_name = EXCLUDED.assignee_name,
            assignee_avatar = EXCLUDED.assignee_avatar,
            project_id = EXCLUDED.project_id,
            project_name = EXCLUDED.project_name,
            due_date = EXCLUDED.due_date,
            estimated_hours = EXCLUDED.estimated_hours,
            actual_hours = EXCLUDED.actual_hours,
            tags = EXCLUDED.tags,
            reason = EXCLUDED.reason,
            updated_at = NOW()
        `, [
          taskId,
          taskData.title || '',
          taskData.description || null,
          taskData.status || 'todo',
          taskData.priority || 'medium',
          taskData.assigneeId || null,
          taskData.assignee || null,
          taskData.assigneeAvatar || null,
          taskData.projectId || null,
          taskData.project || null,
          domain,
          taskData.createdBy || null,
          taskData.dueDate || null,
          taskData.createdDate || null,
          taskData.createdAt || null,
          taskData.estimatedHours || null,
          taskData.actualHours || null,
          JSON.stringify(taskData.tags || []),
          taskData.reason || null
        ]);
        
        // Insert task-team associations
        const teams = taskData.teams || [];
        for (const teamName of teams) {
          try {
            // Get team ID
            const teamResult = await (await getPool()).query(
              'SELECT id FROM teams WHERE name = $1 AND domain = $2',
              [teamName, domain]
            );
            
            if (teamResult.rows.length > 0) {
              await (await getPool()).query(`
                INSERT INTO task_teams (task_id, team_id)
                VALUES ($1, $2)
                ON CONFLICT (task_id, team_id) DO NOTHING
              `, [taskId, teamResult.rows[0].id]);
            }
          } catch (teamError) {
            console.error(`      ⚠️  Error migrating task-team association:`, teamError);
          }
        }
        
        // Insert progress updates
        const progressUpdates = taskData.progressUpdates || [];
        for (const update of progressUpdates) {
          try {
            await (await getPool()).query(`
              INSERT INTO task_progress_updates (
                id, task_id, member_name, member_avatar, date, update_text, type
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (id) DO NOTHING
            `, [
              update.id || `${taskId}-update-${Date.now()}`,
              taskId,
              update.memberName || null,
              update.memberAvatar || null,
              update.date || null,
              update.update || null,
              update.type || null
            ]);
          } catch (updateError) {
            console.error(`      ⚠️  Error migrating task progress update:`, updateError);
          }
        }
        
        // Insert comments
        const comments = taskData.comments || [];
        for (const comment of comments) {
          try {
            await (await getPool()).query(`
              INSERT INTO task_comments (
                id, task_id, member_name, member_avatar, date, comment
              ) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (id) DO NOTHING
            `, [
              comment.id || `${taskId}-comment-${Date.now()}`,
              taskId,
              comment.memberName || null,
              comment.memberAvatar || null,
              comment.date || null,
              comment.comment || null
            ]);
          } catch (commentError) {
            console.error(`      ⚠️  Error migrating task comment:`, commentError);
          }
        }
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating task ${taskDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} tasks (${errors} errors)`);
}

async function migrateUpdates() {
  console.log('\n📊 Migrating updates...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const updatesSnapshot = await db.collection(`domains/${domain}/updates`).get();
    
    console.log(`  Processing ${updatesSnapshot.size} updates from domain: ${domain}`);
    
    for (const updateDoc of updatesSnapshot.docs) {
      try {
        const updateData = updateDoc.data();
        
        await (await getPool()).query(`
          INSERT INTO updates (
            update_id, project_id, user_id, domain, associated_tasks,
            date_id, reason, update_text, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          updateDoc.id,
          updateData.projectId || null,
          updateData.userId || null,
          domain,
          updateData.associatedTasks || '[]',
          updateData.dateId || null,
          updateData.reason || null,
          updateData.update || null,
          timestampToDate(updateData.timestamp) || new Date()
        ]);
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating update ${updateDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} updates (${errors} errors)`);
}

async function migrateUpdateSummaries() {
  console.log('\n📊 Migrating update summaries...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const summariesSnapshot = await db.collection(`domains/${domain}/update_summaries`).get();
    
    console.log(`  Processing ${summariesSnapshot.size} summaries from domain: ${domain}`);
    
    for (const summaryDoc of summariesSnapshot.docs) {
      try {
        const summaryData = summaryDoc.data();
        
        await (await getPool()).query(`
          INSERT INTO update_summaries (
            project_id, domain, date_id, update_summary
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (project_id, date_id) DO UPDATE SET
            update_summary = EXCLUDED.update_summary,
            generated_at = NOW()
        `, [
          summaryData.projectId,
          domain,
          summaryData.dateId,
          summaryData.updateSummary || null
        ]);
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating summary ${summaryDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} summaries (${errors} errors)`);
}

async function migrateIntegrations() {
  console.log('\n📊 Migrating integrations...');
  let totalMigrated = 0;
  let errors = 0;

  const domainsSnapshot = await db.collection('domains').listDocuments();
  
  for (const domainDoc of domainsSnapshot) {
    const domain = domainDoc.id;
    const integrationsSnapshot = await db.collection(`domains/${domain}/integrations`).get();
    
    console.log(`  Processing ${integrationsSnapshot.size} integrations from domain: ${domain}`);
    
    for (const integrationDoc of integrationsSnapshot.docs) {
      try {
        const integrationData = integrationDoc.data();
        
        await (await getPool()).query(`
          INSERT INTO integrations (
            domain, integration_id, integration_name, connected, secret_name,
            connected_at, installation_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (domain, integration_id) DO UPDATE SET
            integration_name = EXCLUDED.integration_name,
            connected = EXCLUDED.connected,
            secret_name = EXCLUDED.secret_name,
            connected_at = EXCLUDED.connected_at,
            installation_id = EXCLUDED.installation_id,
            updated_at = NOW()
        `, [
          domain,
          integrationDoc.id,
          integrationData.name || null,
          integrationData.connected || false,
          integrationData.secretName || null,
          timestampToDate(integrationData.connectedAt) || null,
          integrationData.installationId || null
        ]);
        
        totalMigrated++;
      } catch (error) {
        console.error(`    ❌ Error migrating integration ${integrationDoc.id}:`, error);
        errors++;
      }
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} integrations (${errors} errors)`);
}

async function migrateGitHubInstallations() {
  console.log('\n📊 Migrating GitHub installations...');
  let totalMigrated = 0;
  let errors = 0;

  const installationsSnapshot = await db.collection('github-installations').get();
  
  console.log(`  Processing ${installationsSnapshot.size} GitHub installations`);
  
  for (const installationDoc of installationsSnapshot.docs) {
    try {
      const installationData = installationDoc.data();
      
      await (await getPool()).query(`
        INSERT INTO github_installations (
          installation_id, domain, setup_action, created_at
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (installation_id) DO UPDATE SET
          domain = EXCLUDED.domain,
          setup_action = EXCLUDED.setup_action,
          updated_at = NOW()
      `, [
        installationData.installationId,
        installationData.domain,
        installationData.setupAction || null,
        timestampToDate(installationData.createdAt) || new Date()
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`    ❌ Error migrating GitHub installation ${installationDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`  ✅ Migrated ${totalMigrated} GitHub installations (${errors} errors)`);
}

async function skipMessages() {
  console.log('\n📊 Messages - SKIPPED (Firestore only)');
  console.log('  ℹ️  Messages remain in Firestore for real-time capabilities');
  console.log('  ℹ️  No PostgreSQL migration needed - Firestore is source of truth');
}

// ============================================================================
// MAIN MIGRATION
// ============================================================================

async function runMigration() {
  console.log('🚀 Starting Firestore to PostgreSQL migration...');
  console.log('================================================\n');
  
  try {
    // Initialize PostgreSQL schema
    console.log('📋 Initializing PostgreSQL schema...');
    await initializeSchema();
    console.log('✅ Schema initialized\n');
    
    // Run migrations in order (respecting foreign key constraints)
    await migrateUsers();
    await migrateTeams();
    await migrateTeamJoinRequests();
    await migrateTeamInvitations();
    await migrateProjects();
    await migrateTasks();
    await migrateUpdates();
    await migrateUpdateSummaries();
    await migrateIntegrations();
    await migrateGitHubInstallations();
    await skipMessages();
    
    // Refresh materialized views
    console.log('\n📊 Refreshing materialized views...');
    await (await getPool()).query('SELECT refresh_team_stats()');
    await (await getPool()).query('REFRESH MATERIALIZED VIEW CONCURRENTLY project_stats');
    console.log('✅ Materialized views refreshed');
    
    console.log('\n================================================');
    console.log('✅ Migration completed successfully!');
    console.log('================================================\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await (await getPool()).end();
    process.exit(0);
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration();
}

export { runMigration };

