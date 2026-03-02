/* ── Chat Module ─────────────────────────────────────────────────────────── */
const Chat = (() => {
  let socket = null;
  let currentTextChannel = null;
  let dmPartnerId   = null;
  let dmPartnerName = null;
  let pendingImageFile = null;

  // Toast local (indépendant d'AudioSettings)
  function showToast(msg) {
    if (typeof AudioSettings !== 'undefined' && AudioSettings.showToast) {
      AudioSettings.showToast(msg);
      return;
    }
    // Fallback minimal
    let t = document.getElementById('_chat-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_chat-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #2a2a40;color:#e8e8f0;padding:10px 18px;border-radius:10px;font-size:13px;z-index:999;opacity:0;transition:opacity .3s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
  }

  // ── Salon texte ────────────────────────────────────────────────────────────
  async function joinTextChannel(channelId, channelName) {
    if (currentTextChannel) socket.emit('chat:leave', currentTextChannel);
    currentTextChannel = channelId;
    socket.emit('chat:join', channelId);

    const area = document.getElementById('content-area');
    area.innerHTML = '<p class="text-center text-onkoz-text-muted text-sm py-4">Chargement...</p>';

    const messages = await API.getMessages(channelId);
    area.innerHTML = '';
    messages.forEach(msg => appendMessage(msg, area, false));
    area.scrollTop = area.scrollHeight;

    document.getElementById('message-input-area').style.display = 'block';
    document.getElementById('message-input').focus();
    closePinnedPanel();
    loadPinned(channelId);
  }

  function appendMessage(msg, area, scroll = true) {
    const isMod = Auth.isMod() || Auth.isAdmin();
    const me    = Auth.getUser();

    const div = document.createElement('div');
    div.dataset.msgId = msg.id;
    div.className = `group flex gap-3 px-2 py-1 rounded-md hover:bg-onkoz-hover/50 transition-colors relative${msg.pinned ? ' border-l-2 border-onkoz-accent bg-onkoz-accent/5' : ''}`;
    if (msg.pinned) div.dataset.pinned = '1';

    const av = UI.makeAvatar(msg.username);

    const body = document.createElement('div');
    body.className = 'flex-1 min-w-0';

    const header = document.createElement('div');
    header.className = 'flex items-baseline gap-2 mb-0.5';

    const author = document.createElement('span');
    author.className = `msg-author font-bold text-[0.9rem] ${msg.role}`;
    author.textContent = msg.username;

    const time = document.createElement('span');
    time.className = 'text-[0.72rem] text-onkoz-text-muted';
    time.textContent = UI.formatTime(msg.created_at);

    header.append(author, time);

    // Badge épinglé
    if (msg.pinned) {
      const pinBadge = document.createElement('span');
      pinBadge.className = 'text-[0.68rem] text-onkoz-accent font-semibold flex items-center gap-0.5';
      pinBadge.innerHTML = '📌 épinglé';
      header.appendChild(pinBadge);
    }

    const content = document.createElement('div');
    content.className = 'text-[0.9rem] text-onkoz-text leading-relaxed break-words';

    // Parser le contenu : texte normal + image inline
    const IMG_RE = /\[image:(\/uploads\/[^\]]+)\]/g;
    const rawContent = msg.content || '';
    const textPart   = rawContent.replace(IMG_RE, '').trim();
    const imgMatches = [...rawContent.matchAll(IMG_RE)];

    if (textPart) {
      const p = document.createElement('p');
      // Rendre les URLs cliquables
      p.innerHTML = linkify(textPart);
      content.appendChild(p);
    }

    imgMatches.forEach(([, url]) => {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'mt-1.5';

      const img = document.createElement('img');
      img.src    = url;
      img.alt    = 'Image partagée';
      img.className = 'max-w-xs max-h-64 rounded-lg border border-onkoz-border object-cover cursor-zoom-in hover:opacity-90 transition-opacity';
      img.loading   = 'lazy';
      img.addEventListener('click', () => openLightbox(url));
      img.addEventListener('error', () => {
        imgWrap.innerHTML = `<span class="text-xs text-onkoz-text-muted italic">⚠ Image indisponible</span>`;
      });

      imgWrap.appendChild(img);
      content.appendChild(imgWrap);
    });

    // Prévisualisations de liens (chargées async)
    const previewContainer = document.createElement('div');
    previewContainer.className = 'mt-1 flex flex-col gap-2';
    content.appendChild(previewContainer);

    // Extraire les URLs du texte pour les prévisualiser
    if (textPart) {
      const urls = extractUrls(textPart);
      if (urls.length > 0) {
        // Prévisualiser max 3 URLs par message
        urls.slice(0, 3).forEach(url => fetchAndRenderPreview(url, previewContainer, area, scroll));
      }
    }

    // Zone réactions
    const reactionsEl = document.createElement('div');
    reactionsEl.id = `reactions-${msg.id}`;
    reactionsEl.className = 'flex flex-wrap gap-1 mt-1';
    renderReactions(reactionsEl, msg.reactions || [], msg.id, me);

    body.append(header, content, reactionsEl);
    div.append(av, body);

    // Barre d'actions au survol
    const actions = document.createElement('div');
    actions.className = 'absolute right-2 top-1 hidden group-hover:flex items-center gap-1 bg-onkoz-surface border border-onkoz-border rounded-md shadow-sm px-1 py-0.5';

    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'w-7 h-7 flex items-center justify-center rounded hover:bg-onkoz-hover transition-colors text-onkoz-text-muted hover:text-onkoz-text text-base';
    emojiBtn.textContent = '😊';
    emojiBtn.title = 'Ajouter une réaction';
    emojiBtn.addEventListener('click', e => {
      e.stopPropagation();
      EmojiPicker.open(emojiBtn, emoji => {
        socket.emit('reaction:toggle', { messageId: msg.id, emoji, channelId: currentTextChannel });
      });
    });
    actions.appendChild(emojiBtn);

    if (isMod) {
      // Bouton épingler / désépingler
      const pinBtn = document.createElement('button');
      pinBtn.className = `w-7 h-7 flex items-center justify-center rounded transition-colors text-sm ${msg.pinned ? 'text-onkoz-accent hover:bg-onkoz-danger/20 hover:text-onkoz-danger' : 'text-onkoz-text-muted hover:bg-onkoz-accent/20 hover:text-onkoz-accent'}`;
      pinBtn.textContent = '📌';
      pinBtn.title = msg.pinned ? 'Désépingler' : 'Épingler';
      pinBtn.addEventListener('click', () => {
        if (msg.pinned) {
          socket.emit('chat:unpin', { messageId: msg.id, channelId: currentTextChannel });
        } else {
          socket.emit('chat:pin', { messageId: msg.id, channelId: currentTextChannel });
        }
      });
      actions.appendChild(pinBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'w-7 h-7 flex items-center justify-center rounded hover:bg-onkoz-danger/20 transition-colors text-onkoz-text-muted hover:text-onkoz-danger text-sm';
      delBtn.textContent = '🗑';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('click', () => socket.emit('chat:delete', { messageId: msg.id, channelId: currentTextChannel }));
      actions.appendChild(delBtn);
    }

    div.appendChild(actions);
    area.appendChild(div);
    if (scroll) area.scrollTop = area.scrollHeight;
  }

  function renderReactions(container, reactions, msgId, me) {
    container.innerHTML = '';
    reactions.forEach(({ emoji, count, users }) => {
      const iReacted = users.some(u => u.userId === me?.id);
      const btn = document.createElement('button');
      btn.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-sm transition-colors ${
        iReacted ? 'bg-onkoz-accent/20 border-onkoz-accent text-onkoz-accent-lt' : 'bg-onkoz-hover border-onkoz-border text-onkoz-text hover:border-onkoz-accent'
      }`;
      btn.innerHTML = `<span>${emoji}</span><span class="text-[0.72rem] font-bold">${count}</span>`;
      btn.title = users.map(u => u.username).join(', ');
      btn.addEventListener('click', () => {
        socket.emit('reaction:toggle', { messageId: msgId, emoji, channelId: currentTextChannel });
      });
      container.appendChild(btn);
    });
  }

  function onReactionUpdate({ messageId, reactions }) {
    const container = document.getElementById(`reactions-${messageId}`);
    if (!container) return;
    renderReactions(container, reactions, messageId, Auth.getUser());
  }

  function onMessage(msg) {
    if (msg.channel_id != currentTextChannel) return;
    appendMessage(msg, document.getElementById('content-area'), true);
  }

  function onDeleted({ messageId }) {
    document.querySelector(`[data-msg-id="${messageId}"]`)?.remove();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRÉVISUALISATION DE LIENS
  // ═══════════════════════════════════════════════════════════════════════════

  const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

  function extractUrls(text) {
    return [...new Set((text.match(URL_RE) || []))];
  }

  // Rend les URLs cliquables dans un texte (échappe le HTML)
  function linkify(text) {
    const escaped = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return escaped.replace(URL_RE, url =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer"
          class="text-onkoz-accent hover:underline break-all">${url}</a>`
    );
  }

  // Cache preview côté client
  const previewCache = new Map();

  async function fetchAndRenderPreview(url, container, scrollArea, doScroll) {
    // Pas de preview pour les uploads locaux
    if (url.startsWith('/uploads/')) return;

    try {
      let data;
      if (previewCache.has(url)) {
        data = previewCache.get(url);
      } else {
        const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`, {
          headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
        });
        if (!res.ok || res.status === 204) return;
        data = await res.json();
        previewCache.set(url, data);
      }

      if (!data || (!data.title && !data.image)) return;

      const card = renderPreviewCard(data);
      container.appendChild(card);

      // Rescroller si on était en bas
      if (doScroll && scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;

    } catch { /* silencieux */ }
  }

  function renderPreviewCard(data) {
    const isYoutube = data.type === 'video' && data.videoId;
    const isImage   = data.type === 'image' && !data.title;

    const card = document.createElement('div');
    card.className = 'max-w-sm rounded-lg overflow-hidden border border-onkoz-border bg-onkoz-surface hover:border-onkoz-border-lt transition-colors cursor-pointer';
    card.style.cssText = 'border-left: 3px solid var(--onkoz-accent, #7c5cbf)';

    // Image directe
    if (isImage) {
      const img = document.createElement('img');
      img.src = data.image;
      img.className = 'max-w-xs max-h-64 rounded-lg object-cover cursor-zoom-in hover:opacity-90 transition-opacity';
      img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(data.image));
      return img;
    }

    // Vignette YouTube avec bouton play
    if (isYoutube && data.image) {
      const thumb = document.createElement('div');
      thumb.className = 'relative';
      thumb.innerHTML = `
        <img src="${data.image}" alt="" class="w-full object-cover max-h-40" loading="lazy"
             onerror="this.parentElement.style.display='none'" />
        <div class="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/30 transition-colors">
          <div class="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
            <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>`;
      thumb.addEventListener('click', () => window.open(data.url, '_blank', 'noopener'));
      card.appendChild(thumb);
    } else if (data.image) {
      // Image OG normale
      const img = document.createElement('img');
      img.src = data.image;
      img.className = 'w-full object-cover max-h-32';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    // Texte
    const info = document.createElement('div');
    info.className = 'px-3 py-2';

    // Site name + favicon
    if (data.siteName) {
      const site = document.createElement('div');
      site.className = 'flex items-center gap-1.5 mb-1';
      if (data.favicon) {
        const fav = document.createElement('img');
        fav.src = data.favicon;
        fav.className = 'w-3.5 h-3.5 rounded-sm object-contain';
        fav.onerror = () => fav.remove();
        site.appendChild(fav);
      }
      const siteTxt = document.createElement('span');
      siteTxt.className = 'text-[0.68rem] font-semibold text-onkoz-text-muted uppercase tracking-wide';
      siteTxt.textContent = data.siteName;
      site.appendChild(siteTxt);
      info.appendChild(site);
    }

    if (data.title) {
      const title = document.createElement('p');
      title.className = 'text-[0.85rem] font-semibold text-onkoz-accent hover:underline line-clamp-2 leading-snug';
      title.textContent = data.title;
      info.appendChild(title);
    }

    if (data.description) {
      const desc = document.createElement('p');
      desc.className = 'text-[0.75rem] text-onkoz-text-muted mt-0.5 line-clamp-2 leading-relaxed';
      desc.textContent = data.description;
      info.appendChild(desc);
    }

    card.appendChild(info);
    card.addEventListener('click', (e) => {
      if (!e.target.closest('img[class*="zoom"]')) window.open(data.url, '_blank', 'noopener');
    });

    return card;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PARTAGE D'IMAGES
  // ═══════════════════════════════════════════════════════════════════════════

  function initImageUpload() {
    const fileInput    = document.getElementById('file-input');
    const previewBar   = document.getElementById('img-preview-bar');
    const previewThumb = document.getElementById('img-preview-thumb');
    const previewName  = document.getElementById('img-preview-name');
    const previewSize  = document.getElementById('img-preview-size');
    const removeBtn    = document.getElementById('img-preview-remove');
    const inputWrap    = document.getElementById('msg-input-wrap');
    const msgInput     = document.getElementById('message-input');

    if (!fileInput) return;

    // ── Sélection via bouton 📎 ──
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) setImagePreview(fileInput.files[0]);
      fileInput.value = '';
    });

    // ── Retirer l'image ──
    removeBtn.addEventListener('click', () => clearImagePreview());

    // ── Drag & Drop sur la zone de saisie ──
    const dropZone = document.getElementById('message-input-area');
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputWrap.classList.add('border-onkoz-accent');
    });
    dropZone.addEventListener('dragleave', () => {
      inputWrap.classList.remove('border-onkoz-accent');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      inputWrap.classList.remove('border-onkoz-accent');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) setImagePreview(file);
    });

    // ── Drag & Drop sur la zone de messages ──
    const contentArea = document.getElementById('content-area');
    contentArea?.addEventListener('dragover', (e) => e.preventDefault());
    contentArea?.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        setImagePreview(file);
        msgInput?.focus();
      }
    });

    // ── Coller depuis le presse-papier (Ctrl+V) ──
    document.addEventListener('paste', (e) => {
      // Seulement si on est dans un canal texte actif
      if (!currentTextChannel) return;
      const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        setImagePreview(file);
        e.preventDefault();
      }
    });

    function setImagePreview(file) {
      // Validation type
      const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!ALLOWED.includes(file.type)) {
        showToast('❌ Format non supporté. JPG, PNG, GIF, WEBP uniquement.');
        return;
      }
      // Validation taille
      if (file.size > 10 * 1024 * 1024) {
        showToast('❌ Image trop lourde (max 10 Mo).');
        return;
      }

      pendingImageFile = file;

      const reader = new FileReader();
      reader.onload = (e) => {
        previewThumb.src = e.target.result;
        previewName.textContent = file.name || 'image.png';
        previewSize.textContent = formatBytes(file.size);
        previewBar.classList.remove('hidden');
        previewBar.classList.add('flex');
      };
      reader.readAsDataURL(file);
    }

    function clearImagePreview() {
      pendingImageFile = null;
      previewThumb.src = '';
      previewBar.classList.add('hidden');
      previewBar.classList.remove('flex');
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024)       return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  }

  // ── Upload et envoi ────────────────────────────────────────────────────────
  async function sendMessage() {
    const input   = document.getElementById('message-input');
    const content = input.value.trim();

    // Rien à envoyer
    if (!content && !pendingImageFile) return;

    // Si image en attente → uploader d'abord
    if (pendingImageFile) {
      await uploadAndSend(content);
    } else {
      socket.emit('chat:message', { channelId: currentTextChannel, content });
    }

    input.value = '';
    clearImagePreview();
  }

  async function uploadAndSend(caption) {
    const sendBtn = document.getElementById('send-btn');

    // Indicateur de chargement
    sendBtn.textContent = '⏳';
    sendBtn.disabled = true;

    try {
      const formData = new FormData();
      formData.append('image', pendingImageFile);

      const res  = await fetch('/api/upload', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
        body:    formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erreur upload');
      }

      const { url } = await res.json();

      // Envoyer le message avec l'URL de l'image comme contenu spécial
      const content = caption
        ? `${caption}\n[image:${url}]`
        : `[image:${url}]`;

      socket.emit('chat:message', { channelId: currentTextChannel, content });

    } catch (err) {
      showToast(`❌ ${err.message}`);
    } finally {
      sendBtn.textContent = '↑';
      sendBtn.disabled = false;
    }
  }

  // ── Lightbox ───────────────────────────────────────────────────────────────
  function initLightbox() {
    const lb    = document.getElementById('lightbox');
    const close = document.getElementById('lightbox-close');
    if (!lb) return;
    lb.addEventListener('click',  (e) => { if (e.target === lb) closeLightbox(); });
    close.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  }

  function openLightbox(src) {
    const lb  = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const dl  = document.getElementById('lightbox-dl');
    if (!lb) return;
    img.src = src;
    dl.href = src;
    lb.classList.remove('hidden');
    lb.classList.add('flex');
  }

  function closeLightbox() {
    const lb = document.getElementById('lightbox');
    lb?.classList.add('hidden');
    lb?.classList.remove('flex');
  }

  function init(s) {
    socket = s;
    initImageUpload();
    initLightbox();
    initPinnedPanel();
  }

  // ── DM ────────────────────────────────────────────────────────────────────
  async function openDM(partnerId, partnerName) {
    dmPartnerId = partnerId;
    dmPartnerName = partnerName;

    document.getElementById('dm-partner-name').textContent = partnerName;
    const panel = document.getElementById('dm-panel');
    panel.classList.remove('hidden');
    panel.classList.add('flex');

    const msgs = await API.getDMHistory(partnerId);
    const area = document.getElementById('dm-messages');
    area.innerHTML = '';
    const me = Auth.getUser();
    msgs.forEach(m => appendDMMessage(m, me.id));
    area.scrollTop = area.scrollHeight;
    document.getElementById('dm-input').focus();
  }

  function appendDMMessage(msg, myId) {
    const area = document.getElementById('dm-messages');
    const mine = msg.from_id === myId;

    const div = document.createElement('div');
    div.className = `flex flex-col max-w-[85%] ${mine ? 'self-end items-end' : 'self-start items-start'}`;

    const meta = document.createElement('div');
    meta.className = 'text-[0.7rem] text-onkoz-text-muted mb-0.5 px-1';
    meta.textContent = `${mine ? 'Moi' : msg.from_username} · ${UI.formatTime(msg.created_at)}`;

    const bubble = document.createElement('div');
    bubble.className = `px-3 py-1.5 rounded-lg text-[0.88rem] leading-relaxed ${mine ? 'bg-onkoz-accent text-white' : 'bg-onkoz-hover text-onkoz-text'}`;
    bubble.textContent = msg.content;

    div.append(meta, bubble);
    area.appendChild(div);
  }

  function onDMMessage(msg) {
    const me = Auth.getUser();
    const panel = document.getElementById('dm-panel');
    if (!panel.classList.contains('hidden') && (msg.from_id === dmPartnerId || msg.to_id === dmPartnerId)) {
      appendDMMessage(msg, me.id);
      const area = document.getElementById('dm-messages');
      area.scrollTop = area.scrollHeight;
    } else if (msg.from_id !== me.id) {
      App.showUnreadBadge(msg.from_id);
    }
  }

  function sendDM() {
    const input = document.getElementById('dm-input');
    const content = input.value.trim();
    if (!content || !dmPartnerId) return;
    socket.emit('dm:send', { toId: dmPartnerId, content });
    input.value = '';
  }

  function closeDM() {
    const panel = document.getElementById('dm-panel');
    panel.classList.add('hidden');
    panel.classList.remove('flex');
    dmPartnerId = dmPartnerName = null;
  }

  // ── Texte éphémère ────────────────────────────────────────────────────────
  function setupEphemeralText(socket, eid) {
    document.getElementById('message-input-area').style.display = 'block';
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    const doSend = () => {
      const c = input.value.trim();
      if (!c) return;
      socket.emit('ephemeral:message', { eid, content: c });
      input.value = '';
    };

    sendBtn.onclick = doSend;
    input.onkeydown = e => { if (e.key === 'Enter') doSend(); };

    socket.on('ephemeral:message', ({ eid: msgEid, username, role, content }) => {
      if (msgEid !== eid) return;
      const area = document.getElementById('content-area');
      let chat = document.getElementById('eph-chat');
      if (!chat) {
        chat = document.createElement('div');
        chat.id = 'eph-chat';
        chat.className = 'mt-4 w-full max-w-lg max-h-48 overflow-y-auto bg-onkoz-surface rounded-xl p-3 flex flex-col gap-1';
        area.appendChild(chat);
      }
      const msg = document.createElement('div');
      msg.innerHTML = `<span class="msg-author font-bold text-sm ${role}">${username}</span> <span class="text-sm text-onkoz-text">${content}</span>`;
      chat.appendChild(msg);
      chat.scrollTop = chat.scrollHeight;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MESSAGES ÉPINGLÉS
  // ═══════════════════════════════════════════════════════════════════════════

  let pinnedMessages = [];   // cache local des épinglés du canal courant

  // ── Charger les épinglés du canal et mettre à jour le bouton header ────────
  async function loadPinned(channelId) {
    try {
      const msgs = await fetch(`/api/channels/${channelId}/pinned`, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
      }).then(r => r.json());
      pinnedMessages = Array.isArray(msgs) ? msgs : [];
    } catch { pinnedMessages = []; }
    updatePinButton();
  }

  function updatePinButton() {
    const btn   = document.getElementById('btn-pinned');
    const count = document.getElementById('pin-count');
    if (!btn) return;
    if (pinnedMessages.length > 0) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
      count.textContent = pinnedMessages.length;
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('flex');
      closePinnedPanel();
    }
  }

  // ── Ouvrir / Fermer le panneau ─────────────────────────────────────────────
  function togglePinnedPanel() {
    const panel = document.getElementById('pinned-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
      openPinnedPanel();
    } else {
      closePinnedPanel();
    }
  }

  function openPinnedPanel() {
    const panel = document.getElementById('pinned-panel');
    const list  = document.getElementById('pinned-list');
    const pcount= document.getElementById('pinned-panel-count');
    if (!panel) return;

    // Vider et remplir
    list.innerHTML = '';
    pcount.textContent = `(${pinnedMessages.length})`;

    if (pinnedMessages.length === 0) {
      list.innerHTML = '<p class="text-xs text-onkoz-text-muted text-center py-4">Aucun message épinglé</p>';
    } else {
      pinnedMessages.forEach(msg => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-3 px-4 py-2.5 hover:bg-onkoz-hover/40 transition-colors cursor-pointer';
        row.title = 'Aller au message';
        row.innerHTML = `
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-xs font-bold text-onkoz-text">${UI.escapeHtml ? UI.escapeHtml(msg.username) : msg.username}</span>
              <span class="text-[0.68rem] text-onkoz-text-muted">${UI.formatTime(msg.created_at)}</span>
            </div>
            <p class="text-xs text-onkoz-text-muted truncate">${(msg.content || '').replace(/\[image:[^\]]+\]/g, '🖼 Image')}</p>
          </div>
          ${(Auth.isMod() || Auth.isAdmin()) ? `
          <button class="unpin-btn shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-onkoz-danger/20 text-onkoz-text-muted hover:text-onkoz-danger transition-colors text-xs" data-id="${msg.id}" title="Désépingler">✕</button>
          ` : ''}
        `;

        // Clic sur la ligne → scroller vers le message
        row.addEventListener('click', (e) => {
          if (e.target.closest('.unpin-btn')) return;
          const msgEl = document.querySelector(`[data-msg-id="${msg.id}"]`);
          if (msgEl) {
            msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight temporaire
            msgEl.classList.add('ring-2', 'ring-onkoz-accent', 'ring-offset-1');
            setTimeout(() => msgEl.classList.remove('ring-2', 'ring-onkoz-accent', 'ring-offset-1'), 2000);
          }
          closePinnedPanel();
        });

        // Bouton désépingler dans le panneau
        row.querySelector('.unpin-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('chat:unpin', { messageId: msg.id, channelId: currentTextChannel });
        });

        list.appendChild(row);
      });
    }

    panel.classList.remove('hidden');
    panel.classList.add('flex');
  }

  function closePinnedPanel() {
    const panel = document.getElementById('pinned-panel');
    panel?.classList.add('hidden');
    panel?.classList.remove('flex');
  }

  // ── Initialiser les listeners du panneau ───────────────────────────────────
  function initPinnedPanel() {
    document.getElementById('btn-pinned')?.addEventListener('click', togglePinnedPanel);
    document.getElementById('pinned-panel-close')?.addEventListener('click', closePinnedPanel);
  }

  // ── Socket events épinglage ────────────────────────────────────────────────
  function onPinned({ message, channelId }) {
    if (channelId != currentTextChannel) return;
    // Mettre à jour le message dans le DOM
    const el = document.querySelector(`[data-msg-id="${message.id}"]`);
    if (el) {
      el.classList.add('border-l-2', 'border-onkoz-accent', 'bg-onkoz-accent/5');
      el.dataset.pinned = '1';
      // Ajouter badge si absent
      if (!el.querySelector('.pin-badge')) {
        const header = el.querySelector('.flex.items-baseline');
        if (header) {
          const badge = document.createElement('span');
          badge.className = 'pin-badge text-[0.68rem] text-onkoz-accent font-semibold';
          badge.textContent = '📌 épinglé';
          header.appendChild(badge);
        }
      }
      // Mettre à jour le bouton pin
      const pinBtn = el.querySelector('[title="Épingler"]');
      if (pinBtn) {
        pinBtn.title = 'Désépingler';
        pinBtn.className = pinBtn.className.replace('text-onkoz-text-muted hover:bg-onkoz-accent/20 hover:text-onkoz-accent', 'text-onkoz-accent hover:bg-onkoz-danger/20 hover:text-onkoz-danger');
      }
    }
    // Ajouter au cache local si absent
    if (!pinnedMessages.find(m => m.id === message.id)) {
      pinnedMessages.push(message);
    }
    updatePinButton();
    showToast('📌 Message épinglé');
  }

  function onUnpinned({ messageId, channelId }) {
    if (channelId != currentTextChannel) return;
    // Mettre à jour le DOM
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      el.classList.remove('border-l-2', 'border-onkoz-accent', 'bg-onkoz-accent/5');
      delete el.dataset.pinned;
      el.querySelector('.pin-badge')?.remove();
      const pinBtn = el.querySelector('[title="Désépingler"]');
      if (pinBtn) {
        pinBtn.title = 'Épingler';
        pinBtn.className = pinBtn.className.replace('text-onkoz-accent hover:bg-onkoz-danger/20 hover:text-onkoz-danger', 'text-onkoz-text-muted hover:bg-onkoz-accent/20 hover:text-onkoz-accent');
      }
    }
    // Retirer du cache
    pinnedMessages = pinnedMessages.filter(m => m.id !== messageId);
    updatePinButton();
    // Mettre à jour le panneau si ouvert
    const panel = document.getElementById('pinned-panel');
    if (panel && !panel.classList.contains('hidden')) openPinnedPanel();
    showToast('📌 Message désépinglé');
  }

  return { init, joinTextChannel, onMessage, onDeleted, onReactionUpdate, sendMessage, openDM, onDMMessage, sendDM, closeDM, setupEphemeralText, onPinned, onUnpinned };
})();
