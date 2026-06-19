const API = (() => {
    if (window.VOICECHAT_API_URL) {
        return window.VOICECHAT_API_URL.replace(/\/$/, '');
    }

    if (window.location.protocol === 'file:') {
        return 'http://localhost:3000';
    }

    if (
        ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
        window.location.port &&
        window.location.port !== '3000'
    ) {
        return 'http://localhost:3000';
    }

    if (window.location.hostname.endsWith('.workers.dev')) {
        return null;
    }

    return '';
})();

async function apiRequest(path, options = {}) {
    if (API === null) {
        throw new Error(
            'API non configuree : renseignez window.VOICECHAT_API_URL dans /js/config.js avec l URL de votre serveur Node.'
        );
    }

    const res = await fetch(`${API}${path}`, options);
    const text = await res.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = {
                error: res.ok
                    ? text
                    : `Le serveur a renvoye une reponse inattendue (${res.status}).`
            };
        }
    }

    return { res, data };
}

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

// ── Register ──────────────────────────────────────────────
let pendingEmail = null;

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('register-btn');
    setLoading(btn, true);

    const body = {
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        pseudo: document.getElementById('reg-pseudo').value.trim(),
        roblox_username: document.getElementById('reg-roblox').value.trim()
    };

    try {
        const { res, data } = await apiRequest('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            showMessage(data.error || 'Inscription impossible pour le moment.', 'error');
            setLoading(btn, false);
            return;
        }

        pendingEmail = body.email.toLowerCase();
        showMessage('Compte créé ! Vérifiez votre email puis votre compte Roblox.', 'success');

        if (data.roblox_verification_code) {
            document.getElementById('roblox-code').textContent = data.roblox_verification_code;
            document.getElementById('roblox-verify-section').classList.remove('hidden');
        }

    } catch (err) {
        console.error('Register request failed:', err);
        showMessage(err.message || 'Erreur de connexion au serveur', 'error');
    }

    setLoading(btn, false);
});

// ── Verify Roblox ─────────────────────────────────────────
document.getElementById('verify-roblox-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('verify-roblox-btn');

    if (!pendingEmail) {
        showMessage('Créez un compte ou connectez-vous avant de vérifier Roblox.', 'error');
        return;
    }

    setLoading(btn, true);

    try {
        const { res, data } = await apiRequest('/api/auth/verify-roblox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingEmail })
        });

        if (res.ok) {
            showMessage(data.message, 'success');
            document.getElementById('roblox-verify-section').classList.add('hidden');
        } else {
            showMessage(data.error || 'Verification Roblox impossible pour le moment.', 'error');
            if (data.code) {
                document.getElementById('roblox-code').textContent = data.code;
            }
        }
    } catch (err) {
        console.error('Roblox verification request failed:', err);
        showMessage(err.message || 'Erreur de connexion au serveur', 'error');
    }

    setLoading(btn, false);
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
        const { res, data } = await apiRequest('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            if (data.need_roblox_verification) {
                pendingEmail = body.email.toLowerCase();
                document.getElementById('roblox-code').textContent = data.roblox_verification_code;
                document.getElementById('roblox-verify-section').classList.remove('hidden');
                showMessage(data.error, 'info');
            } else {
                showMessage(data.error || 'Connexion impossible pour le moment.', 'error');
            }
            setLoading(btn, false);
            return;
        }

        localStorage.setItem('voicechat_token', data.token);
        localStorage.setItem('voicechat_user', JSON.stringify(data.user));
        window.location.href = '/chat';

    } catch (err) {
        console.error('Login request failed:', err);
        showMessage(err.message || 'Erreur de connexion au serveur', 'error');
    }

    setLoading(btn, false);
});
