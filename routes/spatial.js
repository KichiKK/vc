const express = require('express');
const router = express.Router();

let spatialData = {};

module.exports = function (io) {
    // POST /api/spatial/update
    // Body: { players: { "roblox_username": { position: {x,y,z}, range: number }, ... } }
    router.post('/update', (req, res) => {
        const apiKey = req.headers['x-api-key'];
        if (process.env.SPATIAL_API_KEY && apiKey !== process.env.SPATIAL_API_KEY) {
            return res.status(403).json({ error: 'Clé API invalide' });
        }

        const { players } = req.body;
        if (!players || typeof players !== 'object') {
            return res.status(400).json({ error: 'Format invalide: { players: { ... } } attendu' });
        }

        spatialData = players;

        // Broadcast to all connected voice clients
        io.to('voice-channel').emit('spatial-update', spatialData);

        res.json({ message: 'Données spatiales mises à jour', playerCount: Object.keys(players).length });
    });

    // GET /api/spatial/data (for debugging)
    router.get('/data', (req, res) => {
        res.json({ players: spatialData });
    });

    return router;
};
