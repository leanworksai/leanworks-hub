/**
 * Data Pipeline Service
 * Handles triggering data pipeline deployments and listening for completion
 */

import { getAuth } from 'firebase-admin/auth';

// Get data pipeline API URL from environment or use default
// In local development, defaults to http://localhost:8082 (data-pipeline API default port)
// In production, defaults to https://data-pipeline-api.leanworks.ai
const DATA_PIPELINE_API_URL = process.env.DATA_PIPELINE_API_URL || 
  (process.env.NODE_ENV === 'development' ? 'http://localhost:8082' : 'https://data-pipeline-api.leanworks.ai');

/**
 * Trigger data pipeline deployment for an organization
 * @param orgSlug - The organization slug
 * @param userEmail - The user email (for authentication)
 * @returns Promise that resolves when deployment is triggered
 */
export async function triggerDataPipelineDeployment(
  orgSlug: string,
  userEmail: string
): Promise<void> {
  try {

    // Generate a custom token for the user to authenticate with data-pipeline API
    const auth = getAuth();
    let customToken: string;
    
    try {
      // Try to get user by email
      const userRecord = await auth.getUserByEmail(userEmail);
      customToken = await auth.createCustomToken(userRecord.uid);
    } catch (error: any) {
      // If user doesn't exist in Firebase Auth yet, we can't create a token
      // In this case, we'll skip the deployment trigger (shouldn't happen in normal flow)
      console.warn(`⚠️ Could not create custom token for ${userEmail}, skipping data pipeline deployment:`, error.message);
      return;
    }

    const deployUrl = `${DATA_PIPELINE_API_URL}/api/deploy`;
    
    console.log(`🚀 Triggering data pipeline deployment for org: ${orgSlug}`);
    console.log(`   API URL: ${deployUrl}`);
    
    const response = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customToken}`,
      },
      body: JSON.stringify({
        org_slug: orgSlug,
        last_n_days: 60, // Default to 60 days for initial deployment
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to trigger data pipeline deployment: ${response.status} ${errorText}`);
      console.error(`   URL: ${deployUrl}`);
      // Don't throw - deployment failure shouldn't block org creation
      return;
    }

    const result = await response.json();
    console.log(`✅ Data pipeline deployment triggered for org ${orgSlug}:`, result);
  } catch (error: any) {
    // Provide helpful error messages
    if (error.message?.includes('fetch failed') || error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to data pipeline API at ${DATA_PIPELINE_API_URL}`);
      console.error(`   Make sure the API is running locally on port 8082`);
      console.error(`   Start it with: cd /Users/yanfuzhu/Documents/projects/data-pipeline && python run.py`);
      console.error(`   Or set DATA_PIPELINE_API_URL to the correct URL`);
    } else {
      console.error(`❌ Error triggering data pipeline deployment for ${orgSlug}:`, error.message);
      if (error.stack) {
        console.error(`   Stack: ${error.stack.split('\n')[0]}`);
      }
    }
    // Don't throw - deployment failure shouldn't block org creation
  }
}

/**
 * Delete/undeploy data pipeline for an organization
 * @param orgSlug - The organization slug
 * @param userEmail - The user email (for authentication)
 * @returns Promise that resolves when deployment is deleted
 */
export async function deleteDataPipelineDeployment(
  orgSlug: string,
  userEmail: string
): Promise<void> {
  try {
    // Skip if API URL is not configured (e.g., in local dev)
    if (!DATA_PIPELINE_API_URL) {
      console.log(`ℹ️ Skipping data pipeline undeployment for ${orgSlug} (DATA_PIPELINE_API_URL not set)`);
      return;
    }

    // Generate a custom token for the user to authenticate with data-pipeline API
    const auth = getAuth();
    let customToken: string;
    
    try {
      // Try to get user by email
      const userRecord = await auth.getUserByEmail(userEmail);
      customToken = await auth.createCustomToken(userRecord.uid);
    } catch (error: any) {
      // If user doesn't exist in Firebase Auth, we can't create a token
      console.warn(`⚠️ Could not create custom token for ${userEmail}, skipping data pipeline undeployment:`, error.message);
      return;
    }

    const undeployUrl = `${DATA_PIPELINE_API_URL}/api/undeploy`;
    
    console.log(`🗑️ Deleting data pipeline deployment for org: ${orgSlug}`);
    console.log(`   API URL: ${undeployUrl}`);
    
    const response = await fetch(undeployUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customToken}`,
      },
      body: JSON.stringify({
        org_slug: orgSlug,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to delete data pipeline deployment: ${response.status} ${errorText}`);
      console.error(`   URL: ${undeployUrl}`);
      // Don't throw - deployment deletion failure shouldn't block org deletion
      return;
    }

    const result = await response.json();
    console.log(`✅ Data pipeline deployment deleted for org ${orgSlug}:`, result);
  } catch (error: any) {
    // Provide helpful error messages
    if (error.message?.includes('fetch failed') || error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to data pipeline API at ${DATA_PIPELINE_API_URL}`);
      console.error(`   Make sure the API is running locally on port 8082`);
      console.error(`   Or set DATA_PIPELINE_API_URL to the correct URL`);
    } else {
      console.error(`❌ Error deleting data pipeline deployment for ${orgSlug}:`, error.message);
      if (error.stack) {
        console.error(`   Stack: ${error.stack.split('\n')[0]}`);
      }
    }
    // Don't throw - deployment deletion failure shouldn't block org deletion
  }
}

