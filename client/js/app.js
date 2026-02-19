/* ── App — Orchestrateur principal ───────────────────────────────────────── */
const App = (() => {
  let socket = null, channels = [], allUsers = [], ephemeralList = [];

  async function launch() {
    const user = Auth.getUser();
    if (!user) return;

    document.getElementById('auth-screen').classList.add('hidden');
    const appEl = document.getElementById('app');
    appEl.classList.remove('hidden');
    appEl.classList.add('grid');

    UI.renderFooterUser(user);

    if (Auth.isAdmin()) {
      document.getElementById('create-text-channel').style.display  = 'flex';
      document.getElementById('create-voice-channel').style.display = 'flex';
    }

    [channels, allUsers] = await Promise.all([API.getChannels(), API.getUsers()]);
    UI.setUsers(allUsers);
    renderChannels();
    connectSocket(user);
  }

  function connectSocket(user) {
    socket = io({ auth: { token: API.getToken() } });
    Voice.init(socket);
    Chat.init(socket);

    socket.on('online:list',   ids  => UI.setOnline(ids));
    socket.on('user:online',   ({ userId }) => UI.setUserOnline(userId));
    socket.on('user:offline',  ({ userId }) => UI.setUserOffline(userId));
    socket.on('chat:message',  msg  => Chat.onMessage(msg));
    socket.on('chat:deleted',  data => Chat.onDeleted(data));
    socket.on('dm:message',    msg  => Chat.onDMMessage(msg));
    socket.on('voice:peer:joined', data => Voice.onPeerJoined(data));
    socket.on('voice:peer:left',   data => Voice.onPeerLeft(data));
    socket.on('voice:peers',       peers => Voice.onExistingPeers(peers));
    socket.on('voice:members', ({ channelId, members }) => updateVoiceMemberCount(channelId, members.length));
    socket.on('ephemeral:list',    list => { ephemeralList = list; renderEphemeralChannels(); });
    socket.on('ephemeral:created', ({ eid, voiceName, withText }) => {
      socket.emit('ephemeral:join', { eid });
      Voice.joinRoom(eid, 'ephemeral', `ephemeral:${eid}`, voiceName);
      document.getElementById('channel-name').textContent = voiceName;
      document.getElementById('channel-icon').textContent = '✨';
      if (withText) setupEphemeralText(eid);
    });
    socket.on('kicked', () => { alert('Vous avez été expulsé.'); API.clearToken(); location.reload(); });
  }

  // ── Canaux ────────────────────────────────────────────────────────────────
  function renderChannels() {
    document.getElementById('text-channels').innerHTML  = '';
    document.getElementById('voice-channels').innerHTML = '';
    channels.forEach(ch => {
      const li = createChannelItem(ch);
      document.getElementById(ch.type === 'text' ? 'text-channels' : 'voice-channels').appendChild(li);
    });
  }

  function createChannelItem(ch) {
    const li = document.createElement('li');
    li.className = 'channel-item flex items-center gap-2 px-3 py-1.5 mx-1.5 rounded-md text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text cursor-pointer transition-colors text-[0.9rem] group';
    li.dataset.id   = ch.id;
    li.dataset.type = ch.type;

    const icon = document.createElement('span');
    icon.className = 'text-[0.85rem] shrink-0';
    icon.textContent = ch.type === 'text' ? '#' : '🔊';

    const name = document.createElement('span');
    name.className = 'flex-1 truncate';
    name.textContent = ch.name;

    li.append(icon, name);

    if (ch.type === 'voice') {
      const count = document.createElement('span');
      count.id = `vc-count-${ch.id}`;
      count.className = 'text-[0.7rem] text-onkoz-text-muted bg-onkoz-hover rounded-full px-1.5 hidden';
      li.append(count);
    }

    if (Auth.isAdmin()) {
      const del = document.createElement('button');
      del.className = 'hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-onkoz-danger hover:bg-onkoz-danger/20 text-xs shrink-0 transition-colors';
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
    ephemeralList.forEach(eph => {
      const li = document.createElement('li');
      li.className = 'flex items-center gap-2 px-3 py-1.5 mx-1.5 rounded-md text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text cursor-pointer transition-colors text-[0.9rem]';
      li.innerHTML = `<span class="shrink-0">✨</span><span class="flex-1 truncate">${eph.voiceName}</span><span class="text-[0.7rem] text-onkoz-text-muted bg-onkoz-hover rounded-full px-1.5">${eph.memberCount}</span>`;
      li.addEventListener('click', () => {
        socket.emit('ephemeral:join', { eid: eph.id });
        Voice.joinRoom(eph.id, 'ephemeral', `ephemeral:${eph.id}`, eph.voiceName);
        document.getElementById('channel-name').textContent = eph.voiceName;
        document.getElementById('channel-icon').textContent = '✨';
        if (eph.withText) setupEphemeralText(eph.id);
      });
      list.appendChild(li);
    });
  }

  function selectChannel(ch) {
    document.querySelectorAll('.channel-item').forEach(el => {
      el.classList.remove('bg-onkoz-active', 'text-onkoz-text');
      el.classList.add('text-onkoz-text-md');
    });
    const active = document.querySelector(`[data-id="${ch.id}"]`);
    if (active) {
      active.classList.add('bg-onkoz-active', 'text-onkoz-text');
      active.classList.remove('text-onkoz-text-md');
    }

    document.getElementById('channel-icon').textContent = ch.type === 'text' ? '#' : '🔊';
    document.getElementById('channel-name').textContent = ch.name;

    if (ch.type === 'text') {
      if (Voice.getCurrentRoomId()?.startsWith('voice:')) Voice.leaveRoom();
      Chat.joinTextChannel(ch.id, ch.name);
    } else {
      document.getElementById('message-input-area').style.display = 'none';
      socket.emit('voice:join', { channelId: ch.id });
      Voice.joinRoom(ch.id, 'permanent', `voice:${ch.id}`, ch.name);
    }
  }

  function updateVoiceMemberCount(channelId, count) {
    const el = document.getElementById(`vc-count-${channelId}`);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }

  // ── Créer / Supprimer salon ───────────────────────────────────────────────
  async function createChannel(type) {
    const result = await UI.openModal(`Créer un salon ${type === 'text' ? 'texte' : 'vocal'}`, {
      placeholder: type === 'text' ? 'general' : 'vocal-general',
    });
    if (!result) return;
    try {
      const ch = await API.createChannel(result.name, type);
      channels.push(ch);
      const li = createChannelItem(ch);
      document.getElementById(type === 'text' ? 'text-channels' : 'voice-channels').appendChild(li);
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

  // ── Éphémère ─────────────────────────────────────────────────────────────
  async function createEphemeral() {
    const result = await UI.openModal('Créer un salon éphémère', {
      placeholder: 'Mon salon', ephemeral: true,
    });
    if (!result) return;
    socket.emit('ephemeral:create', { voiceName: result.name, withText: result.withText });
  }

  function setupEphemeralText(eid) {
    document.getElementById('message-input-area').style.display = 'block';
    const input   = document.getElementById('message-input').cloneNode(true);
    const sendBtn = document.getElementById('send-btn').cloneNode(true);
    document.getElementById('message-input').replaceWith(input);
    document.getElementById('send-btn').replaceWith(sendBtn);

    const doSend = () => {
      const c = input.value.trim();
      if (!c) return;
      socket.emit('ephemeral:message', { eid, content: c });
      input.value = '';
    };
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    socket.on('ephemeral:message', ({ eid: msgEid, username, role, content }) => {
      if (msgEid !== eid) return;
      const vr = document.querySelector('.voice-room-display') || document.getElementById('content-area').firstElementChild;
      if (!vr) return;
      let chat = document.getElementById('eph-chat');
      if (!chat) {
        chat = document.createElement('div');
        chat.id = 'eph-chat';
        chat.className = 'mt-4 w-full max-w-lg max-h-48 overflow-y-auto bg-onkoz-surface rounded-xl p-3 flex flex-col gap-1';
        document.getElementById('content-area').firstElementChild?.appendChild(chat);
      }
      const msg = document.createElement('div');
      msg.innerHTML = `<span class="msg-author font-bold text-sm ${role}">${username}</span> <span class="text-sm text-onkoz-text">${content}</span>`;
      chat.appendChild(msg);
      chat.scrollTop = chat.scrollHeight;
    });
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

  function bindEvents() {
    document.getElementById('create-text-channel').addEventListener('click',  () => createChannel('text'));
    document.getElementById('create-voice-channel').addEventListener('click', () => createChannel('voice'));
    document.getElementById('create-ephemeral').addEventListener('click',     () => createEphemeral());
    document.getElementById('mute-btn').addEventListener('click',       () => Voice.toggleMute());
    document.getElementById('leave-voice-btn').addEventListener('click', () => Voice.leaveRoom());

    const msgInput = document.getElementById('message-input');
    document.getElementById('send-btn').addEventListener('click', () => Chat.sendMessage());
    msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') Chat.sendMessage(); });

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
