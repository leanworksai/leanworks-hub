import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getTenantPool, getDomainFromEmail } from './multi-tenant-pool.js';
import { Pool } from 'pg';

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

// Drop all existing tables for a clean migration
async function dropAllTables(pool: Pool): Promise<void> {
  console.log('    🗑️  Dropping existing tables...');
  
  await pool.query(`
    -- Drop tables in reverse dependency order
    DROP TABLE IF EXISTS github_installations CASCADE;
    DROP TABLE IF EXISTS integrations CASCADE;
    DROP TABLE IF EXISTS project_progress_updates CASCADE;
    DROP TABLE IF EXISTS task_progress_updates CASCADE;
    DROP TABLE IF EXISTS task_comments CASCADE;
    DROP TABLE IF EXISTS task_teams CASCADE;
    DROP TABLE IF EXISTS tasks CASCADE;
    DROP TABLE IF EXISTS project_comments CASCADE;
    DROP TABLE IF EXISTS project_members CASCADE;
    DROP TABLE IF EXISTS projects CASCADE;
    DROP TABLE IF EXISTS team_invitations CASCADE;
    DROP TABLE IF EXISTS team_join_requests CASCADE;
    DROP TABLE IF EXISTS team_members CASCADE;
    DROP TABLE IF EXISTS teams CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    
    -- Drop materialized views
    DROP MATERIALIZED VIEW IF EXISTS project_stats CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS team_stats CASCADE;
    
    -- Drop functions
    DROP FUNCTION IF EXISTS refresh_team_stats() CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
  `);
  
  console.log('    ✅ Existing tables dropped');
}

// Initialize schema for a tenant database
async function initializeTenantSchema(pool: Pool): Promise<void> {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  
  // Drop existing tables first for clean migration
  await dropAllTables(pool);
  
  console.log('    📋 Initializing schema...');
  await pool.query(schema);
  console.log('    ✅ Schema initialized');
}

// ============================================================================
// MIGRATION FUNCTIONS PER TENANT
// ============================================================================

async function migrateUsersForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating users...');
  let totalMigrated = 0;
  let errors = 0;

  const usersSnapshot = await db.collection(`domains/${domain}/users`).get();
  
  for (const userDoc of usersSnapshot.docs) {
    try {
      const userData = userDoc.data();
      const email = userDoc.id;
      
      await pool.query(`
        INSERT INTO users (
          email, password_hash, first_name, last_name, job_title,
          responsibilities, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
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
        timestampToDate(userData.createdAt) || new Date()
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating user ${userDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} users (${errors} errors)`);
}

async function migrateTeamsForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating teams...');
  let totalMigrated = 0;
  let errors = 0;

  const teamsSnapshot = await db.collection(`domains/${domain}/teams`).get();
  
  for (const teamDoc of teamsSnapshot.docs) {
    try {
      const teamData = teamDoc.data();
      const teamId = teamDoc.id;
      
      // Insert team
      await pool.query(`
        INSERT INTO teams (
          id, name, description, avatar, owner_email, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          avatar = EXCLUDED.avatar,
          updated_at = NOW()
      `, [
        teamId,
        teamData.name || 'Unnamed Team',
        teamData.description || null,
        teamData.avatar || null,
        teamData.ownerEmail || teamData.owner_email || '',
        timestampToDate(teamData.createdAt) || new Date()
      ]);
      
      // Migrate team members from teamDetails collection
      try {
        const teamDetailsDoc = await db.collection(`domains/${domain}/teamDetails`).doc(teamId).get();
        if (teamDetailsDoc.exists) {
          const teamDetails = teamDetailsDoc.data();
          const members = teamDetails?.members || [];
          
          for (const member of members) {
            try {
              await pool.query(`
                INSERT INTO team_members (team_id, user_email, role, avatar)
                VALUES ($1, $2, $3, $4)
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
              // Silently skip if user doesn't exist
            }
          }
        }
      } catch (detailsError) {
        // TeamDetails doc might not exist
      }
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating team ${teamDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} teams (${errors} errors)`);
}

async function migrateProjectsForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating projects...');
  let totalMigrated = 0;
  let errors = 0;

  const projectsSnapshot = await db.collection(`domains/${domain}/projects`).get();
  
  for (const projectDoc of projectsSnapshot.docs) {
    try {
      const projectData = projectDoc.data();
      const projectId = projectDoc.id;
      
      // Validate team_id - check if team exists, otherwise set to null
      let teamId = projectData.teamId || null;
      if (teamId) {
        const teamResult = await pool.query(
          'SELECT id FROM teams WHERE id = $1',
          [teamId]
        );
        if (teamResult.rows.length === 0) {
          teamId = null; // Team doesn't exist, set to null
        }
      }
      
      // owner_email is required (NOT NULL) - must be the creator
      // Try to get ownerEmail from projectData, or infer from first member, or skip if unavailable
      let ownerEmail = projectData.ownerEmail;
      if (!ownerEmail && projectData.members && Array.isArray(projectData.members) && projectData.members.length > 0) {
        // Try to infer from first member if ownerEmail is missing
        const firstMember = projectData.members[0];
        ownerEmail = typeof firstMember === 'string' ? firstMember : (firstMember.email || firstMember.id);
      }
      
      if (!ownerEmail) {
        console.warn(`⚠️  Skipping project ${projectId}: ownerEmail is required but not found`);
        errors++;
        continue;
      }
      
      // Normalize email to lowercase
      ownerEmail = ownerEmail.toLowerCase();
      
      await pool.query(`
        INSERT INTO projects (
          id, name, description, team_id, status, priority,
          start_date, end_date, due_date, owner_email, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          team_id = EXCLUDED.team_id,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          due_date = EXCLUDED.due_date,
          owner_email = EXCLUDED.owner_email,
          updated_at = NOW()
      `, [
        projectId,
        projectData.name || 'Unnamed Project',
        projectData.description || null,
        teamId,
        projectData.status || 'active',
        projectData.priority || 'medium',
        timestampToDate(projectData.startDate),
        timestampToDate(projectData.endDate),
        timestampToDate(projectData.dueDate),
        ownerEmail,
        timestampToDate(projectData.createdAt) || new Date()
      ]);
      
      // Migrate project members
      if (projectData.members && Array.isArray(projectData.members)) {
        for (const member of projectData.members) {
          try {
            const memberEmail = typeof member === 'string' ? member : member.id;
            await pool.query(`
              INSERT INTO project_members (project_id, user_email, role, avatar)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (project_id, user_email) DO UPDATE SET
                role = EXCLUDED.role,
                avatar = EXCLUDED.avatar
            `, [
              projectId,
              memberEmail,
              typeof member === 'object' ? (member.role || null) : null,
              typeof member === 'object' ? (member.avatar || null) : null
            ]);
          } catch (memberError) {
            // Silently skip if user doesn't exist
          }
        }
      }
      
      // Migrate project comments
      if (projectData.comments && Array.isArray(projectData.comments)) {
        for (const comment of projectData.comments) {
          try {
            await pool.query(`
              INSERT INTO project_comments (id, project_id, member_name, member_avatar, date, comment)
              VALUES ($1, $2, $3, $4, $5, $6)
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
            // Silently skip comment errors
          }
        }
      }
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating project ${projectDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} projects (${errors} errors)`);
}

async function migrateTasksForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating tasks...');
  let totalMigrated = 0;
  let errors = 0;

  const tasksSnapshot = await db.collection(`domains/${domain}/tasks`).get();
  
  for (const taskDoc of tasksSnapshot.docs) {
    try {
      const taskData = taskDoc.data();
      const taskId = taskDoc.id;
      
      // Convert created_at to unix timestamp (bigint)
      const createdAtTimestamp = taskData.createdAt || Date.now();
      
      // Validate assignee - must be email format or null (to satisfy foreign key)
      // assignee_id maps to assigneeId in Firestore
      const assigneeValue = taskData.assigneeId;
      const isEmail = assigneeValue && assigneeValue.includes('@');
      const assigneeId = isEmail ? assigneeValue : null;
      // assignee_name maps to 'assignee' in Firestore
      const assigneeName = taskData.assignee || null;
      
      // Validate created_by - must be email format or null
      const createdByValue = taskData.reporter || taskData.createdBy;
      const isCreatedByEmail = createdByValue && createdByValue.includes('@');
      const createdBy = isCreatedByEmail ? createdByValue : null;
      
      // Validate project_id - check if project exists, otherwise set to null
      let projectId = taskData.projectId || null;
      if (projectId) {
        const projectExists = await pool.query(
          'SELECT 1 FROM projects WHERE id = $1',
          [projectId]
        );
        if (projectExists.rows.length === 0) {
          projectId = null; // Project doesn't exist, set to null
        }
      }
      
      // project_name maps to 'project' in Firestore
      const projectName = taskData.project || null;
      
      // reason maps from 'reason' in Firestore
      const reason = taskData.reason || null;
      
      await pool.query(`
        INSERT INTO tasks (
          id, title, description, project_id, project_name, assignee_id, assignee_name,
          created_by, status, priority, due_date, reason, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          project_id = EXCLUDED.project_id,
          project_name = EXCLUDED.project_name,
          assignee_id = EXCLUDED.assignee_id,
          assignee_name = EXCLUDED.assignee_name,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          due_date = EXCLUDED.due_date,
          reason = EXCLUDED.reason,
          updated_at = NOW()
      `, [
        taskId,
        taskData.title || 'Untitled Task',
        taskData.description || null,
        projectId,
        projectName,
        assigneeId,
        assigneeName,
        createdBy,
        taskData.status || 'todo',
        taskData.priority || 'medium',
        timestampToDate(taskData.dueDate),
        reason,
        createdAtTimestamp
      ]);
      
      // Migrate task comments
      if (taskData.comments && Array.isArray(taskData.comments)) {
        for (const comment of taskData.comments) {
          try {
            await pool.query(`
              INSERT INTO task_comments (id, task_id, member_name, member_avatar, date, comment)
              VALUES ($1, $2, $3, $4, $5, $6)
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
            // Silently skip comment errors
          }
        }
      }
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating task ${taskDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} tasks (${errors} errors)`);
}

async function migrateUpdatesForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating updates...');
  let totalMigrated = 0;
  let errors = 0;

  const updatesSnapshot = await db.collection(`domains/${domain}/updates`).get();
  
  for (const updateDoc of updatesSnapshot.docs) {
    try {
      const updateData = updateDoc.data();
      
      // Handle associated_tasks - could be string or array
      let associatedTasks = '[]';
      if (updateData.associatedTasks) {
        if (typeof updateData.associatedTasks === 'string') {
          associatedTasks = updateData.associatedTasks;
        } else if (Array.isArray(updateData.associatedTasks)) {
          associatedTasks = JSON.stringify(updateData.associatedTasks);
        }
      }
      
      await pool.query(`
        INSERT INTO task_progress_updates (
          update_id, project_id, user_id, associated_tasks,
          date_id, reason, update_text, timestamp
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
        ON CONFLICT (update_id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          user_id = EXCLUDED.user_id,
          associated_tasks = EXCLUDED.associated_tasks,
          date_id = EXCLUDED.date_id,
          reason = EXCLUDED.reason,
          update_text = EXCLUDED.update_text,
          timestamp = EXCLUDED.timestamp
      `, [
        updateDoc.id,
        updateData.projectId || null,
        updateData.userId || null,
        associatedTasks,
        updateData.dateId || null,
        updateData.reason || null,
        updateData.update || null,
        timestampToDate(updateData.timestamp) || new Date()
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating update ${updateDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} updates (${errors} errors)`);
}

async function migrateUpdateSummariesForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating update summaries...');
  let totalMigrated = 0;
  let errors = 0;

  const summariesSnapshot = await db.collection(`domains/${domain}/update_summaries`).get();
  
  for (const summaryDoc of summariesSnapshot.docs) {
    try {
      const summaryData = summaryDoc.data();
      
      await pool.query(`
        INSERT INTO project_progress_updates (
          project_id, date_id, update_summary, generated_at
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, date_id) DO UPDATE SET
          update_summary = EXCLUDED.update_summary,
          generated_at = EXCLUDED.generated_at
      `, [
        summaryData.projectId || null,
        summaryData.dateId || null,
        summaryData.updateSummary || null,
        timestampToDate(summaryData.generatedAt) || new Date()
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating update summary ${summaryDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} update summaries (${errors} errors)`);
}

async function migrateIntegrationsForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating integrations...');
  let totalMigrated = 0;
  let errors = 0;

  const integrationsSnapshot = await db.collection(`domains/${domain}/integrations`).get();
  
  for (const integrationDoc of integrationsSnapshot.docs) {
    try {
      const integrationData = integrationDoc.data();
      
      await pool.query(`
        INSERT INTO integrations (
          integration_id, integration_name, connected, secret_name,
          connected_at, installation_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (integration_id) DO UPDATE SET
          integration_name = EXCLUDED.integration_name,
          connected = EXCLUDED.connected,
          secret_name = EXCLUDED.secret_name,
          connected_at = EXCLUDED.connected_at,
          installation_id = EXCLUDED.installation_id,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `, [
        integrationDoc.id,
        integrationData.integrationName || integrationData.name || null,
        integrationData.connected || false,
        integrationData.secretName || null,
        timestampToDate(integrationData.connectedAt),
        integrationData.installationId || null,
        JSON.stringify(integrationData.metadata || {})
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating integration ${integrationDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} integrations (${errors} errors)`);
}

async function migrateGitHubInstallationsForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating GitHub installations...');
  let totalMigrated = 0;
  let errors = 0;

  // GitHub installations are stored at root level, filter by domain
  const installationsSnapshot = await db.collection('github-installations')
    .where('domain', '==', domain)
    .get();
  
  for (const installationDoc of installationsSnapshot.docs) {
    try {
      const installationData = installationDoc.data();
      
      await pool.query(`
        INSERT INTO github_installations (
          installation_id, setup_action, created_at
        ) VALUES ($1, $2, $3)
        ON CONFLICT (installation_id) DO UPDATE SET
          setup_action = EXCLUDED.setup_action,
          updated_at = NOW()
      `, [
        parseInt(installationDoc.id),
        installationData.setupAction || null,
        timestampToDate(installationData.createdAt) || new Date()
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating GitHub installation ${installationDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} GitHub installations (${errors} errors)`);
}

async function migrateTeamJoinRequestsForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating team join requests...');
  let totalMigrated = 0;
  let errors = 0;

  const requestsSnapshot = await db.collection(`domains/${domain}/teamJoinRequests`).get();
  
  for (const requestDoc of requestsSnapshot.docs) {
    try {
      const requestData = requestDoc.data();
      
      // Get team ID by name
      const teamResult = await pool.query(
        'SELECT id FROM teams WHERE name = $1',
        [requestData.teamName]
      );
      
      if (teamResult.rows.length === 0) {
        continue; // Skip if team not found
      }
      
      const teamId = teamResult.rows[0].id;
      
      await pool.query(`
        INSERT INTO team_join_requests (
          team_id, user_email, user_name, status, owner_email,
          created_at, processed_by, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT ON CONSTRAINT team_join_requests_pkey DO UPDATE SET
          status = EXCLUDED.status,
          processed_by = EXCLUDED.processed_by,
          processed_at = EXCLUDED.processed_at,
          updated_at = NOW()
      `, [
        teamId,
        requestData.userEmail,
        requestData.userName || null,
        requestData.status || 'pending',
        requestData.ownerEmail,
        timestampToDate(requestData.createdAt) || new Date(),
        requestData.processedBy || null,
        timestampToDate(requestData.processedAt)
      ]);
      
      totalMigrated++;
    } catch (error) {
      console.error(`      ❌ Error migrating join request ${requestDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} team join requests (${errors} errors)`);
}

async function migrateTeamInvitationsForDomain(domain: string, pool: Pool) {
  console.log('    📊 Migrating team invitations...');
  let totalMigrated = 0;
  let errors = 0;

  const invitationsSnapshot = await db.collection(`domains/${domain}/teamInvitations`).get();
  
  for (const invitationDoc of invitationsSnapshot.docs) {
    try {
      const invitationData = invitationDoc.data();
      
      // Get team ID by name
      const teamResult = await pool.query(
        'SELECT id FROM teams WHERE name = $1',
        [invitationData.teamName]
      );
      
      if (teamResult.rows.length === 0) {
        continue; // Skip if team not found
      }
      
      const teamId = teamResult.rows[0].id;
      
      await pool.query(`
        INSERT INTO team_invitations (
          team_id, team_description, invitee_email, inviter_email,
          inviter_name, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT ON CONSTRAINT team_invitations_pkey DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = NOW()
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
      console.error(`      ❌ Error migrating invitation ${invitationDoc.id}:`, error);
      errors++;
    }
  }
  
  console.log(`    ✅ Migrated ${totalMigrated} team invitations (${errors} errors)`);
}

async function skipMessagesForDomain(domain: string) {
  console.log('    📊 Messages - SKIPPED (Firestore only)');
  console.log('      ℹ️  Messages remain in Firestore for real-time capabilities');
}

// ============================================================================
// MAIN MIGRATION ORCHESTRATION
// ============================================================================

async function migrateTenant(domain: string, sampleEmail: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏢 Migrating Tenant: ${domain}`);
  console.log(`   Sample Email: ${sampleEmail}`);
  console.log(`   Database: ${getDomainFromEmail(sampleEmail)}`);
  console.log('='.repeat(60));
  
  try {
    // Get tenant pool (this will auto-create database)
    const pool = await getTenantPool(sampleEmail);
    
    // Initialize schema
    await initializeTenantSchema(pool);
    
    // Migrate all data for this tenant
    await migrateUsersForDomain(domain, pool);
    await migrateTeamsForDomain(domain, pool);
    await migrateTeamJoinRequestsForDomain(domain, pool);
    await migrateTeamInvitationsForDomain(domain, pool);
    await migrateProjectsForDomain(domain, pool);
    await migrateTasksForDomain(domain, pool);
    await migrateUpdatesForDomain(domain, pool);
    await migrateUpdateSummariesForDomain(domain, pool);
    await migrateIntegrationsForDomain(domain, pool);
    await migrateGitHubInstallationsForDomain(domain, pool);
    await skipMessagesForDomain(domain);
    
    // Refresh materialized views
    console.log('    📊 Refreshing materialized views...');
    await pool.query('SELECT refresh_team_stats()');
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY project_stats');
    console.log('    ✅ Views refreshed');
    
    console.log(`\n✅ Tenant ${domain} migration completed successfully!`);
    
  } catch (error) {
    console.error(`\n❌ Failed to migrate tenant ${domain}:`, error);
    throw error;
  }
}

async function runMigration() {
  console.log('🚀 Starting Multi-Tenant Firestore to PostgreSQL Migration...');
  console.log('=' .repeat(60));
  
  try {
    // Get all domains from Firestore
    const domains = await getAllDomains();
    console.log(`\n📋 Found ${domains.length} tenant domain(s) to migrate:`);
    domains.forEach((d, i) => console.log(`   ${i + 1}. ${d}`));
    
    if (domains.length === 0) {
      console.log('\n⚠️  No domains found in Firestore!');
      process.exit(0);
    }
    
    // Migrate each tenant
    for (const domain of domains) {
      // Get first user from this domain to create sample email
      const usersSnapshot = await db.collection(`domains/${domain}/users`).limit(1).get();
      
      if (usersSnapshot.empty) {
        console.log(`\n⚠️  No users found for domain ${domain}, skipping...`);
        continue;
      }
      
      const firstUserEmail = usersSnapshot.docs[0].id;
      await migrateTenant(domain, firstUserEmail);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Multi-Tenant Migration Completed Successfully!');
    console.log('='.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   Tenants migrated: ${domains.length}`);
    console.log(`   Databases created: ${domains.length}`);
    console.log(`\n📝 Next steps:`);
    console.log('   1. Update server code to use getTenantPool(userEmail)');
    console.log('   2. Test API endpoints with different tenant users');
    console.log('   3. Monitor connection pools in Cloud SQL');
    console.log('   4. Messages remain in Firestore for real-time features');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();

