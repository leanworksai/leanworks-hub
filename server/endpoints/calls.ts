/**
 * Call Signaling Endpoints
 * Optional backend endpoints for call signaling (can also use Firestore directly)
 * These endpoints provide additional validation and security checks
 */

import express from 'express';
import crypto from 'crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getOrgSlugById, getOrgPool, getUserInfoBatch } from '../../database/multi-tenant-pool.js';
import { finalizeTranscriptionSession, formatTranscriptWithSpeakers, isTranscriptionActive } from '../services/transcription.js';

export function setupCallEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  db: FirebaseFirestore.Firestore,
  secretManagerClient?: SecretManagerServiceClient,
  projectId?: string
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
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
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
      // Use org slug for Firestore path (sanitized name instead of ID)
      let callsPath: string;
      let orgSlug: string | null = null;
      if (orgId) {
        try {
          orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
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
        transcriptionEnabled: true, // Enable transcription by default
        transcriptReady: false,
      };

      console.log('📞 [Backend] Creating call document', {
        callId,
        callsPath,
        orgSlug,
        orgId,
        callerEmail: userEmail,
        calleeEmail: calleeEmail.toLowerCase(),
        chatId,
        databaseId: db.databaseId,
      });

      try {
        const docRef = db.collection(callsPath).doc(callId);
        await docRef.set(callData);
        
        console.log('✅ [Backend] Call document created successfully', {
          callId,
          documentPath: docRef.path,
          databaseId: db.databaseId,
        });
        
        // Verify the document was written
        const verifyDoc = await docRef.get();
        
        if (!verifyDoc.exists) {
          console.error('❌ [Backend] Call document not found after write!', {
            documentPath: docRef.path,
          });
        } else {
          const verifyData = verifyDoc.data();
          console.log('✅ [Backend] Call document verified', {
            callId,
            documentPath: docRef.path,
            data: {
              callerEmail: verifyData?.callerEmail,
              calleeEmail: verifyData?.calleeEmail,
              status: verifyData?.status,
              hasOffer: !!verifyData?.offer,
              createdAt: verifyData?.createdAt?.toDate ? verifyData.createdAt.toDate().toISOString() : verifyData?.createdAt,
            },
          });
        }
      } catch (writeError: any) {
        console.error('❌ [Backend] Failed to write call document', {
          error: writeError,
          message: writeError?.message,
          code: writeError?.code,
          stack: writeError?.stack,
          callsPath,
          callId,
          databaseId: db.databaseId,
        });
        throw writeError;
      }

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
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
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
      // Use org slug for Firestore path (sanitized name instead of ID)
      let callsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
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
        transcriptionEnabled: true, // Enable transcription for active calls
      });

      // Start transcription if roomName is available
      if (callData?.roomName) {
        try {
          const participants: Array<{ email: string; name?: string }> = [];
          
          if (callData.callerEmail) {
            participants.push({ email: callData.callerEmail });
          }
          if (callData.calleeEmail && !callData.calleeEmail.startsWith('project-') && !callData.calleeEmail.startsWith('team-')) {
            participants.push({ email: callData.calleeEmail });
          }
          if (callData?.participantEmails && Array.isArray(callData.participantEmails)) {
            for (const email of callData.participantEmails) {
              if (!participants.find(p => p.email.toLowerCase() === email.toLowerCase())) {
                participants.push({ email });
              }
            }
          }

          if (participants.length > 0) {
            const { startTranscriptionSession } = await import('../services/transcription.js');
            await startTranscriptionSession(callId, callData.roomName, participants, secretManagerClient, projectId);
            console.log(`✅ Transcription started for call ${callId}`);
            
            // Note: LiveKit egress needs to be configured on the LiveKit server
            // For now, transcription will work if egress is manually started or configured via webhooks
            // TODO: Add code to start LiveKit egress programmatically when transcription begins
            console.log(`📝 Note: Ensure LiveKit egress is configured to stream to /api/livekit/audio?callId=${callId}&participantEmail={participant}`);
          }
        } catch (transcriptionError) {
          console.error('❌ Error starting transcription:', transcriptionError);
          // Don't fail the call answer if transcription fails
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Send call answer error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /api/calls/:chatId/ice-candidate - Send ICE candidate
  app.post('/api/calls/:chatId/ice-candidate', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
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
      // Use org slug for Firestore path (sanitized name instead of ID)
      let callsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
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
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
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
      // Use org slug for Firestore path (sanitized name instead of ID)
      let callsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
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

      // Finalize transcription if active and create notes
      try {
        if (isTranscriptionActive(callId)) {
          console.log(`📝 Finalizing transcription for call ${callId}`);
          
          // Get participants from call data
          const participants: Array<{ email: string; name?: string }> = [];
          
          // Add caller
          if (callData?.callerEmail) {
            participants.push({ email: callData.callerEmail });
          }
          
          // Add callee
          if (callData?.calleeEmail && !callData.calleeEmail.startsWith('project-') && !callData.calleeEmail.startsWith('team-')) {
            participants.push({ email: callData.calleeEmail });
          }
          
          // Add group call participants if available
          if (callData?.participantEmails && Array.isArray(callData.participantEmails)) {
            for (const email of callData.participantEmails) {
              if (!participants.find(p => p.email.toLowerCase() === email.toLowerCase())) {
                participants.push({ email });
              }
            }
          }

          // Get user names for participants
          const participantEmails = participants.map(p => p.email);
          const userInfoMap = await getUserInfoBatch(participantEmails);
          
          // Update participants with names
          const participantsWithNames = participants.map(p => {
            const info = userInfoMap.get(p.email.toLowerCase());
            return {
              email: p.email,
              name: info?.name || p.email,
            };
          });

          // Create participant map for transcript formatting
          const participantMap = new Map(
            participantsWithNames.map(p => [p.email.toLowerCase(), p])
          );

          // Finalize transcription
          const transcripts = await finalizeTranscriptionSession(callId);
          
          if (transcripts.size > 0) {
            // Format transcript with speaker labels
            const formattedTranscript = formatTranscriptWithSpeakers(transcripts, participantMap);
            
            // Create notes for each participant
            const pool = await getOrgPool(orgId);
            const callDate = callData?.createdAt?.toDate 
              ? callData.createdAt.toDate() 
              : new Date();
            const callDateStr = callDate.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            // Determine projectId or teamId from chatId
            let projectId: string | null = null;
            let teamId: string | null = null;
            if (callData?.chatId) {
              if (callData.chatId.startsWith('project-')) {
                projectId = callData.chatId.replace('project-', '');
              } else if (callData.chatId.startsWith('team-')) {
                teamId = callData.chatId.replace('team-', '');
              }
            }

            // Create note for each participant
            for (const participant of participantsWithNames) {
              try {
                const noteId = crypto.randomBytes(16).toString('hex');
                const noteTitle = `Meeting Notes - ${callDateStr}`;
                
                // Create HTML content with transcript
                const noteContent = `
                  <div>
                    <h2>Voice Call Transcript</h2>
                    <p><strong>Date:</strong> ${callDateStr}</p>
                    <p><strong>Participants:</strong> ${participantsWithNames.map(p => p.name).join(', ')}</p>
                    <hr>
                    <div>
                      ${formattedTranscript}
                    </div>
                  </div>
                `;

                await pool.query(`
                  INSERT INTO notes (id, title, content, owner_email, project_id, team_id, tags, is_pinned, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                `, [
                  noteId,
                  noteTitle,
                  noteContent,
                  participant.email.toLowerCase(),
                  projectId,
                  teamId,
                  JSON.stringify(['meeting', 'transcript']),
                  false
                ]);

                console.log(`✅ Created meeting note for ${participant.email}`);
              } catch (noteError) {
                console.error(`❌ Error creating note for ${participant.email}:`, noteError);
                // Continue with other participants even if one fails
              }
            }

            // Update call document with transcription status
            await callRef.update({
              transcriptReady: true,
              participantTranscripts: Object.fromEntries(transcripts),
            });
          } else {
            console.log(`⚠️ No transcripts available for call ${callId}`);
          }
        }
      } catch (transcriptionError) {
        console.error('❌ Error finalizing transcription:', transcriptionError);
        // Don't fail the call end if transcription fails
      }

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
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).userEmail?.toLowerCase();

      // Get all active calls where user is the callee
      // Use org slug for Firestore path (sanitized name instead of ID)
      let callsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
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

  // POST /api/calls/:callId/start-transcription - Start transcription for an active call
  app.post('/api/calls/:callId/start-transcription', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const callId = req.params.callId;

      // Get call document
      let callsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
      const callRef = db.collection(callsPath).doc(callId);
      const callDoc = await callRef.get();

      if (!callDoc.exists) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const callData = callDoc.data();
      
      // Verify user is a participant
      const isCaller = callData?.callerEmail?.toLowerCase() === userEmail;
      const isCallee = callData?.calleeEmail?.toLowerCase() === userEmail;
      const isGroupParticipant = callData?.participantEmails?.some((email: string) => 
        email.toLowerCase() === userEmail
      );

      if (!isCaller && !isCallee && !isGroupParticipant) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if call is active
      if (callData?.status !== 'active') {
        return res.status(400).json({ error: 'Call must be active to start transcription' });
      }

      // Check if transcription is already active
      const { isTranscriptionActive } = await import('../services/transcription.js');
      if (isTranscriptionActive(callId)) {
        return res.json({ success: true, message: 'Transcription already active' });
      }

      // Get participants
      const participants: Array<{ email: string; name?: string }> = [];
      
      if (callData.callerEmail) {
        participants.push({ email: callData.callerEmail });
      }
      if (callData.calleeEmail && !callData.calleeEmail.startsWith('project-') && !callData.calleeEmail.startsWith('team-')) {
        participants.push({ email: callData.calleeEmail });
      }
      if (callData?.participantEmails && Array.isArray(callData.participantEmails)) {
        for (const email of callData.participantEmails) {
          if (!participants.find(p => p.email.toLowerCase() === email.toLowerCase())) {
            participants.push({ email });
          }
        }
      }

      if (!callData?.roomName) {
        return res.status(400).json({ error: 'Room name is required for transcription' });
      }

      // Start transcription
      const { startTranscriptionSession } = await import('../services/transcription.js');
      await startTranscriptionSession(callId, callData.roomName, participants, secretManagerClient, projectId);

      // Update call document
      await callRef.update({
        transcriptionEnabled: true,
      });

      console.log(`✅ Transcription started for call ${callId}`);
      console.log(`📝 Note: Egress will start automatically via webhooks when audio tracks are published`);
      console.log(`   If tracks were published before transcription started, webhook retry will handle them`);

      res.json({ success: true, message: 'Transcription started' });
    } catch (error: any) {
      console.error('Start transcription error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/calls/:chatId/status - Get call status
  app.get('/api/calls/:chatId/status', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).userEmail?.toLowerCase();
      const chatId = req.params.chatId;

      // Validate chatId
      const validation = validateDMChatId(chatId, userEmail);
      if (!validation.valid) {
        return res.status(403).json({ error: 'Invalid chat ID or access denied' });
      }

      // Get latest call for this chat
      // Use org slug for Firestore path (sanitized name instead of ID)
      let callsPath: string;
      if (orgId) {
        try {
          const orgSlug = await getOrgSlugById(orgId);
          callsPath = `orgs/${orgSlug}/calls`;
        } catch (error) {
          console.error(`Failed to get org slug for ${orgId}, using default:`, error);
          callsPath = `orgs/default/calls`;
        }
      } else {
        callsPath = `orgs/default/calls`;
      }
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

