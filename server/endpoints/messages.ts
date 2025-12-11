/**
 * Messages Endpoints - FIRESTORE ONLY
 * All messaging and notifications are stored exclusively in Firestore
 * This ensures true real-time capabilities without sync complexity
 */

import express from 'express';
import { userQueries } from '../../database/queries.js';
import { getOrgPool, getOrgSlugById, getSharedPool } from '../../database/multi-tenant-pool.js';

/**
 * Check if a user has access to a project (either as a member or owner)
 */
async function isProjectMember(orgId: string, userEmail: string, projectId: string): Promise<boolean> {
  try {
    const pool = await getOrgPool(orgId);
    const result = await pool.query(
      `SELECT 1 
       FROM projects p
       LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_email = $2
       WHERE p.id = $1 
         AND (p.owner_email = $2 OR pm.user_email IS NOT NULL)`,
      [projectId, userEmail.toLowerCase()]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking project access:', error);
    return false;
  }
}

/**
 * Check if a user has access to a team (either as a member or owner)
 */
async function isTeamMember(orgId: string, userEmail: string, teamId: string): Promise<boolean> {
  try {
    const pool = await getOrgPool(orgId);
    const result = await pool.query(
      `SELECT 1 
       FROM teams t
       LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_email = $2
       WHERE t.id = $1 
         AND (t.owner_email = $2 OR tm.user_email IS NOT NULL)`,
      [teamId, userEmail.toLowerCase()]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking team access:', error);
    return false;
  }
}

/**
 * Check if user is on free plan
 * HARD CODED: Always returns false (everyone is on standard tier)
 */
async function isFreePlanUser(userEmail: string): Promise<boolean> {
  return false; // Everyone is on standard tier
}

/**
 * Check if message contains @lean mention
 */
function containsLeanMention(content: string): boolean {
  const mentionRegex = /@lean\b/i;
  return mentionRegex.test(content);
}

export function setupMessageEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  db: FirebaseFirestore.Firestore,
  storage?: any // Firebase Admin Storage instance (optional, for refreshing image URLs)
) {
  
  // GET messages by chat ID - Read from Firestore
  app.get('/api/messages/:chatId', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();
      const chatId = req.params.chatId;
      const afterTimestamp = req.query.afterTimestamp 
        ? new Date(req.query.afterTimestamp as string) 
        : undefined;
      
      // Check authorization for project channels
      if (chatId.startsWith('project-') && orgId) {
        const projectId = chatId.replace('project-', '');
        const isMember = await isProjectMember(orgId, userEmail, projectId);
        if (!isMember) {
          return res.status(403).json({ error: 'Access denied: You must be a project member or owner to view messages' });
        }
      }
      
      // Check authorization for team channels
      if (chatId.startsWith('team-') && orgId) {
        const teamId = chatId.replace('team-', '');
        const isMember = await isTeamMember(orgId, userEmail, teamId);
        if (!isMember) {
          return res.status(403).json({ error: 'Access denied: You must be a team member or owner to view messages' });
        }
      }
      
      // Use org slug for Firestore path (sanitized name instead of ID)
      let messagesPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          messagesPath = `orgs/${orgSlug}/messages`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          messagesPath = `orgs/default/messages`;
        }
      } else {
        messagesPath = `orgs/default/messages`;
      }
      let query = db.collection(messagesPath).where('chatId', '==', chatId);
      
      // For AI assistant conversations, ensure privacy by filtering by userId
      // This provides an additional security layer even if chatId is somehow compromised
      if (chatId.startsWith('ai-assistant-')) {
        if (userEmail && !chatId.endsWith(`-${userEmail}`)) {
          // User is trying to access another user's AI conversation - deny access
          return res.status(403).json({ error: 'Access denied' });
        }
        // Also filter by userId for additional security
        query = query.where('userId', '==', userEmail);
      }
      
      // For project channels, also filter by projectId to ensure we only get messages for this project
      if (chatId.startsWith('project-')) {
        const projectId = chatId.replace('project-', '');
        query = query.where('projectId', '==', projectId);
      }
      
      // For team channels, also filter by teamId to ensure we only get messages for this team
      if (chatId.startsWith('team-')) {
        const teamId = chatId.replace('team-', '');
        query = query.where('teamId', '==', teamId);
      }
      
      if (afterTimestamp) {
        query = query.where('timestamp', '>', afterTimestamp);
      }
      
      // Try to order by timestamp, fallback if index doesn't exist
      let snapshot;
      try {
        snapshot = await query.orderBy('timestamp', 'asc').get();
      } catch (error: any) {
        // If index error, fetch without orderBy and sort in memory
        if (error.code === 9 || error.message?.includes('index')) {
          snapshot = await query.get();
          // Sort in memory
          const docs = snapshot.docs.sort((a, b) => {
            const aTime = a.data().timestamp?.toDate?.()?.getTime() || 0;
            const bTime = b.data().timestamp?.toDate?.()?.getTime() || 0;
            return aTime - bTime; // Ascending order (oldest first)
          });
          snapshot = { docs, empty: docs.length === 0 } as any;
        } else {
          throw error;
        }
      }
      
      const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
          imageUrls: data.imageUrls || null,
          likes: Array.isArray(data.likes) ? data.likes : [],
        };
      });
      
      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST new message - Write to Firestore only
  app.post('/api/messages', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();
      const { chatId, role, content, memberName, memberAvatar, projectId, teamId, citedContext, imageUrls } = req.body;

      if (!chatId || !content) {
        return res.status(400).json({ error: 'chatId and content are required' });
      }

      // Check authorization for project channels
      // Check both chatId (if it's a project channel) and projectId (if provided)
      let actualProjectId: string | null = null;
      
      if (chatId.startsWith('project-')) {
        actualProjectId = chatId.replace('project-', '');
      } else if (projectId) {
        actualProjectId = projectId;
      }
      
      if (actualProjectId && orgId) {
        const isMember = await isProjectMember(orgId, userEmail, actualProjectId);
        if (!isMember) {
          return res.status(403).json({ error: 'Access denied: You must be a project member or owner to post messages' });
        }
      }
      
      // Check authorization for team channels
      // Check both chatId (if it's a team channel) and teamId (if provided)
      let actualTeamId: string | null = null;
      
      if (chatId.startsWith('team-')) {
        actualTeamId = chatId.replace('team-', '');
      } else if (teamId) {
        actualTeamId = teamId;
      }
      
      if (actualTeamId && orgId) {
        const isMember = await isTeamMember(orgId, userEmail, actualTeamId);
        if (!isMember) {
          return res.status(403).json({ error: 'Access denied: You must be a team member or owner to post messages' });
        }
      }

      // Check if this is a team or project channel message
      const isTeamChannel = actualTeamId !== null;
      const isProjectChannel = actualProjectId !== null;

      // Block @lean mentions in team/group channels for free tier users
      if ((isTeamChannel || isProjectChannel) && containsLeanMention(content)) {
        const isFree = await isFreePlanUser(userEmail);
        if (isFree) {
          return res.status(403).json({ 
            error: 'Mentioning Lean in team/group channels requires a paid subscription. Please upgrade to Standard or Pro plan.' 
          });
        }
      }

      // Get user info if not provided
      let finalMemberName = memberName || 'You';
      let finalMemberAvatar = memberAvatar || 'U';
      
      if ((!memberName || !memberAvatar) && orgId) {
        const userData = await userQueries.getByEmail(orgId, userEmail);
        if (userData) {
          const firstName = userData.first_name || '';
          const lastName = userData.last_name || '';
          finalMemberName = `${firstName} ${lastName}`.trim() || userEmail;
          finalMemberAvatar = userData.avatar || `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() 
            || userEmail.charAt(0).toUpperCase();
        }
      }

      // Ensure projectId is set when posting to a project channel
      const finalProjectId = projectId || (chatId.startsWith('project-') ? chatId.replace('project-', '') : null);

      const messageData: any = {
        chatId,
        role: role || 'user',
        content,
        timestamp: new Date(),
        userId: userEmail.toLowerCase(),
        projectId: finalProjectId,
        teamId: teamId || null,
        memberName: finalMemberName,
        memberAvatar: finalMemberAvatar,
        likes: [], // Initialize likes as empty array for new messages
      };

      // Add citedContext if provided
      if (citedContext) {
        messageData.citedContext = citedContext;
      }

      // Add imageUrls if provided
      if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
        messageData.imageUrls = imageUrls;
      }

      // Write to Firestore only - single source of truth for messages
      // Use org slug for Firestore path (sanitized name instead of ID)
      let messagesPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          messagesPath = `orgs/${orgSlug}/messages`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          messagesPath = `orgs/default/messages`;
        }
      } else {
        messagesPath = `orgs/default/messages`;
      }
      const docRef = await db.collection(messagesPath).add(messageData);
      
      res.json({
        success: true,
        messageId: docRef.id,
        message: {
          id: docRef.id,
          ...messageData,
          timestamp: messageData.timestamp.toISOString(),
          imageUrls: messageData.imageUrls || null,
          likes: messageData.likes || [],
        },
      });
    } catch (error) {
      console.error('Create message error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // PATCH toggle like on a message
  app.patch('/api/messages/:messageId/like', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();
      const messageId = req.params.messageId;
      
      // Use org slug for Firestore path (sanitized name instead of ID)
      let messagesPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          messagesPath = `orgs/${orgSlug}/messages`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          messagesPath = `orgs/default/messages`;
        }
      } else {
        messagesPath = `orgs/default/messages`;
      }
      const messageRef = db.collection(messagesPath).doc(messageId);
      const messageDoc = await messageRef.get();
      
      if (!messageDoc.exists) {
        return res.status(404).json({ error: 'Message not found' });
      }
      
      const messageData = messageDoc.data();
      const likes = messageData?.likes || [];
      const userEmailLower = userEmail.toLowerCase();
      
      // Toggle like: remove if exists, add if not
      const updatedLikes = likes.includes(userEmailLower)
        ? likes.filter((email: string) => email !== userEmailLower)
        : [...likes, userEmailLower];
      
      await messageRef.update({ likes: updatedLikes });
      
      res.json({
        success: true,
        likes: updatedLikes,
        liked: updatedLikes.includes(userEmailLower),
      });
    } catch (error) {
      console.error('Toggle like error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

