const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// WebSocket server with custom settings
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: true,
    maxPayload: 100 * 1024 * 1024 // 100MB for media data
});

// Store active meetings and participants
const meetings = new Map();
const userConnections = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/registration", (req, res) => {
    res.render("registration");
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        activeMeetings: meetings.size,
        activeUsers: userConnections.size 
    });
});

// ===== UTILITY FUNCTIONS =====
function generateMeetingId() {
    return Math.random().toString(36).substring(2, 9).toUpperCase();
}

function findUserInMeeting(meetingId, userId) {
    const meeting = meetings.get(meetingId);
    if (!meeting) return null;

    for (let client of meeting) {
        const userInfo = userConnections.get(client);
        if (userInfo && userInfo.userId === userId && client.readyState === WebSocket.OPEN) {
            return client;
        }
    }
    return null;
}

function broadcastToMeeting(meetingId, message, excludeWs = null) {
    const meeting = meetings.get(meetingId);
    if (!meeting) return;

    const messageStr = JSON.stringify(message);
    for (let client of meeting) {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
            try {
                client.send(messageStr);
            } catch (error) {
                console.error('Error broadcasting message:', error);
            }
        }
    }
}

function handleUserLeft(ws, meetingId, userId, userName) {
    const meeting = meetings.get(meetingId);
    if (meeting) {
        meeting.delete(ws);
        userConnections.delete(ws);

        if (meeting.size === 0) {
            meetings.delete(meetingId);
            console.log(`✓ Meeting ${meetingId} closed (no participants)`);
        } else {
            broadcastToMeeting(meetingId, {
                type: 'user-left',
                userId: userId,
                userName: userName,
                totalParticipants: meeting.size
            });
            console.log(`✓ ${userName} left meeting ${meetingId}. Remaining: ${meeting.size}`);
        }
    }
}

// ===== WEBSOCKET CONNECTION HANDLING =====
wss.on('connection', (ws) => {
    const userId = Math.random().toString(36).substring(7);
    let meetingId = null;
    let userName = null;
    let isAlive = true;

    console.log(`→ User connected: ${userId}`);

    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'connection-established',
        userId: userId
    }));

    // Heart beat to detect dead connections
    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000);

    ws.on('pong', () => {
        isAlive = true;
    });

    ws.on('ping', () => {
        ws.pong();
    });

    // ===== MESSAGE HANDLING =====
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(data, ws, userId, meetingId, userName);
        } catch (error) {
            console.error('Message parsing error:', error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid message format'
                }));
            }
        }
    });

    // ===== MESSAGE ROUTER =====
    function handleMessage(data, ws, userId, currentMeetingId, currentUserName) {
        try {
            switch (data.type) {
                case 'join-meeting':
                    handleJoinMeeting(ws, userId, data);
                    meetingId = data.meetingId;
                    userName = data.userName;
                    break;

                case 'offer':
                    handleOffer(ws, currentMeetingId, userId, data);
                    break;

                case 'answer':
                    handleAnswer(ws, currentMeetingId, userId, data);
                    break;

                case 'ice-candidate':
                    handleIceCandidate(ws, currentMeetingId, userId, data);
                    break;

                case 'chat-message':
                    handleChatMessage(ws, currentMeetingId, userId, currentUserName, data);
                    break;

                case 'media-status':
                    handleMediaStatus(ws, currentMeetingId, userId, data);
                    break;

                case 'user-left':
                    handleUserLeft(ws, currentMeetingId, userId, currentUserName);
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default:
                    console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    // ===== EVENT HANDLERS =====
    function handleJoinMeeting(ws, userId, data) {
        meetingId = data.meetingId;
        userName = data.userName;

        if (!meetings.has(meetingId)) {
            meetings.set(meetingId, new Set());
            console.log(`→ New meeting created: ${meetingId}`);
        }

        const meeting = meetings.get(meetingId);
        const existingUsers = [];

        // Collect existing users in meeting
        for (let client of meeting) {
            if (client.readyState === WebSocket.OPEN) {
                const userInfo = userConnections.get(client);
                if (userInfo) {
                    existingUsers.push({
                        userId: userInfo.userId,
                        userName: userInfo.userName
                    });

                    // Notify existing user about new participant
                    try {
                        client.send(JSON.stringify({
                            type: 'user-joined',
                            userId: userId,
                            userName: userName
                        }));
                    } catch (error) {
                        console.error('Error notifying existing user:', error);
                    }
                }
            }
        }

        // Add new user to meeting
        meeting.add(ws);
        userConnections.set(ws, { 
            userId, 
            userName, 
            meetingId,
            joinedAt: new Date()
        });

        // Send existing users to new participant
        try {
            ws.send(JSON.stringify({
                type: 'existing-users',
                users: existingUsers,
                meetingId: meetingId,
                totalParticipants: meeting.size
            }));
        } catch (error) {
            console.error('Error sending existing users:', error);
        }

        // Broadcast updated participant count
        broadcastToMeeting(meetingId, {
            type: 'participant-count',
            count: meeting.size
        }, ws);

        console.log(`✓ ${userName} joined meeting ${meetingId}. Total: ${meeting.size}`);
    }

    function handleOffer(ws, currentMeetingId, userId, data) {
        const targetWs = findUserInMeeting(currentMeetingId, data.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            try {
                targetWs.send(JSON.stringify({
                    type: 'offer',
                    from: userId,
                    offer: data.offer
                }));
            } catch (error) {
                console.error('Error sending offer:', error);
            }
        }
    }

    function handleAnswer(ws, currentMeetingId, userId, data) {
        const targetWs = findUserInMeeting(currentMeetingId, data.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            try {
                targetWs.send(JSON.stringify({
                    type: 'answer',
                    from: userId,
                    answer: data.answer
                }));
            } catch (error) {
                console.error('Error sending answer:', error);
            }
        }
    }

    function handleIceCandidate(ws, currentMeetingId, userId, data) {
        const targetWs = findUserInMeeting(currentMeetingId, data.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            try {
                targetWs.send(JSON.stringify({
                    type: 'ice-candidate',
                    from: userId,
                    candidate: data.candidate
                }));
            } catch (error) {
                console.error('Error sending ICE candidate:', error);
            }
        }
    }

    function handleChatMessage(ws, currentMeetingId, userId, currentUserName, data) {
        // Validate message
        if (!data.message || typeof data.message !== 'string') {
            console.warn('Invalid chat message:', data);
            return;
        }

        const message = data.message.trim().slice(0, 500);
        if (!message) return;

        broadcastToMeeting(currentMeetingId, {
            type: 'chat-message',
            from: currentUserName || 'Anonymous',
            userId: userId,
            message: message,
            timestamp: new Date().toLocaleTimeString()
        });

        console.log(`💬 Chat in ${currentMeetingId}: ${currentUserName}: ${message.substring(0, 30)}...`);
    }

    function handleMediaStatus(ws, currentMeetingId, userId, data) {
        broadcastToMeeting(currentMeetingId, {
            type: 'media-status',
            userId: userId,
            audio: !!data.audio,
            video: !!data.video
        }, ws);
    }

    // ===== CONNECTION LIFECYCLE =====
    ws.on('close', () => {
        clearInterval(heartbeat);
        if (meetingId) {
            console.log(`← User ${userId} disconnected from meeting ${meetingId}`);
            handleUserLeft(ws, meetingId, userId, userName);
        } else {
            userConnections.delete(ws);
            console.log(`← User ${userId} disconnected (no meeting joined)`);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
    });
});

// ===== CLEANUP INTERVAL =====
// Clean up stale connections and empty meetings every 5 minutes
setInterval(() => {
    let cleanedConnections = 0;
    let cleanedMeetings = 0;

    // Clean up dead connections
    for (let [ws, userInfo] of userConnections) {
        if (ws.readyState !== WebSocket.OPEN) {
            if (userInfo && userInfo.meetingId) {
                handleUserLeft(ws, userInfo.meetingId, userInfo.userId, userInfo.userName);
            }
            userConnections.delete(ws);
            cleanedConnections++;
        }
    }

    // Check for empty meetings
    for (let [meetingId, meeting] of meetings) {
        // Remove closed connections from meeting
        for (let client of meeting) {
            if (client.readyState !== WebSocket.OPEN) {
                meeting.delete(client);
            }
        }

        // Delete empty meetings
        if (meeting.size === 0) {
            meetings.delete(meetingId);
            cleanedMeetings++;
        }
    }

    if (cleanedConnections > 0 || cleanedMeetings > 0) {
        console.log(`🧹 Cleanup: Removed ${cleanedConnections} dead connections, ${cleanedMeetings} empty meetings`);
    }
}, 5 * 60 * 1000);

// ===== SERVER START =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║   🎥 Video Conferencing Server v2      ║
╚════════════════════════════════════════╝

✓ Server running on http://localhost:${PORT}
✓ WebSocket server ready for connections
✓ Health check: GET /health
    `);
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutting down');
        }
    });

    // Close server
    server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        console.error('✗ Forced shutdown');
        process.exit(1);
    }, 10000);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});