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
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function fetchJson(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        const data = await res.json().catch(() => null);
        return { res, data };
    } finally {
        clearTimeout(timeout);
    }
}

async function findRobloxUser(username) {
    const normalizedUsername = username.trim().toLowerCase();

    const usernameLookup = await fetchJson('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            usernames: [username],
            excludeBannedUsers: false
        })
    }, 4500);

    if (usernameLookup.res.ok && usernameLookup.data?.data?.length) {
        const found = usernameLookup.data.data.find(
            user => user.name?.toLowerCase() === normalizedUsername
        );

        if (found) {
            return found;
        }
    }

    const searchLookup = await fetchJson(
        `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=10`,
        {},
        4500
    );

    if (!searchLookup.res.ok) {
        throw new Error(`Roblox API HTTP ${searchLookup.res.status}`);
    }

    return searchLookup.data?.data?.find(
        user => user.name?.toLowerCase() === normalizedUsername
    ) || null;
}

function sendVerificationEmail({ email, pseudo, verifyUrl }) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[DEV] SMTP non configuré. Verification link: ${verifyUrl}`);
        return;
    }

    transporter.sendMail({
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
    }).catch(emailErr => {
        console.error('[Email] Sending failed:', emailErr);
        console.log(`[DEV] Verification link: ${verifyUrl}`);
    });
}

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
    const rowsModified = db.getRowsModified();
    saveDB();
    return rowsModified;
}

function requireResetToken(req, res, next) {
    const resetToken = process.env.RESET_TOKEN;
    const providedToken = req.headers['x-reset-token'] || req.body?.resetToken;

    if (!resetToken) {
        return res.status(403).json({ error: 'Reset désactivé : RESET_TOKEN n\'est pas configuré.' });
    }

    if (!providedToken || providedToken !== resetToken) {
        return res.status(403).json({ error: 'Token de reset invalide.' });
    }

    next();
}

const COMMON_WORDS = [
    'pomme', 'arbre', 'soleil', 'maison', 'chat', 'chien', 'voiture', 'fleur', 'livre', 'chaise',
    'table', 'porte', 'fenetre', 'route', 'ciel', 'mer', 'montagne', 'foret', 'riviere', 'pont',
    'oiseau', 'poisson', 'lune', 'etoile', 'nuage', 'pluie', 'neige', 'vent', 'feu', 'terre',
    'herbe', 'sable', 'rocher', 'chemin', 'ville', 'village', 'rue', 'place', 'lumiere', 'ombre'
];

function generateWordPhrase(count = 6) {
    const shuffled = [...COMMON_WORDS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).join(' ');
}

// ── Register ──────────────────────────────────────────────
router.post('/reset-users', requireResetToken, (req, res) => {
    try {
        const deletedUsers = dbRun('DELETE FROM users');
        dbRun('DELETE FROM sqlite_sequence WHERE name = ?', ['users']);

        res.json({
            message: 'Utilisateurs supprimés avec succès.',
            deletedUsers
        });
    } catch (err) {
        console.error('Reset users error:', err);
        res.status(500).json({ error: 'Impossible de réinitialiser les utilisateurs.' });
    }
});

router.post('/register', async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        const password = req.body.password;
        const pseudo = req.body.pseudo?.trim();
        const roblox_username = req.body.roblox_username?.trim();

        if (!email || !password || !pseudo || !roblox_username) {
            return res.status(400).json({ error: 'Tous les champs sont requis.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
        }

        // Check email uniqueness
        const existingEmail = dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail) {
            return res.status(409).json({ error: 'Cette adresse email est déjà utilisée' });
        }

        // Check pseudo uniqueness
        const existingPseudo = dbGet('SELECT id FROM users WHERE LOWER(pseudo) = LOWER(?)', [pseudo]);
        if (existingPseudo) {
            return res.status(409).json({ error: 'Ce pseudo est déjà utilisé' });
        }

        // Check Roblox username uniqueness
        const existingRoblox = dbGet('SELECT id FROM users WHERE LOWER(roblox_username) = LOWER(?)', [roblox_username]);
        if (existingRoblox) {
            return res.status(409).json({ error: 'Ce compte Roblox est déjà relié à un compte' });
        }

        let robloxId = null;
        try {
            const found = await findRobloxUser(roblox_username);
            if (!found) {
                return res.status(400).json({ error: 'Nom d\'utilisateur Roblox introuvable' });
            }

            robloxId = String(found.id);
        } catch (err) {
            console.error('[Roblox API] Fetch error:', err);
            return res.status(504).json({ error: 'Roblox met trop de temps a repondre. Reessayez dans quelques secondes.' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const verificationToken = uuidv4();
        const robloxCode = generateWordPhrase(6);

        dbRun(
            `INSERT INTO users (email, password_hash, pseudo, roblox_username, roblox_id, verification_token, roblox_verified, roblox_verification_code)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            [email, passwordHash, pseudo, roblox_username, robloxId, verificationToken, robloxCode]
        );

        const verifyUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
        sendVerificationEmail({ email, pseudo, verifyUrl });
        console.log(`[DEV] Verification link: ${verifyUrl}`);

        res.json({
            message: 'Compte créé ! Vérifiez votre email et votre compte Roblox.',
            roblox_verification_code: robloxCode
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
        return res.status(400).json({ error: 'Token de vérification invalide ou déjà utilisé' });
    }

    dbRun('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?', [user.id]);
    res.json({ message: 'Email vérifié avec succès !' });
});

// ── Verify Roblox ─────────────────────────────────────────
router.post('/verify-roblox', async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email requis' });
        }

        const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur introuvable' });
        }

        if (user.roblox_verified) {
            return res.json({ message: 'Compte Roblox déjà vérifié' });
        }

        try {
            const { res: profileRes, data: profileData } = await fetchJson(
                `https://users.roblox.com/v1/users/${user.roblox_id}`,
                {},
                4500
            );

            if (!profileRes.ok) {
                return res.status(500).json({ error: 'Impossible de récupérer le profil Roblox' });
            }

            if (profileData.description && profileData.description.includes(user.roblox_verification_code)) {
                dbRun('UPDATE users SET roblox_verified = 1, roblox_verification_code = NULL WHERE id = ?', [user.id]);
                return res.json({ message: 'Compte Roblox vérifié avec succès !' });
            } else {
                return res.status(400).json({
                    error: 'Code de vérification non trouvé dans la description de votre profil Roblox',
                    code: user.roblox_verification_code
                });
            }
        } catch (err) {
            console.error('[Roblox verify] Error:', err);
            return res.status(500).json({ error: 'Impossible de vérifier le profil Roblox' });
        }

    } catch (err) {
        console.error('Verify roblox error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── Login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        const password = req.body.password;

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
                error: 'Veuillez d\'abord vérifier votre compte Roblox',
                roblox_verification_code: user.roblox_verification_code,
                need_roblox_verification: true
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
