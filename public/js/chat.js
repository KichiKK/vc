const token = localStorage.getItem('voicechat_token');
const userData = JSON.parse(localStorage.getItem('voicechat_user') || 'null');

if (!token || !userData) {
    window.location.href = '/';
}

// ── UI Elements ───────────────────────────────────────────
const connectBtn = document.getElementById('connect-btn');
const connectRing = document.getElementById('connect-ring');
const connectLabel = document.getElementById('connect-label');
const connectHint = document.getElementById('connect-hint');
const channelStatus = document.getElementById('channel-status');
const usersGrid = document.getElementById('users-grid');
const usersCount = document.getElementById('users-count');
const userNameEl = document.getElementById('user-name');
const userAvatarEl = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');
const audioContainer = document.getElementById('audio-container');

// ── User Info ─────────────────────────────────────────────
userNameEl.textContent = userData.pseudo;
userAvatarEl.textContent = userData.pseudo.charAt(0).toUpperCase();

// ── State ─────────────────────────────────────────────────
let isConnected = false;
let localStream = null;
let socket = null;
const peers = new Map();       // socketId -> { pc, pseudo, roblox_username }
const peerStreams = new Map();  // socketId -> MediaStream

// ── ICE Servers ───────────────────────────────────────────
const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// ── Audio Constraints ─────────────────────────────────────
const AUDIO_CONSTRAINTS = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1
    },
    video: false
};

// ── Noise Gate ────────────────────────────────────────────
const NOISE_GATE_THRESHOLD = -50; // dB
let noiseGateContext = null;
let noiseGateAnalyser = null;
let noiseGateProcessor = null;
let noiseGateInterval = null;

function setupNoiseGate(stream) {
    noiseGateContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = noiseGateContext.createMediaStreamSource(stream);

    noiseGateAnalyser = noiseGateContext.createAnalyser();
    noiseGateAnalyser.fftSize = 2048;
    noiseGateAnalyser.smoothingTimeConstant = 0.8;

    source.connect(noiseGateAnalyser);

    const dataArray = new Float32Array(noiseGateAnalyser.fftSize);

    noiseGateInterval = setInterval(() => {
        noiseGateAnalyser.getFloatTimeDomainData(dataArray);

        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const dB = 20 * Math.log10(Math.max(rms, 1e-10));

        const tracks = stream.getAudioTracks();
        if (tracks.length > 0) {
            tracks[0].enabled = dB > NOISE_GATE_THRESHOLD;
        }
    }, 50);
}

function destroyNoiseGate() {
    if (noiseGateInterval) {
        clearInterval(noiseGateInterval);
        noiseGateInterval = null;
    }
    if (noiseGateContext) {
        noiseGateContext.close();
        noiseGateContext = null;
    }
}

// ── Socket.IO ─────────────────────────────────────────────
function initSocket() {
    socket = io({
        auth: { token }
    });

    socket.on('connect', () => {
        console.log('[Socket] Connected');
    });

    socket.on('connect_error', (err) => {
        console.error('[Socket] Auth error:', err.message);
        if (err.message.includes('Token')) {
            localStorage.removeItem('voicechat_token');
            localStorage.removeItem('voicechat_user');
            window.location.href = '/';
        }
    });

    socket.on('force-disconnect', ({ reason }) => {
        alert(reason);
        disconnect();
    });

    // ── WebRTC Signaling ──────────────────────────────────
    socket.on('current-users', async (users) => {
        for (const user of users) {
            await createPeerConnection(user.socketId, user.pseudo, user.roblox_username, true);
        }
    });

    socket.on('user-joined', async ({ socketId, pseudo, roblox_username }) => {
        await createPeerConnection(socketId, pseudo, roblox_username, false);
        addUserCard(socketId, pseudo, roblox_username);
        updateUsersCount();
    });

    socket.on('user-left', ({ socketId }) => {
        removePeer(socketId);
        removeUserCard(socketId);
        updateUsersCount();
    });

    socket.on('offer', async ({ from, offer, pseudo, roblox_username }) => {
        let peer = peers.get(from);
        if (!peer) {
            await createPeerConnection(from, pseudo, roblox_username, false);
            peer = peers.get(from);
        }
        await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
    });

    socket.on('answer', async ({ from, answer }) => {
        const peer = peers.get(from);
        if (peer) {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
        const peer = peers.get(from);
        if (peer && candidate) {
            try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn('[ICE] Error adding candidate:', e);
            }
        }
    });

    // ── Spatial Audio ─────────────────────────────────────
    socket.on('spatial-update', (data) => {
        window.spatialAudio.updateSpatialData(data, peers);
    });
}

// ── Peer Connection ───────────────────────────────────────
async function createPeerConnection(socketId, pseudo, robloxUsername, isInitiator) {
    const pc = new RTCPeerConnection(ICE_CONFIG);

    peers.set(socketId, { pc, pseudo, roblox_username: robloxUsername });

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        peerStreams.set(socketId, remoteStream);

        let audioEl = document.getElementById(`audio-${socketId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${socketId}`;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioContainer.appendChild(audioEl);
        }
        audioEl.srcObject = remoteStream;

        // Connect to spatial audio
        window.spatialAudio.createGainForPeer(socketId, audioEl);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { to: socketId, candidate: event.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            console.warn(`[Peer] ${pseudo} connection ${pc.connectionState}`);
        }
    };

    // Prefer Opus codec
    pc.oniceconnectionstatechange = () => {
        console.log(`[ICE] ${pseudo}: ${pc.iceConnectionState}`);
    };

    // Initiator creates offer
    if (isInitiator) {
        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });

            // Prefer Opus and set parameters
            offer.sdp = preferOpus(offer.sdp);

            await pc.setLocalDescription(offer);
            socket.emit('offer', { to: socketId, offer });
        } catch (err) {
            console.error('[Offer] Error:', err);
        }
    }

    addUserCard(socketId, pseudo, robloxUsername);
    return pc;
}

function removePeer(socketId) {
    const peer = peers.get(socketId);
    if (peer) {
        peer.pc.close();
        peers.delete(socketId);
    }
    peerStreams.delete(socketId);

    const audioEl = document.getElementById(`audio-${socketId}`);
    if (audioEl) {
        audioEl.srcObject = null;
        audioEl.remove();
    }

    window.spatialAudio.removePeer(socketId);
}

function removeAllPeers() {
    for (const socketId of peers.keys()) {
        removePeer(socketId);
    }
    peers.clear();
    peerStreams.clear();
}

// ── Opus SDP Preference ───────────────────────────────────
function preferOpus(sdp) {
    const lines = sdp.split('\r\n');
    let mLineIndex = -1;
    let opusPayload = null;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=audio')) {
            mLineIndex = i;
        }
        if (lines[i].includes('opus/48000')) {
            const match = lines[i].match(/:(\d+) opus\/48000/);
            if (match) opusPayload = match[1];
        }
    }

    if (mLineIndex === -1 || !opusPayload) return sdp;

    const mLineParts = lines[mLineIndex].split(' ');
    const payloads = mLineParts.slice(3);
    const reordered = [opusPayload, ...payloads.filter(p => p !== opusPayload)];
    lines[mLineIndex] = [...mLineParts.slice(0, 3), ...reordered].join(' ');

    // Add fmtp for Opus parameters
    let fmtpExists = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`a=fmtp:${opusPayload}`)) {
            lines[i] = `a=fmtp:${opusPayload} minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=64000`;
            fmtpExists = true;
            break;
        }
    }
    if (!fmtpExists) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith(`a=rtpmap:${opusPayload}`)) {
                lines.splice(i + 1, 0, `a=fmtp:${opusPayload} minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=64000`);
                break;
            }
        }
    }

    return lines.join('\r\n');
}

// ── User Cards ────────────────────────────────────────────
function addUserCard(socketId, pseudo, robloxUsername) {
    if (document.getElementById(`card-${socketId}`)) return;

    const card = document.createElement('div');
    card.className = 'user-card';
    card.id = `card-${socketId}`;
    card.innerHTML = `
    <div class="card-avatar">${pseudo.charAt(0).toUpperCase()}</div>
    <div class="card-info">
      <div class="card-name">${pseudo}</div>
      <div class="card-roblox">${robloxUsername}</div>
    </div>
    <div class="card-volume" id="vol-${socketId}"></div>
  `;
    usersGrid.appendChild(card);
}

function removeUserCard(socketId) {
    const card = document.getElementById(`card-${socketId}`);
    if (card) {
        card.style.animation = 'fadeIn 0.3s ease reverse';
        setTimeout(() => card.remove(), 300);
    }
}

function updateUsersCount() {
    usersCount.textContent = peers.size;
}

// ── Connect / Disconnect ──────────────────────────────────
async function connect() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
        setupNoiseGate(localStream);

        // Init spatial audio
        window.spatialAudio.init(userData.roblox_username);

        if (!socket) initSocket();

        socket.emit('join-voice');

        isConnected = true;
        connectBtn.classList.add('connected');
        connectRing.classList.add('connected');
        connectLabel.textContent = 'CONNECTED';
        connectHint.textContent = 'Cliquez pour quitter le canal vocal';
        channelStatus.textContent = 'Connecté';
        channelStatus.classList.add('connected');

    } catch (err) {
        console.error('[Mic] Error:', err);
        alert('Impossible d\'accéder au microphone. Vérifiez les permissions.');
    }
}

function disconnect() {
    if (socket) {
        socket.emit('leave-voice');
    }

    removeAllPeers();
    destroyNoiseGate();
    window.spatialAudio.destroy();

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    usersGrid.innerHTML = '';
    updateUsersCount();

    isConnected = false;
    connectBtn.classList.remove('connected');
    connectRing.classList.remove('connected');
    connectLabel.textContent = 'CONNECT';
    connectHint.textContent = 'Cliquez pour rejoindre le canal vocal';
    channelStatus.textContent = 'Déconnecté';
    channelStatus.classList.remove('connected');
}

// ── Event Listeners ───────────────────────────────────────
connectBtn.addEventListener('click', () => {
    if (isConnected) {
        disconnect();
    } else {
        connect();
    }
});

logoutBtn.addEventListener('click', () => {
    disconnect();
    if (socket) socket.disconnect();
    localStorage.removeItem('voicechat_token');
    localStorage.removeItem('voicechat_user');
    window.location.href = '/';
});

// Init socket on page load (but don't join voice yet)
initSocket();
