/**
 * Messages Endpoints - FIRESTORE ONLY
 * All messaging and notifications are stored exclusively in Firestore
 * This ensures true real-time capabilities without sync complexity
 */

import express from 'express';
import { userQueries } from '../../database/queries.js';
import { getOrgPool, getOrgSlugById, getSharedPool } from '../../database/multi-tenant-pool.js';

/**
 * Check if a user has access to a project (checks visibility settings)
 */
async function isProjectMember(orgId: string, userEmail: string, projectId: string): Promise<boolean> {
  try {
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    const result = await pool.query(
      `SELECT 
         p.visibility,
         p.visible_to_members,
         p.owner_email
       FROM projects p
       WHERE p.id = $1`,
      [projectId]
    );
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const project = result.rows[0];
    const visibility = project.visibility || 'all_members';
    const isOwner = project.owner_email.toLowerCase() === normalizedEmail;
    
    // Owner always has access
    if (isOwner) {
      return true;
    }
    
    // If visibility is 'all_members', all org members have access
    if (visibility === 'all_members') {
      return true;
    }
    
    // If visibility is 'specific_members', check if user is in visible_to_members
    if (visibility === 'specific_members') {
      const visibleToMembers = Array.isArray(project.visible_to_members) 
        ? project.visible_to_members 
        : (project.visible_to_members ? JSON.parse(project.visible_to_members) : []);
      return visibleToMembers.includes(normalizedEmail);
    }
    
    return false;
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

  // GET recent conversations - Returns list of conversations with last message info
  app.get('/api/conversations/recent', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Use org slug for Firestore path
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

      // Get all messages for this user (they can see messages where they're the sender or in channels they have access to)
      // We'll group by chatId and get the most recent message for each
      const messagesRef = db.collection(messagesPath);
      
      // For AI assistant, filter by userId
      // For DMs, filter by userId (user is participant)
      // For channels, we'll need to check access separately
      
      // Get messages where user is the sender (covers DMs and AI assistant)
      const userMessagesQuery = messagesRef
        .where('userId', '==', userEmail)
        .orderBy('timestamp', 'desc')
        .limit(500); // Get more to group by chatId
      
      let userMessagesSnapshot;
      try {
        userMessagesSnapshot = await userMessagesQuery.get();
      } catch (error: any) {
        // If index error, fetch without orderBy
        if (error.code === 9 || error.message?.includes('index')) {
          const snapshot = await messagesRef.where('userId', '==', userEmail).limit(500).get();
          const docs = snapshot.docs.sort((a, b) => {
            const aTime = a.data().timestamp?.toDate?.()?.getTime() || 0;
            const bTime = b.data().timestamp?.toDate?.()?.getTime() || 0;
            return bTime - aTime; // Descending
          });
          userMessagesSnapshot = { docs, empty: docs.length === 0 } as any;
        } else {
          throw error;
        }
      }

      // Group messages by chatId and get the most recent one for each
      const conversationsMap = new Map<string, any>();
      
      userMessagesSnapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        const chatId = data.chatId;
        if (!chatId) return;
        
        const timestamp = data.timestamp?.toDate?.()?.getTime() || 
                         (typeof data.timestamp === 'number' ? data.timestamp : 0);
        
        if (!conversationsMap.has(chatId)) {
          conversationsMap.set(chatId, {
            chatId,
            lastMessage: data.content || '',
            lastMessageTimestamp: timestamp,
            lastMessageRole: data.role || 'user',
            lastMessageUserId: data.userId || null,
          });
        } else {
          const existing = conversationsMap.get(chatId)!;
          if (timestamp > existing.lastMessageTimestamp) {
            existing.lastMessage = data.content || '';
            existing.lastMessageTimestamp = timestamp;
            existing.lastMessageRole = data.role || 'user';
            existing.lastMessageUserId = data.userId || null;
          }
        }
      });

      // Also get messages in DMs where user is the recipient (other user sent)
      // For DMs, chatId format is dm-{email1}-{email2} where emails are sorted alphabetically
      // We need to get all messages and filter for DMs where the user is a participant
      const allMessagesQuery = messagesRef
        .orderBy('timestamp', 'desc')
        .limit(1000); // Get more to filter DMs
      
      let allMessagesSnapshot;
      try {
        allMessagesSnapshot = await allMessagesQuery.get();
      } catch (error: any) {
        if (error.code === 9 || error.message?.includes('index')) {
          const snapshot = await messagesRef.limit(1000).get();
          const docs = snapshot.docs.sort((a, b) => {
            const aTime = a.data().timestamp?.toDate?.()?.getTime() || 0;
            const bTime = b.data().timestamp?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          });
          allMessagesSnapshot = { docs, empty: docs.length === 0 } as any;
        } else {
          throw error;
        }
      }

      // Process DM messages where user is recipient
      // DM format: dm-{email1}-{email2} where emails are sorted alphabetically
      // We check if the chatId contains the user's email (normalized, without @)
      const userEmailNormalized = userEmail.replace('@', '').replace(/\./g, '');
      
      allMessagesSnapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        const chatId = data.chatId;
        if (!chatId || !chatId.startsWith('dm-')) return;
        
        // Skip if we already have this conversation (user was the sender)
        if (conversationsMap.has(chatId)) return;
        
        // Check if this DM involves the current user
        // The chatId format is dm-{email1}-{email2} where emails are sorted
        // We normalize both the chatId and userEmail to compare
        const chatIdNormalized = chatId.toLowerCase().replace(/[@\.-]/g, '');
        if (!chatIdNormalized.includes(userEmailNormalized)) {
          return; // User is not a participant in this DM
        }
        
        const timestamp = data.timestamp?.toDate?.()?.getTime() || 
                         (typeof data.timestamp === 'number' ? data.timestamp : 0);
        
        conversationsMap.set(chatId, {
          chatId,
          lastMessage: data.content || '',
          lastMessageTimestamp: timestamp,
          lastMessageRole: data.role || 'user',
          lastMessageUserId: data.userId || null,
        });
      });

      // Filter conversations to only include those the user has access to
      const filteredConversations: any[] = [];
      
      for (const conv of conversationsMap.values()) {
        const chatId = conv.chatId;
        
        // AI assistant conversations - user always has access (already filtered by userId)
        if (chatId.startsWith('ai-assistant-')) {
          // Verify it's the user's own AI assistant conversation
          if (chatId.endsWith(`-${userEmail}`)) {
            filteredConversations.push(conv);
          }
          continue;
        }
        
        // Project channels - check if user has access
        if (chatId.startsWith('project-') && orgId) {
          const projectId = chatId.replace('project-', '');
          const hasAccess = await isProjectMember(orgId, userEmail, projectId);
          if (hasAccess) {
            filteredConversations.push(conv);
          }
          continue;
        }
        
        // Team channels - check if user has access
        if (chatId.startsWith('team-') && orgId) {
          const teamId = chatId.replace('team-', '');
          const hasAccess = await isTeamMember(orgId, userEmail, teamId);
          if (hasAccess) {
            filteredConversations.push(conv);
          }
          continue;
        }
        
        // Direct messages - verify the other user is in the same org
        if (chatId.startsWith('dm-') && orgId) {
          try {
            // Extract the other user's email from the DM chatId
            // Format: dm-{email1}-{email2} where emails are sorted
            const dmPart = chatId.replace('dm-', '');
            
            // Try to extract emails - look for @ symbols
            const atIndices: number[] = [];
            for (let i = 0; i < dmPart.length; i++) {
              if (dmPart[i] === '@') {
                atIndices.push(i);
              }
            }
            
            if (atIndices.length >= 2) {
              // Find the split point (hyphen between domains)
              const firstDomainEnd = dmPart.indexOf('-', atIndices[0]);
              if (firstDomainEnd > atIndices[0]) {
                const email1 = dmPart.substring(0, firstDomainEnd);
                const email2 = dmPart.substring(firstDomainEnd + 1);
                const otherUserEmail = email1.toLowerCase() === userEmail 
                  ? email2.toLowerCase() 
                  : email1.toLowerCase();
                
                // Check if the other user is in the same org
                const pool = await getOrgPool(orgId);
                const userCheck = await pool.query(
                  `SELECT 1 FROM users WHERE email = $1`,
                  [otherUserEmail]
                );
                
                if (userCheck.rows.length > 0) {
                  filteredConversations.push(conv);
                }
              }
            } else {
              // Fallback: if we can't parse, check if any org member's email appears in the chatId
              const pool = await getOrgPool(orgId);
              const orgMembers = await pool.query(
                `SELECT email FROM users WHERE email != $1`,
                [userEmail]
              );
              
              const memberEmails = orgMembers.rows.map((row: any) => row.email.toLowerCase());
              const chatIdLower = chatId.toLowerCase();
              const hasOrgMember = memberEmails.some((email: string) => 
                chatIdLower.includes(email.replace('@', '').replace(/\./g, ''))
              );
              
              if (hasOrgMember) {
                filteredConversations.push(conv);
              }
            }
          } catch (error) {
            console.error('Error checking DM access:', error);
            // Skip this conversation if we can't verify access
          }
          continue;
        }
        
        // Unknown conversation type - skip it for safety
      }

      // Sort by last message timestamp and limit
      const conversations = filteredConversations
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp)
        .slice(0, limit)
        .map(conv => ({
          ...conv,
          lastMessageTimestamp: new Date(conv.lastMessageTimestamp).toISOString(),
        }));

      res.json(conversations);
    } catch (error) {
      console.error('Get recent conversations error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // PATCH /api/chats/:chatId/read - Mark a chat as read
  app.patch('/api/chats/:chatId/read', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();
      const chatId = req.params.chatId;

      if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get org slug for Firestore path
      let readReceiptsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          readReceiptsPath = `orgs/${orgSlug}/read_receipts`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          readReceiptsPath = `orgs/default/read_receipts`;
        }
      } else {
        readReceiptsPath = `orgs/default/read_receipts`;
      }

      // Sanitize document ID: replace @ and . with - in userId and chatId
      const sanitizedUserId = userEmail.replace(/[@.]/g, '-');
      const sanitizedChatId = chatId.replace(/[@.]/g, '-');
      const docId = `${sanitizedUserId}_${sanitizedChatId}`;

      const now = Date.now();
      const readReceiptRef = db.collection(readReceiptsPath).doc(docId);

      // Use set with merge to create or update
      await readReceiptRef.set({
        userId: userEmail,
        chatId: chatId,
        lastReadTimestamp: now,
        updatedAt: new Date(),
      }, { merge: true });

      res.json({ success: true, lastReadTimestamp: now });
    } catch (error) {
      console.error('Mark chat as read error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /api/chats/read-receipts - Get all read receipts for the current user
  app.get('/api/chats/read-receipts', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();

      if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get org slug for Firestore path
      let readReceiptsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          readReceiptsPath = `orgs/${orgSlug}/read_receipts`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          readReceiptsPath = `orgs/default/read_receipts`;
        }
      } else {
        readReceiptsPath = `orgs/default/read_receipts`;
      }

      // Query all read receipts for this user
      const snapshot = await db.collection(readReceiptsPath)
        .where('userId', '==', userEmail)
        .get();

      const readReceipts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          chatId: data.chatId,
          lastReadTimestamp: data.lastReadTimestamp || 0,
        };
      });

      res.json(readReceipts);
    } catch (error) {
      console.error('Get read receipts error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /api/chats/read-receipts/batch - Get read receipts for specific chats
  app.post('/api/chats/read-receipts/batch', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user.email?.toLowerCase();
      const { chatIds } = req.body;

      if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!Array.isArray(chatIds)) {
        return res.status(400).json({ error: 'chatIds must be an array' });
      }

      // Get org slug for Firestore path
      let readReceiptsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          readReceiptsPath = `orgs/${orgSlug}/read_receipts`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          readReceiptsPath = `orgs/default/read_receipts`;
        }
      } else {
        readReceiptsPath = `orgs/default/read_receipts`;
      }

      // Build document IDs for the requested chats
      const sanitizedUserId = userEmail.replace(/[@.]/g, '-');
      const docIds = chatIds.map((chatId: string) => {
        const sanitizedChatId = chatId.replace(/[@.]/g, '-');
        return `${sanitizedUserId}_${sanitizedChatId}`;
      });

      // Fetch documents in batches (Firestore limit is 10 for 'in' queries)
      const BATCH_SIZE = 10;
      const readReceiptsMap: Record<string, number> = {};

      for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
        const batch = docIds.slice(i, i + BATCH_SIZE);
        const snapshot = await db.collection(readReceiptsPath)
          .where(db.FieldPath.documentId(), 'in', batch)
          .get();

        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.chatId) {
            readReceiptsMap[data.chatId] = data.lastReadTimestamp || 0;
          }
        });
      }

      res.json(readReceiptsMap);
    } catch (error) {
      console.error('Get read receipts batch error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

