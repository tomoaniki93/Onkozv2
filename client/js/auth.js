/* ── Auth Module ─────────────────────────────────────────────────────────────
   Gère l'écran de connexion/inscription et la session courante.
   ─────────────────────────────────────────────────────────────────────────── */
const Auth = (() => {
  let currentUser = null;

  function getUser()    { return currentUser; }
  function isAdmin()    { return currentUser?.role === 'admin'; }
  function isMod()      { return ['admin','moderator'].includes(currentUser?.role); }

  async function init() {
    const token = API.getToken();
    if (!token) return showAuthScreen();

    try {
      const user = await API.me();
      currentUser = user;
      localStorage.setItem('onkoz_user', JSON.stringify(user));
      return user;
    } catch {
      API.clearToken();
      showAuthScreen();
      return null;
    }
  }

  async function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');

    // Vérifier si admin existe
    try {
      const res = await fetch('/api/auth/check-username/__SETUP_CHECK__');
      // Si on peut atteindre le serveur, vérifier s'il y a un admin
      const setupRes = await fetch('/api/auth/setup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
      const setupData = await setupRes.json();
      if (setupData.error === 'Admin déjà configuré') {
        // Admin existe, mode normal
        showLoginTabs();
      } else {
        // Pas encore d'admin → montrer setup
        showSetupForm();
      }
    } catch {
      showLoginTabs();
    }
  }

  function showSetupForm() {
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('auth-tabs').classList.add('hidden');
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.add('hidden');
  }

  function showLoginTabs() {
    document.getElementById('setup-form').classList.add('hidden');
    document.getElementById('auth-tabs').classList.remove('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
  }

  function bindEvents() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('login-form').classList.toggle('hidden',    tab !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
        document.getElementById('auth-error').classList.add('hidden');
      });
    });

    // Setup
    document.getElementById('setup-btn').addEventListener('click', async () => {
      const u = document.getElementById('setup-username').value.trim();
      const p = document.getElementById('setup-password').value;
      try {
        const { token, user } = await API.setup(u, p);
        API.setToken(token);
        currentUser = user;
        localStorage.setItem('onkoz_user', JSON.stringify(user));
        App.launch();
      } catch (e) { showError(e.message); }
    });

    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
      const u = document.getElementById('login-username').value.trim();
      const p = document.getElementById('login-password').value;
      try {
        const { token, user } = await API.login(u, p);
        API.setToken(token);
        currentUser = user;
        localStorage.setItem('onkoz_user', JSON.stringify(user));
        App.launch();
      } catch (e) { showError(e.message); }
    });

    // Entrée = submit login
    ['login-username','login-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('login-btn').click();
      });
    });

    // Register
    document.getElementById('register-btn').addEventListener('click', async () => {
      const u = document.getElementById('reg-username').value.trim();
      const p = document.getElementById('reg-password').value;
      try {
        const { token, user } = await API.register(u, p);
        API.setToken(token);
        currentUser = user;
        localStorage.setItem('onkoz_user', JSON.stringify(user));
        App.launch();
      } catch (e) { showError(e.message); }
    });

    ['reg-username','reg-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('register-btn').click();
      });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
      API.clearToken();
      currentUser = null;
      location.reload();
    });
  }

  return { init, getUser, isAdmin, isMod, showAuthScreen, bindEvents };
})();
