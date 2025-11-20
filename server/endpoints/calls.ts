/**
 * Call Signaling Endpoints
 * Optional backend endpoints for call signaling (can also use Firestore directly)
 * These endpoints provide additional validation and security checks
 */

import express from 'express';
import { getDomainFromEmail } from '../../database/multi-tenant-pool.js';

export function setupCallEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  db: FirebaseFirestore.Firestore
) {
  
  // Validate chatId is a DM chat
  function validateDMChatId(chatId: string, userEmail: string): { valid: boolean; otherUserEmail?: string } {
    if (!chatId.startsWith('dm-')) {
      return { valid: false };
    }

    // Extract emails from chatId (format: dm-email1-email2)
    const parts = chatId.replace('dm-', '').split('-');
    if (parts.length < 2) {
      return { valid: false };
    }

    // Reconstruct emails (emails may contain hyphens)
    const normalizedUserEmail = userEmail.toLowerCase();
    const emails = chatId.replace('dm-', '').split(/-/);
    
    // Try to find the other user's email
    // The chatId format is: dm-{sorted-email1}-{sorted-email2}
    // We need to find which email is not the current user's
    let otherUserEmail: string | undefined;
    
    // Simple approach: split by last occurrence of user email
    const userEmailIndex = chatId.indexOf(normalizedUserEmail);
    if (userEmailIndex === -1) {
      return { valid: false };
    }

    // Extract the part before and after user email
    const before = chatId.substring(4, userEmailIndex - 1); // Skip 'dm-'
    const after = chatId.substring(userEmailIndex + normalizedUserEmail.length);
    
    // The other email is either before or after
    if (before && !before.includes('@')) {
      // Try to find email pattern
      const emailMatch = chatId.match(/dm-([^-]+@[^-]+)-([^-]+@[^-]+)/);
      if (emailMatch) {
        const email1 = emailMatch[1];
        const email2 = emailMatch[2];
        otherUserEmail = email1 === normalizedUserEmail ? email2 : email1;
      }
    }

    // Fallback: try to parse by splitting on known patterns
    if (!otherUserEmail) {
      // Try splitting by the user's email
      const parts = chatId.replace('dm-', '').split(normalizedUserEmail);
      if (parts.length === 2) {
        // The other email should be in one of the parts
        const candidate = parts[0] || parts[1];
        if (candidate && candidate.includes('@')) {
          // Clean up the candidate (remove leading/trailing hyphens)
          otherUserEmail = candidate.replace(/^-+|-+$/g, '');
        }
      }
    }

    // Verify the user is part of this chat
    const sortedEmails = [normalizedUserEmail, otherUserEmail || ''].sort();
    const expectedChatId = `dm-${sortedEmails[0]}-${sortedEmails[1]}`;
    
    if (chatId !== expectedChatId && otherUserEmail) {
      return { valid: false };
    }

    return { valid: true, otherUserEmail };
  }

  // POST /api/calls/:chatId/offer - Create call offer
  app.post('/api/calls/:chatId/offer', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const chatId = req.params.chatId;
      const { offer, calleeEmail } = req.body;

      if (!offer || !calleeEmail) {
        return res.status(400).json({ error: 'offer and calleeEmail are required' });
      }

      // Validate chatId
      const validation = validateDMChatId(chatId, userEmail);
      if (!validation.valid) {
        return res.status(403).json({ error: 'Invalid chat ID or access denied' });
      }

      // Verify calleeEmail matches the other user in the chat
      if (validation.otherUserEmail && validation.otherUserEmail !== calleeEmail.toLowerCase()) {
        return res.status(400).json({ error: 'calleeEmail does not match chat participants' });
      }

      // Create call document in Firestore
      const callsPath = `domains/${domain}/calls`;
      const callId = `${chatId}-${Date.now()}`;
      
      const callData = {
        callId,
        chatId,
        callerEmail: userEmail,
        calleeEmail: calleeEmail.toLowerCase(),
        status: 'ringing',
        offer: JSON.stringify(offer),
        iceCandidates: [],
        createdAt: new Date(),
      };

      await db.collection(callsPath).doc(callId).set(callData);

      res.json({
        success: true,
        callId,
      });
    } catch (error) {
      console.error('Create call offer error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /api/calls/:chatId/answer - Send call answer
  app.post('/api/calls/:chatId/answer', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const chatId = req.params.chatId;
      const { callId, answer } = req.body;

      if (!callId || !answer) {
        return res.status(400).json({ error: 'callId and answer are required' });
      }

      // Validate chatId
      const validation = validateDMChatId(chatId, userEmail);
      if (!validation.valid) {
        return res.status(403).json({ error: 'Invalid chat ID or access denied' });
      }

      // Update call document
      const callsPath = `domains/${domain}/calls`;
      const callRef = db.collection(callsPath).doc(callId);
      const callDoc = await callRef.get();

      if (!callDoc.exists) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const callData = callDoc.data();
      if (callData?.calleeEmail?.toLowerCase() !== userEmail) {
        return res.status(403).json({ error: 'Only the callee can answer the call' });
      }

      await callRef.update({
        answer: JSON.stringify(answer),
        status: 'active',
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Send call answer error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /api/calls/:chatId/ice-candidate - Send ICE candidate
  app.post('/api/calls/:chatId/ice-candidate', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const chatId = req.params.chatId;
      const { callId, candidate } = req.body;

      if (!callId || !candidate) {
        return res.status(400).json({ error: 'callId and candidate are required' });
      }

      // Validate chatId
      const validation = validateDMChatId(chatId, userEmail);
      if (!validation.valid) {
        return res.status(403).json({ error: 'Invalid chat ID or access denied' });
      }

      // Update call document with ICE candidate
      const callsPath = `domains/${domain}/calls`;
      const callRef = db.collection(callsPath).doc(callId);
      const callDoc = await callRef.get();

      if (!callDoc.exists) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const callData = callDoc.data();
      const isCaller = callData?.callerEmail?.toLowerCase() === userEmail;
      const isCallee = callData?.calleeEmail?.toLowerCase() === userEmail;

      if (!isCaller && !isCallee) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Add ICE candidate to array
      const currentCandidates = callData?.iceCandidates || [];
      await callRef.update({
        iceCandidates: [...currentCandidates, JSON.stringify(candidate)],
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Send ICE candidate error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /api/calls/:chatId/end - End call
  app.post('/api/calls/:chatId/end', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const chatId = req.params.chatId;
      const { callId } = req.body;

      if (!callId) {
        return res.status(400).json({ error: 'callId is required' });
      }

      // Validate chatId
      const validation = validateDMChatId(chatId, userEmail);
      if (!validation.valid) {
        return res.status(403).json({ error: 'Invalid chat ID or access denied' });
      }

      // Update call document
      const callsPath = `domains/${domain}/calls`;
      const callRef = db.collection(callsPath).doc(callId);
      const callDoc = await callRef.get();

      if (!callDoc.exists) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const callData = callDoc.data();
      const isCaller = callData?.callerEmail?.toLowerCase() === userEmail;
      const isCallee = callData?.calleeEmail?.toLowerCase() === userEmail;

      if (!isCaller && !isCallee) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await callRef.update({
        status: 'ended',
        endedAt: new Date(),
      });

      res.json({ success: true });
    } catch (error) {
      console.error('End call error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /api/calls/incoming - Get all incoming calls for the current user
  // MUST be registered BEFORE /api/calls/:chatId/status to avoid route conflicts
  app.get('/api/calls/incoming', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const userEmail = (req as any).userEmail?.toLowerCase();

      // Get all active calls where user is the callee
      const callsPath = `domains/${domain}/calls`;
      let snapshot;
      
      try {
        // Query for calls where calleeEmail matches and status is ringing or active
        snapshot = await db.collection(callsPath)
          .where('calleeEmail', '==', userEmail)
          .where('status', 'in', ['ringing', 'active'])
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get();
      } catch (error: any) {
        // If index error, query without orderBy
        if (error.code === 9 || error.message?.includes('index')) {
          const allCallsSnapshot = await db.collection(callsPath)
            .where('calleeEmail', '==', userEmail)
            .where('status', 'in', ['ringing', 'active'])
            .get();
          
          if (allCallsSnapshot.empty) {
            return res.json({ calls: [] });
          }
          
          // Sort by createdAt in memory
          const calls = allCallsSnapshot.docs.map(doc => ({
            id: doc.id,
            data: doc.data(),
          }));
          
          calls.sort((a, b) => {
            const aTime = a.data.createdAt?.toDate ? a.data.createdAt.toDate().getTime() : 
                         a.data.createdAt?.getTime ? a.data.createdAt.getTime() : 0;
            const bTime = b.data.createdAt?.toDate ? b.data.createdAt.toDate().getTime() : 
                         b.data.createdAt?.getTime ? b.data.createdAt.getTime() : 0;
            return bTime - aTime; // Descending order
          });
          
          const result = calls.slice(0, 10).map(call => ({
            callId: call.id,
            chatId: call.data.chatId,
            callerEmail: call.data.callerEmail,
            calleeEmail: call.data.calleeEmail,
            status: call.data.status || 'ringing',
            offer: call.data.offer,
            answer: call.data.answer,
            iceCandidates: call.data.iceCandidates || [],
            createdAt: call.data.createdAt?.toDate ? call.data.createdAt.toDate().toISOString() : call.data.createdAt,
          }));
          
          return res.json({ calls: result });
        } else {
          throw error;
        }
      }

      if (snapshot.empty) {
        return res.json({ calls: [] });
      }

      const calls = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          callId: doc.id,
          chatId: data.chatId,
          callerEmail: data.callerEmail,
          calleeEmail: data.calleeEmail,
          status: data.status || 'ringing',
          offer: data.offer,
          answer: data.answer,
          iceCandidates: data.iceCandidates || [],
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
        };
      });

      res.json({ calls });
    } catch (error) {
      console.error('Get incoming calls error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /api/calls/:chatId/status - Get call status
  app.get('/api/calls/:chatId/status', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const chatId = req.params.chatId;

      // Validate chatId
      const validation = validateDMChatId(chatId, userEmail);
      if (!validation.valid) {
        return res.status(403).json({ error: 'Invalid chat ID or access denied' });
      }

      // Get latest call for this chat
      const callsPath = `domains/${domain}/calls`;
      let snapshot;
      
      try {
        // Try query with orderBy first (requires index)
        snapshot = await db.collection(callsPath)
          .where('chatId', '==', chatId)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
      } catch (error: any) {
        // If index error, query without orderBy and sort in memory
        if (error.code === 9 || error.message?.includes('index')) {
          const allCallsSnapshot = await db.collection(callsPath)
            .where('chatId', '==', chatId)
            .get();
          
          if (allCallsSnapshot.empty) {
            return res.json({ status: 'idle' });
          }
          
          // Sort by createdAt in memory
          const calls = allCallsSnapshot.docs.map(doc => ({
            id: doc.id,
            data: doc.data(),
          }));
          
          calls.sort((a, b) => {
            const aTime = a.data.createdAt?.toDate ? a.data.createdAt.toDate().getTime() : 
                         a.data.createdAt?.getTime ? a.data.createdAt.getTime() : 0;
            const bTime = b.data.createdAt?.toDate ? b.data.createdAt.toDate().getTime() : 
                         b.data.createdAt?.getTime ? b.data.createdAt.getTime() : 0;
            return bTime - aTime; // Descending order
          });
          
          const callDoc = { id: calls[0].id, data: () => calls[0].data };
          const callData = calls[0].data;
          
          res.json({
            callId: callDoc.id,
            status: callData.status || 'idle',
            callerEmail: callData.callerEmail,
            calleeEmail: callData.calleeEmail,
            offer: callData.offer, // Include offer for call signaling
            answer: callData.answer, // Include answer if available
            iceCandidates: callData.iceCandidates || [], // Include ICE candidates
            createdAt: callData.createdAt?.toDate ? callData.createdAt.toDate().toISOString() : callData.createdAt,
            endedAt: callData.endedAt?.toDate ? callData.endedAt.toDate().toISOString() : callData.endedAt,
          });
          return;
        } else {
          // Re-throw if it's not an index error
          throw error;
        }
      }

      if (snapshot.empty) {
        return res.json({ status: 'idle' });
      }

      const callDoc = snapshot.docs[0];
      const callData = callDoc.data();

      res.json({
        callId: callDoc.id,
        status: callData.status || 'idle',
        callerEmail: callData.callerEmail,
        calleeEmail: callData.calleeEmail,
        offer: callData.offer, // Include offer for call signaling
        answer: callData.answer, // Include answer if available
        iceCandidates: callData.iceCandidates || [], // Include ICE candidates
        createdAt: callData.createdAt?.toDate ? callData.createdAt.toDate().toISOString() : callData.createdAt,
        endedAt: callData.endedAt?.toDate ? callData.endedAt.toDate().toISOString() : callData.endedAt,
      });
    } catch (error) {
      console.error('Get call status error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

}

