const API = '';

function showMessage(text, type = 'error') {
    const box = document.getElementById('message-box');
    box.textContent = text;
    box.className = `message-box ${type}`;
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 5000);
}

function setLoading(btn, loading) {
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
});

// Check if already logged in
if (localStorage.getItem('voicechat_token')) {
    window.location.href = '/chat';
}

// ── PKCE Helpers ──────────────────────────────────────────
function generateRandomString(length) {
    const arr = new Uint8Array(length);
    window.crypto.getRandomValues(arr);
    return Array.from(arr, dec => dec.toString(16).padStart(2, '0')).join('');
}

async function generatePKCE() {
    const verifier = generateRandomString(32);
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return { verifier, challenge };
}

// ── Register ──────────────────────────────────────────────
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('register-btn');
    const robloxId = document.getElementById('reg-roblox-id').value;
    const robloxUsername = document.getElementById('reg-roblox-username').value;

    if (!robloxId || !robloxUsername) {
        showMessage('Veuillez lier votre compte Roblox avant de créer le compte.', 'error');
        return;
    }

    setLoading(btn, true);

    const body = {
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        pseudo: document.getElementById('reg-pseudo').value.trim(),
        roblox_username: robloxUsername,
        roblox_id: robloxId
    };

    try {
        const res = await fetch(`${API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
            showMessage(data.error, 'error');
            setLoading(btn, false);
            return;
        }

        showMessage('Compte créé ! Veuillez vérifier votre email.', 'success');
        document.getElementById('register-form').reset();

        // Reset Roblox button
        const robloxBtn = document.getElementById('link-roblox-btn');
        robloxBtn.style = '';
        robloxBtn.className = 'btn btn-secondary';
        document.getElementById('link-roblox-text').textContent = 'Lier le compte Roblox (Requis)';
        document.getElementById('reg-roblox-id').value = '';
        document.getElementById('reg-roblox-username').value = '';

    } catch {
        showMessage('Erreur de connexion au serveur', 'error');
    }

    setLoading(btn, false);
});

// ── Link Roblox (OAuth2) ──────────────────────────────────
document.getElementById('link-roblox-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('link-roblox-btn');
    setLoading(btn, true);

    try {
        const res = await fetch(`${API}/api/auth/roblox-config`);
        const config = await res.json();

        if (!config.clientId) {
            showMessage('Application Roblox non configurée. Vérifiez le backend.', 'error');
            setLoading(btn, false);
            return;
        }

        const pkce = await generatePKCE();
        const state = generateRandomString(16);

        sessionStorage.setItem('oauth_verifier', pkce.verifier);
        sessionStorage.setItem('oauth_state', state);

        const authUrl = `https://apis.roblox.com/oauth/v1/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=openid profile&response_type=code&state=${state}&code_challenge=${pkce.challenge}&code_challenge_method=S256`;

        window.open(authUrl, 'robloxLogin', 'width=500,height=600');
    } catch {
        showMessage('Erreur de configuration Roblox', 'error');
    }
    setLoading(btn, false);
});

window.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'ROBLOX_OAUTH') {
        const { code, state } = event.data;
        const savedState = sessionStorage.getItem('oauth_state');
        const savedVerifier = sessionStorage.getItem('oauth_verifier');

        if (state !== savedState) {
            showMessage('Session expirée ou invalide', 'error');
            return;
        }

        const btn = document.getElementById('link-roblox-btn');
        setLoading(btn, true);

        try {
            const res = await fetch(`${API}/api/auth/roblox-exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: savedVerifier })
            });
            const data = await res.json();

            if (res.ok) {
                document.getElementById('reg-roblox-id').value = data.roblox_id;
                document.getElementById('reg-roblox-username').value = data.roblox_username;

                btn.className = 'btn';
                btn.style.backgroundColor = 'rgba(102, 187, 106, 0.15)';
                btn.style.color = '#66bb6a';
                btn.style.border = '1px solid #66bb6a';
                document.getElementById('link-roblox-text').textContent = `Connecté : ${data.roblox_username}`;
                showMessage('Compte Roblox lié avec succès !', 'success');
            } else {
                showMessage(data.error || 'Erreur lors de la liaison', 'error');
            }
        } catch {
            showMessage("Erreur serveur lors de l'échange de code", 'error');
        }
        setLoading(btn, false);
    }
});

// ── Login ─────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    setLoading(btn, true);

    const body = {
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value
    };

    try {
        const res = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
            showMessage(data.error, 'error');
            setLoading(btn, false);
            return;
        }

        localStorage.setItem('voicechat_token', data.token);
        localStorage.setItem('voicechat_user', JSON.stringify(data.user));
        window.location.href = '/chat';

    } catch {
        showMessage('Erreur de connexion au serveur', 'error');
    }

    setLoading(btn, false);
});
