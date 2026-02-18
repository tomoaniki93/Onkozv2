/* ── Voice Module ────────────────────────────────────────────────────────── */
const Voice = (() => {
  let device = null, sendTransport = null, recvTransport = null;
  let producer = null, consumers = new Map(), localStream = null;
  let isMuted = false, socket = null;
  let currentRoomId = null, currentChannelId = null, currentType = null;

  function init(s) { socket = s; }

  async function joinRoom(channelId, type, roomId, channelName) {
    if (currentRoomId) await leaveRoom();
    currentRoomId = roomId; currentChannelId = channelId; currentType = type;

    renderVoiceRoom(channelName);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      device = new mediasoupClient.Device();

      const { caps } = await socketEmit('ms:getRouterCapabilities', { roomId });
      await device.load({ routerRtpCapabilities: caps });

      // Send transport
      const sendParams = await socketEmit('ms:createTransport', { roomId });
      sendTransport = device.createSendTransport(sendParams);
      sendTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try { await socketEmit('ms:connectTransport', { roomId, transportId: sendTransport.id, dtlsParameters }); cb(); }
        catch (e) { eb(e); }
      });
      sendTransport.on('produce', async ({ kind, rtpParameters }, cb, eb) => {
        try { const { producerId } = await socketEmit('ms:produce', { roomId, transportId: sendTransport.id, kind, rtpParameters }); cb({ id: producerId }); }
        catch (e) { eb(e); }
      });

      producer = await sendTransport.produce({ track: localStream.getAudioTracks()[0] });

      // Recv transport
      const recvParams = await socketEmit('ms:createTransport', { roomId });
      recvTransport = device.createRecvTransport(recvParams);
      recvTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try { await socketEmit('ms:connectTransport', { roomId, transportId: recvTransport.id, dtlsParameters }); cb(); }
        catch (e) { eb(e); }
      });
    } catch (err) {
      console.error('[Voice]', err);
      showVoiceError(err.message);
      return;
    }

    socket.on('ms:newProducer', handleNewProducer);

    const vc = document.getElementById('voice-controls');
    vc.classList.remove('hidden');
    vc.classList.add('flex');
    updateMuteBtn();
  }

  async function handleNewProducer({ peerId, username }) {
    if (!recvTransport || !device) return;
    try {
      const data = await socketEmit('ms:consume', {
        roomId: currentRoomId, producerPeerId: peerId,
        transportId: recvTransport.id, rtpCapabilities: device.rtpCapabilities,
      });
      const consumer = await recvTransport.consume(data);
      consumers.set(peerId, consumer);
      const audio = new Audio();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play().catch(console.warn);
      addPeerToUI(peerId, username);
    } catch (err) { console.error('[Voice] consume:', err); }
  }

  async function leaveRoom() {
    if (!currentRoomId) return;
    currentType === 'permanent'
      ? socket.emit('voice:leave',    { channelId: currentChannelId })
      : socket.emit('ephemeral:leave', { eid: currentChannelId });

    socket.off('ms:newProducer', handleNewProducer);
    producer?.close(); sendTransport?.close(); recvTransport?.close();
    localStream?.getTracks().forEach(t => t.stop());
    consumers.clear();
    producer = recvTransport = sendTransport = localStream = device = null;
    currentRoomId = currentChannelId = currentType = null;
    isMuted = false;

    const vc = document.getElementById('voice-controls');
    vc.classList.add('hidden');
    vc.classList.remove('flex');

    document.getElementById('content-area').innerHTML = `
      <div class="flex flex-col items-center justify-center flex-1 gap-3 text-onkoz-text-muted">
        <div class="text-6xl">🎤</div>
        <h2 class="text-onkoz-text-md text-xl font-semibold">Bienvenue sur ONKOZ</h2>
        <p class="text-sm">Sélectionne un salon pour commencer</p>
      </div>`;
    document.getElementById('message-input-area').style.display = 'none';
    document.getElementById('channel-name').textContent = 'Sélectionne un salon';
  }

  function toggleMute() {
    isMuted = !isMuted;
    localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    btn.textContent = isMuted ? '🔇' : '🎤';
    btn.title = isMuted ? 'Activer le micro' : 'Couper le micro';
  }

  function addPeerToUI(peerId, username) {
    if (document.getElementById(`vp-${peerId}`)) return;
    const container = document.getElementById('voice-peers-container');
    if (!container) return;

    const peer = document.createElement('div');
    peer.id = `vp-${peerId}`;
    peer.className = 'voice-peer flex flex-col items-center gap-2 px-4 py-3 bg-onkoz-surface rounded-xl min-w-[80px] transition-all';
    peer.innerHTML = `
      <div class="${UI.avatarClass(username)} w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-white uppercase">${username[0]}</div>
      <span class="text-[0.8rem] text-onkoz-text-md text-center">${username}</span>`;
    container.appendChild(peer);
  }

  function removePeerFromUI(peerId) {
    document.getElementById(`vp-${peerId}`)?.remove();
    consumers.get(peerId)?.close();
    consumers.delete(peerId);
  }

  function renderVoiceRoom(channelName) {
    const user = Auth.getUser();
    document.getElementById('content-area').innerHTML = `
      <div class="flex flex-col items-center justify-center flex-1 gap-6">
        <h3 class="text-xl font-semibold text-onkoz-text-md">🎤 ${channelName}</h3>
        <div id="voice-peers-container" class="flex flex-wrap gap-4 justify-center">
          <div class="voice-peer flex flex-col items-center gap-2 px-4 py-3 bg-onkoz-surface rounded-xl min-w-[80px]">
            <div class="${UI.avatarClass(user.username)} w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-white uppercase">${user.username[0]}</div>
            <span class="text-[0.8rem] text-onkoz-text-md text-center">${user.username} <span class="text-onkoz-text-muted">(moi)</span></span>
          </div>
        </div>
      </div>`;
  }

  function showVoiceError(msg) {
    document.getElementById('content-area').innerHTML = `
      <div class="flex flex-col items-center justify-center flex-1 gap-3 text-onkoz-text-muted">
        <div class="text-5xl">⚠️</div>
        <h2 class="text-onkoz-text-md text-xl font-semibold">Erreur microphone</h2>
        <p class="text-sm text-center max-w-xs">${msg}<br>Vérifiez les permissions microphone dans votre navigateur.</p>
      </div>`;
  }

  function onPeerJoined({ peerId, username }) { addPeerToUI(peerId, username); }
  function onPeerLeft({ peerId }) { removePeerFromUI(peerId); }
  function onExistingPeers(peers) {
    peers.forEach(p => {
      addPeerToUI(p.peerId, p.username);
      if (recvTransport) handleNewProducer(p);
    });
  }

  function socketEmit(event, data) {
    return new Promise((resolve, reject) => {
      socket.emit(event, data, res => res?.error ? reject(new Error(res.error)) : resolve(res));
    });
  }

  return { init, joinRoom, leaveRoom, toggleMute, onPeerJoined, onPeerLeft, onExistingPeers, getCurrentRoomId: () => currentRoomId };
})();
