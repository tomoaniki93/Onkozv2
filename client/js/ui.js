/* ── UI Utilities ────────────────────────────────────────────────────────────
   Fonctions partagées : avatars, formatage, modal, rendu membres.
   ─────────────────────────────────────────────────────────────────────────── */
const UI = (() => {

  const COLORS = ['av-0','av-1','av-2','av-3','av-4','av-5','av-6','av-7'];

  function avatarClass(username) {
    let hash = 0;
    for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
    return COLORS[hash % COLORS.length];
  }

  function makeAvatar(username, size) {
    const div = document.createElement('div');
    div.className = `user-avatar ${avatarClass(username)}`;
    div.textContent = username[0];
    if (size) div.style.cssText = `width:${size}px;height:${size}px;font-size:${size*.42}px`;
    return div;
  }

  function formatTime(ts) {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  }

  function formatDate(ts) {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
  }

  function roleBadge(role) {
    const span = document.createElement('span');
    span.className = `role-badge ${role}`;
    span.textContent = role === 'admin' ? 'Admin' : role === 'moderator' ? 'Mod' : 'User';
    return span;
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function openModal(title, opts = {}) {
    return new Promise(resolve => {
      document.getElementById('modal-title').textContent = title;
      const input = document.getElementById('modal-channel-name');
      input.value = '';
      input.placeholder = opts.placeholder || 'nom';

      const ephOpts = document.getElementById('modal-ephemeral-opts');
      if (opts.ephemeral) ephOpts.classList.remove('hidden');
      else ephOpts.classList.add('hidden');

      document.getElementById('modal-overlay').classList.remove('hidden');
      input.focus();

      const confirm = document.getElementById('modal-confirm');
      const cancel  = document.getElementById('modal-cancel');

      function close(val) {
        document.getElementById('modal-overlay').classList.add('hidden');
        confirm.replaceWith(confirm.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(val);
      }

      document.getElementById('modal-confirm').addEventListener('click', () => {
        const name = input.value.trim();
        if (!name) return;
        const withText = document.getElementById('eph-with-text')?.checked || false;
        close({ name, withText });
      });

      document.getElementById('modal-cancel').addEventListener('click', () => close(null));

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('modal-confirm').click();
        if (e.key === 'Escape') close(null);
      });
    });
  }

  // ── Utilisateurs sidebar ──────────────────────────────────────────────────
  let allUsers = [];
  let onlineIds = new Set();

  function setUsers(users) { allUsers = users; renderUsers(); }
  function setOnline(ids)   { onlineIds = new Set(ids); renderUsers(); }
  function setUserOnline(id)  { onlineIds.add(id);  renderUsers(); }
  function setUserOffline(id) { onlineIds.delete(id); renderUsers(); }

  function renderUsers() {
    const me = Auth.getUser();
    const online  = allUsers.filter(u => onlineIds.has(u.id));
    const offline = allUsers.filter(u => !onlineIds.has(u.id));

    document.getElementById('online-users').innerHTML  = '';
    document.getElementById('offline-users').innerHTML = '';

    for (const u of online)  appendUserItem(u, true,  me);
    for (const u of offline) appendUserItem(u, false, me);
  }

  function appendUserItem(u, isOnline, me) {
    const li = document.createElement('li');
    li.className = `user-item ${isOnline ? '' : 'offline'}`;
    li.dataset.userId = u.id;

    const av = makeAvatar(u.username);
    av.classList.add('user-avatar');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'u-name';
    nameSpan.textContent = u.username;

    const badge = roleBadge(u.role);

    li.append(av, nameSpan, badge);

    if (isOnline) {
      const dot = document.createElement('span');
      dot.className = 'online-dot';
      li.insertBefore(dot, nameSpan);
    }

    // Admin actions
    if (me && Auth.isAdmin() && u.id !== me.id) {
      const actions = document.createElement('div');
      actions.className = 'u-actions';

      const kickBtn = document.createElement('button');
      kickBtn.className = 'u-btn kick';
      kickBtn.textContent = 'Kick';
      kickBtn.addEventListener('click', e => { e.stopPropagation(); App.kickUser(u.id); });

      const modBtn = document.createElement('button');
      modBtn.className = 'u-btn mod';
      modBtn.textContent = u.role === 'moderator' ? '→User' : '→Mod';
      modBtn.addEventListener('click', e => {
        e.stopPropagation();
        App.changeRole(u.id, u.role === 'moderator' ? 'user' : 'moderator');
      });

      actions.append(kickBtn, modBtn);
      li.append(actions);
    }

    // Clic → DM
    if (me && u.id !== me.id) {
      li.addEventListener('click', () => Chat.openDM(u.id, u.username));
    }

    const target = isOnline ? 'online-users' : 'offline-users';
    document.getElementById(target).appendChild(li);
  }

  // ── Footer user ────────────────────────────────────────────────────────────
  function renderFooterUser(user) {
    document.getElementById('footer-username').textContent = user.username;
    const roleEl = document.getElementById('footer-role');
    roleEl.textContent = user.role === 'admin' ? 'Admin' : user.role === 'moderator' ? 'Modérateur' : 'Utilisateur';
    roleEl.className = `role-badge ${user.role}`;

    const av = document.getElementById('footer-avatar');
    av.textContent = user.username[0].toUpperCase();
    av.className = `user-avatar ${avatarClass(user.username)}`;
  }

  return {
    avatarClass, makeAvatar, formatTime, formatDate, roleBadge, openModal,
    setUsers, setOnline, setUserOnline, setUserOffline,
    renderFooterUser,
  };
})();
