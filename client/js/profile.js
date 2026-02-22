/* ── Profile Module ──────────────────────────────────────────────────────────
   - Panneau d'édition de son propre profil (bio, statut, avatar, bannière)
   - Popup de consultation du profil d'un autre utilisateur
   - Mises à jour en temps réel via socket
   ─────────────────────────────────────────────────────────────────────────── */
const Profile = (() => {

  // Cache local des profils { userId: { bio, status, avatar_url, banner_url } }
  const cache = {};
  let socket  = null;

  function init(s) {
    socket = s;
    socket.on('profile:updated', data => {
      cache[data.userId] = data;
      refreshAvatarsInDOM(data);
      refreshStatusInDOM(data);
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

        <!-- Aperçu bannière + avatar -->
        <div class="relative rounded-lg overflow-hidden h-20 bg-onkoz-deep border border-onkoz-border">
          <div id="edit-banner-preview" class="absolute inset-0 bg-gradient-to-br from-onkoz-accent/30 to-onkoz-deep bg-cover bg-center"></div>
          <div class="absolute bottom-0 left-4 translate-y-1/2">
            <div id="edit-avatar-preview" class="w-12 h-12 rounded-full border-4 border-onkoz-surface flex items-center justify-center font-bold text-lg text-white uppercase bg-onkoz-accent overflow-hidden">
              ${me.username[0]}
            </div>
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
          </div>

          <!-- Bannière URL -->
          <div class="flex flex-col gap-1">
            <label class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🏙 URL Bannière</label>
            <input id="edit-banner-url" type="url" placeholder="https://..."
                   class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2 text-sm outline-none focus:border-onkoz-accent transition-colors" />
          </div>

        </div>

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
    const bannerInput   = document.getElementById('edit-banner-url');

    statusInput.value = saved.status  || '';
    bioInput.value    = saved.bio     || '';
    avatarInput.value = saved.avatar_url || '';
    bannerInput.value = saved.banner_url || '';

    document.getElementById('status-count').textContent = statusInput.value.length;
    document.getElementById('bio-count').textContent    = bioInput.value.length;

    // Aperçu en temps réel
    function updatePreview() {
      const avatarPrev = document.getElementById('edit-avatar-preview');
      const bannerPrev = document.getElementById('edit-banner-preview');
      const av = avatarInput.value.trim();
      const bn = bannerInput.value.trim();
      if (av) {
        avatarPrev.style.backgroundImage = `url(${av})`;
        avatarPrev.style.backgroundSize  = 'cover';
        avatarPrev.style.backgroundPosition = 'center';
        avatarPrev.textContent = '';
      } else {
        avatarPrev.style.backgroundImage = '';
        avatarPrev.textContent = me.username[0];
      }
      if (bn) {
        bannerPrev.style.backgroundImage = `url(${bn})`;
      } else {
        bannerPrev.style.backgroundImage = '';
      }
    }

    statusInput.addEventListener('input', () => {
      document.getElementById('status-count').textContent = statusInput.value.length;
    });
    bioInput.addEventListener('input', () => {
      document.getElementById('bio-count').textContent = bioInput.value.length;
    });
    avatarInput.addEventListener('input', updatePreview);
    bannerInput.addEventListener('input', updatePreview);
    updatePreview();

    document.getElementById('close-profile-panel').addEventListener('click', () => panel.remove());
    document.getElementById('btn-save-profile').addEventListener('click', () => saveProfile(panel));

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
    const data = {
      status:     document.getElementById('edit-status').value.trim()     || null,
      bio:        document.getElementById('edit-bio').value.trim()        || null,
      avatar_url: document.getElementById('edit-avatar-url').value.trim() || null,
      banner_url: document.getElementById('edit-banner-url').value.trim() || null,
    };

    try {
      const updated = await API.updateProfile(data);
      const me = Auth.getUser();
      cache[me.id] = { ...updated };

      // Émettre via socket pour mise à jour temps réel
      socket?.emit('profile:update', data);

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
      ? `background-image:url(${profile.banner_url});background-size:cover;background-position:center`
      : 'background:linear-gradient(135deg,#5865f2 0%,#3b1f6b 100%)';

    const avatarHtml = profile.avatar_url
      ? `<img src="${profile.avatar_url}" class="w-16 h-16 rounded-full object-cover border-4 border-onkoz-surface" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div style="display:none" class="${UI.avatarClass(username)} w-16 h-16 rounded-full border-4 border-onkoz-surface flex items-center justify-center text-2xl font-bold text-white uppercase">${username[0]}</div>`
      : `<div class="${UI.avatarClass(username)} w-16 h-16 rounded-full border-4 border-onkoz-surface flex items-center justify-center text-2xl font-bold text-white uppercase">${username[0]}</div>`;

    const roleLabel = { admin: '👑 Admin', moderator: '🛡 Modérateur', user: '👤 Membre' }[profile.role] || '👤 Membre';
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
          <span class="font-bold text-lg text-onkoz-text">${username}</span>
          <span class="text-[0.72rem] font-semibold text-onkoz-text-muted">${roleLabel}</span>
        </div>

        <!-- Statut -->
        ${profile.status ? `<p class="text-sm text-onkoz-accent-lt mt-0.5">💬 ${profile.status}</p>` : ''}

        <!-- Séparateur -->
        <div class="border-t border-onkoz-border my-3"></div>

        <!-- Bio -->
        ${profile.bio ? `
        <div class="mb-3">
          <p class="text-[0.7rem] font-bold uppercase tracking-wider text-onkoz-text-muted mb-1">À PROPOS</p>
          <p class="text-sm text-onkoz-text leading-relaxed">${profile.bio}</p>
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
        el.style.backgroundImage = `url(${avatar_url})`;
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

  // ── Précharger les profils depuis la liste utilisateurs ───────────────────
  function preloadProfiles(users) {
    users.forEach(u => {
      cache[u.id] = u;
    });
  }

  return { init, openEditPanel, openProfilePopup, preloadProfiles };
})();
