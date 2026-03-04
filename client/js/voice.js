/* ── Voice Module ─────────────────────────────────────────────────────────────
   Gestion de la voix via mediasoup-client + partage d'écran.

   Pipeline audio (PATCH NoiseReducer) :
     getUserMedia → NoiseReducer.process() → sendTransport.produce()

   Le stream brut ne passe JAMAIS directement à mediasoup.
   NoiseReducer.process() retourne le stream traité (ou le stream brut si
   la réduction de bruit est désactivée dans les options).
   ─────────────────────────────────────────────────────────────────────────── */
const Voice = (() => {

  // ── État interne ────────────────────────────────────────────────────────────
  let device        = null;
  let sendTransport = null;
  let recvTransport = null;
  let producer      = null;
  let consumers     = new Map(); // peerId → consumer audio
  let localStream   = null;     // stream brut (micro)
  let processedStream = null;   // stream après NoiseReducer (envoyé à mediasoup)
  let isMuted       = false;
  let socket        = null;

  let currentRoomId    = null;
  let currentChannelId = null;
  let currentType      = null;  // 'permanent' | 'ephemeral'
  let pendingPeers     = [];

  // ── Partage d'écran ─────────────────────────────────────────────────────────
  let screenProducer  = null;
  let screenStream    = null;
  let isSharing       = false;
  let screenConsumers = new Map(); // peerId → consumer vidéo

  // ── Init ────────────────────────────────────────────────────────────────────
  function init(s) { socket = s; }

  // ═══════════════════════════════════════════════════════════════════════════
  //  REJOINDRE UN SALON
  // ═══════════════════════════════════════════════════════════════════════════
  async function joinRoom(channelId, type, roomId, channelName) {
    if (currentRoomId) await leaveRoom();
    currentRoomId    = roomId;
    currentChannelId = channelId;
    currentType      = type;

    renderVoiceRoom(channelName);

    try {
      // 1. Obtenir le stream brut depuis le micro
      const micId = AudioSettings.getMicId();
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: micId && micId !== 'default' ? { deviceId: { ideal: micId } } : true,
        video: false,
      });

      // 2. ✅ PATCH — Passer le stream par le pipeline de traitement audio
      //    HighPass → LowPass → Compresseur → NoiseGate (AudioWorklet)
      //    Si NoiseReducer est désactivé dans les options → retourne localStream brut
      processedStream = await NoiseReducer.process(localStream);
      console.log('[Voice] NoiseReducer actif :', processedStream !== localStream);

      // 3. Créer le device mediasoup-client
      device = new mediasoupClient.Device();

      // 4. Charger les capabilities du router
      const { caps } = await socketEmit('ms:getRouterCapabilities', { roomId });
      await device.load({ routerRtpCapabilities: caps });

      // 5. Transport d'envoi
      const sendParams = await socketEmit('ms:createTransport', { roomId });
      sendTransport = device.createSendTransport(sendParams);

      sendTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try {
          await socketEmit('ms:connectTransport', {
            roomId, transportId: sendTransport.id, dtlsParameters,
          });
          cb();
        } catch (e) { eb(e); }
      });

      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, cb, eb) => {
        try {
          const { producerId } = await socketEmit('ms:produce', {
            roomId, transportId: sendTransport.id, kind, rtpParameters, appData,
          });
          cb({ id: producerId });
        } catch (e) { eb(e); }
      });

      // 6. ✅ PATCH — Envoyer la piste TRAITÉE (pas la piste brute)
      producer = await sendTransport.produce({
        track: processedStream.getAudioTracks()[0],
        codecOptions: { opusStereo: false, opusDtx: true },
      });

      // 7. Transport de réception
      const recvParams = await socketEmit('ms:createTransport', { roomId });
      recvTransport = device.createRecvTransport(recvParams);

      recvTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
        try {
          await socketEmit('ms:connectTransport', {
            roomId, transportId: recvTransport.id, dtlsParameters,
          });
          cb();
        } catch (e) { eb(e); }
      });

      // 8. Consommer les pairs déjà présents (arrivés avant recvTransport)
      if (pendingPeers.length > 0) {
        pendingPeers.forEach(p => {
          addPeerToUI(p.peerId, p.username);
          handleNewProducer(p);
        });
        pendingPeers = [];
      }

    } catch (err) {
      console.error('[Voice] Erreur joinRoom :', err);
      showVoiceError(err.message);
      return;
    }

    // 9. Écouter les nouveaux producers
    socket.off('ms:newProducer', handleNewProducer);
    socket.on('ms:newProducer', handleNewProducer);

    // 10. Consommer les producers déjà actifs (ex: screen share en cours)
    socket.off('ms:existingProducers');
    socket.on('ms:existingProducers', (producers) => {
      producers.forEach(p => handleNewProducer(p));
    });

    updateMuteBtn();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSOMMER UN PRODUCER DISTANT
  // ═══════════════════════════════════════════════════════════════════════════
  async function handleNewProducer({ peerId, producerId, username, appData }) {
    if (!recvTransport || !device) {
      pendingPeers.push({ peerId, producerId, username, appData });
      return;
    }
    try {
      const data = await socketEmit('ms:consume', {
        roomId: currentRoomId,
        producerId,
        producerPeerId: peerId,
        transportId: recvTransport.id,
        rtpCapabilities: device.rtpCapabilities,
      });
      const consumer = await recvTransport.consume(data);

      if (consumer.track.kind === 'video') {
        // ── Flux vidéo = partage d'écran ──
        screenConsumers.set(peerId, consumer);
        showScreenOverlay(consumer.track, peerId, username || peerId);
      } else {
        // ── Flux audio ──
        consumers.set(peerId, consumer);
        const audio = new Audio();
        audio.srcObject = new MediaStream([consumer.track]);
        const vol = parseInt(localStorage.getItem('onkoz_volume') || '100') / 100;
        audio.volume = vol;
        audio.play().catch(console.warn);
        addPeerToUI(peerId, username);
      }
    } catch (err) {
      console.error('[Voice] consume :', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  QUITTER LE SALON
  // ═══════════════════════════════════════════════════════════════════════════
  async function leaveRoom() {
    if (!currentRoomId) return;

    // Arrêter le partage d'écran proprement
    if (isSharing) await stopScreenShare(false);

    // Signaler au serveur
    currentType === 'permanent'
      ? socket.emit('voice:leave',     { channelId: currentChannelId })
      : socket.emit('ephemeral:leave', { eid: currentChannelId });

    // Détacher le listener
    socket.off('ms:newProducer', handleNewProducer);

    // Fermer les transports mediasoup
    producer?.close();
    sendTransport?.close();
    recvTransport?.close();

    // ✅ PATCH — Arrêter le stream traité (libère l'AudioContext de NoiseReducer)
    if (processedStream && processedStream !== localStream) {
      processedStream.getTracks().forEach(t => t.stop());
    }
    processedStream = null;

    // Arrêter le stream brut (libère le micro)
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;

    // ✅ PATCH — Fermer l'AudioContext de NoiseReducer
    if (typeof NoiseReducer !== 'undefined') {
      NoiseReducer.dispose();
    }

    // Fermer tous les consumers
    consumers.forEach(c => c.close());
    screenConsumers.forEach(c => c.close());
    consumers.clear();
    screenConsumers.clear();

    // Réinitialiser l'état
    producer = sendTransport = recvTransport = device = null;
    currentRoomId = currentChannelId = currentType = null;
    isMuted = false;
    pendingPeers = [];

    // Nettoyer les overlays
    document.querySelectorAll('[id^="screen-overlay-"]').forEach(el => el.remove());
    hideLocalPreview();

    // Réinitialiser la zone de contenu
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
  //  MUTE / UNMUTE
  // ═══════════════════════════════════════════════════════════════════════════
  function toggleMute() {
    isMuted = !isMuted;

    // Pause/resume au niveau mediasoup (coupe l'envoi RTP)
    if (producer) {
      isMuted ? producer.pause() : producer.resume();
    }

    // ✅ PATCH — Muter la piste traitée (celle que mediasoup utilise)
    processedStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });

    // Garder localStream en sync
    localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });

    updateMuteBtn();
  }

  function updateMuteBtn() {
    const btn = document.getElementById('voice-bar-mute');
    if (!btn) return;
    btn.textContent = isMuted ? '🔇' : '🎤';
    btn.title       = isMuted ? 'Activer le micro' : 'Couper le micro';
    btn.classList.toggle('muted', isMuted);
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
        encodings: [{ maxBitrate: 1_500_000, scaleResolutionDownBy: 1 }],
        codecOptions: { videoGoogleStartBitrate: 1000 },
      });

      isSharing = true;
      updateShareBtn(true);
      showLocalPreview(screenStream);

      // Informer les autres membres du salon
      socket.emit('screen:sharing', { roomId: currentRoomId, sharing: true });

      // Arrêt via le bouton natif du navigateur (Chrome "Arrêter le partage")
      videoTrack.addEventListener('ended', () => stopScreenShare(true));

    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('[ScreenShare]', err);
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

    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 bg-onkoz-surface border border-onkoz-border rounded-full px-4 py-2 text-sm font-semibold text-onkoz-text';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-onkoz-success animate-pulse shrink-0"></span> Tu partages ton écran';

    const video = document.createElement('video');
    video.className = 'max-w-5xl max-h-[70vh] rounded-xl border border-onkoz-border shadow-dm object-contain';
    video.srcObject = stream;
    video.autoplay  = true;
    video.muted     = true;

    const btns = document.createElement('div');
    btns.className = 'flex items-center gap-3';

    const stopBtn = document.createElement('button');
    stopBtn.className = 'flex items-center gap-2 px-5 py-2.5 bg-onkoz-danger/20 hover:bg-onkoz-danger/30 text-onkoz-danger border border-onkoz-danger/30 font-semibold rounded-lg transition-colors';
    stopBtn.innerHTML = '⏹ Arrêter le partage';
    stopBtn.addEventListener('click', () => stopScreenShare(true));

    const hideBtn = document.createElement('button');
    hideBtn.className = 'flex items-center gap-2 px-4 py-2.5 bg-onkoz-surface border border-onkoz-border hover:bg-onkoz-hover text-onkoz-text font-medium rounded-lg transition-colors text-sm';
    hideBtn.innerHTML = '✕ Masquer l\'aperçu';
    hideBtn.addEventListener('click', () => overlay.remove());

    btns.append(stopBtn, hideBtn);
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

    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 bg-onkoz-surface border border-onkoz-border rounded-full px-4 py-2 text-sm font-semibold text-onkoz-text';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-onkoz-success animate-pulse shrink-0"></span> <strong>${username}</strong>&nbsp;partage son écran`;

    const video = document.createElement('video');
    video.className = 'max-w-5xl max-h-[70vh] rounded-xl border border-onkoz-border shadow-dm object-contain';
    video.srcObject = new MediaStream([track]);
    video.autoplay  = true;
    video.muted     = false;

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
        video.classList.remove('max-w-5xl', 'max-h-[70vh]');
        video.classList.add('w-64', 'h-36');
        overlay.className = 'fixed bottom-20 right-4 z-[200] flex flex-col items-center gap-2';
        minimizeBtn.textContent = '⬆ Agrandir';
      } else {
        video.classList.add('max-w-5xl', 'max-h-[70vh]');
        video.classList.remove('w-64', 'h-36');
        overlay.className = 'fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center gap-4';
        minimizeBtn.textContent = '⬇ Réduire';
      }
    });

    btns.append(closeBtn, minimizeBtn);
    overlay.append(badge, video, btns);
    document.body.appendChild(overlay);
  }

  function hideScreenOverlay(peerId = null) {
    if (peerId) {
      document.getElementById(`screen-overlay-${peerId}`)?.remove();
      screenConsumers.get(peerId)?.close();
      screenConsumers.delete(peerId);
    } else {
      document.querySelectorAll('[id^="screen-overlay-"]').forEach(el => el.remove());
      screenConsumers.forEach(c => c.close());
      screenConsumers.clear();
      hideLocalPreview();
    }
  }

  function updateShareBtn(sharing) {
    const btn = document.getElementById('voice-bar-screenshare');
    if (!btn) return;
    if (sharing) {
      btn.textContent = '⏹';
      btn.title = 'Arrêter le partage';
      btn.classList.add('text-onkoz-danger');
      btn.classList.remove('text-onkoz-text-muted');
    } else {
      btn.textContent = '🖥️';
      btn.title = 'Partager l\'écran';
      btn.classList.remove('text-onkoz-danger');
      btn.classList.add('text-onkoz-text-muted');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI — PEERS
  // ═══════════════════════════════════════════════════════════════════════════
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
    // Fermer l'overlay de partage d'écran si ce pair partageait
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
          <div class="voice-peer flex flex-col items-center gap-2 px-4 py-3 bg-onkoz-surface rounded-xl min-w-[80px]" id="vp-self">
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  EVENTS SOCKET ENTRANTS
  // ═══════════════════════════════════════════════════════════════════════════
  function onPeerJoined({ peerId, username }) {
    addPeerToUI(peerId, username);
  }

  function onPeerLeft({ peerId }) {
    removePeerFromUI(peerId);
  }

  function onExistingPeers(peers) {
    if (!recvTransport) {
      pendingPeers = peers;
      return;
    }
    peers.forEach(p => {
      addPeerToUI(p.peerId, p.username);
      handleNewProducer(p);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HELPER
  // ═══════════════════════════════════════════════════════════════════════════
  function socketEmit(event, data) {
    return new Promise((resolve, reject) => {
      socket.emit(event, data, res =>
        res?.error ? reject(new Error(res.error)) : resolve(res)
      );
    });
  }

  // ── API publique ────────────────────────────────────────────────────────────
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
