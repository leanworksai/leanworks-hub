/**
 * Messages Endpoints - FIRESTORE ONLY
 * All messaging and notifications are stored exclusively in Firestore
 * This ensures true real-time capabilities without sync complexity
 */

import express from 'express';
import { userQueries } from '../../database/queries.js';

export function setupMessageEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  db: FirebaseFirestore.Firestore
) {
  
  // GET messages by chat ID - Read from Firestore
  app.get('/api/messages/:chatId', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const chatId = req.params.chatId;
      const afterTimestamp = req.query.afterTimestamp 
        ? new Date(req.query.afterTimestamp as string) 
        : undefined;
      
      const messagesPath = `domains/${domain}/messages`;
      let query = db.collection(messagesPath).where('chatId', '==', chatId);
      
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
            return aTime - bTime; // Ascending
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
      const domain = (req as any).userDomain;
      const userEmail = (req as any).user.email;
      const { chatId, role, content, memberName, memberAvatar, projectId, teamId } = req.body;

      if (!chatId || !content) {
        return res.status(400).json({ error: 'chatId and content are required' });
      }

      // Get user info if not provided
      let finalMemberName = memberName || 'You';
      let finalMemberAvatar = memberAvatar || 'U';
      
      if (!memberName || !memberAvatar) {
        const userData = await userQueries.getByEmail(userEmail);
        if (userData) {
          const firstName = userData.first_name || '';
          const lastName = userData.last_name || '';
          finalMemberName = `${firstName} ${lastName}`.trim() || userEmail;
          finalMemberAvatar = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() 
            || userEmail.charAt(0).toUpperCase();
        }
      }

      const messageData = {
        chatId,
        role: role || 'user',
        content,
        timestamp: new Date(),
        userId: userEmail.toLowerCase(),
        projectId: projectId || null,
        teamId: teamId || null,
        memberName: finalMemberName,
        memberAvatar: finalMemberAvatar,
      };

      // Write to Firestore only - single source of truth for messages
      const messagesPath = `domains/${domain}/messages`;
      const docRef = await db.collection(messagesPath).add(messageData);
      
      res.json({
        success: true,
        messageId: docRef.id,
        message: {
          id: docRef.id,
          ...messageData,
          timestamp: messageData.timestamp.toISOString(),
        },
      });
    } catch (error) {
      console.error('Create message error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

