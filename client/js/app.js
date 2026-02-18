/* ── App — Orchestrateur principal ───────────────────────────────────────────
   Initialise tout, gère les canaux socket, salons, et navigation.
   ─────────────────────────────────────────────────────────────────────────── */
const App = (() => {
  let socket = null;
  let channels = [];
  let allUsers = [];
  let ephemeralList = [];
  let voiceMembers  = {};  // channelId → [userId, ...]

  // ── Démarrage ─────────────────────────────────────────────────────────────
  async function launch() {
    const user = Auth.getUser();
    if (!user) return;

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    UI.renderFooterUser(user);

    // Boutons admin visibles
    if (Auth.isAdmin()) {
      document.getElementById('create-text-channel').style.display  = 'flex';
      document.getElementById('create-voice-channel').style.display = 'flex';
    }

    // Charger les données
    [channels, allUsers] = await Promise.all([API.getChannels(), API.getUsers()]);
    UI.setUsers(allUsers);
    renderChannels();

    // Connexion socket
    connectSocket(user);
  }

  function connectSocket(user) {
    socket = io({ auth: { token: API.getToken() } });

    Voice.init(socket);
    Chat.init(socket);

    // ── Événements socket ─────────────────────────────────────────────────
    socket.on('connect', () => {
      console.log('[socket] Connecté', socket.id);
    });

    socket.on('online:list', (ids) => {
      UI.setOnline(ids);
    });

    socket.on('user:online',  ({ userId }) => UI.setUserOnline(userId));
    socket.on('user:offline', ({ userId }) => UI.setUserOffline(userId));

    socket.on('chat:message', (msg) => Chat.onMessage(msg));
    socket.on('chat:deleted', (data) => Chat.onDeleted(data));

    socket.on('dm:message', (msg) => Chat.onDMMessage(msg));

    socket.on('voice:peer:joined', (data) => Voice.onPeerJoined(data));
    socket.on('voice:peer:left',   ({ peerId, userId }) => Voice.onPeerLeft({ peerId }));
    socket.on('voice:peers',       (peers) => Voice.onExistingPeers(peers));

    socket.on('voice:members', ({ channelId, members }) => {
      voiceMembers[channelId] = members;
      updateVoiceMemberCount(channelId, members.length);
    });

    socket.on('ephemeral:list', (list) => {
      ephemeralList = list;
      renderEphemeralChannels();
    });

    socket.on('ephemeral:created', ({ eid, voiceName, withText }) => {
      // Rejoindre automatiquement le salon créé
      const roomId = `ephemeral:${eid}`;
      socket.emit('ephemeral:join', { eid });
      Voice.joinRoom(eid, 'ephemeral', roomId, voiceName);
      document.getElementById('channel-name').textContent = voiceName;
      document.getElementById('channel-icon').textContent = '🔊';

      // Salon texte éphémère
      if (withText) {
        document.getElementById('message-input-area').style.display = 'block';
        setupEphemeralText(eid);
      }
    });

    socket.on('kicked', () => {
      alert('Vous avez été expulsé du serveur.');
      API.clearToken();
      location.reload();
    });
  }

  // ── Canaux ────────────────────────────────────────────────────────────────
  function renderChannels() {
    const textList  = document.getElementById('text-channels');
    const voiceList = document.getElementById('voice-channels');
    textList.innerHTML  = '';
    voiceList.innerHTML = '';

    for (const ch of channels) {
      const li = createChannelItem(ch);
      if (ch.type === 'text')  textList.appendChild(li);
      else voiceList.appendChild(li);
    }
  }

  function createChannelItem(ch) {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.dataset.id   = ch.id;
    li.dataset.type = ch.type;

    const icon = document.createElement('span');
    icon.className = 'ch-icon';
    icon.textContent = ch.type === 'text' ? '#' : '🔊';

    const name = document.createElement('span');
    name.className = 'ch-name';
    name.textContent = ch.name;

    li.append(icon, name);

    if (ch.type === 'voice') {
      const count = document.createElement('span');
      count.className = 'voice-member-count';
      count.id = `vc-count-${ch.id}`;
      count.textContent = '';
      li.append(count);
    }

    if (Auth.isAdmin()) {
      const del = document.createElement('button');
      del.className = 'ch-del btn-icon danger';
      del.textContent = '✕';
      del.title = 'Supprimer';
      del.addEventListener('click', e => { e.stopPropagation(); deleteChannel(ch.id); });
      li.append(del);
    }

    li.addEventListener('click', () => selectChannel(ch));
    return li;
  }

  function renderEphemeralChannels() {
    const list = document.getElementById('ephemeral-channels');
    list.innerHTML = '';

    for (const eph of ephemeralList) {
      const li = document.createElement('li');
      li.className = 'channel-item';
      li.innerHTML = `<span class="ch-icon">✨</span><span class="ch-name">${eph.voiceName}</span><span class="voice-member-count">${eph.memberCount}</span>`;
      li.addEventListener('click', () => {
        socket.emit('ephemeral:join', { eid: eph.id });
        const roomId = `ephemeral:${eph.id}`;
        Voice.joinRoom(eph.id, 'ephemeral', roomId, eph.voiceName);
        document.getElementById('channel-name').textContent = eph.voiceName;
        document.getElementById('channel-icon').textContent = '✨';
        if (eph.withText) setupEphemeralText(eph.id);
      });
      list.appendChild(li);
    }
  }

  function selectChannel(ch) {
    // Mettre à jour l'actif
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-id="${ch.id}"]`)?.classList.add('active');

    document.getElementById('channel-icon').textContent = ch.type === 'text' ? '#' : '🔊';
    document.getElementById('channel-name').textContent = ch.name;

    if (ch.type === 'text') {
      // Quitter le vocal si on était dans un salon permanent
      if (Voice.getCurrentRoomId()?.startsWith('voice:')) Voice.leaveRoom();
      document.getElementById('message-input-area').style.display = 'block';
      Chat.joinTextChannel(ch.id, ch.name);
    } else {
      // Vocal permanent
      document.getElementById('message-input-area').style.display = 'none';
      socket.emit('voice:join', { channelId: ch.id });
      Voice.joinRoom(ch.id, 'permanent', `voice:${ch.id}`, ch.name);
    }
  }

  function updateVoiceMemberCount(channelId, count) {
    const el = document.getElementById(`vc-count-${channelId}`);
    if (!el) return;
    el.textContent = count > 0 ? count : '';
  }

  // ── Créer salon (admin) ────────────────────────────────────────────────────
  async function createChannel(type) {
    const result = await UI.openModal(`Créer un salon ${type === 'text' ? 'texte' : 'vocal'}`, {
      placeholder: type === 'text' ? 'general' : 'vocal-général'
    });
    if (!result) return;

    try {
      const ch = await API.createChannel(result.name, type);
      channels.push(ch);
      const textList  = document.getElementById('text-channels');
      const voiceList = document.getElementById('voice-channels');
      const li = createChannelItem(ch);
      if (type === 'text') textList.appendChild(li);
      else voiceList.appendChild(li);
    } catch (e) { alert(e.message); }
  }

  async function deleteChannel(id) {
    if (!confirm('Supprimer ce salon ?')) return;
    try {
      await API.deleteChannel(id);
      channels = channels.filter(c => c.id !== id);
      document.querySelector(`[data-id="${id}"]`)?.remove();
    } catch (e) { alert(e.message); }
  }

  // ── Salon éphémère ────────────────────────────────────────────────────────
  async function createEphemeral() {
    const result = await UI.openModal('Créer un salon éphémère', {
      placeholder: 'Mon salon',
      ephemeral: true,
    });
    if (!result) return;
    socket.emit('ephemeral:create', { voiceName: result.name, withText: result.withText });
  }

  function setupEphemeralText(eid) {
    document.getElementById('message-input-area').style.display = 'block';
    const input  = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    // Remplacer les handlers
    const newInput = input.cloneNode(true);
    const newSend  = sendBtn.cloneNode(true);
    input.replaceWith(newInput);
    sendBtn.replaceWith(newSend);

    newSend.addEventListener('click', () => {
      const content = newInput.value.trim();
      if (!content) return;
      socket.emit('ephemeral:message', { eid, content });
      newInput.value = '';
    });
    newInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') newSend.click();
    });

    socket.on('ephemeral:message', ({ eid: msgEid, username, role, content, ts }) => {
      if (msgEid !== eid) return;
      const area = document.getElementById('content-area');
      const vr = area.querySelector('.voice-room-display');
      if (!vr) return;

      let chatArea = vr.querySelector('.ephemeral-chat');
      if (!chatArea) {
        chatArea = document.createElement('div');
        chatArea.className = 'ephemeral-chat';
        chatArea.style.cssText = 'max-height:200px;overflow-y:auto;background:var(--bg-secondary);border-radius:8px;padding:.5rem;margin-top:1rem;width:100%;max-width:600px';
        vr.appendChild(chatArea);
      }

      const msg = document.createElement('div');
      msg.innerHTML = `<span class="msg-author ${role}" style="font-size:.85rem;font-weight:700">${username}</span> <span style="font-size:.85rem;color:var(--text-primary)">${content}</span>`;
      chatArea.appendChild(msg);
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  // ── Modération ─────────────────────────────────────────────────────────────
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
    // Mini notification dans l'UI utilisateur
    const el = document.querySelector(`[data-user-id="${fromId}"]`);
    if (!el) return;
    let badge = el.querySelector('.unread-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.style.cssText = 'background:var(--accent);color:#fff;font-size:.65rem;padding:1px 5px;border-radius:10px;font-weight:700';
      el.appendChild(badge);
    }
    badge.textContent = (parseInt(badge.textContent) || 0) + 1;
  }

  // ── Bind global UI events ─────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('create-text-channel').addEventListener('click',  () => createChannel('text'));
    document.getElementById('create-voice-channel').addEventListener('click', () => createChannel('voice'));
    document.getElementById('create-ephemeral').addEventListener('click',     () => createEphemeral());

    document.getElementById('mute-btn').addEventListener('click', () => Voice.toggleMute());
    document.getElementById('leave-voice-btn').addEventListener('click', () => Voice.leaveRoom());

    const msgInput = document.getElementById('message-input');
    const sendBtn  = document.getElementById('send-btn');
    sendBtn.addEventListener('click', () => Chat.sendMessage());
    msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') Chat.sendMessage(); });

    document.getElementById('dm-send-btn').addEventListener('click', () => Chat.sendDM());
    document.getElementById('dm-input').addEventListener('keydown', e => { if (e.key === 'Enter') Chat.sendDM(); });
    document.getElementById('close-dm').addEventListener('click', () => Chat.closeDM());
  }

  return { launch, kickUser, changeRole, showUnreadBadge, bindEvents };
})();

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  Auth.bindEvents();
  App.bindEvents();

  const user = await Auth.init();
  if (user) App.launch();
});
