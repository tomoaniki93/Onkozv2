/* ── App — Orchestrateur principal ───────────────────────────────────────── */
const App = (() => {
  let socket = null;
  let allUsers = [];
  let cats = [];           // { id, name, position, channels: [] }
  let uncategorized = [];  // channels sans catégorie
  let presence = {};       // { 'text:channelId': [{userId, username}], 'voice:channelId': [...] }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  async function launch() {
    const user = Auth.getUser();
    if (!user) return;

    document.getElementById('auth-screen').classList.add('hidden');
    const appEl = document.getElementById('app');
    appEl.classList.remove('hidden');
    appEl.classList.add('flex');

    UI.renderFooterUser(user);

    [{ categories: cats, uncategorized }, allUsers] = await Promise.all([
      API.getCategories(), API.getUsers(),
    ]);
    UI.setUsers(allUsers);
    Profile.preloadProfiles(allUsers);
    renderSidebar();
    connectSocket(user);
  }

  // ── Socket ────────────────────────────────────────────────────────────────
  function connectSocket(user) {
    socket = io({ auth: { token: API.getToken() } });
    Voice.init(socket);
    Chat.init(socket);
    Profile.init(socket);

    socket.on('online:list',       ids  => UI.setOnline(ids));
    socket.on('user:online',       ({ userId }) => UI.setUserOnline(userId));
    socket.on('user:offline',      ({ userId }) => UI.setUserOffline(userId));
    socket.on('chat:message',      msg  => Chat.onMessage(msg));
    socket.on('chat:deleted',      data => Chat.onDeleted(data));
    socket.on('reaction:update',   data => Chat.onReactionUpdate(data));
    socket.on('chat:pinned',       data => Chat.onPinned(data));
    socket.on('chat:unpinned',     data => Chat.onUnpinned(data));
    socket.on('dm:message',        msg  => Chat.onDMMessage(msg));
    socket.on('voice:peer:joined', data => Voice.onPeerJoined(data));
    socket.on('voice:peer:left',   data => Voice.onPeerLeft(data));
    socket.on('screen:stopped', ({ peerId, username }) => {
      document.getElementById(`screen-overlay-${peerId}`)?.remove();
      if (username) AudioSettings.showToast(`⏹️ ${username} a arrêté le partage`);
    });
    socket.on('screen:started', ({ username }) => {
      AudioSettings.showToast(`🖥️ ${username} partage son écran`);
    });
    socket.on('voice:peers',       peers => Voice.onExistingPeers(peers));
    socket.on('voice:forceMove', ({ toChannelId, by }) => {
      const ch = findChannelById(toChannelId);
      if (!ch) return;
      AudioSettings.showToast?.(`↔️ Déplacé vers ${ch.name} par ${by}`);
      selectChannel(ch);   // réutilise tout le flux join existant (leave auto)
    });
    socket.on('kicked', () => { alert('Vous avez été expulsé.'); API.clearToken(); location.reload(); });

    // Présence texte et vocal
    socket.on('text:viewers', ({ channelId, members }) => {
      presence[`text:${channelId}`] = members;
      updateChannelPresence(channelId, 'text', members);
    });
    socket.on('voice:members', ({ channelId, members }) => {
      presence[`voice:${channelId}`] = members;
      updateChannelPresence(channelId, 'voice', members);
    });

    // Éphémères
    socket.on('ephemeral:list', list => renderEphemeralSection(list));
    socket.on('ephemeral:created', ({ eid, voiceName, withText }) => {
      socket.emit('ephemeral:join', { eid });
      Voice.joinRoom(eid, 'ephemeral', `ephemeral:${eid}`, voiceName);
      setChannelHeader('✨', voiceName, '');
      showVoiceBar(voiceName);
      if (withText) Chat.setupEphemeralText(socket, eid);
    });
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('channel-list');
    list.innerHTML = '';

    const canManage = Auth.isAdmin() || Auth.isMod();

    // ── Bouton "Nouvelle catégorie" ──
    if (canManage) {
      const addCat = document.createElement('button');
      addCat.className = 'mx-3 mt-1 mb-2 flex items-center gap-1.5 text-[0.72rem] font-bold text-onkoz-text-muted hover:text-onkoz-text transition-colors';
      addCat.innerHTML = `<span class="text-base font-light leading-none">+</span> Nouvelle catégorie`;
      addCat.addEventListener('click', createCategory);
      list.appendChild(addCat);
    }

    // ── Catégories ──
    cats.forEach(cat => {
      list.appendChild(renderCategorySection(cat, canManage));
    });

    // ── Salons sans catégorie ──
    if (uncategorized.length > 0 || canManage) {
      list.appendChild(renderUncategorizedSection(canManage));
    }

    // ── Éphémères ──
    list.appendChild(renderEphemeralHeader());

    // Glisser-déposer pour réorganiser (admin/mod)
    enableSidebarDnD();
  }

  function renderCategorySection(cat, canManage) {
    const section = document.createElement('div');
    section.dataset.catId = cat.id;
    section.className = 'mb-1';

    // Header catégorie
    const header = document.createElement('div');
    header.className = 'flex items-center gap-1 px-2 py-1 group cursor-pointer select-none';

    const arrow = document.createElement('span');
    arrow.className = 'text-[0.6rem] text-onkoz-text-muted transition-transform';
    arrow.textContent = '▼';

    const name = document.createElement('span');
    name.className = 'flex-1 text-[0.72rem] font-bold tracking-wider uppercase text-onkoz-text-muted truncate hover:text-onkoz-text transition-colors';
    name.textContent = cat.name;

    header.append(arrow, name);

    if (canManage) {
      // Bouton ajouter salon dans catégorie
      const addBtn = document.createElement('button');
      addBtn.className = 'hidden group-hover:flex w-5 h-5 items-center justify-center rounded text-onkoz-text-muted hover:text-onkoz-text hover:bg-onkoz-hover transition-colors text-sm shrink-0';
      addBtn.textContent = '+';
      addBtn.title = 'Ajouter un salon';
      addBtn.addEventListener('click', e => { e.stopPropagation(); createChannelInCategory(cat.id); });

      // Bouton supprimer catégorie
      const delBtn = document.createElement('button');
      delBtn.className = 'hidden group-hover:flex w-5 h-5 items-center justify-center rounded text-onkoz-text-muted hover:text-onkoz-danger hover:bg-onkoz-danger/15 transition-colors text-xs shrink-0';
      delBtn.textContent = '✕';
      delBtn.title = 'Supprimer la catégorie';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteCategory(cat.id); });

      header.append(addBtn, delBtn);
    }

    // Canal list
    const channelList = document.createElement('ul');
    channelList.id = `cat-channels-${cat.id}`;
    channelList.className = 'flex flex-col';

    cat.channels.forEach(ch => channelList.appendChild(createChannelItem(ch)));

    // Toggle collapse
    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      arrow.style.transform = collapsed ? 'rotate(-90deg)' : '';
      channelList.classList.toggle('hidden', collapsed);
    });

    section.append(header, channelList);
    return section;
  }

  function renderUncategorizedSection(canManage) {
    const section = document.createElement('div');
    section.id = 'uncategorized-section';
    section.className = 'mb-1';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-1 px-2 py-1 group cursor-pointer select-none';

    const arrow = document.createElement('span');
    arrow.className = 'text-[0.6rem] text-onkoz-text-muted transition-transform';
    arrow.textContent = '▼';

    const name = document.createElement('span');
    name.className = 'flex-1 text-[0.72rem] font-bold tracking-wider uppercase text-onkoz-text-muted';
    name.textContent = 'Général';

    header.append(arrow, name);

    if (canManage) {
      const addBtn = document.createElement('button');
      addBtn.className = 'hidden group-hover:flex w-5 h-5 items-center justify-center rounded text-onkoz-text-muted hover:text-onkoz-text hover:bg-onkoz-hover transition-colors text-sm shrink-0';
      addBtn.textContent = '+';
      addBtn.title = 'Ajouter un salon';
      addBtn.addEventListener('click', e => { e.stopPropagation(); createChannelInCategory(null); });
      header.append(addBtn);
    }

    const channelList = document.createElement('ul');
    channelList.id = 'uncategorized-channels';
    channelList.className = 'flex flex-col';
    uncategorized.forEach(ch => channelList.appendChild(createChannelItem(ch)));

    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      arrow.style.transform = collapsed ? 'rotate(-90deg)' : '';
      channelList.classList.toggle('hidden', collapsed);
    });

    section.append(header, channelList);
    return section;
  }

  function renderEphemeralHeader() {
    const section = document.createElement('div');
    section.id = 'ephemeral-section';
    section.className = 'mt-1 border-t border-onkoz-border pt-1';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-1 px-2 py-1';

    const name = document.createElement('span');
    name.className = 'flex-1 text-[0.72rem] font-bold tracking-wider uppercase text-onkoz-text-muted';
    name.textContent = 'Éphémères';

    header.append(name);

    const list = document.createElement('ul');
    list.id = 'ephemeral-channels';
    list.className = 'flex flex-col';

    section.append(header, list);
    return section;
  }

  function renderEphemeralSection(ephemerals) {
    const list = document.getElementById('ephemeral-channels');
    if (!list) return;
    list.innerHTML = '';
    ephemerals.forEach(eph => {
      const li = document.createElement('li');
      li.className = 'channel-item flex flex-col px-3 py-1 mx-1 rounded-md text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text cursor-pointer transition-colors text-[0.88rem]';

      const row = document.createElement('div');
      row.className = 'flex items-center gap-1.5';
      row.innerHTML = `<span class="shrink-0 text-sm">✨</span><span class="flex-1 truncate">${eph.voiceName}</span><span class="text-[0.7rem] text-onkoz-text-muted">${eph.memberCount}</span>`;

      // Présence membres
      if (eph.members?.length) {
        const presEl = document.createElement('div');
        presEl.className = 'flex flex-wrap gap-0.5 mt-0.5 pl-5';
        eph.members.slice(0, 5).forEach(m => {
          const span = document.createElement('span');
          span.className = 'text-[0.65rem] text-onkoz-success';
          span.textContent = m.username;
          presEl.appendChild(span);
          if (eph.members.indexOf(m) < eph.members.length - 1 && eph.members.indexOf(m) < 4) {
            presEl.appendChild(document.createTextNode(', '));
          }
        });
        li.append(row, presEl);
      } else {
        li.appendChild(row);
      }

      li.addEventListener('click', () => {
        socket.emit('ephemeral:join', { eid: eph.id });
        Voice.joinRoom(eph.id, 'ephemeral', `ephemeral:${eph.id}`, eph.voiceName);
        setChannelHeader('✨', eph.voiceName, '');
        showVoiceBar(eph.voiceName);
        if (eph.withText) Chat.setupEphemeralText(socket, eph.id);
      });

      list.appendChild(li);
    });
  }

  // ── Créer item salon ──────────────────────────────────────────────────────
  // ── Glisser-déposer de réorganisation ───────────────────────────────────────
  let dndDragged = null;
  let dndDidDrag = false;

  function dndContainers() {
    return [
      ...document.querySelectorAll('[id^="cat-channels-"]'),
      document.getElementById('uncategorized-channels'),
    ].filter(Boolean);
  }

  function enableSidebarDnD() {
    if (!(Auth.isAdmin() || Auth.isMod())) return;

    document.querySelectorAll('#channel-list .channel-item[data-id]').forEach(li => {
      // On n'active le drag que sur les salons rangés (pas les éphémères)
      if (!li.closest('[id^="cat-channels-"]') && li.parentElement?.id !== 'uncategorized-channels') return;
      li.draggable = true;
      li.addEventListener('dragstart', onDndStart);
      li.addEventListener('dragend',   onDndEnd);
    });

    dndContainers().forEach(ul => {
      ul.addEventListener('dragover', onDndOver);
      ul.addEventListener('drop',     onDndDrop);
    });
  }

  function onDndStart(e) {
    dndDragged = e.currentTarget;
    dndDidDrag = true;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => dndDragged?.classList.add('opacity-40'), 0);
  }

  function onDndEnd() {
    dndDragged?.classList.remove('opacity-40');
    dndDragged = null;
    // Laisse passer l'éventuel click post-drag avant de réautoriser la sélection
    setTimeout(() => { dndDidDrag = false; }, 60);
  }

  function onDndOver(e) {
    e.preventDefault();
    if (!dndDragged) return;
    const ul = e.currentTarget;
    const after = dndAfterElement(ul, e.clientY);
    if (after == null) ul.appendChild(dndDragged);
    else ul.insertBefore(dndDragged, after);
  }

  function dndAfterElement(container, y) {
    const els = [...container.querySelectorAll('.channel-item:not(.opacity-40)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: -Infinity, element: null }).element;
  }

  function onDndDrop(e) {
    e.preventDefault();
    persistSidebarOrder();
  }

  function persistSidebarOrder() {
    const channels = [];

    document.querySelectorAll('[id^="cat-channels-"]').forEach(ul => {
      const catId = parseInt(ul.id.replace('cat-channels-', ''), 10);
      [...ul.querySelectorAll('.channel-item[data-id]')].forEach((li, i) => {
        channels.push({ id: parseInt(li.dataset.id, 10), position: i, category_id: catId });
      });
    });

    const uncat = document.getElementById('uncategorized-channels');
    if (uncat) {
      [...uncat.querySelectorAll('.channel-item[data-id]')].forEach((li, i) => {
        channels.push({ id: parseInt(li.dataset.id, 10), position: i, category_id: null });
      });
    }

    // Synchroniser l'état local pour que les re-rendus (présence, etc.) restent cohérents
    applyOrderToState(channels);

    API.reorderLayout({ channels }).catch(() => {
      AudioSettings.showToast?.('❌ Réorganisation non enregistrée');
    });
  }

  function applyOrderToState(channels) {
    const all  = [...cats.flatMap(c => c.channels), ...uncategorized];
    const byId = new Map(all.map(ch => [ch.id, ch]));
    cats.forEach(c => { c.channels = []; });
    uncategorized = [];
    channels.forEach(c => {
      const ch = byId.get(c.id);
      if (!ch) return;
      ch.position = c.position;
      ch.category_id = c.category_id;
      if (c.category_id == null) { uncategorized.push(ch); return; }
      const cat = cats.find(x => x.id === c.category_id);
      (cat ? cat.channels : uncategorized).push(ch);
    });
  }

  function createChannelItem(ch) {
    const li = document.createElement('li');
    li.id = `ch-item-${ch.id}`;
    li.dataset.id   = ch.id;
    li.dataset.type = ch.type;
    li.className = 'channel-item flex flex-col px-3 py-1 mx-1 rounded-md cursor-pointer transition-colors group text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text';

    const row = document.createElement('div');
    row.className = 'flex items-center gap-1.5';

    const icon = document.createElement('span');
    icon.className = 'text-[0.85rem] shrink-0 text-onkoz-text-muted group-hover:text-onkoz-text';
    icon.textContent = ch.type === 'text' ? '#' : '🔊';

    const nameSp = document.createElement('span');
    nameSp.className = 'flex-1 truncate text-[0.88rem]';
    nameSp.textContent = ch.name;

    row.append(icon, nameSp);

    // Bouton options (admin/mod)
    const canManage = Auth.isAdmin() || Auth.isMod();
    if (canManage) {
      const optBtn = document.createElement('button');
      optBtn.className = 'hidden group-hover:flex w-6 h-6 items-center justify-center rounded text-onkoz-text-muted hover:bg-onkoz-hover hover:text-onkoz-text text-base shrink-0 transition-colors font-bold';
      optBtn.textContent = '⋮';
      optBtn.title = 'Options';
      optBtn.addEventListener('click', e => { e.stopPropagation(); openChannelMenu(e, ch); });
      row.appendChild(optBtn);
    }

    // Zone présence (sous le nom)
    const presenceEl = document.createElement('div');
    presenceEl.id = `ch-presence-${ch.id}`;
    presenceEl.className = 'pl-5 flex flex-wrap gap-x-1';

    li.append(row, presenceEl);
    li.addEventListener('click', () => { if (!dndDidDrag) selectChannel(ch); });
    return li;
  }

  // ── Présence sous les salons ──────────────────────────────────────────────
  function updateChannelPresence(channelId, type, members) {
    const el = document.getElementById(`ch-presence-${channelId}`);
    if (!el) return;
    el.innerHTML = '';
    if (!members?.length) return;

    if (type === 'text') {
      const span = document.createElement('span');
      span.className = 'text-[0.65rem] text-onkoz-text-muted truncate pl-5 block';
      span.textContent = '👁 ' + members.map(m => m.username).join(', ');
      el.appendChild(span);
    } else {
      // Vocal → une ligne par membre avec mini-avatar
      members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'voice-presence-row';
        row.dataset.userId = m.userId;                 // pour le rafraîchissement live
        const av = document.createElement('div');
        av.className = `vpr-av user-avatar ${UI.avatarClass(m.username)}`;
        const avatarUrl = m.avatar_url || Profile.getAvatar?.(m.userId);
        if (avatarUrl) {
          av.style.backgroundImage    = `url("${avatarUrl}")`;
          av.style.backgroundSize     = 'cover';
          av.style.backgroundPosition = 'center';
        } else {
          av.textContent = m.username[0].toUpperCase();
        }
        const name = document.createElement('span');
        name.className = 'vpr-name';
        name.textContent = m.username;
        const mic = document.createElement('span');
        mic.className = 'vpr-mic';
        mic.textContent = '🎤';
        row.append(av, name, mic);
        el.appendChild(row);
      });
    }
  }

  // ── Sélectionner un salon ─────────────────────────────────────────────────
  function selectChannel(ch) {
    // Highlight
    document.querySelectorAll('.channel-item').forEach(el => {
      el.classList.remove('bg-onkoz-active', 'text-onkoz-text');
    });
    document.getElementById(`ch-item-${ch.id}`)?.classList.add('bg-onkoz-active', 'text-onkoz-text');

    // Catégorie dans le header
    const catName = findCategoryOfChannel(ch.id)?.name || '';
    setChannelHeader(ch.type === 'text' ? '#' : '🔊', ch.name, catName);

    if (ch.type === 'text') {
      // Ne quitte PAS le vocal (comme Discord)
      document.getElementById('message-input-area').style.display = 'block';
      Chat.joinTextChannel(ch.id, ch.name);
    } else {
      document.getElementById('message-input-area').style.display = 'none';
      socket.emit('voice:join', { channelId: ch.id });
      Voice.joinRoom(ch.id, 'permanent', `voice:${ch.id}`, ch.name);
      showVoiceBar(ch.name);
    }
    // Fermer le drawer sidebar sur mobile après sélection
    if (window.innerWidth <= 640) closeSidebar();
  }

  function setChannelHeader(icon, name, category) {
    document.getElementById('channel-icon').textContent = icon;
    document.getElementById('channel-name').textContent = name;
    document.getElementById('channel-category').textContent = category ? `— ${category}` : '';
    // Mise à jour topbar mobile
    const mIcon = document.getElementById('mobile-ch-icon');
    const mName = document.getElementById('mobile-ch-name');
    if (mIcon) mIcon.textContent = icon;
    if (mName) mName.textContent  = name;
  }

  function findCategoryOfChannel(chId) {
    for (const cat of cats) {
      if (cat.channels.find(c => c.id === chId)) return cat;
    }
    return null;
  }

  function findChannelById(chId) {
    for (const cat of cats) {
      const c = cat.channels.find(x => String(x.id) === String(chId));
      if (c) return c;
    }
    return uncategorized.find(x => String(x.id) === String(chId)) || null;
  }

  /** Tous les salons vocaux (permanents), pour le menu « Déplacer vers ». */
  function getVoiceChannels() {
    const out = [];
    for (const cat of cats) cat.channels.forEach(c => { if (c.type !== 'text') out.push(c); });
    uncategorized.forEach(c => { if (c.type !== 'text') out.push(c); });
    return out;
  }

  /** Émet l'ordre de déplacement (appelé depuis le menu modération de ui.js). */
  function moveMember(targetUserId, toChannelId) {
    socket.emit('voice:move', { targetUserId, toChannelId });
  }

  // ── Panneau vocal sidebar (style Discord) ────────────────────────────────
  function showVoiceBar(channelName) {
    const panel = document.getElementById('voice-panel');
    panel.classList.remove('hidden');
    panel.classList.add('flex');
    document.getElementById('voice-panel-channel').textContent = channelName;
  }

  function hideVoiceBar() {
    const panel = document.getElementById('voice-panel');
    panel.classList.add('hidden');
    panel.classList.remove('flex');
  }

  // ── Créer catégorie ───────────────────────────────────────────────────────
  async function createCategory() {
    const result = await UI.openModal('Nouvelle catégorie', { placeholder: 'NOM CATÉGORIE', mode: 'category' });
    if (!result) return;
    try {
      const cat = await API.createCategory(result.name);
      cat.channels = [];
      cats.push(cat);
      renderSidebar();
      AudioSettings.showToast(`✅ Catégorie "${cat.name}" créée`);
    } catch (e) { alert(e.message); }
  }

  async function deleteCategory(id) {
    if (!confirm('Supprimer cette catégorie ? Les salons seront déplacés dans "Général".')) return;
    try {
      await API.deleteCategory(id);
      // Récupérer les salons de la catégorie supprimée → les mettre dans uncategorized
      const cat = cats.find(c => c.id === id);
      if (cat) uncategorized.push(...cat.channels.map(ch => ({ ...ch, category_id: null })));
      cats = cats.filter(c => c.id !== id);
      renderSidebar();
    } catch (e) { alert(e.message); }
  }

  // ── Créer salon ───────────────────────────────────────────────────────────
  async function createChannelInCategory(categoryId) {
    const result = await UI.openModal('Nouveau salon', {
      placeholder: 'nom-du-salon',
      mode: 'channel',
      categories: cats,
      defaultCategoryId: categoryId,
    });
    if (!result) return;
    try {
      const ch = await API.createChannelInCategory(result.name, result.type, result.categoryId || null);
      // Ajouter localement
      if (result.categoryId) {
        const cat = cats.find(c => c.id == result.categoryId);
        if (cat) cat.channels.push(ch);
      } else {
        uncategorized.push(ch);
      }
      renderSidebar();
      AudioSettings.showToast(`✅ Salon "${ch.name}" créé`);
    } catch (e) { alert(e.message); }
  }

  // ── Menu options salon ────────────────────────────────────────────────────
  function openChannelMenu(e, ch) {
    // Fermer tout menu existant
    document.getElementById('channel-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'channel-ctx-menu';
    menu.className = 'fixed z-[300] bg-onkoz-surface border border-onkoz-border rounded-lg shadow-dm py-1 w-52 text-sm';

    // Position sous le bouton ⋮
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.top  = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left - 170}px`;

    const menuItems = [];

    // ── Gérer les modérateurs (admin seulement) ──
    if (Auth.isAdmin()) {
      menuItems.push({
        icon: '🛡',
        label: 'Droits de modération',
        action: () => openModerationModal(ch),
      });
    }

    // ── Supprimer (admin + mod) ──
    menuItems.push({
      icon: '🗑',
      label: 'Supprimer le salon',
      danger: true,
      action: () => deleteChannel(ch.id),
    });

    menuItems.forEach(item => {
      const btn = document.createElement('button');
      btn.className = `w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${
        item.danger
          ? 'text-onkoz-danger hover:bg-onkoz-danger/15'
          : 'text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text'
      }`;
      btn.innerHTML = `<span class="text-base">${item.icon}</span><span>${item.label}</span>`;
      btn.addEventListener('click', () => { menu.remove(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Fermer au clic extérieur
    setTimeout(() => {
      document.addEventListener('click', function handler(ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', handler); }
      });
    }, 50);
  }

  // ── Modal droits de modération ────────────────────────────────────────────
  async function openModerationModal(ch) {
    // Récupérer les modérateurs
    const mods = allUsers.filter(u => u.role === 'moderator');
    const temps = allUsers.filter(u => u.role === 'temporary');
    if (!mods.length) {
      AudioSettings.showToast('ℹ️ Aucun modérateur sur le serveur');
      return;
    }

    // Créer modal
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[300]';

    const box = document.createElement('div');
    box.className = 'bg-onkoz-surface border border-onkoz-border rounded-xl p-6 w-80 flex flex-col gap-4 shadow-dm';

    box.innerHTML = `
      <h3 class="font-bold text-lg text-onkoz-text">🛡 Droits de modération</h3>
      <p class="text-sm text-onkoz-text-md">Salon : <strong class="text-onkoz-text">#${ch.name}</strong></p>
      <p class="text-[0.75rem] text-onkoz-text-muted">Sélectionne les modérateurs qui peuvent gérer ce salon :</p>
      <div id="mod-checklist" class="flex flex-col gap-2 max-h-48 overflow-y-auto"></div>
      <div class="flex gap-2 justify-end pt-1">
        <button id="mod-modal-cancel" class="px-4 py-2 rounded-md border border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover transition-colors text-sm font-medium">Annuler</button>
        <button id="mod-modal-save" class="px-4 py-2 rounded-md bg-onkoz-accent hover:bg-onkoz-accent-dk text-white font-semibold text-sm transition-colors">Enregistrer</button>
      </div>`;

    // Charger les droits existants du salon
    const channelMods = await loadChannelMods(ch.id);
    const checklist = box.querySelector('#mod-checklist');

    mods.forEach(mod => {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-onkoz-hover cursor-pointer transition-colors';
      const checked = channelMods.includes(mod.id);
      label.innerHTML = `
        <input type="checkbox" value="${mod.id}" ${checked ? 'checked' : ''} class="accent-onkoz-accent w-4 h-4 cursor-pointer" />
        <div class="${UI.avatarClass(mod.username)} w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white uppercase">${mod.username[0]}</div>
        <span class="text-sm text-onkoz-text font-medium">${mod.username}</span>
        <span class="role-badge moderator ml-auto">Mod</span>`;
      checklist.appendChild(label);
    });

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#mod-modal-cancel').addEventListener('click', () => overlay.remove());
    box.querySelector('#mod-modal-save').addEventListener('click', async () => {
      const selected = [...box.querySelectorAll('input[type=checkbox]:checked')].map(cb => parseInt(cb.value));
      await saveChannelMods(ch.id, selected);
      overlay.remove();
      AudioSettings.showToast(`✅ Droits de modération mis à jour pour #${ch.name}`);
    });
  }

  // ── Stocker/charger les droits de modération par salon ───────────────────
  // Stocké en localStorage (côté client) — peut être migré en DB plus tard
  function getModPermsKey(channelId) { return `onkoz_modperms_${channelId}`; }

  function loadChannelMods(channelId) {
    try {
      return JSON.parse(localStorage.getItem(getModPermsKey(channelId)) || '[]');
    } catch { return []; }
  }

  function saveChannelMods(channelId, modIds) {
    localStorage.setItem(getModPermsKey(channelId), JSON.stringify(modIds));
    // Notifier via socket pour que les autres clients soient informés
    socket?.emit('channel:mod-perms', { channelId, modIds });
    return Promise.resolve();
  }

  // Vérifier si l'utilisateur courant a des droits sur un salon spécifique
  function canModerateChannel(channelId) {
    if (Auth.isAdmin()) return true;
    if (!Auth.isMod()) return false;
    const user = Auth.getUser();
    const mods = loadChannelMods(channelId);
    return mods.includes(user.id);
  }

  async function deleteChannel(id) {
    if (!confirm('Supprimer ce salon ?')) return;
    try {
      await API.deleteChannel(id);
      cats.forEach(cat => { cat.channels = cat.channels.filter(c => c.id !== id); });
      uncategorized = uncategorized.filter(c => c.id !== id);
      renderSidebar();
    } catch (e) { alert(e.message); }
  }

  // ── Créer éphémère ────────────────────────────────────────────────────────
  async function createEphemeral() {
    const result = await UI.openModal('Salon éphémère', { placeholder: 'Mon salon', mode: 'ephemeral' });
    if (!result) return;
    socket.emit('ephemeral:create', { voiceName: result.name, withText: result.withText });
  }

  // ── Modération ────────────────────────────────────────────────────────────
  async function changeRole(userId, newRole) {
    try {
      await API.changeRole(userId, newRole);
      const u = allUsers.find(u => u.id === userId);
      if (u) u.role = newRole;
      UI.setUsers(allUsers);
    } catch (e) { alert(e.message); }
  }

  function kickUser(userId) {
    if (!confirm('Expulser cet utilisateur ?')) return;
    socket.emit('mod:kick', { targetId: userId });
  }

  function showUnreadBadge(fromId) {
    const el = document.querySelector(`[data-user-id="${fromId}"]`);
    if (!el) return;
    let badge = el.querySelector('.unread-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge bg-onkoz-accent text-white text-[0.65rem] px-1.5 py-px rounded-full font-bold';
      el.appendChild(badge);
    }
    badge.textContent = (parseInt(badge.textContent) || 0) + 1;
  }

  // ── Bind events ───────────────────────────────────────────────────────────
  function bindEvents() {
    // Confirmation navigateur si on ferme l'onglet EN ÉTANT en vocal / partage d'écran.
    // NB : le texte du popup est imposé par le navigateur (non personnalisable).
    // Web uniquement : en Electron, beforeunload bloquerait la fermeture sans dialogue
    // (à gérer côté main process via win.on('close') si un jour souhaité).
    if (!window.ElectronAPI?.isElectron) {
      window.addEventListener('beforeunload', (e) => {
        if (Voice.getCurrentRoomId()) {   // en vocal → on prévient d'une fermeture accidentelle
          e.preventDefault();
          e.returnValue = '';             // requis pour déclencher la popup native
        }
      });
    }

    // Panneau vocal sidebar
    document.getElementById('voice-panel-screenshare').addEventListener('click', () => Voice.toggleScreenShare());
    document.getElementById('voice-panel-mute').addEventListener('click',  () => Voice.toggleMute());
    document.getElementById('voice-panel-leave2').addEventListener('click', () => { Voice.leaveRoom(); hideVoiceBar(); });
    document.getElementById('voice-panel-overlay')?.addEventListener('click', () => Voice.toggleOverlay());

    document.getElementById('send-btn').addEventListener('click', () => Chat.sendMessage());
    const messageInput = document.getElementById('message-input');

    // Entrée = envoyer, Shift+Entrée = nouvelle ligne.
    // isComposing évite d'envoyer au milieu d'une composition IME.
    messageInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        Chat.sendMessage();
      }
    });

    // Le textarea grandit avec le contenu jusqu'à 180 px, puis devient scrollable.
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
    });

    document.getElementById('dm-send-btn').addEventListener('click', () => Chat.sendDM());
    document.getElementById('dm-input').addEventListener('keydown', e => { if (e.key === 'Enter') Chat.sendDM(); });
    document.getElementById('close-dm').addEventListener('click', () => Chat.closeDM());
    document.getElementById('btn-audio-settings').addEventListener('click',   () => AudioSettings.toggle());
    document.getElementById('btn-profile-settings').addEventListener('click', () => Profile.openEditPanel());

    // ── Mobile ──
    document.getElementById('sidebar-toggle')?.addEventListener('click', openSidebar);
    document.getElementById('mobile-members-btn')?.addEventListener('click', toggleMobileMembers);

    // Swipe depuis bord gauche → ouvre le drawer
    let _tx = 0;
    document.addEventListener('touchstart', e => { _tx = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _tx;
      const sidebar = document.getElementById('main-sidebar');
      if (_tx < 24 && dx > 56) openSidebar();
      else if (dx < -72 && sidebar.classList.contains('open')) closeSidebar();
    }, { passive: true });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeSidebar(); closeMobileMembers(); }
      if (e.key === 'v' && e.altKey) { e.preventDefault(); Voice.toggleOverlay(); }
    });

    if (typeof Hotkeys !== 'undefined') Hotkeys.init();
  }

  // ── Fonctions mobile ──────────────────────────────────────────────────────
  function openSidebar() {
    document.getElementById('main-sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  }
  function closeSidebar() {
    document.getElementById('main-sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }
  function toggleMobileMembers() {
    document.getElementById('members-sidebar').classList.toggle('open');
  }
  function closeMobileMembers() {
    document.getElementById('members-sidebar')?.classList.remove('open');
  }

  return { launch, kickUser, changeRole, showUnreadBadge, bindEvents, openSidebar, closeSidebar, toggleMobileMembers,
           findChannelById, getVoiceChannels, moveMember };
})();

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  Auth.bindEvents();
  App.bindEvents();
  const user = await Auth.init();
  if (user) App.launch();
});
