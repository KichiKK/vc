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

        pendingEmail = body.email;
        showMessage('Compte créé ! Vérifiez votre email puis votre compte Roblox.', 'success');

        if (data.roblox_verification_code) {
            document.getElementById('roblox-code').textContent = data.roblox_verification_code;
            document.getElementById('roblox-verify-section').classList.remove('hidden');
        }

    } catch {
        showMessage('Erreur de connexion au serveur', 'error');
    }

    setLoading(btn, false);
});

// ── Verify Roblox ─────────────────────────────────────────
document.getElementById('verify-roblox-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('verify-roblox-btn');
    setLoading(btn, true);

    try {
        const res = await fetch(`${API}/api/auth/verify-roblox`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingEmail })
        });

        const data = await res.json();

        if (res.ok) {
            showMessage(data.message, 'success');
            document.getElementById('roblox-verify-section').classList.add('hidden');
        } else {
            showMessage(data.error, 'error');
            if (data.code) {
                document.getElementById('roblox-code').textContent = data.code;
            }
        }
    } catch {
        showMessage('Erreur de connexion au serveur', 'error');
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
        const res = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
            if (data.need_roblox_verification) {
                pendingEmail = body.email;
                document.getElementById('roblox-code').textContent = data.roblox_verification_code;
                document.getElementById('roblox-verify-section').classList.remove('hidden');
                showMessage(data.error, 'info');
            } else {
                showMessage(data.error, 'error');
            }
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
