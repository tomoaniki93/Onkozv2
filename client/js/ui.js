/* ── UI Utilities ─────────────────────────────────────────────────────────── */
const UI = (() => {
  const AV_COLORS = ['av-0','av-1','av-2','av-3','av-4','av-5','av-6','av-7'];

  // Échappe le HTML — à utiliser sur toute donnée utilisateur injectée via innerHTML
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function avatarClass(username) {
    let hash = 0;
    for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
    return AV_COLORS[hash % AV_COLORS.length];
  }

  function makeAvatar(username, extraClasses = '', userId = null, avatarUrl = null) {
    const div = document.createElement('div');
    div.className = `${avatarClass(username)} user-avatar w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 uppercase overflow-hidden ${extraClasses}`;
    if (avatarUrl) {
      div.style.backgroundImage    = `url("${avatarUrl}")`;
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
    const labels = { admin: 'Admin', moderator: 'Mod', user: 'User', temporary: '⏳ Temp' };
    span.textContent = labels[role] || 'User';
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

    // Badge expiration pour les comptes temporaires
    if (u.role === 'temporary' && u.expires_at) {
      const diff = u.expires_at - Math.floor(Date.now() / 1000);
      if (diff > 0) {
        const h   = Math.floor(diff / 3600);
        const m   = Math.floor((diff % 3600) / 60);
        const exp = document.createElement('p');
        exp.className = 'text-[0.65rem] text-amber-400/70 truncate';
        exp.textContent = `⏳ Expire dans ${h}h${String(m).padStart(2,'0')}`;
        info.appendChild(exp);
      }
    }

    li.append(av, info);

    // Bouton options admin
    if (me && Auth.isAdmin() && u.id !== me.id) {
      const optBtn = document.createElement('button');
      optBtn.className = 'hidden w-6 h-6 items-center justify-center rounded text-onkoz-text-muted hover:bg-onkoz-hover hover:text-onkoz-text transition-colors font-bold text-base shrink-0';
      optBtn.textContent = '⋮';
      optBtn.title = 'Options';
      optBtn.addEventListener('click', e => { e.stopPropagation(); openUserMenu(e, u); });
      li.append(optBtn);
      li.addEventListener('mouseenter', () => optBtn.classList.replace('hidden', 'flex'));
      li.addEventListener('mouseleave', () => optBtn.classList.replace('flex', 'hidden'));
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

  // ── Menu options utilisateur ───────────────────────────────────────────────
  function openUserMenu(e, u) {
    document.getElementById('user-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'user-ctx-menu';
    menu.className = 'fixed z-[300] bg-onkoz-surface border border-onkoz-border rounded-lg shadow-dm py-1 w-48 text-sm overflow-hidden';

    const rect = e.currentTarget.getBoundingClientRect();
    let top  = rect.bottom + 4;
    let left = rect.left - 160;
    if (left < 8) left = rect.right + 4;
    if (top + 200 > window.innerHeight) top = rect.top - 204;
    menu.style.top  = `${top}px`;
    menu.style.left = `${left}px`;

    // Header utilisateur
    const header = document.createElement('div');
    header.className = 'flex items-center gap-2 px-3 py-2 border-b border-onkoz-border mb-1';
    header.innerHTML = `
      <div class="${avatarClass(u.username)} w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white uppercase">${u.username[0]}</div>
      <span class="font-bold text-sm text-onkoz-text truncate">${u.username}</span>`;
    menu.appendChild(header);

    const items = [];

    // Rôles (pas de changement de rôle pour les comptes temporaires)
    if (u.role !== 'admin' && u.role !== 'temporary') {
      if (u.role !== 'moderator') {
        items.push({ icon: '🛡', label: 'Passer Modérateur', action: () => App.changeRole(u.id, 'moderator') });
      } else {
        items.push({ icon: '👤', label: 'Passer Utilisateur', action: () => App.changeRole(u.id, 'user') });
      }
      items.push({ icon: '👑', label: 'Passer Admin', action: () => App.changeRole(u.id, 'admin') });
    } else if (u.role === 'temporary') {
      items.push({ icon: '⏳', label: 'Compte temporaire', action: () => AudioSettings.showToast("ℹ️ Ce compte doit d'abord définir un mot de passe"), danger: false });
    }

    // Déplacer vers un salon vocal (mod/admin)
    if (Auth.isAdmin() || Auth.isMod()) {
      const vchans = App.getVoiceChannels?.() || [];
      if (vchans.length) {
        items.push({ separator: true });
        items.push({ heading: 'Déplacer vers' });
        vchans.forEach(ch => {
          items.push({ icon: '🔊', label: ch.name, action: () => App.moveMember(u.id, ch.id) });
        });
      }
    }

    // Séparateur + kick
    items.push({ separator: true });
    items.push({ icon: '👢', label: 'Expulser (Kick)', danger: true, action: () => App.kickUser(u.id) });

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'border-t border-onkoz-border my-1';
        menu.appendChild(sep);
        return;
      }
      if (item.heading) {
        const h = document.createElement('p');
        h.className = 'px-3 py-0.5 text-[0.62rem] uppercase tracking-wider text-onkoz-text-muted';
        h.textContent = item.heading;
        menu.appendChild(h);
        return;
      }
      const btn = document.createElement('button');
      btn.className = `w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left text-sm ${
        item.danger
          ? 'text-onkoz-danger hover:bg-onkoz-danger/15'
          : 'text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text'
      }`;
      btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
      btn.addEventListener('click', () => { menu.remove(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', function handler(ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', handler); }
      });
    }, 50);
  }

  // ── Footer user ────────────────────────────────────────────────────────────
  function renderFooterUser(user) {
    document.getElementById('footer-username').textContent = user.username;
    const roleEl = document.getElementById('footer-role');
    roleEl.className = 'role-badge';
    roleEl.classList.add(user.role);
    const roleNames = { admin: 'Admin', moderator: 'Modérateur', user: 'Utilisateur', temporary: '⏳ Temporaire' };
    roleEl.textContent = roleNames[user.role] || 'Utilisateur';

    const av = document.getElementById('footer-avatar');
    av.textContent = user.username[0].toUpperCase();
    av.className = `${avatarClass(user.username)} w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 uppercase`;
  }

  return {
    escapeHtml,
    avatarClass, makeAvatar, formatTime, roleBadge, openModal,
    setUsers, setOnline, setUserOnline, setUserOffline, renderFooterUser,
  };
})();
