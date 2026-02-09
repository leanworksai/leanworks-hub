/**
 * Mock external services for demo mode
 * Provides mock implementations for Stripe, Firebase, Twilio, etc.
 */

export const mockStripe = {
  // Mock successful payment responses
  createCheckoutSession: async (params: Record<string, any>) => {
    return {
      id: `cs_demo_${Date.now()}`,
      object: 'checkout.session',
      url: 'https://checkout.stripe.com/demo',
      success_url: params.success_url,
      cancel_url: params.cancel_url,
      status: 'open',
    };
  },

  getCustomerPortalSession: async (params: Record<string, any>) => {
    return {
      id: `bps_demo_${Date.now()}`,
      object: 'billing_portal.session',
      url: 'https://billing.stripe.com/demo',
      return_url: params.return_url,
      created: Math.floor(Date.now() / 1000),
    };
  },

  getSubscription: async (subscriptionId: string) => {
    return {
      id: subscriptionId,
      object: 'subscription',
      customer: 'cus_demo',
      status: 'active',
      plan: {
        id: 'plan_pro',
        name: 'Pro Plan',
        amount: 9900,
        currency: 'usd',
        interval: 'month',
      },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };
  },

  switchSubscription: async (params: Record<string, any>) => {
    return {
      id: `sub_demo_${Date.now()}`,
      status: 'active',
      plan: params.plan,
      proration_date: Math.floor(Date.now() / 1000),
    };
  },

  cancelSubscription: async (subscriptionId: string) => {
    return {
      id: subscriptionId,
      status: 'canceled',
      canceled_at: Math.floor(Date.now() / 1000),
    };
  },
};

export const mockTwilio = {
  // Mock TURN credentials for WebRTC
  getTurnCredentials: async (params?: Record<string, any>) => {
    const username = `demo-user-${Date.now()}`;
    const credentials = [
      {
        username,
        credential: `demo-password-${Math.random().toString(36).slice(2)}`,
        ttl: 3600,
        urls: ['turn:demo.twilio.com?transport=udp'],
      },
    ];

    return {
      username,
      password: credentials[0].credential,
      ttl: 3600,
      iceServers: [
        {
          urls: ['turn:demo.twilio.com:3478'],
          username,
          credential: credentials[0].credential,
        },
      ],
    };
  },
};

export const mockFirebaseStorage = {
  // Mock file upload responses
  uploadFile: async (params: Record<string, any>) => {
    return {
      name: params.filename || `file-${Date.now()}.bin`,
      bucket: 'demo-bucket.appspot.com',
      contentType: params.contentType || 'application/octet-stream',
      size: params.size || 0,
      timeCreated: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
  },

  // Mock signed URL generation
  getSignedUrl: async (params: Record<string, any>) => {
    return {
      urls: [
        `https://storage.googleapis.com/demo-bucket/${params.filename || 'file.bin'}?token=demo_token_${Math.random()
          .toString(36)
          .slice(2)}`,
      ],
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  },

  // Mock file deletion
  deleteFile: async (filename: string) => {
    return {
      name: filename,
      deleted: true,
    };
  },
};

export const mockIntegrations = {
  // Mock Slack integration
  slack: {
    sendMessage: async (message: string, channel: string) => {
      return {
        ok: true,
        channel,
        ts: `${Date.now()}`,
        message: {
          text: message,
          type: 'message',
        },
      };
    },

    notifyChannel: async (params: Record<string, any>) => {
      return {
        ok: true,
        status: 'sent',
        timestamp: new Date().toISOString(),
      };
    },
  },

  // Mock GitHub integration
  github: {
    checkInstallation: async (userId: string) => {
      return {
        installed: false,
        appId: 'demo-app-123',
        installationUrl: 'https://github.com/apps/demo/installations/new',
      };
    },

    saveInstallation: async (params: Record<string, any>) => {
      return {
        installationId: params.installation_id || 'demo-123',
        saved: true,
        timestamp: new Date().toISOString(),
      };
    },

    listRepos: async (installationId: string) => {
      return [
        {
          id: 1,
          name: 'demo-repo-1',
          full_name: 'demo-org/demo-repo-1',
          description: 'Sample repository',
          private: false,
        },
        {
          id: 2,
          name: 'demo-repo-2',
          full_name: 'demo-org/demo-repo-2',
          description: 'Another sample repository',
          private: true,
        },
      ];
    },

    createWebhook: async (repoName: string, webhookUrl: string) => {
      return {
        id: `hook-${Date.now()}`,
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: {
          url: webhookUrl,
          insecure_ssl: 0,
        },
      };
    },
  },

  // Mock Jira integration
  jira: {
    getIssue: async (issueKey: string) => {
      return {
        key: issueKey,
        id: `jira-demo-${Date.now()}`,
        fields: {
          summary: 'Demo Jira Issue',
          description: 'This is a demo issue',
          status: { name: 'In Progress' },
          assignee: { name: 'Demo User' },
        },
      };
    },

    createIssue: async (params: Record<string, any>) => {
      return {
        id: `jira-demo-${Date.now()}`,
        key: `DEMO-${Math.floor(Math.random() * 1000)}`,
        self: 'https://demo.atlassian.net/rest/api/2/issue/DEMO-1',
      };
    },
  },

  // Mock Linear integration
  linear: {
    getIssue: async (issueId: string) => {
      return {
        id: issueId,
        identifier: `LINEAR-${Math.floor(Math.random() * 1000)}`,
        title: 'Demo Linear Issue',
        state: 'In Progress',
        assignee: { name: 'Demo User' },
      };
    },

    createIssue: async (params: Record<string, any>) => {
      return {
        id: `linear-demo-${Date.now()}`,
        identifier: `LINEAR-${Math.floor(Math.random() * 1000)}`,
        title: params.title,
        createdAt: new Date().toISOString(),
      };
    },
  },

  // Mock Notion integration
  notion: {
    getDatabase: async (databaseId: string) => {
      return {
        object: 'database',
        id: databaseId,
        title: [{ type: 'text', text: { content: 'Demo Database' } }],
        properties: {
          Name: { id: 'prop1', type: 'title' },
          Status: { id: 'prop2', type: 'select' },
        },
      };
    },

    queryDatabase: async (databaseId: string, filter: Record<string, any>) => {
      return {
        object: 'list',
        results: [
          {
            id: `notion-demo-${Date.now()}`,
            object: 'page',
            properties: {
              Name: { title: [{ text: { content: 'Demo Page' } }] },
              Status: { select: { name: 'Active' } },
            },
          },
        ],
        has_more: false,
      };
    },
  },
};

export const mockEmail = {
  // Mock email sending
  sendVerificationEmail: async (email: string, token: string) => {
    return {
      messageId: `demo-msg-${Date.now()}`,
      to: email,
      subject: '[Demo] Verify your email',
      status: 'sent',
      timestamp: new Date().toISOString(),
    };
  },

  sendInvitationEmail: async (email: string, inviterName: string, orgName: string) => {
    return {
      messageId: `demo-msg-${Date.now()}`,
      to: email,
      subject: `${inviterName} invited you to ${orgName}`,
      status: 'sent',
      timestamp: new Date().toISOString(),
    };
  },

  sendPasswordResetEmail: async (email: string, token: string) => {
    return {
      messageId: `demo-msg-${Date.now()}`,
      to: email,
      subject: '[Demo] Reset your password',
      status: 'sent',
      timestamp: new Date().toISOString(),
    };
  },
};

// Mock database operations (in-memory simulation)
export const mockDatabase = {
  // Query operations
  query: async (query: string, params: any[] = []) => {
    // Simple mock that returns empty or mock data
    return {
      rows: [],
      rowCount: 0,
      command: 'SELECT',
    };
  },

  // Execute operations
  execute: async (query: string, params: any[] = []) => {
    return {
      rowCount: 1,
      command: 'INSERT/UPDATE/DELETE',
      oid: null,
    };
  },

  // Transaction support
  transaction: async (callback: (client: any) => Promise<any>) => {
    const mockClient = {
      query,
      execute,
    };
    return callback(mockClient);
  },
};

// Mock Firebase Cloud Messaging
export const mockFirebaseMessaging = {
  sendMulticast: async (message: Record<string, any>) => {
    return {
      successCount: message.tokens?.length || 0,
      failureCount: 0,
      responses: (message.tokens || []).map((token: string) => ({
        success: true,
        messageId: `demo-msg-${Date.now()}`,
      })),
    };
  },

  send: async (message: Record<string, any>) => {
    return `demo-msg-${Date.now()}`;
  },
};
