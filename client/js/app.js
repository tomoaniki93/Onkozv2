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
    appEl.classList.add('grid');

    UI.renderFooterUser(user);

    [{ categories: cats, uncategorized }, allUsers] = await Promise.all([
      API.getCategories(), API.getUsers(),
    ]);
    UI.setUsers(allUsers);
    renderSidebar();
    connectSocket(user);
  }

  // ── Socket ────────────────────────────────────────────────────────────────
  function connectSocket(user) {
    socket = io({ auth: { token: API.getToken() } });
    Voice.init(socket);
    Chat.init(socket);

    socket.on('online:list',       ids  => UI.setOnline(ids));
    socket.on('user:online',       ({ userId }) => UI.setUserOnline(userId));
    socket.on('user:offline',      ({ userId }) => UI.setUserOffline(userId));
    socket.on('chat:message',      msg  => Chat.onMessage(msg));
    socket.on('chat:deleted',      data => Chat.onDeleted(data));
    socket.on('dm:message',        msg  => Chat.onDMMessage(msg));
    socket.on('voice:peer:joined', data => Voice.onPeerJoined(data));
    socket.on('voice:peer:left',   data => Voice.onPeerLeft(data));
    socket.on('voice:peers',       peers => Voice.onExistingPeers(peers));
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

    const addBtn = document.createElement('button');
    addBtn.className = 'w-5 h-5 flex items-center justify-center rounded text-onkoz-text-muted hover:text-onkoz-text hover:bg-onkoz-hover transition-colors text-sm';
    addBtn.textContent = '+';
    addBtn.title = 'Créer un salon éphémère';
    addBtn.addEventListener('click', createEphemeral);

    header.append(name, addBtn);

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

    // Bouton supprimer (admin/mod)
    const canManage = Auth.isAdmin() || Auth.isMod();
    if (canManage) {
      const del = document.createElement('button');
      del.className = 'hidden group-hover:flex w-4 h-4 items-center justify-center rounded text-onkoz-danger hover:bg-onkoz-danger/20 text-xs shrink-0 transition-colors';
      del.textContent = '✕';
      del.addEventListener('click', e => { e.stopPropagation(); deleteChannel(ch.id); });
      row.appendChild(del);
    }

    // Zone présence (sous le nom)
    const presenceEl = document.createElement('div');
    presenceEl.id = `ch-presence-${ch.id}`;
    presenceEl.className = 'pl-5 flex flex-wrap gap-x-1';

    li.append(row, presenceEl);
    li.addEventListener('click', () => selectChannel(ch));
    return li;
  }

  // ── Présence sous les salons ──────────────────────────────────────────────
  function updateChannelPresence(channelId, type, members) {
    const el = document.getElementById(`ch-presence-${channelId}`);
    if (!el) return;
    el.innerHTML = '';
    if (!members?.length) return;

    const color  = type === 'voice' ? 'text-onkoz-success' : 'text-onkoz-text-muted';
    const prefix = type === 'voice' ? '🎤 ' : '👁 ';

    const text = document.createElement('span');
    text.className = `text-[0.65rem] ${color} truncate`;
    text.textContent = prefix + members.map(m => m.username).join(', ');
    el.appendChild(text);
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
  }

  function setChannelHeader(icon, name, category) {
    document.getElementById('channel-icon').textContent = icon;
    document.getElementById('channel-name').textContent = name;
    document.getElementById('channel-category').textContent = category ? `— ${category}` : '';
  }

  function findCategoryOfChannel(chId) {
    for (const cat of cats) {
      if (cat.channels.find(c => c.id === chId)) return cat;
    }
    return null;
  }

  // ── Barre vocale persistante ───────────────────────────────────────────────
  function showVoiceBar(channelName) {
    const bar = document.getElementById('voice-bar');
    bar.classList.remove('hidden');
    bar.classList.add('flex');
    document.getElementById('voice-bar-name').textContent = channelName;
  }

  function hideVoiceBar() {
    const bar = document.getElementById('voice-bar');
    bar.classList.add('hidden');
    bar.classList.remove('flex');
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
    document.getElementById('voice-bar-mute').addEventListener('click',  () => Voice.toggleMute());
    document.getElementById('voice-bar-leave').addEventListener('click', () => { Voice.leaveRoom(); hideVoiceBar(); });
    document.getElementById('send-btn').addEventListener('click', () => Chat.sendMessage());
    document.getElementById('message-input').addEventListener('keydown', e => { if (e.key === 'Enter') Chat.sendMessage(); });
    document.getElementById('dm-send-btn').addEventListener('click', () => Chat.sendDM());
    document.getElementById('dm-input').addEventListener('keydown', e => { if (e.key === 'Enter') Chat.sendDM(); });
    document.getElementById('close-dm').addEventListener('click', () => Chat.closeDM());
    document.getElementById('btn-audio-settings').addEventListener('click', () => AudioSettings.toggle());
  }

  return { launch, kickUser, changeRole, showUnreadBadge, bindEvents };
})();

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  Auth.bindEvents();
  App.bindEvents();
  const user = await Auth.init();
  if (user) App.launch();
});
