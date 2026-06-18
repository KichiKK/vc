require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const { initDB } = require('./db');
const authRoutes = require('./routes/auth');
const spatialRoutes = require('./routes/spatial');
const setupSignaling = require('./signaling');

async function start() {
    await initDB();

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: { origin: '*' }
    });

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    app.use('/api/auth', authRoutes);
    app.use('/api/spatial', spatialRoutes(io));

    app.get('/verify-email', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'verify-email.html'));
    });

    app.get('/chat', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'chat.html'));
    });

    setupSignaling(io);

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
