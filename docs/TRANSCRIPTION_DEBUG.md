# Transcription Debugging Guide

## Issue: Notes Not Being Created After Call Ends

### What to Check in Backend Logs

When a call ends, you should see these log messages in order:

1. **Call End Request:**
   ```
   🔍 Checking transcription status for call ${callId}...
      Transcription active: true/false
   ```

2. **If Transcription is Active:**
   ```
   📝 Finalizing transcription for call ${callId}
      Participants found: 2 ['email1@example.com', 'email2@example.com']
   ```

3. **Transcription Finalization:**
   ```
   🔍 Finalizing transcription for call ${callId}...
      Active sessions: [list of active session callIds]
      Session found: roomName=..., isActive=true
      Participants: [list]
      Transcripts collected so far: email1:5, email2:3
   ```

4. **Transcript Aggregation:**
   ```
   📝 Final transcript for email1@example.com: [first 100 chars]...
   📝 Final transcript for email2@example.com: [first 100 chars]...
   ✅ Transcription finalized for call ${callId} - 2 participant(s) with transcripts
   ```

5. **Note Creation:**
   ```
      Getting database pool for org: ${orgId}
      ✅ Database pool obtained
      Project ID: null, Team ID: null
      Creating note for email1@example.com...
      ✅ Created meeting note for email1@example.com (ID: ${noteId})
      ✅ Successfully created 2 note(s) out of 2 participant(s)
   ```

### Common Issues and Solutions

#### Issue 1: "Transcription active: false"
**Cause:** Transcription session was never started or was already finalized
**Check:**
- Look for `✅ Transcription started for call ${callId}` in logs
- Verify transcription is started when call becomes active

#### Issue 2: "No transcription session found for call ${callId}"
**Cause:** CallId mismatch between transcription session and call end
**Check:**
- Compare callId in transcription start vs call end logs
- Check if multiple calls exist with same roomName

#### Issue 3: "No transcripts available for call ${callId}"
**Cause:** No audio was transcribed (egress not working, no speech detected)
**Check:**
- Look for `📝 Transcript for ${email}: ...` messages during call
- Check if egress is working: `✅ Egress started successfully`
- Check if audio chunks are being received: `🎵 Audio chunk processed for ${email}`

#### Issue 4: "Cannot create notes: orgId is missing"
**Cause:** orgId not passed in request headers or context
**Check:**
- Verify `X-Org-Id` header is set in frontend request
- Check if `(req as any).orgId` is populated

#### Issue 5: Database connection error
**Cause:** Database pool creation failed or query failed
**Check:**
- Look for `❌ Error creating note for ${email}:` messages
- Check database connection and permissions
- Verify org database exists

### Manual Verification

1. **Check if transcription session exists:**
   - Look for `✅ Transcription session started for call ${callId}` in logs
   - Check active sessions list in finalization logs

2. **Check if transcripts were collected:**
   - Look for `📝 Transcript for ${email}: ...` during the call
   - Check "Transcripts collected so far" in finalization logs

3. **Check if notes were created:**
   - Query database: `SELECT * FROM notes WHERE tags @> '["meeting", "transcript"]' ORDER BY created_at DESC LIMIT 5;`
   - Check Notes page in UI

4. **Check call document:**
   - Verify `transcriptReady: true` in Firestore call document
   - Check `participantTranscripts` field for transcript data

### Next Steps

If notes still aren't being created after checking logs:
1. Share the backend logs from call start to call end
2. Check if there are any error messages
3. Verify database connection is working
4. Check if orgId is being passed correctly

