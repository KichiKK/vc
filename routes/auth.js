const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { getDB, saveDB } = require('../db');

const router = express.Router();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

function generateToken(user) {
    return jwt.sign(
        { id: user.id, pseudo: user.pseudo, roblox_username: user.roblox_username },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '7d' }
    );
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant' });
    }
    try {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'dev-secret');
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Token invalide' });
    }
}

function dbGet(sql, params = []) {
    const db = getDB();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

function dbRun(sql, params = []) {
    const db = getDB();
    db.run(sql, params);
    saveDB();
}

// ── Register ──────────────────────────────────────────────
router.post('/register', async (req, res) => {
    try {
        const { email, password, pseudo, roblox_username, roblox_id } = req.body;

        if (!email || !password || !pseudo || !roblox_username || !roblox_id) {
            return res.status(400).json({ error: 'Tous les champs sont requis, veuillez lier votre compte Roblox.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
        }

        const existingEmail = dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail) {
            return res.status(409).json({ error: 'Cette adresse email est déjà utilisée' });
        }

        const existingRoblox = dbGet('SELECT id FROM users WHERE roblox_username = ?', [roblox_username]);
        if (existingRoblox) {
            return res.status(409).json({ error: 'Ce compte Roblox est déjà relié à un compte' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const verificationToken = uuidv4();

        dbRun(
            `INSERT INTO users (email, password_hash, pseudo, roblox_username, roblox_id, verification_token, roblox_verified)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [email, passwordHash, pseudo, roblox_username, robloxId, verificationToken]
        );

        const verifyUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;

        try {
            await transporter.sendMail({
                from: process.env.SMTP_USER,
                to: email,
                subject: 'VoiceChat — Vérifiez votre email',
                html: `
          <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
            <h2 style="color: #4fc3f7; text-align: center;">VoiceChat</h2>
            <p>Bonjour <strong>${pseudo}</strong>,</p>
            <p>Cliquez sur le bouton ci-dessous pour vérifier votre adresse email :</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="background: linear-gradient(135deg, #4fc3f7, #2196f3); color: white; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
                Vérifier mon email
              </a>
            </div>
            <p style="font-size: 12px; color: #888;">Si vous n'avez pas créé de compte, ignorez cet email.</p>
          </div>
        `
            });
        } catch (emailErr) {
            console.error('Email sending failed:', emailErr);
            console.log(`[DEV] Verification link: ${verifyUrl}`);
        }

        console.log(`[DEV] Verification link: ${verifyUrl}`);

        res.json({
            message: 'Compte créé ! Vérifiez votre email pour valider le compte.'
        });

    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── Verify Email ──────────────────────────────────────────
router.get('/verify-email/:token', (req, res) => {
    const { token } = req.params;
    const user = dbGet('SELECT id FROM users WHERE verification_token = ?', [token]);

    if (!user) {
        return res.status(400).json({ error: 'Token de vérification invalide' });
    }

    dbRun('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?', [user.id]);
    res.json({ message: 'Email vérifié avec succès !' });
});

// ── Roblox OAuth2 ─────────────────────────────────────────

router.get('/roblox-config', (req, res) => {
    res.json({ 
        clientId: process.env.ROBLOX_CLIENT_ID || '', 
        redirectUri: `${process.env.BASE_URL || 'http://localhost:3000'}/roblox-callback.html` 
    });
});

router.post('/roblox-exchange', async (req, res) => {
    try {
        const { code, code_verifier } = req.body;
        if (!code || !code_verifier) return res.status(400).json({ error: 'Requête invalide' });

        const clientId = process.env.ROBLOX_CLIENT_ID;
        const clientSecret = process.env.ROBLOX_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            return res.status(500).json({ error: 'Application Roblox non configurée dans le backend' });
        }

        const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': authHeader
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                code_verifier,
                client_id: clientId
            })
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Échec token Roblox');

        const userRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        if (!userRes.ok) throw new Error('Échec userInfo');

        res.json({
            roblox_id: userData.sub,
            roblox_username: userData.preferred_username || userData.name
        });

    } catch (err) {
        console.error('Roblox exchange error:', err);
        res.status(500).json({ error: 'Impossible de se lier avec Roblox' });
    }
});

// ── Login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email et mot de passe requis' });
        }

        const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        if (!user.email_verified) {
            return res.status(403).json({ error: 'Veuillez d\'abord vérifier votre adresse email' });
        }

        if (!user.roblox_verified) {
            return res.status(403).json({
                error: 'Compte Roblox non lié.'
            });
        }

        const token = generateToken(user);

        res.json({
            token,
            user: {
                id: user.id,
                pseudo: user.pseudo,
                email: user.email,
                roblox_username: user.roblox_username
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── Get current user ──────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
    const user = dbGet('SELECT id, email, pseudo, roblox_username FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
        return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    res.json({ user });
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
