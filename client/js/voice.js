/* ── Voice Module ────────────────────────────────────────────────────────────
   Gère les salons vocaux via mediasoup-client + socket.io.
   ─────────────────────────────────────────────────────────────────────────── */
const Voice = (() => {
  let device       = null;
  let sendTransport = null;
  let recvTransport = null;
  let producer     = null;
  let consumers    = new Map(); // peerId → consumer
  let localStream  = null;
  let isMuted      = false;

  let currentRoomId   = null;
  let currentChannelId = null; // peut être un id numérique ou un eid éphémère
  let currentType     = null;  // 'permanent' | 'ephemeral'

  let socket = null; // référence au socket (injectée par App)

  function init(s) { socket = s; }

  // ── Rejoindre une salle ────────────────────────────────────────────────────
  async function joinRoom(channelId, type, roomId, channelName) {
    if (currentRoomId) await leaveRoom();

    currentRoomId    = roomId;
    currentChannelId = channelId;
    currentType      = type;

    // Afficher l'UI vocale
    renderVoiceRoom(channelName);

    try {
      // 1. Obtenir microphonie
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // 2. Créer le device mediasoup-client
      device = new mediasoupClient.Device();

      // 3. Obtenir RtpCapabilities du router
      const { caps } = await socketEmit('ms:getRouterCapabilities', { roomId });
      await device.load({ routerRtpCapabilities: caps });

      // 4. Transport d'envoi
      const sendParams = await socketEmit('ms:createTransport', { roomId });
      sendTransport = device.createSendTransport(sendParams);

      sendTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try {
          await socketEmit('ms:connectTransport', { roomId, transportId: sendTransport.id, dtlsParameters });
          cb();
        } catch (e) { eb(e); }
      });

      sendTransport.on('produce', async ({ kind, rtpParameters }, cb, eb) => {
        try {
          const { producerId } = await socketEmit('ms:produce', { roomId, transportId: sendTransport.id, kind, rtpParameters });
          cb({ id: producerId });
        } catch (e) { eb(e); }
      });

      // 5. Produire audio
      const audioTrack = localStream.getAudioTracks()[0];
      producer = await sendTransport.produce({ track: audioTrack });

      // 6. Transport de réception
      const recvParams = await socketEmit('ms:createTransport', { roomId });
      recvTransport = device.createRecvTransport(recvParams);

      recvTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try {
          await socketEmit('ms:connectTransport', { roomId, transportId: recvTransport.id, dtlsParameters });
          cb();
        } catch (e) { eb(e); }
      });

    } catch (err) {
      console.error('[Voice] Erreur microphonie ou mediasoup:', err);
      showVoiceError(err.message);
      return;
    }

    // 7. Écouter les nouveaux producers
    socket.on('ms:newProducer', handleNewProducer);

    // Mettre à jour les contrôles
    document.getElementById('voice-controls').classList.remove('hidden');
    updateMuteBtn();
  }

  async function handleNewProducer({ peerId, userId, username, producerId }) {
    if (!recvTransport || !device) return;

    try {
      const data = await socketEmit('ms:consume', {
        roomId: currentRoomId,
        producerPeerId: peerId,
        transportId: recvTransport.id,
        rtpCapabilities: device.rtpCapabilities,
      });

      const consumer = await recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      consumers.set(peerId, consumer);

      // Lire l'audio
      const audio = new Audio();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play().catch(console.warn);

      // Ajouter peer dans l'UI
      addPeerToUI(peerId, username);
    } catch (err) {
      console.error('[Voice] consume error:', err);
    }
  }

  // ── Quitter la salle ───────────────────────────────────────────────────────
  async function leaveRoom() {
    if (!currentRoomId) return;

    if (currentType === 'permanent') {
      socket.emit('voice:leave', { channelId: currentChannelId });
    } else {
      socket.emit('ephemeral:leave', { eid: currentChannelId });
    }

    socket.off('ms:newProducer', handleNewProducer);

    producer?.close();
    sendTransport?.close();
    recvTransport?.close();
    localStream?.getTracks().forEach(t => t.stop());
    consumers.clear();

    producer = recvTransport = sendTransport = localStream = device = null;
    currentRoomId = currentChannelId = currentType = null;
    isMuted = false;

    document.getElementById('voice-controls').classList.add('hidden');

    // Revenir à l'écran vide
    document.getElementById('content-area').innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-icon">🎤</div>
        <h2>Bienvenue sur ONKOZ</h2>
        <p>Sélectionne un salon pour commencer</p>
      </div>`;
    document.getElementById('message-input-area').style.display = 'none';
    document.getElementById('channel-name').textContent = 'Sélectionne un salon';
  }

  // ── Mute / Unmute ──────────────────────────────────────────────────────────
  function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    }
    producer?.pause();
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    btn.textContent = isMuted ? '🔇' : '🎤';
    btn.title       = isMuted ? 'Activer le micro' : 'Couper le micro';
    btn.classList.toggle('muted', isMuted);
  }

  // ── Gestion des peers ──────────────────────────────────────────────────────
  function addPeerToUI(peerId, username) {
    const existing = document.getElementById(`vp-${peerId}`);
    if (existing) return;

    const peers = document.querySelector('.voice-peers');
    if (!peers) return;

    const peer = document.createElement('div');
    peer.className = 'voice-peer';
    peer.id = `vp-${peerId}`;
    peer.innerHTML = `
      <div class="vp-avatar ${UI.avatarClass(username)}">${username[0].toUpperCase()}</div>
      <span class="vp-name">${username}</span>
    `;
    peers.appendChild(peer);
  }

  function removePeerFromUI(peerId) {
    document.getElementById(`vp-${peerId}`)?.remove();
    consumers.get(peerId)?.close();
    consumers.delete(peerId);
  }

  // ── Rendu UI salle vocale ──────────────────────────────────────────────────
  function renderVoiceRoom(channelName) {
    const user = Auth.getUser();
    const area = document.getElementById('content-area');
    area.innerHTML = `
      <div class="voice-room-display">
        <h3>🎤 ${channelName}</h3>
        <div class="voice-peers" id="voice-peers-container">
          <div class="voice-peer" id="vp-self">
            <div class="vp-avatar ${UI.avatarClass(user.username)}">${user.username[0].toUpperCase()}</div>
            <span class="vp-name">${user.username} (moi)</span>
          </div>
        </div>
      </div>`;
  }

  function showVoiceError(msg) {
    const area = document.getElementById('content-area');
    area.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-icon">⚠️</div>
        <h2>Erreur microphone</h2>
        <p>${msg}</p>
        <p>Vérifiez les permissions microphone dans votre navigateur.</p>
      </div>`;
  }

  // ── Gestion pairs distants (events socket) ─────────────────────────────────
  function onPeerJoined({ peerId, userId, username }) {
    addPeerToUI(peerId, username);
  }

  function onPeerLeft({ peerId }) {
    removePeerFromUI(peerId);
  }

  function onExistingPeers(peers) {
    // Consommer les producers existants
    for (const peer of peers) {
      if (recvTransport) {
        handleNewProducer({ peerId: peer.peerId, userId: peer.userId, username: peer.username });
      }
      addPeerToUI(peer.peerId, peer.username);
    }
  }

  // ── Helper socket promise ──────────────────────────────────────────────────
  function socketEmit(event, data) {
    return new Promise((resolve, reject) => {
      socket.emit(event, data, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }

  return {
    init, joinRoom, leaveRoom, toggleMute,
    onPeerJoined, onPeerLeft, onExistingPeers,
    getCurrentRoomId: () => currentRoomId,
  };
})();
