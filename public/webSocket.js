// WebSocket Connection
let ws = null;
let userId = null;
let meetingId = null;
let userName = null;

// WebRTC Configuration
const peerConnections = new Map();
const dataChannels = new Map();
let localStream = null;
let isAudioEnabled = true;
let isVideoEnabled = true;

const RTCConfig = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ]
};

// DOM Elements
// ScreenShare 
const screenShare  = document.getElementById('screenshareBtn');
const loginScreen = document.getElementById('loginScreen');
const meetingScreen = document.getElementById('meetingScreen');
const userNameInput = document.getElementById('userNameInput');
const meetingIdInput = document.getElementById('meetingIdInput');
const newMeetingBtn = document.getElementById('newMeetingBtn');
const joinMeetingBtn = document.getElementById('joinMeetingBtn');

const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const remoteVideosContainer = document.getElementById('remoteVideosContainer');

const meetingCodeDisplay = document.getElementById('meetingCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const participantCount = document.getElementById('participantCount');

const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const endCallBtn = document.getElementById('endCallBtn');
const leaveBtn = document.getElementById('leaveBtn');

const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatSidebar = document.getElementById('chatSidebar');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const closeChatBtn = document.getElementById('closeChatBtn');
const unreadBadge = document.getElementById('unreadBadge');

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

const localUserName = document.getElementById('localUserName');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    newMeetingBtn.addEventListener('click', startNewMeeting);
    joinMeetingBtn.addEventListener('click', joinMeeting);

    toggleAudioBtn.addEventListener('click', toggleAudio);
    toggleVideoBtn.addEventListener('click', toggleVideo);
    endCallBtn.addEventListener('click', () => leaveCall(true));
    leaveBtn.addEventListener('click', () => leaveCall(true));

    copyCodeBtn.addEventListener('click', copyMeetingCode);
    toggleChatBtn.addEventListener('click', () => toggleChat(true));
    closeChatBtn.addEventListener('click', () => toggleChat(false));
    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    settingsBtn.addEventListener('click', () => settingsModal.classList.add('active'));
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));

    // Load available devices
    loadMediaDevices();
}

async function loadMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameraSelect = document.getElementById('cameraSelect');
        const microphoneSelect = document.getElementById('microphoneSelect');
        const speakerSelect = document.getElementById('speakerSelect');

        devices.forEach(device => {
            if (device.kind === 'videoinput') {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || 'Camera ' + (cameraSelect.length + 1);
                cameraSelect.appendChild(option);
            } else if (device.kind === 'audioinput') {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || 'Microphone ' + (microphoneSelect.length + 1);
                microphoneSelect.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || 'Speaker ' + (speakerSelect.length + 1);
                speakerSelect.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Error loading media devices:', error);
    }
}

function generateMeetingId() {
    return Math.random().toString(36).substring(2, 9).toUpperCase();
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification show ${type}`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

async function startNewMeeting() {
    const name = userNameInput.value.trim();
    if (!name) {
        showNotification('Please enter your name', 'error');
        return;
    }

    meetingId = generateMeetingId();
    userName = name;
    
    await initializeMeeting();
}

async function joinMeeting() {
    const name = userNameInput.value.trim();
    const code = meetingIdInput.value.trim();

    if (!name) {
        showNotification('Please enter your name', 'error');
        return;
    }
    if (!code) {
        showNotification('Please enter meeting code', 'error');
        return;
    }

    meetingId = code;
    userName = name;
    
    await initializeMeeting();
}

async function initializeMeeting() {
    try {
        // Get local media stream
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        localUserName.textContent = userName;

        // Connect WebSocket
        connectWebSocket();

        // Switch to meeting screen
        loginScreen.classList.remove('active');
        meetingScreen.classList.add('active');

        showNotification(`Meeting ${meetingId} started!`, 'success');
    } catch (error) {
        console.error('Error accessing media devices:', error);
        showNotification('Unable to access camera/microphone', 'error');
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        userId = Math.random().toString(36).substring(7);
        
        // Send join message
        ws.send(JSON.stringify({
            type: 'join-meeting',
            meetingId: meetingId,
            userName: userName
        }));

        meetingCodeDisplay.textContent = meetingId;
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error', 'error');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
    };
}

async function handleWebSocketMessage(data) {
    try {
        switch (data.type) {
            case 'existing-users':
                handleExistingUsers(data.users);
                break;

            case 'user-joined':
                handleUserJoined(data);
                break;

            case 'user-left':
                handleUserLeft(data);
                break;

            case 'offer':
                handleOffer(data);
                break;

            case 'answer':
                handleAnswer(data);
                break;

            case 'ice-candidate':
                handleIceCandidate(data);
                break;

            case 'participant-count':
                participantCount.textContent = data.count;
                break;

            case 'chat-message':
                displayChatMessage(data);
                break;

            case 'media-status':
                updateRemoteMediaStatus(data);
                break;
        }
    } catch (error) {
        console.error('Error handling WebSocket message:', error);
    }
}

async function handleExistingUsers(users) {
    for (const user of users) {
        await createPeerConnection(user.userId, user.userName, true);
    }
}

async function handleUserJoined(data) {
    showNotification(`${data.userName} joined the call`, 'info');
    await createPeerConnection(data.userId, data.userName, true);
}

async function handleUserLeft(data) {
    showNotification(`${data.userName} left the call`, 'info');
    closePeerConnection(data.userId);
    removeRemoteVideo(data.userId);
    participantCount.textContent = data.totalParticipants;
}

async function createPeerConnection(remoteUserId, remoteName, initiator) {
    if (peerConnections.has(remoteUserId)) {
        return peerConnections.get(remoteUserId);
    }

    const peerConnection = new RTCPeerConnection(RTCConfig);
    peerConnections.set(remoteUserId, peerConnection);

    // Add local tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle remote tracks
    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        addRemoteVideo(remoteUserId, remoteName, event.streams[0]);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                targetUserId: remoteUserId,
                candidate: event.candidate
            }));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${remoteUserId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
            closePeerConnection(remoteUserId);
            removeRemoteVideo(remoteUserId);
        }
    };

    // Create offer if initiator
    if (initiator) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            ws.send(JSON.stringify({
                type: 'offer',
                targetUserId: remoteUserId,
                offer: offer
            }));
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    return peerConnection;
}

async function handleOffer(data) {
    let peerConnection = peerConnections.get(data.from);
    
    if (!peerConnection) {
        peerConnection = await createPeerConnection(data.from, 'User', false);
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            targetUserId: data.from,
            answer: answer
        }));
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(data) {
    const peerConnection = peerConnections.get(data.from);
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
}

async function handleIceCandidate(data) {
    const peerConnection = peerConnections.get(data.from);
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
}

function addRemoteVideo(userId, userName, stream) {
    if (document.getElementById(`video-${userId}`)) {
        return; // Video already exists
    }

    const videoCard = document.createElement('div');
    videoCard.className = 'video-card';
    videoCard.id = `card-${userId}`;

    const video = document.createElement('video');
    video.id = `video-${userId}`;
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.innerHTML = `
        <span>${userName}</span>
        <div class="media-indicators">
            <i class="fas fa-microphone-slash" style="display: none;" data-user="${userId}" data-type="audio"></i>
            <i class="fas fa-video-slash" style="display: none;" data-user="${userId}" data-type="video"></i>
        </div>
    `;

    videoCard.appendChild(video);
    videoCard.appendChild(label);
    remoteVideosContainer.appendChild(videoCard);
}

function removeRemoteVideo(userId) {
    const card = document.getElementById(`card-${userId}`);
    if (card) {
        card.remove();
    }
}

function closePeerConnection(userId) {
    const peerConnection = peerConnections.get(userId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(userId);
    }
}

function toggleAudio() {
    isAudioEnabled = !isAudioEnabled;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });

    toggleAudioBtn.classList.toggle('active', isAudioEnabled);
    toggleAudioBtn.classList.toggle('inactive', !isAudioEnabled);

    const icon = toggleAudioBtn.querySelector('i');
    icon.className = isAudioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';

    // Update local indicator
    const localAudioIcon = document.getElementById('localAudioIcon');
    localAudioIcon.style.display = isAudioEnabled ? 'none' : 'inline';

    // Broadcast status
    broadcastMediaStatus();
}

function toggleVideo() {
    isVideoEnabled = !isVideoEnabled;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled;
    });

    toggleVideoBtn.classList.toggle('active', isVideoEnabled);
    toggleVideoBtn.classList.toggle('inactive', !isVideoEnabled);

    const icon = toggleVideoBtn.querySelector('i');
    icon.className = isVideoEnabled ? 'fas fa-video' : 'fas fa-video-slash';

    // Update local indicator
    const localVideoIcon = document.getElementById('localVideoIcon');
    localVideoIcon.style.display = isVideoEnabled ? 'none' : 'inline';

    // Broadcast status
    broadcastMediaStatus();
}

function broadcastMediaStatus() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'media-status',
            audio: isAudioEnabled,
            video: isVideoEnabled
        }));
    }
}

function updateRemoteMediaStatus(data) {
    const audioIcon = document.querySelector(`i[data-user="${data.userId}"][data-type="audio"]`);
    const videoIcon = document.querySelector(`i[data-user="${data.userId}"][data-type="video"]`);

    if (audioIcon) {
        audioIcon.style.display = data.audio ? 'none' : 'inline';
    }
    if (videoIcon) {
        videoIcon.style.display = data.video ? 'none' : 'inline';
    }
}

function copyMeetingCode() {
    navigator.clipboard.writeText(meetingId).then(() => {
        copyCodeBtn.classList.add('copied');
        showNotification('Meeting code copied!', 'success');

        setTimeout(() => {
            copyCodeBtn.classList.remove('copied');
        }, 2000);
    });
}

function toggleChat(show) {
    chatSidebar.classList.toggle('active', show);
    if (show) {
        unreadBadge.style.display = 'none';
        chatInput.focus();
    }
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    ws.send(JSON.stringify({
        type: 'chat-message',
        message: message
    }));

    chatInput.value = '';
    chatInput.focus();
}

function displayChatMessage(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${data.userId === userId ? 'own' : ''}`;

    const author = document.createElement('div');
    author.className = 'chat-message-author';
    author.textContent = data.from;

    const content = document.createElement('div');
    content.className = 'chat-message-content';
    content.textContent = data.message;

    const time = document.createElement('div');
    time.className = 'chat-message-time';
    time.textContent = data.timestamp;

    messageDiv.appendChild(author);
    messageDiv.appendChild(content);
    messageDiv.appendChild(time);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Show unread badge if chat is closed
    if (!chatSidebar.classList.contains('active') && data.userId !== userId) {
        unreadBadge.style.display = 'block';
    }
}

function leaveCall(notify = true) {
    // Close all peer connections
    peerConnections.forEach((pc) => {
        pc.close();
    });
    peerConnections.clear();

    // ✅ Stop ALL tracks properly
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
    }

    // ✅ IMPORTANT: video element bhi clear karo
    if (localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
    }

    // Reset localStream
    localStream = null;

    // Notify server
    if (ws && ws.readyState === WebSocket.OPEN && notify) {
        ws.send(JSON.stringify({
            type: 'user-left'
        }));
        ws.close();
    }

    // Reset UI
    remoteVideosContainer.innerHTML = '';
    meetingScreen.classList.remove('active');
    loginScreen.classList.add('active');
    userNameInput.value = '';
    meetingIdInput.value = '';
    chatMessages.innerHTML = '';
    chatSidebar.classList.remove('active');

    isAudioEnabled = true;
    isVideoEnabled = true;
    toggleAudioBtn.classList.add('active');
    toggleVideoBtn.classList.add('active');

    showNotification('You left the meeting', 'info');
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'user-left' }));
        ws.close();
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
    }
});

// Handle visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden && localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = false;
        });
    } else if (localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isVideoEnabled;
        });
    }
});


// * ScreenShare Function
screenShare.addEventListener('click', async () => {
    try {
        // 1. Screen stream lo
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        // 2. Sab peer connections me replace karo
        peerConnections.forEach((pc) => {
            const sender = pc.getSenders().find(s => 
                s.track && s.track.kind === "video"
            );

            if (sender) {
                sender.replaceTrack(screenTrack);
            }
        });

        // 3. Local preview update
        localVideo.srcObject = screenStream;

        // 4. Stop share pe wapas camera
        screenTrack.onended = async () => {
            const cameraStream = await navigator.mediaDevices.getUserMedia({
                video: true
            });

            const cameraTrack = cameraStream.getVideoTracks()[0];

            peerConnections.forEach((pc) => {
                const sender = pc.getSenders().find(s => 
                    s.track && s.track.kind === "video"
                );

                if (sender) {
                    sender.replaceTrack(cameraTrack);
                }
            });
            localStream = cameraStream;
            localVideo.srcObject = cameraStream;
        };

    } catch (err) {
        console.error("Screen share error:", err);
    }
});