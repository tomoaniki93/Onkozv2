/* ── Chat Module ─────────────────────────────────────────────────────────── */
const Chat = (() => {
  let socket = null;
  let currentTextChannel = null;
  let dmPartnerId   = null;
  let dmPartnerName = null;

  function init(s) { socket = s; }

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
  }

  function appendMessage(msg, area, scroll = true) {
    const isMod = Auth.isMod();

    const div = document.createElement('div');
    div.dataset.msgId = msg.id;
    div.className = 'group flex gap-3 px-2 py-1 rounded-md hover:bg-onkoz-hover transition-colors';

    // Avatar
    const av = UI.makeAvatar(msg.username);

    // Body
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

    const content = document.createElement('div');
    content.className = 'text-[0.9rem] text-onkoz-text leading-relaxed break-words';
    content.textContent = msg.content;

    body.append(header, content);
    div.append(av, body);

    // Supprimer (mod/admin)
    if (isMod) {
      const delBtn = document.createElement('button');
      delBtn.className = 'hidden group-hover:block text-[0.7rem] text-onkoz-danger bg-onkoz-danger/15 hover:bg-onkoz-danger/30 px-1.5 py-px rounded transition-colors shrink-0 self-start mt-1';
      delBtn.textContent = '🗑';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('click', () => socket.emit('chat:delete', { messageId: msg.id, channelId: currentTextChannel }));
      div.append(delBtn);
    }

    area.appendChild(div);
    if (scroll) area.scrollTop = area.scrollHeight;
  }

  function onMessage(msg) {
    if (msg.channel_id != currentTextChannel) return;
    appendMessage(msg, document.getElementById('content-area'), true);
  }

  function onDeleted({ messageId }) {
    document.querySelector(`[data-msg-id="${messageId}"]`)?.remove();
  }

  function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    socket.emit('chat:message', { channelId: currentTextChannel, content });
    input.value = '';
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

  return { init, joinTextChannel, onMessage, onDeleted, sendMessage, openDM, onDMMessage, sendDM, closeDM };
})();
