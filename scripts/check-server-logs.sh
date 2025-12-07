#!/bin/bash

# Helper script to check server logs
# The server logs should be visible in the terminal where you ran 'npm run dev'

echo "📋 Server Log Check Helper"
echo "=========================="
echo ""
echo "The server is running (PID: $(lsof -ti:3001 2>/dev/null | head -1))"
echo ""
echo "To see server logs:"
echo "  1. Look at the terminal where you ran 'npm run dev'"
echo "  2. Look for the '[1]' process output (that's the server)"
echo "  3. When you make a call, you should see logs like:"
echo "     - 📞 Getting LiveKit credentials:"
echo "     - ✅ Using local dev credentials for local LiveKit server"
echo "     - ❌ Error generating LiveKit token: (if there's an error)"
echo ""
echo "Common issues to check:"
echo "  - Is NODE_ENV=development set?"
echo "  - Is LIVEKIT_URL not set (should default to ws://localhost:7880)?"
echo "  - Are there any import errors for 'livekit-server-sdk'?"
echo ""
echo "To test the endpoint directly, you can run:"
echo "  ./scripts/test-livekit-endpoint.sh"
echo ""
echo "Or check the browser Network tab for the full error response"

