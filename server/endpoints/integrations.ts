/**
 * Integrations Endpoints
 * Uses PostgreSQL for metadata, Secret Manager for credentials
 */

import express from 'express';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getFirestore } from 'firebase-admin/firestore';
import { getTenantPool, getDomainFromEmail } from '../../database/multi-tenant-pool.js';
import crypto from 'crypto';

// Helper function to create secret name for domain and integration
function getSecretName(domain: string, integrationId: string): string {
  const sanitizedDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sanitizedIntegrationId = integrationId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `integrations-${sanitizedDomain}-${sanitizedIntegrationId}`;
}

// Helper function to save secret to GCP Secret Manager
async function saveSecret(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  const parent = `projects/${projectId}`;
  const fullSecretName = `${parent}/secrets/${secretName}`;

  try {
    // Try to create the secret first
    try {
      await secretManagerClient.createSecret({
        parent,
        secretId: secretName,
        secret: {
          replication: {
            automatic: {},
          },
        },
      });
    } catch (error: any) {
      // If secret already exists (error code 6), that's fine
      if (error.code !== 6) {
        throw error;
      }
    }

    // Add a new version with the secret value
    await secretManagerClient.addSecretVersion({
      parent: fullSecretName,
      payload: {
        data: Buffer.from(secretValue, 'utf8'),
      },
    });
  } catch (error: any) {
    console.error('[Secret Manager] Error saving secret:', error);
    throw new Error(`Failed to save secret: ${error.message}`);
  }
}

// Helper function to delete secret from GCP Secret Manager
async function deleteSecret(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string,
  secretName: string
): Promise<void> {
  const fullSecretName = `projects/${projectId}/secrets/${secretName}`;

  try {
    await secretManagerClient.deleteSecret({ name: fullSecretName });
  } catch (error: any) {
    // If secret doesn't exist (error code 5), that's fine
    if (error.code !== 5) {
      console.error('Error deleting secret:', error);
      throw new Error(`Failed to delete secret: ${error.message}`);
    }
  }
}

export function setupIntegrationEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  secretManagerClient: SecretManagerServiceClient,
  serviceAccount: any,
  db: FirebaseFirestore.Firestore
) {
  const projectId = serviceAccount.project_id;

  // GET all integrations
  app.get('/api/integrations', authenticateUser, async (req, res) => {
    try {
      const userEmail = (req as any).userEmail;
      const domain = (req as any).userDomain;
      const pool = await getTenantPool(userEmail);
      
      // Get connected integrations from PostgreSQL using tenant pool
      // Note: No domain column needed - each tenant has its own database
      const result = await pool.query(
        `SELECT id, integration_id, integration_name, connected, 
                secret_name, connected_at, installation_id, metadata
         FROM integrations 
         ORDER BY integration_id`
      );
      const connectedIntegrations = result.rows;
      
      // Return all integrations with connection status
      const allIntegrations = [
        { id: 'slack', name: 'Slack' },
        { id: 'atlassian', name: 'Atlassian' },
        { id: 'github', name: 'GitHub' },
        { id: 'outlook', name: 'Outlook' },
      ].map(integration => {
        const existing = connectedIntegrations.find((i: any) => i.integration_id === integration.id);
        return {
          id: integration.id,
          name: integration.name,
          connected: existing ? true : false,
          secretName: existing?.secret_name,
          connectedAt: existing?.connected_at,
          installationId: existing?.installation_id,
        };
      });

      res.json(allIntegrations);
    } catch (error) {
      console.error('Get integrations error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST connect integration
  app.post('/api/integrations/:integrationId/connect', authenticateUser, async (req, res) => {
    try {
      const userEmail = (req as any).userEmail;
      const domain = (req as any).userDomain;
      const integrationId = req.params.integrationId;
      const body = req.body;
      const pool = await getTenantPool(userEmail);

      // Validate integration ID
      if (!['slack', 'atlassian', 'outlook'].includes(integrationId)) {
        return res.status(400).json({ error: 'Invalid integration ID' });
      }

      // Integration-specific validation
      let credentials: any;
      let integrationName: string;

      switch (integrationId) {
        case 'slack':
          if (!body.botToken) {
            return res.status(400).json({ error: 'Bot token is required' });
          }
          credentials = { botToken: body.botToken };
          integrationName = 'Slack';
          break;

        case 'atlassian':
          if (!body.email || !body.domain || !body.apiToken) {
            return res.status(400).json({ error: 'Email, Atlassian domain, and API token are required' });
          }
          credentials = { 
            email: body.email, 
            domain: body.domain, 
            apiToken: body.apiToken 
          };
          integrationName = 'Atlassian';
          break;

        case 'outlook':
          if (!body.clientId || !body.clientSecret || !body.tenantId) {
            return res.status(400).json({ error: 'Client ID, Client Secret, and Tenant ID are required' });
          }
          credentials = { 
            clientId: body.clientId, 
            clientSecret: body.clientSecret, 
            tenantId: body.tenantId 
          };
          integrationName = 'Outlook';
          break;

        default:
          return res.status(400).json({ error: 'Unsupported integration type' });
      }

      // Generate secret name
      const secretName = getSecretName(domain, integrationId);
      
      // Save credentials to GCP Secret Manager
      await saveSecret(secretManagerClient, projectId, secretName, JSON.stringify(credentials));

      // Update PostgreSQL using tenant pool
      // Note: No domain column - each tenant has its own database
      await pool.query(
        `INSERT INTO integrations (
          integration_id, integration_name, connected,
          secret_name, installation_id, connected_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (integration_id) DO UPDATE SET
          integration_name = EXCLUDED.integration_name,
          connected = EXCLUDED.connected,
          secret_name = EXCLUDED.secret_name,
          installation_id = EXCLUDED.installation_id,
          updated_at = NOW()`,
        [
          integrationId,
          integrationName,
          true,
          secretName,
          null
        ]
      );

      res.json({ success: true, message: `${integrationName} connected successfully` });
    } catch (error) {
      console.error(`Connect ${req.params.integrationId} error:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST disconnect integration
  app.post('/api/integrations/:integrationId/disconnect', authenticateUser, async (req, res) => {
    try {
      const userEmail = (req as any).userEmail;
      const domain = (req as any).userDomain;
      const integrationId = req.params.integrationId;
      const pool = await getTenantPool(userEmail);

      if (!['slack', 'atlassian', 'github', 'outlook'].includes(integrationId)) {
        return res.status(400).json({ error: 'Invalid integration ID' });
      }

      // Get the secret name from PostgreSQL using tenant pool
      // Note: No domain column - each tenant has its own database
      const result = await pool.query(
        `SELECT id, integration_id, integration_name, connected, 
                secret_name, connected_at, installation_id, metadata
         FROM integrations 
         WHERE integration_id = $1`,
        [integrationId]
      );
      const integration = result.rows[0] || null;
      const secretName = integration?.secret_name || getSecretName(domain, integrationId);

      // Delete secret from GCP Secret Manager
      await deleteSecret(secretManagerClient, projectId, secretName);

      // Delete from PostgreSQL using tenant pool
      await pool.query(
        'DELETE FROM integrations WHERE integration_id = $1',
        [integrationId]
      );

      res.json({ success: true, message: 'Integration disconnected successfully' });
    } catch (error) {
      console.error('Disconnect integration error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GitHub App installation callback
  app.get('/api/integrations/github/callback', async (req, res) => {
    try {
      const { installation_id, setup_action, state } = req.query;

      if (!installation_id || !state) {
        return res.status(400).send('Missing required parameters');
      }

      const installationId = parseInt(installation_id as string, 10);
      if (isNaN(installationId)) {
        return res.status(400).send('Invalid installation_id');
      }
      
      const rawDomain = state as string;
      
      // Sanitize domain to match database name format (same as getDomainFromEmail does)
      // The state contains the raw domain (e.g., "example.com"), but DB name is sanitized (e.g., "examplecom")
      const sanitizedDomain = rawDomain.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Ensure database name doesn't start with a number (PostgreSQL requirement)
      const domain = sanitizedDomain && /^\d/.test(sanitizedDomain) ? 'db_' + sanitizedDomain : sanitizedDomain;
      
      // Get tenant pool - create a dummy email to get the pool
      const dummyEmail = `admin@${rawDomain}`;
      const pool = await getTenantPool(dummyEmail);

      // Store mapping in PostgreSQL using tenant pool
      // Note: github_installations table doesn't have domain column in multi-tenant setup
      await pool.query(
        `INSERT INTO github_installations (installation_id, setup_action, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (installation_id) DO UPDATE SET
           setup_action = EXCLUDED.setup_action,
           updated_at = NOW()`,
        [installationId, (setup_action as string) || 'install']
      );

      // Save basic installation data to Secret Manager
      // Use rawDomain for secret naming (getSecretName will sanitize it)
      const secretName = getSecretName(rawDomain, 'github');
      const basicInstallationData = {
        installationId,
        domain: rawDomain,
        connectedAt: new Date().toISOString(),
      };

      await saveSecret(secretManagerClient, projectId, secretName, JSON.stringify(basicInstallationData));

      // Update PostgreSQL integration record using tenant pool
      // Note: No domain column - each tenant has its own database
      await pool.query(
        `INSERT INTO integrations (
          integration_id, integration_name, connected,
          secret_name, installation_id, connected_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (integration_id) DO UPDATE SET
          integration_name = EXCLUDED.integration_name,
          connected = EXCLUDED.connected,
          secret_name = EXCLUDED.secret_name,
          installation_id = EXCLUDED.installation_id,
          updated_at = NOW()`,
        [
          'github',
          'GitHub',
          true,
          secretName,
          installationId
        ]
      );

      // Redirect to frontend
      const redirectUrl = process.env.FRONTEND_URL || 'https://hub.leanworks.ai';
      const redirectPath = `${redirectUrl}/integrations?github=connected&installation_id=${installationId}`;
      res.redirect(redirectPath);
    } catch (error: any) {
      console.error('[GitHub Callback] Error:', error);
      const redirectUrl = process.env.FRONTEND_URL || 'https://hub.leanworks.ai';
      res.redirect(`${redirectUrl}/integrations?github=error`);
    }
  });

  // GitHub Webhook endpoint (keep existing implementation)
  app.post('/api/integrations/github/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const signature = req.headers['x-hub-signature-256'] as string;
      const event = req.headers['x-github-event'] as string;
      const deliveryId = req.headers['x-github-delivery'] as string;

      if (!signature || !event || !deliveryId) {
        return res.status(400).json({ error: 'Missing required GitHub webhook headers' });
      }

      // Get webhook secret
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error('[GitHub Webhook] Webhook secret not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
      }

      // Verify webhook signature
      const payload = req.body;
      const hmac = crypto.createHmac('sha256', webhookSecret);
      const digest = 'sha256=' + hmac.update(payload).digest('hex');
      
      if (signature !== digest) {
        console.error('[GitHub Webhook] Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Parse payload
      let payloadData;
      try {
        payloadData = JSON.parse(payload.toString());
      } catch (error) {
        console.error('[GitHub Webhook] Invalid JSON payload');
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      // Handle installation events
      if (event === 'installation') {
        const installation = payloadData.installation;
        if (!installation || !installation.id) {
          return res.status(400).json({ error: 'Missing installation data' });
        }

        const installationId = installation.id;

        if (payloadData.action === 'created') {
          // Installation details will be stored in Secret Manager by the callback
        } else if (payloadData.action === 'deleted') {
          // For deletion, we need to find which tenant database has this installation
          // This is a limitation of multi-tenant architecture - we'd need a shared lookup table
          // For now, we'll handle it when the user tries to use it
          
          // Note: We can't easily delete from tenant DBs without knowing which one
          // The integration will be cleaned up when the user next accesses the integrations page
        }
      }

      res.status(200).json({ received: true, event, deliveryId });
    } catch (error) {
      console.error('[GitHub Webhook] Error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

