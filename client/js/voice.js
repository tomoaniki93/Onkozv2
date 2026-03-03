/* ── Voice Module ────────────────────────────────────────────────────────────
   Gestion complète : audio WebRTC (mediasoup) + partage d'écran
   ──────────────────────────────────────────────────────────────────────────── */
const Voice = (() => {
  let device = null, sendTransport = null, recvTransport = null;
  let producer = null, consumers = new Map(), localStream = null;
  let isMuted = false, socket = null;
  let currentRoomId = null, currentChannelId = null, currentType = null;
  let pendingPeers = [];

  // ── Partage d'écran ────────────────────────────────────────────────────────
  let screenProducer  = null;   // producer vidéo local (partageur)
  let screenStream    = null;   // stream getDisplayMedia
  let isSharing       = false;
  let screenConsumers = new Map(); // peerId → consumer vidéo distant

  function init(s) { socket = s; }

  // ── Rejoindre un salon vocal ───────────────────────────────────────────────
  async function joinRoom(channelId, type, roomId, channelName) {
    if (currentRoomId) await leaveRoom();
    currentRoomId = roomId; currentChannelId = channelId; currentType = type;

    renderVoiceRoom(channelName);

    try {
      const micId = (typeof AudioSettings !== 'undefined') ? AudioSettings.getMicId() : null;
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: micId && micId !== 'default' ? { deviceId: { ideal: micId } } : true,
        video: false,
      });
      device = new mediasoupClient.Device();

      const { caps } = await socketEmit('ms:getRouterCapabilities', { roomId });
      await device.load({ routerRtpCapabilities: caps });

      // ── Send transport ──
      const sendParams = await socketEmit('ms:createTransport', { roomId });
      sendTransport = device.createSendTransport(sendParams);
      sendTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try { await socketEmit('ms:connectTransport', { roomId, transportId: sendTransport.id, dtlsParameters }); cb(); }
        catch (e) { eb(e); }
      });
      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, cb, eb) => {
        try {
          const { producerId } = await socketEmit('ms:produce', {
            roomId, transportId: sendTransport.id, kind, rtpParameters, appData,
          });
          cb({ id: producerId });
        } catch (e) { eb(e); }
      });

      producer = await sendTransport.produce({ track: localStream.getAudioTracks()[0] });

      // ── Recv transport ──
      const recvParams = await socketEmit('ms:createTransport', { roomId });
      recvTransport = device.createRecvTransport(recvParams);
      recvTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try { await socketEmit('ms:connectTransport', { roomId, transportId: recvTransport.id, dtlsParameters }); cb(); }
        catch (e) { eb(e); }
      });

      // Consommer les pairs déjà présents
      if (pendingPeers.length > 0) {
        onExistingPeers(pendingPeers);
        pendingPeers = [];
      }

    } catch (err) {
      console.error('[Voice]', err);
      showVoiceError(err.message);
      return;
    }

    socket.on('ms:newProducer', handleNewProducer);

    // Écouter les notifications de partage d'écran distant
    socket.on('screen:sharing', ({ peerId, username: peerName, sharing }) => {
      if (!sharing) hideScreenOverlay(peerId);
    });
    socket.on('screen:stopped', ({ peerId }) => {
      hideScreenOverlay(peerId);
    });

    const vc = document.getElementById('voice-controls');
    if (vc) { vc.classList.remove('hidden'); vc.classList.add('flex'); }
    updateMuteBtn();
  }

  // ── Consommer un producer distant ─────────────────────────────────────────
  // ✅ FIX BUG 3 : utiliser producerId (reçu dans ms:newProducer)
  async function handleNewProducer({ peerId, username: peerName, producerId, appData }) {
    if (!recvTransport || !device) return;
    try {
      const data = await socketEmit('ms:consume', {
        roomId: currentRoomId,
        producerId,           // ✅ plus producerPeerId
        transportId: recvTransport.id,
        rtpCapabilities: device.rtpCapabilities,
      });
      const consumer = await recvTransport.consume(data);

      if (consumer.track.kind === 'video' || data.appData?.screenShare) {
        // ── Partage d'écran distant ──
        screenConsumers.set(peerId, consumer);
        showScreenOverlay(consumer.track, peerId, peerName);
      } else {
        // ── Audio normal ──
        consumers.set(peerId, consumer);
        const audio = new Audio();
        audio.srcObject = new MediaStream([consumer.track]);
        const vol = parseInt(localStorage.getItem('onkoz_volume') || '100') / 100;
        audio.volume = vol;
        audio.play().catch(console.warn);
        addPeerToUI(peerId, peerName);
      }
    } catch (err) {
      console.error('[Voice] consume error:', err);
    }
  }

  // ── Quitter le salon ───────────────────────────────────────────────────────
  async function leaveRoom() {
    if (!currentRoomId) return;

    if (isSharing) await stopScreenShare(false);

    currentType === 'permanent'
      ? socket.emit('voice:leave',    { channelId: currentChannelId })
      : socket.emit('ephemeral:leave', { eid: currentChannelId });

    socket.off('ms:newProducer', handleNewProducer);
    socket.off('screen:sharing');
    socket.off('screen:stopped');

    producer?.close();
    for (const c of consumers.values()) c.close();
    for (const c of screenConsumers.values()) c.close();
    consumers.clear();
    screenConsumers.clear();

    localStream?.getTracks().forEach(t => t.stop());
    sendTransport?.close(); recvTransport?.close();
    device = null; sendTransport = null; recvTransport = null;
    producer = null; localStream = null;

    currentRoomId = null; currentChannelId = null; currentType = null;
    pendingPeers  = [];

    // Nettoyer overlays
    document.getElementById('screen-local-preview')?.remove();
    document.querySelectorAll('.screen-overlay-remote').forEach(el => el.remove());

    renderVoiceRoom(null);
    const vc = document.getElementById('voice-controls');
    if (vc) { vc.classList.add('hidden'); vc.classList.remove('flex'); }
  }

  // ── Mute / Unmute ──────────────────────────────────────────────────────────
  function toggleMute() {
    if (!producer) return;
    isMuted = !isMuted;
    isMuted ? producer.pause() : producer.resume();
    localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const btn = document.getElementById('voice-bar-mute');
    if (btn) btn.textContent = isMuted ? '🔇' : '🎤';
  }

  // ── Partage d'écran local ──────────────────────────────────────────────────
  async function toggleScreenShare() {
    isSharing ? await stopScreenShare(true) : await startScreenShare();
  }

  async function startScreenShare() {
    if (!currentRoomId || !sendTransport) {
      if (typeof AudioSettings !== 'undefined') AudioSettings.showToast('⚠️ Rejoins d\'abord un salon vocal');
      return;
    }
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      const videoTrack = screenStream.getVideoTracks()[0];

      screenProducer = await sendTransport.produce({
        track: videoTrack,
        appData: { kind: 'video', screenShare: true },
        encodings: [{ maxBitrate: 1_500_000 }],
        codecOptions: { videoGoogleStartBitrate: 1000 },
      });

      isSharing = true;
      updateShareBtn(true);
      showLocalPreview(screenStream);

      // Notifier les autres via le serveur
      socket.emit('screen:sharing', { roomId: currentRoomId, sharing: true });

      // Arrêt via bouton natif navigateur
      videoTrack.addEventListener('ended', () => stopScreenShare(true));

    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        if (typeof AudioSettings !== 'undefined') AudioSettings.showToast(`❌ Partage impossible : ${err.message}`);
      }
    }
  }

  async function stopScreenShare(notify = true) {
    screenProducer?.close();
    screenStream?.getTracks().forEach(t => t.stop());
    screenProducer = null;
    screenStream   = null;
    isSharing      = false;
    updateShareBtn(false);
    hideLocalPreview();
    if (notify && socket && currentRoomId) {
      socket.emit('screen:sharing', { roomId: currentRoomId, sharing: false });
    }
  }

  function updateShareBtn(active) {
    const btn = document.getElementById('voice-bar-screenshare');
    if (!btn) return;
    btn.textContent = active ? '🛑' : '🖥️';
    btn.title = active ? 'Arrêter le partage' : 'Partager l\'écran';
    if (active) btn.classList.add('text-onkoz-accent');
    else btn.classList.remove('text-onkoz-accent');
  }

  // ── Aperçu local (partageur) ───────────────────────────────────────────────
  function showLocalPreview(stream) {
    hideLocalPreview();
    const overlay = document.createElement('div');
    overlay.id = 'screen-local-preview';
    overlay.className = 'fixed inset-0 z-[200] bg-black/85 flex flex-col items-center justify-center gap-4';

    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 bg-onkoz-surface border border-onkoz-border rounded-full px-4 py-2 text-sm font-semibold text-onkoz-text';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Partage en cours';

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted    = true;
    video.className = 'max-w-[80vw] max-h-[70vh] rounded-xl border-2 border-onkoz-accent shadow-2xl';

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏹ Arrêter le partage';
    stopBtn.className   = 'px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition-colors';
    stopBtn.onclick     = () => stopScreenShare(true);

    overlay.append(badge, video, stopBtn);
    document.body.appendChild(overlay);
  }

  function hideLocalPreview() {
    document.getElementById('screen-local-preview')?.remove();
  }

  // ── Overlay distant (spectateur) ───────────────────────────────────────────
  function showScreenOverlay(track, peerId, peerName) {
    hideScreenOverlay(peerId);
    const overlay = document.createElement('div');
    overlay.id = `screen-overlay-${peerId}`;
    overlay.className = 'screen-overlay-remote fixed inset-0 z-[190] bg-black/90 flex flex-col items-center justify-center gap-3';

    const label = document.createElement('div');
    label.className = 'text-onkoz-text-muted text-sm font-medium';
    label.textContent = `🖥️ ${peerName} partage son écran`;

    const video = document.createElement('video');
    video.srcObject = new MediaStream([track]);
    video.autoplay  = true;
    video.muted     = true;
    video.className = 'max-w-[90vw] max-h-[80vh] rounded-xl border border-onkoz-border shadow-2xl';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Fermer';
    closeBtn.className   = 'px-4 py-1.5 bg-onkoz-surface border border-onkoz-border text-onkoz-text-muted hover:text-onkoz-text rounded-lg text-sm transition-colors';
    closeBtn.onclick     = () => hideScreenOverlay(peerId);

    overlay.append(label, video, closeBtn);
    document.body.appendChild(overlay);
  }

  function hideScreenOverlay(peerId) {
    document.getElementById(`screen-overlay-${peerId}`)?.remove();
    const consumer = screenConsumers.get(peerId);
    if (consumer) { try { consumer.close(); } catch {} screenConsumers.delete(peerId); }
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────
  function renderVoiceRoom(channelName) {
    const bar = document.getElementById('voice-bar');
    const nameEl = document.getElementById('voice-bar-channel');
    if (!bar) return;
    if (channelName) {
      if (nameEl) nameEl.textContent = channelName;
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }

  function addPeerToUI(peerId, peerName) {
    const container = document.getElementById('voice-peers');
    if (!container || container.querySelector(`[data-peer="${peerId}"]`)) return;
    const el = document.createElement('div');
    el.dataset.peer = peerId;
    el.className = 'flex items-center gap-2 text-sm text-onkoz-text-muted';
    el.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-400"></span>${peerName}`;
    container.appendChild(el);
  }

  function removePeerFromUI(peerId) {
    document.querySelector(`[data-peer="${peerId}"]`)?.remove();
    hideScreenOverlay(peerId);
  }

  function showVoiceError(msg) {
    if (typeof AudioSettings !== 'undefined') AudioSettings.showToast(`❌ ${msg}`);
    else console.error('[Voice]', msg);
  }

  // ── Socket helpers ─────────────────────────────────────────────────────────
  function socketEmit(event, data) {
    return new Promise((resolve, reject) => {
      socket.emit(event, data, (res) => {
        if (!res) return reject(new Error('Pas de réponse'));
        res.error ? reject(new Error(res.error)) : resolve(res);
      });
    });
  }

  function onPeerJoined({ peerId, username: peerName }) {
    addPeerToUI(peerId, peerName);
  }

  function onPeerLeft({ peerId }) {
    removePeerFromUI(peerId);
  }

  // ✅ FIX BUG 5 : consommer tous les producers de chaque peer existant
  function onExistingPeers(peers) {
    if (!recvTransport) { pendingPeers = peers; return; }
    peers.forEach(p => {
      addPeerToUI(p.peerId, p.username);
      if (p.producers && p.producers.length > 0) {
        // Consommer chaque producer du peer (audio + éventuel screen share)
        p.producers.forEach(prod => {
          handleNewProducer({
            peerId:   p.peerId,
            username: p.username,
            producerId: prod.producerId,
            appData:    prod.appData,
          });
        });
      } else {
        // Fallback ancien format (rétro-compat)
        handleNewProducer(p);
      }
    });
  }

  return {
    init,
    joinRoom,
    leaveRoom,
    toggleMute,
    toggleScreenShare,
    onPeerJoined,
    onPeerLeft,
    onExistingPeers,
    getCurrentRoomId: () => currentRoomId,
  };
})();
