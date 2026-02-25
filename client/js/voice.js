/* ── Voice Module ────────────────────────────────────────────────────────── */
const Voice = (() => {
  let device = null, sendTransport = null, recvTransport = null;
  let producer = null, consumers = new Map(), localStream = null;
  let isMuted = false, socket = null;
  let currentRoomId = null, currentChannelId = null, currentType = null;
  let pendingPeers = [];

  // ── Partage d'écran ────────────────────────────────────────────────────────
  let screenProducer  = null;
  let screenStream    = null;
  let isSharing       = false;
  let screenConsumers = new Map(); // peerId → consumer

  function init(s) { socket = s; }

  // ── Rejoindre un salon vocal ───────────────────────────────────────────────
  async function joinRoom(channelId, type, roomId, channelName) {
    if (currentRoomId) await leaveRoom();
    currentRoomId = roomId; currentChannelId = channelId; currentType = type;

    renderVoiceRoom(channelName);

    try {
      const micId = AudioSettings.getMicId();
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: micId && micId !== 'default'
          ? { deviceId: { ideal: micId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      // Appliquer la chaîne de réduction de bruit
      localStream = await NoiseReducer.process(rawStream);
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

      // Consommer les pairs en attente
      if (pendingPeers.length > 0) {
        pendingPeers.forEach(p => { addPeerToUI(p.peerId, p.username); handleNewProducer(p); });
        pendingPeers = [];
      }

    } catch (err) {
      console.error('[Voice]', err);
      showVoiceError(err.message);
      return;
    }

    socket.on('ms:newProducer', handleNewProducer);
    updateMuteBtn();
  }

  // ── Consommer un producer distant ─────────────────────────────────────────
  async function handleNewProducer({ peerId, username, appData }) {
    if (!recvTransport || !device) return;
    try {
      const data = await socketEmit('ms:consume', {
        roomId: currentRoomId, producerPeerId: peerId,
        transportId: recvTransport.id, rtpCapabilities: device.rtpCapabilities,
      });
      const consumer = await recvTransport.consume(data);

      if (consumer.track.kind === 'video') {
        // ── Flux vidéo = partage d'écran ──
        screenConsumers.set(peerId, consumer);
        showScreenOverlay(consumer.track, peerId, username || peerId);
      } else {
        // ── Flux audio normal ──
        consumers.set(peerId, consumer);
        const audio = new Audio();
        audio.srcObject = new MediaStream([consumer.track]);
        const vol = parseInt(localStorage.getItem('onkoz_volume') || '100') / 100;
        audio.volume = vol;
        audio.play().catch(console.warn);
        addPeerToUI(peerId, username);
      }
    } catch (err) { console.error('[Voice] consume:', err); }
  }

  // ── Quitter le salon ───────────────────────────────────────────────────────
  async function leaveRoom() {
    if (!currentRoomId) return;
    if (isSharing) await stopScreenShare(false);
    NoiseReducer.dispose();

    currentType === 'permanent'
      ? socket.emit('voice:leave',    { channelId: currentChannelId })
      : socket.emit('ephemeral:leave', { eid: currentChannelId });

    socket.off('ms:newProducer', handleNewProducer);
    producer?.close(); sendTransport?.close(); recvTransport?.close();
    localStream?.getTracks().forEach(t => t.stop());
    consumers.forEach(c => c.close());
    screenConsumers.forEach(c => c.close());
    consumers.clear(); screenConsumers.clear();
    producer = recvTransport = sendTransport = localStream = device = null;
    currentRoomId = currentChannelId = currentType = null;
    isMuted = false; pendingPeers = [];

    hideAllScreenOverlays();

    document.getElementById('content-area').innerHTML = `
      <div class="flex flex-col items-center justify-center flex-1 gap-3 text-onkoz-text-muted">
        <div class="text-6xl">🎤</div>
        <h2 class="text-onkoz-text-md text-xl font-semibold">Bienvenue sur ONKOZ</h2>
        <p class="text-sm">Sélectionne un salon pour commencer</p>
      </div>`;
    document.getElementById('message-input-area').style.display = 'none';
    document.getElementById('channel-name').textContent = 'Sélectionne un salon';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PARTAGE D'ÉCRAN
  // ═══════════════════════════════════════════════════════════════════════════

  async function toggleScreenShare() {
    isSharing ? await stopScreenShare(true) : await startScreenShare();
  }

  async function startScreenShare() {
    if (!currentRoomId || !sendTransport) {
      AudioSettings.showToast('⚠️ Rejoins d\'abord un salon vocal');
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

      // Arrêt via bouton natif navigateur
      videoTrack.addEventListener('ended', () => stopScreenShare(true));

    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        AudioSettings.showToast(`❌ Partage impossible : ${err.message}`);
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
      socket.emit('screen:stop', { roomId: currentRoomId });
    }
  }

  // ── Aperçu local (partageur) ───────────────────────────────────────────────
  function showLocalPreview(stream) {
    hideLocalPreview();
    const overlay = document.createElement('div');
    overlay.id = 'screen-local-preview';
    overlay.className = 'fixed inset-0 z-[200] bg-black/85 flex flex-col items-center justify-center gap-4';

    // Badge "En direct"
    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 bg-onkoz-surface border border-onkoz-border rounded-full px-4 py-2 text-sm font-semibold text-onkoz-text';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-onkoz-danger animate-pulse shrink-0"></span> Vous partagez votre écran`;

    // Vidéo
    const video = document.createElement('video');
    video.className = 'max-w-5xl max-h-[65vh] rounded-xl border border-onkoz-border shadow-dm object-contain';
    video.srcObject = stream;
    video.autoplay  = true;
    video.muted     = true;

    // Boutons
    const btns = document.createElement('div');
    btns.className = 'flex items-center gap-3';

    const stopBtn = document.createElement('button');
    stopBtn.className = 'flex items-center gap-2 px-5 py-2.5 bg-onkoz-danger hover:bg-red-700 text-white font-semibold rounded-lg transition-colors';
    stopBtn.innerHTML = '⏹ Arrêter le partage';
    stopBtn.addEventListener('click', () => stopScreenShare(true));

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'flex items-center gap-2 px-4 py-2.5 bg-onkoz-surface border border-onkoz-border hover:bg-onkoz-hover text-onkoz-text font-medium rounded-lg transition-colors text-sm';
    minimizeBtn.innerHTML = '⬇ Réduire';
    let minimized = false;
    minimizeBtn.addEventListener('click', () => {
      minimized = !minimized;
      if (minimized) {
        overlay.className = 'fixed bottom-20 right-4 z-[200] flex flex-col items-end gap-2';
        video.className   = 'w-56 h-32 rounded-lg border border-onkoz-border shadow-dm object-contain';
        badge.classList.add('hidden');
        minimizeBtn.innerHTML = '⬆ Agrandir';
      } else {
        overlay.className = 'fixed inset-0 z-[200] bg-black/85 flex flex-col items-center justify-center gap-4';
        video.className   = 'max-w-5xl max-h-[65vh] rounded-xl border border-onkoz-border shadow-dm object-contain';
        badge.classList.remove('hidden');
        minimizeBtn.innerHTML = '⬇ Réduire';
      }
    });

    btns.append(stopBtn, minimizeBtn);
    overlay.append(badge, video, btns);
    document.body.appendChild(overlay);
  }

  function hideLocalPreview() {
    document.getElementById('screen-local-preview')?.remove();
  }

  // ── Overlay spectateur ─────────────────────────────────────────────────────
  function showScreenOverlay(track, peerId, username) {
    document.getElementById(`screen-overlay-${peerId}`)?.remove();

    const overlay = document.createElement('div');
    overlay.id = `screen-overlay-${peerId}`;
    overlay.className = 'fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center gap-4';

    // Badge
    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 bg-onkoz-surface border border-onkoz-border rounded-full px-4 py-2 text-sm font-semibold text-onkoz-text';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-onkoz-success animate-pulse shrink-0"></span> <strong>${username}</strong>&nbsp;partage son écran`;

    // Vidéo
    const video = document.createElement('video');
    video.className = 'max-w-5xl max-h-[70vh] rounded-xl border border-onkoz-border shadow-dm object-contain';
    video.srcObject = new MediaStream([track]);
    video.autoplay  = true;
    video.muted     = false;
    video.controls  = false;

    // Boutons
    const btns = document.createElement('div');
    btns.className = 'flex items-center gap-3';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'flex items-center gap-2 px-5 py-2.5 bg-onkoz-surface border border-onkoz-border hover:bg-onkoz-hover text-onkoz-text font-semibold rounded-lg transition-colors';
    closeBtn.innerHTML = '✕ Fermer l\'aperçu';
    closeBtn.addEventListener('click', () => overlay.remove());

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'flex items-center gap-2 px-4 py-2.5 bg-onkoz-surface border border-onkoz-border hover:bg-onkoz-hover text-onkoz-text font-medium rounded-lg transition-colors text-sm';
    minimizeBtn.innerHTML = '⬇ Réduire';
    let minimized = false;
    minimizeBtn.addEventListener('click', () => {
      minimized = !minimized;
      if (minimized) {
        overlay.className = 'fixed bottom-20 right-4 z-[200] flex flex-col items-end gap-2';
        video.className   = 'w-56 h-32 rounded-lg border border-onkoz-border shadow-dm object-contain';
        badge.classList.add('hidden');
        minimizeBtn.innerHTML = '⬆ Agrandir';
      } else {
        overlay.className = 'fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center gap-4';
        video.className   = 'max-w-5xl max-h-[70vh] rounded-xl border border-onkoz-border shadow-dm object-contain';
        badge.classList.remove('hidden');
        minimizeBtn.innerHTML = '⬇ Réduire';
      }
    });

    btns.append(closeBtn, minimizeBtn);
    overlay.append(badge, video, btns);
    document.body.appendChild(overlay);
  }

  function hideAllScreenOverlays() {
    document.querySelectorAll('[id^="screen-overlay-"]').forEach(el => el.remove());
    hideLocalPreview();
    screenConsumers.forEach(c => c.close());
    screenConsumers.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function toggleMute() {
    isMuted = !isMuted;
    localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const icon = document.getElementById('voice-panel-mute-icon');
    const btn  = document.getElementById('voice-panel-mute');
    if (!icon || !btn) return;
    if (isMuted) {
      icon.textContent = '🔇';
      btn.title = 'Activer le micro';
      btn.classList.add('text-onkoz-danger', 'bg-onkoz-danger/15');
      btn.classList.remove('text-onkoz-text-muted');
    } else {
      icon.textContent = '🎤';
      btn.title = 'Couper le micro';
      btn.classList.remove('text-onkoz-danger', 'bg-onkoz-danger/15');
      btn.classList.add('text-onkoz-text-muted');
    }
  }

  function updateShareBtn(sharing) {
    const icon = document.getElementById('voice-panel-screen-icon');
    const btn  = document.getElementById('voice-panel-screenshare');
    if (!icon || !btn) return;
    if (sharing) {
      icon.textContent = '⏹';
      btn.title = 'Arrêter le partage';
      btn.classList.add('text-onkoz-danger');
      btn.classList.remove('text-onkoz-text-muted');
    } else {
      icon.textContent = '🖥️';
      btn.title = 'Partager l\'écran';
      btn.classList.remove('text-onkoz-danger');
      btn.classList.add('text-onkoz-text-muted');
    }
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
    // Fermer l'overlay si ce pair partageait
    document.getElementById(`screen-overlay-${peerId}`)?.remove();
    screenConsumers.get(peerId)?.close();
    screenConsumers.delete(peerId);
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

  function socketEmit(event, data) {
    return new Promise((resolve, reject) => {
      socket.emit(event, data, res => res?.error ? reject(new Error(res.error)) : resolve(res));
    });
  }

  function onPeerJoined({ peerId, username }) { addPeerToUI(peerId, username); }
  function onPeerLeft({ peerId })             { removePeerFromUI(peerId); }
  function onExistingPeers(peers) {
    if (!recvTransport) { pendingPeers = peers; return; }
    peers.forEach(p => { addPeerToUI(p.peerId, p.username); handleNewProducer(p); });
  }

  return {
    init, joinRoom, leaveRoom, toggleMute, toggleScreenShare,
    onPeerJoined, onPeerLeft, onExistingPeers,
    getCurrentRoomId: () => currentRoomId,
  };
})();
