/* ── Profile Module ──────────────────────────────────────────────────────────
   - Panneau d'édition de son propre profil (bio, statut, avatar, bannière)
   - Popup de consultation du profil d'un autre utilisateur
   - Mises à jour en temps réel via socket
   ─────────────────────────────────────────────────────────────────────────── */
const Profile = (() => {

  // ── Galerie d'avatars prédéfinis ───────────────────────────────────────────
  //  Avatars générés en SVG (data-URI) : aucune dépendance externe, aucun droit
  //  en jeu, la galerie s'affiche toujours (même hors-ligne). Dégradé + symbole.
  const AV = (c1, c2, glyph) => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
      `</linearGradient></defs>` +
      `<rect width="120" height="120" fill="url(#g)"/>` +
      `<g fill="#ffffff" fill-opacity="0.92" stroke="#ffffff" stroke-opacity="0.92">${glyph}</g>` +
      `</svg>`;
    const enc = encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `data:image/svg+xml,${enc}`;
  };

  const G = {
    circle:   '<circle cx="60" cy="60" r="28" stroke="none"/>',
    ring:     '<circle cx="60" cy="60" r="24" fill="none" stroke-width="9"/>',
    square:   '<rect x="34" y="34" width="52" height="52" rx="13" stroke="none"/>',
    diamond:  '<path d="M60 30 L90 60 L60 90 L30 60 Z" stroke="none"/>',
    triangle: '<path d="M60 34 L86 82 L34 82 Z" stroke="none"/>',
    hexagon:  '<path d="M60 30 L86 45 L86 75 L60 90 L34 75 L34 45 Z" stroke="none"/>',
    pentagon: '<path d="M60 30 L88 51 L77 84 L43 84 L32 51 Z" stroke="none"/>',
    plus:     '<path d="M52 32 L68 32 L68 52 L88 52 L88 68 L68 68 L68 88 L52 88 L52 68 L32 68 L32 52 L52 52 Z" stroke="none"/>',
    bolt:     '<path d="M66 30 L42 62 L57 62 L54 90 L80 56 L63 56 Z" stroke="none"/>',
    droplet:  '<path d="M60 32 C80 56 78 70 60 88 C42 70 40 56 60 32 Z" stroke="none"/>',
    crescent: '<path d="M74 32 A28 28 0 1 0 74 88 A22 22 0 1 1 74 32 Z" stroke="none"/>',
    dots:     '<circle cx="46" cy="60" r="12" stroke="none"/><circle cx="74" cy="60" r="12" stroke="none"/>',
  };

  const PRESETS_GENERATED = [
    { name: 'Saphir',    url: AV('#1e3a8a', '#38bdf8', G.circle) },
    { name: 'Rubis',     url: AV('#7f1d1d', '#f87171', G.diamond) },
    { name: 'Arcane',    url: AV('#4c1d95', '#c084fc', G.hexagon) },
    { name: 'Émeraude',  url: AV('#064e3b', '#34d399', G.triangle) },
    { name: 'Givre',     url: AV('#0e7490', '#67e8f9', G.crescent) },
    { name: 'Braise',    url: AV('#7c2d12', '#fb923c', G.bolt) },
    { name: 'Or',        url: AV('#78350f', '#fbbf24', G.pentagon) },
    { name: 'Sang',      url: AV('#450a0a', '#ef4444', G.droplet) },
    { name: 'Améthyste', url: AV('#2e1065', '#a78bfa', G.square) },
    { name: 'Océan',     url: AV('#0c4a6e', '#22d3ee', G.ring) },
    { name: 'Fel',       url: AV('#14532d', '#4ade80', G.plus) },
    { name: 'Nocturne',  url: AV('#0f172a', '#64748b', G.dots) },
  ];

  // Ajoute ici tes propres avatars hébergés sur le VPS, ex :
  //   { name: 'Guerrier', url: 'https://onkoz.fr/avatars/guerrier.png' },
  const PRESETS_CUSTOM = [];

  const AVATAR_PRESETS = [...PRESETS_CUSTOM, ...PRESETS_GENERATED];

  // ── Galerie de bannières prédéfinies ───────────────────────────────────────
  //  Dégradés générés en SVG (data-URI) : aucune image à héberger, aucun droit
  //  en jeu, une URL valide utilisable telle quelle dans banner_url.
  const GRAD = (c1, c2, c3) => {
    const stops = c3
      ? `<stop offset="0" stop-color="${c1}"/><stop offset="0.5" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>`
      : `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="150">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>` +
      `<rect width="600" height="150" fill="url(#g)"/></svg>`;
    // encodeURIComponent laisse ( ) littéraux → ils casseraient le url() CSS.
    // On les encode aussi pour que le data-URI fonctionne dans un url() non quoté.
    const enc = encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `data:image/svg+xml,${enc}`;
  };

  const BANNER_PRESETS = [
    { name: 'Bleu & Or',   url: GRAD('#1e3a8a', '#f5c542') },
    { name: 'Rouge & Noir', url: GRAD('#7f1d1d', '#111827') },
    { name: 'Arcane',      url: GRAD('#4c1d95', '#7c3aed', '#c084fc') },
    { name: 'Fel',         url: GRAD('#052e16', '#22c55e') },
    { name: 'Givre',       url: GRAD('#0e7490', '#67e8f9') },
    { name: 'Braise',      url: GRAD('#7c2d12', '#f97316', '#facc15') },
    { name: 'Nocturne',    url: GRAD('#0f172a', '#334155') },
    { name: 'Sang',        url: GRAD('#450a0a', '#dc2626') },
    { name: 'Émeraude',    url: GRAD('#064e3b', '#10b981') },
    { name: 'Améthyste',   url: GRAD('#2e1065', '#a78bfa') },
    { name: 'Crépuscule',  url: GRAD('#1e1b4b', '#be185d', '#f59e0b') },
    { name: 'Abysse',      url: GRAD('#020617', '#1e40af') },
  ];

  // Bannières perso hébergées sur le VPS, ex :
  //   { name: 'Guilde', url: 'https://onkoz.fr/banners/guilde.png' },
  const BANNER_CUSTOM = [];

  const ALL_BANNERS = [...BANNER_CUSTOM, ...BANNER_PRESETS];

  // Cache local des profils { userId: { bio, status, avatar_url, banner_url } }
  const cache = {};
  let socket  = null;

  function init(s) {
    socket = s;
    socket.on('profile:updated', data => {
      cache[data.userId] = data;
      refreshAvatarsInDOM(data);
      refreshStatusInDOM(data);
      const me = Auth.getUser();
      if (me && data.userId === me.id) applyFooterAvatar(data.avatar_url);
    });
  }

  // ── Ouvrir panneau édition (son propre profil) ────────────────────────────
  function openEditPanel() {
    document.getElementById('profile-edit-panel')?.remove();

    const me = Auth.getUser();
    const panel = document.createElement('div');
    panel.id = 'profile-edit-panel';
    panel.className = 'fixed bottom-16 left-2 z-[150] w-80 bg-onkoz-surface border border-onkoz-border rounded-xl shadow-dm flex flex-col overflow-hidden';

    panel.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3 border-b border-onkoz-border shrink-0">
        <span class="font-bold text-sm text-onkoz-text">👤 Mon profil</span>
        <button id="close-profile-panel" class="w-6 h-6 flex items-center justify-center rounded text-onkoz-text-muted hover:bg-onkoz-hover hover:text-onkoz-text transition-colors text-xs">✕</button>
      </div>

      <div class="flex flex-col gap-4 p-4 overflow-y-auto">

        <!-- Aperçu avatar -->
        <div class="flex justify-center py-2">
          <div id="edit-avatar-preview" class="w-20 h-20 rounded-full border-4 border-onkoz-surface bg-onkoz-accent flex items-center justify-center font-bold text-3xl text-white uppercase overflow-hidden bg-cover bg-center">
            ${me.username[0]}
          </div>
        </div>

        <div class="mt-5 flex flex-col gap-3">

          <!-- Statut -->
          <div class="flex flex-col gap-1">
            <label class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">💬 Statut personnalisé</label>
            <input id="edit-status" type="text" maxlength="50" placeholder="Qu'est-ce que tu fais ?"
                   class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2 text-sm outline-none focus:border-onkoz-accent transition-colors" />
            <span class="text-[0.68rem] text-onkoz-text-muted text-right"><span id="status-count">0</span>/50</span>
          </div>

          <!-- Bio -->
          <div class="flex flex-col gap-1">
            <label class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">📝 Bio</label>
            <textarea id="edit-bio" maxlength="200" placeholder="Parle-nous de toi..." rows="3"
                      class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2 text-sm outline-none focus:border-onkoz-accent transition-colors resize-none"></textarea>
            <span class="text-[0.68rem] text-onkoz-text-muted text-right"><span id="bio-count">0</span>/200</span>
          </div>

          <!-- Avatar URL -->
          <div class="flex flex-col gap-1">
            <label class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🖼 URL Avatar</label>
            <input id="edit-avatar-url" type="url" placeholder="https://..."
                   class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2 text-sm outline-none focus:border-onkoz-accent transition-colors" />
            <span class="text-[0.68rem] text-onkoz-text-muted">ou choisis-en un :</span>
            <div id="avatar-presets" class="grid grid-cols-6 gap-1.5 mt-0.5"></div>
          </div>

        </div>

        ${me.role === 'temporary' ? `
        <div id="secure-account-section" class="flex flex-col gap-2 border-t border-onkoz-border pt-3 mt-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-amber-400">⏳ Compte temporaire</span>
            <span id="expiry-countdown" class="text-[0.68rem] text-amber-400/70"></span>
          </div>
          <p class="text-xs text-onkoz-text-muted leading-relaxed">
            Ce compte sera supprimé automatiquement. Définis un mot de passe pour le rendre permanent.
          </p>
          <input id="new-password" type="password" placeholder="Nouveau mot de passe (min 6 car.)" autocomplete="new-password"
                 class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2 text-sm outline-none focus:border-amber-400 transition-colors" />
          <input id="new-password-confirm" type="password" placeholder="Confirmer le mot de passe"
                 class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2 text-sm outline-none focus:border-amber-400 transition-colors" />
          <button id="btn-set-password"
                  class="bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm py-2 rounded-md transition-colors">
            🔒 Sécuriser mon compte
          </button>
        </div>` : ''}

        <button id="btn-save-profile"
                class="bg-onkoz-accent hover:bg-onkoz-accent-dk text-white font-semibold text-sm py-2 rounded-md transition-colors mt-1">
          ✅ Enregistrer
        </button>
      </div>`;

    document.body.appendChild(panel);

    // Charger les données actuelles
    const saved = cache[me.id] || {};
    const statusInput   = document.getElementById('edit-status');
    const bioInput      = document.getElementById('edit-bio');
    const avatarInput   = document.getElementById('edit-avatar-url');

    statusInput.value = saved.status  || '';
    bioInput.value    = saved.bio     || '';
    avatarInput.value = saved.avatar_url || '';

    document.getElementById('status-count').textContent = statusInput.value.length;
    document.getElementById('bio-count').textContent    = bioInput.value.length;

    // Aperçu en temps réel
    function updatePreview() {
      const avatarPrev = document.getElementById('edit-avatar-preview');
      const av = avatarInput.value.trim();
      if (av) {
        avatarPrev.style.backgroundImage = `url("${av}")`;
        avatarPrev.style.backgroundSize  = 'cover';
        avatarPrev.style.backgroundPosition = 'center';
        avatarPrev.textContent = '';
      } else {
        avatarPrev.style.backgroundImage = '';
        avatarPrev.textContent = me.username[0];
      }
    }

    statusInput.addEventListener('input', () => {
      document.getElementById('status-count').textContent = statusInput.value.length;
    });
    bioInput.addEventListener('input', () => {
      document.getElementById('bio-count').textContent = bioInput.value.length;
    });
    avatarInput.addEventListener('input', updatePreview);
    updatePreview();

    // ── Galerie d'avatars prédéfinis ──
    const presetGrid = document.getElementById('avatar-presets');
    if (presetGrid) {
      presetGrid.innerHTML = '';
      // Grille forcée en inline (les classes Tailwind grid-cols-* peuvent être purgées)
      presetGrid.style.display = 'grid';
      presetGrid.style.gridTemplateColumns = 'repeat(6, 1fr)';
      presetGrid.style.gap = '6px';
      AVATAR_PRESETS.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = p.name;
        btn.className =
          'rounded-md overflow-hidden border-2 border-transparent ' +
          'hover:border-onkoz-accent focus:border-onkoz-accent transition-colors bg-onkoz-deep';
        btn.style.aspectRatio = '1 / 1';
        btn.style.width = '100%';
        btn.style.padding = '0';
        btn.innerHTML =
          `<img src="${p.url}" alt="${p.name}" loading="lazy" ` +
          `style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:none" ` +
          `onerror="this.parentElement.style.display='none'">`;
        btn.addEventListener('click', () => {
          avatarInput.value = p.url;
          updatePreview();
          // Met en évidence la sélection courante
          presetGrid.querySelectorAll('button').forEach(b =>
            b.classList.remove('border-onkoz-accent'));
          btn.classList.add('border-onkoz-accent');
        });
        presetGrid.appendChild(btn);
      });
    }

    document.getElementById('close-profile-panel').addEventListener('click', () => panel.remove());
    document.getElementById('btn-save-profile').addEventListener('click', () => saveProfile(panel));

    // ── Section compte éphémère ───────────────────────────────────────────
    if (me.role === 'temporary') {
      // Countdown d'expiration
      const countdownEl = document.getElementById('expiry-countdown');
      function updateCountdown() {
        if (!countdownEl) return;
        const saved = JSON.parse(localStorage.getItem('onkoz_user') || '{}');
        const expiresAt = saved.expires_at;
        if (!expiresAt) return;
        const diff = expiresAt - Math.floor(Date.now() / 1000);
        if (diff <= 0) {
          countdownEl.textContent = 'Expiré';
          return;
        }
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        countdownEl.textContent = `Expire dans ${h}h${String(m).padStart(2,'0')}`;
      }
      updateCountdown();
      const countdownTimer = setInterval(updateCountdown, 30000);
      panel.addEventListener('remove', () => clearInterval(countdownTimer), { once: true });

      // Handler définir mot de passe
      document.getElementById('btn-set-password')?.addEventListener('click', async () => {
        const pwd  = document.getElementById('new-password').value;
        const pwd2 = document.getElementById('new-password-confirm').value;
        if (pwd.length < 6) {
          AudioSettings.showToast('❌ Mot de passe min 6 caractères');
          return;
        }
        if (pwd !== pwd2) {
          AudioSettings.showToast('❌ Les mots de passe ne correspondent pas');
          return;
        }
        const btn = document.getElementById('btn-set-password');
        btn.disabled = true;
        btn.textContent = '⏳ En cours…';
        try {
          const { token, user } = await API.setPassword(pwd);
          API.setToken(token);
          // Mettre à jour currentUser via Auth
          localStorage.setItem('onkoz_user', JSON.stringify(user));
          panel.remove();
          AudioSettings.showToast('✅ Compte sécurisé ! Tu es maintenant un membre permanent.');
          // Recharger pour mettre à jour le rôle dans toute l'UI
          setTimeout(() => location.reload(), 1500);
        } catch (e) {
          AudioSettings.showToast('❌ ' + e.message);
          btn.disabled = false;
          btn.textContent = '🔒 Sécuriser mon compte';
        }
      });
    }

    // Fermer au clic extérieur
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        const btnProfile = document.getElementById('btn-profile-settings');
        if (!panel.contains(e.target) && e.target !== btnProfile) {
          panel.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 100);
  }

  async function saveProfile(panel) {
    const me = Auth.getUser();
    const data = {
      status:     document.getElementById('edit-status').value.trim()     || null,
      bio:        document.getElementById('edit-bio').value.trim()        || null,
      avatar_url: document.getElementById('edit-avatar-url').value.trim() || null,
      banner_url: (cache[me.id]?.banner_url) || null,   // bannière conservée telle quelle
    };

    try {
      const updated = await API.updateProfile(data);
      cache[me.id] = { ...updated };

      // Émettre via socket pour mise à jour temps réel
      socket?.emit('profile:update', data);

      // Mise à jour immédiate de son propre avatar (sans attendre le socket)
      refreshAvatarsInDOM({ userId: me.id, avatar_url: data.avatar_url });
      applyFooterAvatar(data.avatar_url);

      panel.remove();
      AudioSettings.showToast('✅ Profil mis à jour');

      // Mettre à jour le footer
      refreshFooterStatus(data.status);
    } catch (e) {
      AudioSettings.showToast(`❌ ${e.message}`);
    }
  }

  // ── Popup profil (voir le profil d'un autre) ──────────────────────────────
  async function openProfilePopup(userId, username, anchorEl) {
    document.getElementById('profile-popup')?.remove();

    // Charger le profil
    let profile;
    try {
      profile = cache[userId] || await API.getUserProfile(userId);
      cache[userId] = profile;
    } catch {
      profile = { username, role: 'user' };
    }

    const popup = document.createElement('div');
    popup.id = 'profile-popup';
    popup.className = 'fixed z-[400] w-72 bg-onkoz-surface border border-onkoz-border rounded-xl shadow-dm overflow-hidden';

    // Positionner à côté de l'élément
    const rect = anchorEl?.getBoundingClientRect() || { top: 100, right: 100, bottom: 100, left: 100 };
    let top  = rect.top;
    let left = rect.right + 8;
    if (left + 290 > window.innerWidth) left = rect.left - 298;
    if (top  + 320 > window.innerHeight) top = window.innerHeight - 328;
    popup.style.top  = `${Math.max(8, top)}px`;
    popup.style.left = `${Math.max(8, left)}px`;

    const bannerStyle = profile.banner_url
      ? `background-image:url('${profile.banner_url}');background-size:cover;background-position:center`
      : 'background:linear-gradient(135deg,#5865f2 0%,#3b1f6b 100%)';

    const avatarHtml = profile.avatar_url
      ? `<img src="${profile.avatar_url}" class="w-16 h-16 rounded-full object-cover border-4 border-onkoz-surface" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div style="display:none" class="${UI.avatarClass(username)} w-16 h-16 rounded-full border-4 border-onkoz-surface flex items-center justify-center text-2xl font-bold text-white uppercase">${username[0]}</div>`
      : `<div class="${UI.avatarClass(username)} w-16 h-16 rounded-full border-4 border-onkoz-surface flex items-center justify-center text-2xl font-bold text-white uppercase">${username[0]}</div>`;

    const roleLabel = { admin: '👑 Admin', moderator: '🛡 Modérateur', user: '👤 Membre', temporary: '⏳ Temporaire' }[profile.role] || '👤 Membre';
    const memberSince = profile.created_at
      ? new Date(profile.created_at * 1000).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';
    const lastSeen = profile.last_seen
      ? new Date(profile.last_seen * 1000).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';

    popup.innerHTML = `
      <!-- Bannière -->
      <div class="h-20 relative" style="${bannerStyle}"></div>

      <!-- Avatar flottant -->
      <div class="px-4 pb-3">
        <div class="flex items-end justify-between -mt-8 mb-2">
          <div class="flex items-center">${avatarHtml}</div>
          ${Auth.getUser()?.id !== userId ? `
          <button id="popup-dm-btn" class="flex items-center gap-1.5 px-3 py-1.5 bg-onkoz-accent hover:bg-onkoz-accent-dk text-white text-xs font-semibold rounded-md transition-colors">
            💬 Message
          </button>` : ''}
        </div>

        <!-- Nom + rôle -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-lg text-onkoz-text">${UI.escapeHtml(username)}</span>
          <span class="text-[0.72rem] font-semibold text-onkoz-text-muted">${roleLabel}</span>
        </div>

        <!-- Statut -->
        ${profile.status ? `<p class="text-sm text-onkoz-accent-lt mt-0.5">💬 ${UI.escapeHtml(profile.status)}</p>` : ''}

        <!-- Séparateur -->
        <div class="border-t border-onkoz-border my-3"></div>

        <!-- Bio -->
        ${profile.bio ? `
        <div class="mb-3">
          <p class="text-[0.7rem] font-bold uppercase tracking-wider text-onkoz-text-muted mb-1">À PROPOS</p>
          <p class="text-sm text-onkoz-text leading-relaxed">${UI.escapeHtml(profile.bio)}</p>
        </div>` : ''}

        <!-- Infos -->
        <div class="flex flex-col gap-1">
          <div class="flex justify-between text-[0.72rem]">
            <span class="text-onkoz-text-muted">Membre depuis</span>
            <span class="text-onkoz-text">${memberSince}</span>
          </div>
          <div class="flex justify-between text-[0.72rem]">
            <span class="text-onkoz-text-muted">Dernière activité</span>
            <span class="text-onkoz-text">${lastSeen}</span>
          </div>
        </div>
      </div>`;

    document.body.appendChild(popup);

    // Bouton DM
    document.getElementById('popup-dm-btn')?.addEventListener('click', () => {
      popup.remove();
      Chat.openDM(userId, username);
    });

    // Fermer au clic extérieur
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 50);
  }

  // ── Mettre à jour les avatars dans le DOM ─────────────────────────────────
  function refreshAvatarsInDOM({ userId, avatar_url }) {
    document.querySelectorAll(`[data-user-id="${userId}"] .user-avatar`).forEach(el => {
      if (avatar_url) {
        el.style.backgroundImage = `url("${avatar_url}")`;
        el.style.backgroundSize  = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = '';
      }
    });
  }

  // ── Mettre à jour les statuts dans le DOM ─────────────────────────────────
  function refreshStatusInDOM({ userId, status }) {
    document.querySelectorAll(`[data-user-id="${userId}"] .user-status`).forEach(el => {
      el.textContent = status || '';
      el.classList.toggle('hidden', !status);
    });
  }

  function refreshFooterStatus(status) {
    const el = document.getElementById('footer-status');
    if (!el) return;
    el.textContent = status || '';
    el.classList.toggle('hidden', !status);
  }

  // Applique l'avatar personnalisé sur la pastille du footer (bas gauche)
  function applyFooterAvatar(avatar_url) {
    const av = document.getElementById('footer-avatar');
    if (!av) return;
    if (avatar_url) {
      av.style.backgroundImage    = `url("${avatar_url}")`;
      av.style.backgroundSize     = 'cover';
      av.style.backgroundPosition = 'center';
      av.textContent = '';
    } else {
      av.style.backgroundImage = '';
      const me = Auth.getUser();
      av.textContent = (me?.username?.[0] || '?').toUpperCase();
    }
  }

  // ── Précharger les profils depuis la liste utilisateurs ───────────────────
  function preloadProfiles(users) {
    users.forEach(u => {
      cache[u.id] = u;
    });
    // Appliquer son propre avatar au footer (le /me ne renvoie pas avatar_url)
    const me = Auth.getUser();
    if (me && cache[me.id]) applyFooterAvatar(cache[me.id].avatar_url);
  }

  return { init, openEditPanel, openProfilePopup, preloadProfiles };
})();
