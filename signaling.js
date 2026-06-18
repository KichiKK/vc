const jwt = require('jsonwebtoken');

const connectedUsers = new Map(); // socketId -> { id, pseudo, roblox_username }

function setupSignaling(io) {

    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Token manquant'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
            socket.user = decoded;
            next();
        } catch {
            next(new Error('Token invalide'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`[Socket] Connected: ${socket.user.pseudo} (${socket.id})`);

        // ── Join voice channel ──────────────────────────────
        socket.on('join-voice', () => {
            // Check if user is already connected from another tab
            for (const [sid, u] of connectedUsers.entries()) {
                if (u.id === socket.user.id && sid !== socket.id) {
                    io.to(sid).emit('force-disconnect', { reason: 'Connexion depuis un autre onglet' });
                    const oldSocket = io.sockets.sockets.get(sid);
                    if (oldSocket) {
                        oldSocket.leave('voice-channel');
                    }
                    connectedUsers.delete(sid);
                }
            }

            socket.join('voice-channel');
            connectedUsers.set(socket.id, {
                id: socket.user.id,
                pseudo: socket.user.pseudo,
                roblox_username: socket.user.roblox_username
            });

            // Notify existing peers about new user
            socket.to('voice-channel').emit('user-joined', {
                socketId: socket.id,
                pseudo: socket.user.pseudo,
                roblox_username: socket.user.roblox_username
            });

            // Send list of current users to new peer
            const currentUsers = [];
            for (const [sid, user] of connectedUsers.entries()) {
                if (sid !== socket.id) {
                    currentUsers.push({
                        socketId: sid,
                        pseudo: user.pseudo,
                        roblox_username: user.roblox_username
                    });
                }
            }
            socket.emit('current-users', currentUsers);

            console.log(`[Voice] ${socket.user.pseudo} joined. Total: ${connectedUsers.size}`);
        });

        // ── Leave voice channel ─────────────────────────────
        socket.on('leave-voice', () => {
            socket.leave('voice-channel');
            connectedUsers.delete(socket.id);
            io.to('voice-channel').emit('user-left', { socketId: socket.id });
            console.log(`[Voice] ${socket.user.pseudo} left. Total: ${connectedUsers.size}`);
        });

        // ── WebRTC signaling ────────────────────────────────
        socket.on('offer', ({ to, offer }) => {
            io.to(to).emit('offer', {
                from: socket.id,
                offer,
                pseudo: socket.user.pseudo,
                roblox_username: socket.user.roblox_username
            });
        });

        socket.on('answer', ({ to, answer }) => {
            io.to(to).emit('answer', { from: socket.id, answer });
        });

        socket.on('ice-candidate', ({ to, candidate }) => {
            io.to(to).emit('ice-candidate', { from: socket.id, candidate });
        });

        // ── Disconnect ──────────────────────────────────────
        socket.on('disconnect', () => {
            if (connectedUsers.has(socket.id)) {
                connectedUsers.delete(socket.id);
                io.to('voice-channel').emit('user-left', { socketId: socket.id });
                console.log(`[Socket] Disconnected: ${socket.user.pseudo}. Total: ${connectedUsers.size}`);
            }
        });
    });
}

module.exports = setupSignaling;
