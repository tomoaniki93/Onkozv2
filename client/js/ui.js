/* ── UI Utilities ─────────────────────────────────────────────────────────── */
const UI = (() => {
  const AV_COLORS = ['av-0','av-1','av-2','av-3','av-4','av-5','av-6','av-7'];

  function avatarClass(username) {
    let hash = 0;
    for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
    return AV_COLORS[hash % AV_COLORS.length];
  }

  function makeAvatar(username, extraClasses = '', userId = null, avatarUrl = null) {
    const div = document.createElement('div');
    div.className = `${avatarClass(username)} user-avatar w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 uppercase overflow-hidden ${extraClasses}`;
    if (avatarUrl) {
      div.style.backgroundImage    = `url(${avatarUrl})`;
      div.style.backgroundSize     = 'cover';
      div.style.backgroundPosition = 'center';
    } else {
      div.textContent = username[0];
    }
    if (userId) {
      div.style.cursor = 'pointer';
      div.addEventListener('click', e => { e.stopPropagation(); Profile.openProfilePopup(userId, username, div); });
    }
    return div;
  }

  function formatTime(ts) {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Role badge ─────────────────────────────────────────────────────────────
  function roleBadge(role) {
    const span = document.createElement('span');
    span.className = 'role-badge';
    span.classList.add(role);
    span.textContent = role === 'admin' ? 'Admin' : role === 'moderator' ? 'Mod' : 'User';
    return span;
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(title, opts = {}) {
    // opts.mode: 'category' | 'channel' | 'ephemeral'
    return new Promise(resolve => {
      document.getElementById('modal-title').textContent = title;
      const input = document.getElementById('modal-channel-name');
      input.value = '';
      input.placeholder = opts.placeholder || 'Nom...';

      const mode = opts.mode || 'channel';

      // ── Sélecteur type texte/vocal ──
      const typeOpts = document.getElementById('modal-type-opts');
      let selectedType = 'text';
      if (mode === 'channel') {
        typeOpts.classList.remove('hidden');
        typeOpts.classList.add('flex');
        selectedType = 'text';
        document.querySelectorAll('.type-btn').forEach(btn => {
          const active = btn.dataset.type === 'text';
          btn.className = `type-btn flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${active ? 'border-onkoz-accent bg-onkoz-accent/20 text-onkoz-accent-lt' : 'border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover'}`;
          btn.onclick = () => {
            selectedType = btn.dataset.type;
            document.querySelectorAll('.type-btn').forEach(b => {
              b.className = `type-btn flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${b.dataset.type === selectedType ? 'border-onkoz-accent bg-onkoz-accent/20 text-onkoz-accent-lt' : 'border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover'}`;
            });
          };
        });
      } else {
        typeOpts.classList.add('hidden');
        typeOpts.classList.remove('flex');
      }

      // ── Sélecteur catégorie ──
      const catOpts = document.getElementById('modal-category-opts');
      if (mode === 'channel' && opts.categories?.length) {
        catOpts.classList.remove('hidden');
        catOpts.classList.add('flex');
        const sel = document.getElementById('modal-category-select');
        sel.innerHTML = '<option value="">— Aucune catégorie —</option>';
        opts.categories.forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.name;
          if (cat.id == opts.defaultCategoryId) opt.selected = true;
          sel.appendChild(opt);
        });
      } else {
        catOpts.classList.add('hidden');
        catOpts.classList.remove('flex');
      }

      // ── Éphémère texte ──
      const ephOpts = document.getElementById('modal-ephemeral-opts');
      if (mode === 'ephemeral') {
        ephOpts.classList.remove('hidden');
        document.getElementById('eph-with-text').checked = false;
      } else {
        ephOpts.classList.add('hidden');
      }

      // ── Ouvrir ──
      const overlay = document.getElementById('modal-overlay');
      overlay.classList.remove('hidden');
      overlay.classList.add('flex');
      setTimeout(() => input.focus(), 50);

      function close(val) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        typeOpts.classList.add('hidden');
        typeOpts.classList.remove('flex');
        catOpts.classList.add('hidden');
        catOpts.classList.remove('flex');
        document.getElementById('modal-confirm').replaceWith(document.getElementById('modal-confirm').cloneNode(true));
        document.getElementById('modal-cancel').replaceWith(document.getElementById('modal-cancel').cloneNode(true));
        resolve(val);
      }

      document.getElementById('modal-confirm').addEventListener('click', () => {
        const name = input.value.trim();
        if (!name) return;
        const categoryId = document.getElementById('modal-category-select')?.value || null;
        close({
          name,
          type: selectedType,
          categoryId: categoryId ? parseInt(categoryId) : null,
          withText: document.getElementById('eph-with-text')?.checked || false,
        });
      });
      document.getElementById('modal-cancel').addEventListener('click', () => close(null));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  document.getElementById('modal-confirm').click();
        if (e.key === 'Escape') close(null);
      });
    });
  }

  // ── Users sidebar ──────────────────────────────────────────────────────────
  let allUsers = [];
  let onlineIds = new Set();

  function setUsers(users) { allUsers = users; renderUsers(); }
  function setOnline(ids)   { onlineIds = new Set(ids); renderUsers(); }
  function setUserOnline(id)  { onlineIds.add(id);    renderUsers(); }
  function setUserOffline(id) { onlineIds.delete(id); renderUsers(); }

  function renderUsers() {
    const me = Auth.getUser();
    document.getElementById('online-users').innerHTML  = '';
    document.getElementById('offline-users').innerHTML = '';
    allUsers.filter(u =>  onlineIds.has(u.id)).forEach(u => appendUserItem(u, true,  me));
    allUsers.filter(u => !onlineIds.has(u.id)).forEach(u => appendUserItem(u, false, me));
  }

  function appendUserItem(u, isOnline, me) {
    const li = document.createElement('li');
    li.dataset.userId = u.id;
    li.className = `flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-onkoz-hover group ${isOnline ? '' : 'opacity-50'}`;

    const av = makeAvatar(u.username, 'w-7 h-7 text-xs', u.id, u.avatar_url);

    const info = document.createElement('div');
    info.className = 'flex-1 min-w-0';

    const nameRow = document.createElement('div');
    nameRow.className = 'flex items-center gap-1.5';

    if (isOnline) {
      const dot = document.createElement('span');
      dot.className = 'w-2 h-2 rounded-full bg-onkoz-success shrink-0';
      nameRow.appendChild(dot);
    }

    const name = document.createElement('span');
    name.className = 'text-[0.88rem] font-medium truncate text-onkoz-text';
    name.textContent = u.username;
    nameRow.append(name, roleBadge(u.role));
    info.appendChild(nameRow);

    // Statut personnalisé
    if (u.status) {
      const st = document.createElement('p');
      st.className = 'user-status text-[0.68rem] text-onkoz-text-muted truncate';
      st.textContent = u.status;
      info.appendChild(st);
    } else {
      const st = document.createElement('p');
      st.className = 'user-status hidden text-[0.68rem] text-onkoz-text-muted truncate';
      info.appendChild(st);
    }

    li.append(av, info);

    // Actions admin
    if (me && Auth.isAdmin() && u.id !== me.id) {
      const actions = document.createElement('div');
      actions.className = 'hidden gap-1 items-center';

      const kickBtn = document.createElement('button');
      kickBtn.className = 'text-[0.65rem] font-bold px-1.5 py-px rounded text-onkoz-danger bg-onkoz-danger/15 hover:bg-onkoz-danger/30 transition-colors';
      kickBtn.textContent = 'Kick';
      kickBtn.addEventListener('click', e => { e.stopPropagation(); App.kickUser(u.id); });

      const modBtn = document.createElement('button');
      modBtn.className = 'text-[0.65rem] font-bold px-1.5 py-px rounded text-onkoz-mod bg-onkoz-mod/15 hover:bg-onkoz-mod/30 transition-colors';
      modBtn.textContent = u.role === 'moderator' ? '→User' : '→Mod';
      modBtn.addEventListener('click', e => {
        e.stopPropagation();
        App.changeRole(u.id, u.role === 'moderator' ? 'user' : 'moderator');
      });

      actions.append(kickBtn, modBtn);
      li.append(actions);
      li.addEventListener('mouseenter', () => actions.classList.replace('hidden', 'flex'));
      li.addEventListener('mouseleave', () => actions.classList.replace('flex', 'hidden'));
    }

    // Clic → popup profil (ou DM si autre utilisateur)
    li.addEventListener('click', () => {
      if (u.id === me?.id) {
        Profile.openEditPanel();
      } else {
        Profile.openProfilePopup(u.id, u.username, li);
      }
    });

    document.getElementById(isOnline ? 'online-users' : 'offline-users').appendChild(li);
  }

  // ── Footer user ────────────────────────────────────────────────────────────
  function renderFooterUser(user) {
    document.getElementById('footer-username').textContent = user.username;
    const roleEl = document.getElementById('footer-role');
    roleEl.className = 'role-badge';
    roleEl.classList.add(user.role);
    roleEl.textContent = user.role === 'admin' ? 'Admin' : user.role === 'moderator' ? 'Modérateur' : 'Utilisateur';

    const av = document.getElementById('footer-avatar');
    av.textContent = user.username[0].toUpperCase();
    av.className = `${avatarClass(user.username)} w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 uppercase`;
  }

  return {
    avatarClass, makeAvatar, formatTime, roleBadge, openModal,
    setUsers, setOnline, setUserOnline, setUserOffline, renderFooterUser,
  };
})();
