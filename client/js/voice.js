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

  // ── Speaking detection ───────────────────────────────────────────────────
  let speakingAnalysers = new Map(); // peerId → { analyser, source, rafId }
  let selfAnalyser      = null;      // AnalyserNode sur le micro local
  let selfRafId         = null;
  const SPEAK_THRESHOLD = 12;        // 0–255, sensibilité voyant
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

    // ── IMPORTANT : enregistrer les listeners AVANT toute opération async ──
    // ms:existingProducers et ms:newProducer arrivent quasi-immédiatement après
    // voice:join (côté serveur). Si on les enregistre après getUserMedia +
    // transports (plusieurs secondes), les events sont perdus → pas de son.
    // handleNewProducer met en file d'attente si recvTransport pas encore prêt.
    pendingPeers = [];
    socket.off('ms:newProducer', handleNewProducer);
    socket.on('ms:newProducer', handleNewProducer);
    socket.off('ms:existingProducers');
    socket.on('ms:existingProducers', (producers) => {
      producers.forEach(p => handleNewProducer(p));
    });

    try {
      // 1. Obtenir le stream brut depuis le micro
      const micId = AudioSettings.getMicId();
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: micId && micId !== 'default' ? { deviceId: { ideal: micId } } : true,
        video: false,
      });

      // 2. Passer le stream par le pipeline de traitement audio
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

      // 6. Envoyer la piste TRAITÉE (jamais le stream brut)
      producer = await sendTransport.produce({
        track: processedStream.getAudioTracks()[0],
        codecOptions: {
          opusStereo:          false,
          opusDtx:             true,
          opusFec:             true,
          opusMaxPlaybackRate: 48000,
          opusPtime:           20,
        },
        encodings: [{ maxBitrate: 64_000 }],
      });

      // Démarrer la détection speaking sur le micro local
      startSelfSpeakingDetection(processedStream);

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

      // 8. Vider la file d'attente — events reçus pendant l'init async
      if (pendingPeers.length > 0) {
        const queued = [...pendingPeers];
        pendingPeers = [];
        for (const p of queued) {
          addPeerToUI(p.peerId, p.username);
          await handleNewProducer(p);
        }
      }

    } catch (err) {
      console.error('[Voice] Erreur joinRoom :', err);
      showVoiceError(err.message);
      return;
    }

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
        // Démarrer la détection speaking sur ce pair
        startPeerSpeakingDetection(peerId, consumer.track);
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

    // Détacher les listeners
    socket.off('ms:newProducer', handleNewProducer);
    socket.off('ms:existingProducers');

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

    // Stopper toutes les détections speaking
    stopSelfSpeakingDetection();
    speakingAnalysers.forEach((_, pid) => stopPeerSpeakingDetection(pid));
    speakingAnalysers.clear();

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
    destroyOverlay();
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
    const btn = document.getElementById('voice-panel-mute');
    if (!btn) return;
    const icon = document.getElementById('voice-panel-mute-icon') || btn;
    icon.textContent = isMuted ? '🔇' : '🎤';
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
    const btn = document.getElementById('voice-panel-screenshare');
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
  // ═══════════════════════════════════════════════════════════════════════════
  //  ANNONCES VOCALES (style TeamSpeak)
  // ═══════════════════════════════════════════════════════════════════════════

  const KEY_ANNOUNCE = 'onkoz_voice_announce';

  function isAnnounceEnabled() {
    return localStorage.getItem(KEY_ANNOUNCE) !== 'false';
  }

  const announceQueue = [];
  let   isAnnouncing  = false;

  function announce(username, action) {
    if (!isAnnounceEnabled()) return;
    announceQueue.push({ username, action });
    if (!isAnnouncing) processAnnounceQueue();
  }

  function processAnnounceQueue() {
    if (announceQueue.length === 0) { isAnnouncing = false; return; }
    isAnnouncing = true;
    const { username, action } = announceQueue.shift();

    playJoinSound(action === 'join');

    setTimeout(() => {
      const msg = action === 'join'
        ? `${username} a rejoint le canal`
        : `${username} a quitté le canal`;

      if (!window.speechSynthesis) { processAnnounceQueue(); return; }

      window.speechSynthesis.cancel();
      const utt  = new SpeechSynthesisUtterance(msg);
      utt.lang   = 'fr-FR';
      utt.volume = parseFloat(localStorage.getItem('onkoz_announce_volume') || '0.8');
      utt.rate   = 1.05;
      utt.pitch  = 1.0;

      const voices  = window.speechSynthesis.getVoices();
      const frVoice = voices.find(v => v.lang.startsWith('fr')) || null;
      if (frVoice) utt.voice = frVoice;

      utt.onend   = () => setTimeout(processAnnounceQueue, 200);
      utt.onerror = () => setTimeout(processAnnounceQueue, 200);
      window.speechSynthesis.speak(utt);
    }, 350);
  }

  function playJoinSound(isJoin) {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const vol  = parseFloat(localStorage.getItem('onkoz_announce_volume') || '0.8') * 0.4;
      const gain = ctx.createGain();
      gain.gain.value = vol;
      gain.connect(ctx.destination);
      if (isJoin) {
        playNote(ctx, gain, 523.25, 0,    0.12); // Do5
        playNote(ctx, gain, 659.25, 0.13, 0.12); // Mi5
      } else {
        playNote(ctx, gain, 659.25, 0,    0.12); // Mi5
        playNote(ctx, gain, 523.25, 0.13, 0.12); // Do5
      }
      setTimeout(() => ctx.close(), 800);
    } catch (e) {}
  }

  function playNote(ctx, dest, freq, startOffset, duration) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const now = ctx.currentTime + startOffset;
    osc.type            = 'sine';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0,   now);
    env.gain.linearRampToValueAtTime(1, now + 0.01);
    env.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  // Précharger les voix dès que possible
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.getVoices();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  OVERLAY IN-GAME (milieu-gauche, draggable)
  // ═══════════════════════════════════════════════════════════════════════════

  // Données membres overlay : peerId → { username, speaking }
  const overlayMembers = new Map();
  let overlayEl        = null;
  let overlayVisible   = false;

  function createOverlay() {
    if (document.getElementById('voice-overlay')) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'voice-overlay';
    overlayEl.style.cssText = `
      position: fixed;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 9999;
      display: none;
      flex-direction: column;
      gap: 4px;
      min-width: 160px;
      max-width: 220px;
      background: rgba(8, 7, 16, 0.72);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 10px;
      padding: 8px 6px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      user-select: none;
      cursor: grab;
      font-family: 'DM Sans', system-ui, sans-serif;
    `;

    // Header draggable
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 4px 6px; margin-bottom: 2px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    `;
    header.innerHTML = `
      <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5A5474;">Vocal</span>
      <button id="voice-overlay-close" style="background:none;border:none;color:#5A5474;cursor:pointer;font-size:12px;padding:0;line-height:1;" title="Masquer l'overlay">✕</button>
    `;
    overlayEl.appendChild(header);

    // Conteneur membres
    const membersEl = document.createElement('div');
    membersEl.id = 'voice-overlay-members';
    membersEl.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    overlayEl.appendChild(membersEl);

    document.body.appendChild(overlayEl);

    // Fermer
    document.getElementById('voice-overlay-close').addEventListener('click', e => {
      e.stopPropagation();
      hideOverlay();
    });

    // Drag
    let dragging = false, dx = 0, dy = 0;
    overlayEl.addEventListener('mousedown', e => {
      if (e.target.id === 'voice-overlay-close') return;
      dragging = true;
      dx = e.clientX - overlayEl.getBoundingClientRect().left;
      dy = e.clientY - overlayEl.getBoundingClientRect().top;
      overlayEl.style.cursor = 'grabbing';
      overlayEl.style.transform = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      overlayEl.style.left = `${Math.max(0, Math.min(e.clientX - dx, window.innerWidth - overlayEl.offsetWidth))}px`;
      overlayEl.style.top  = `${Math.max(0, Math.min(e.clientY - dy, window.innerHeight - overlayEl.offsetHeight))}px`;
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      overlayEl.style.cursor = 'grab';
    });
  }

  function showOverlay() {
    if (!overlayEl) createOverlay();
    overlayEl.style.display = 'flex';
    overlayVisible = true;
    renderOverlayMembers();
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
    overlayVisible = false;
  }

  function destroyOverlay() {
    overlayEl?.remove();
    overlayEl = null;
    overlayVisible = false;
    overlayMembers.clear();
  }

  function renderOverlayMembers() {
    const container = document.getElementById('voice-overlay-members');
    if (!container) return;
    container.innerHTML = '';
    overlayMembers.forEach(({ username, speaking }, peerId) => {
      container.appendChild(buildOverlayRow(peerId, username, speaking));
    });
  }

  function buildOverlayRow(peerId, username, speaking) {
    const row = document.createElement('div');
    row.id = `ov-row-${peerId}`;
    row.style.cssText = `
      display: flex; align-items: center; gap: 7px;
      padding: 3px 4px; border-radius: 6px;
      transition: background 0.1s;
      background: ${speaking ? 'rgba(123,92,229,0.12)' : 'transparent'};
    `;

    // Voyant
    const dot = document.createElement('div');
    dot.style.cssText = `
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      background: ${speaking ? '#FF5252' : '#302D45'};
      box-shadow: ${speaking ? '0 0 6px #FF5252' : 'none'};
      transition: background 0.1s, box-shadow 0.1s;
    `;

    // Nom
    const name = document.createElement('span');
    name.style.cssText = `
      font-size: 0.78rem; font-weight: 500;
      color: ${speaking ? '#EBE9F5' : '#A89FC8'};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      transition: color 0.1s;
    `;
    name.textContent = username;

    row.append(dot, name);
    return row;
  }

  function updateOverlaySpeaking(peerId, speaking) {
    if (!overlayEl || !overlayVisible) return;
    const row = document.getElementById(`ov-row-${peerId}`);
    if (!row) return;
    const dot  = row.querySelector('div');
    const name = row.querySelector('span');
    row.style.background  = speaking ? 'rgba(123,92,229,0.12)' : 'transparent';
    dot.style.background  = speaking ? '#FF5252' : '#302D45';
    dot.style.boxShadow   = speaking ? '0 0 6px #FF5252' : 'none';
    name.style.color      = speaking ? '#EBE9F5' : '#A89FC8';
    // Remonter les speakers en haut
    if (speaking) row.parentElement?.prepend(row);
  }

  // Ajouter/retirer un membre de l'overlay en sync avec les peers
  function overlayAddMember(peerId, username) {
    overlayMembers.set(peerId, { username, speaking: false });
    if (overlayVisible) renderOverlayMembers();
  }
  function overlayRemoveMember(peerId) {
    overlayMembers.delete(peerId);
    document.getElementById(`ov-row-${peerId}`)?.remove();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SPEAKING DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function startSelfSpeakingDetection(stream) {
    try {
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      selfAnalyser = { analyser, ctx };

      function loop() {
        selfRafId = requestAnimationFrame(loop);
        analyser.getByteFrequencyData(data);
        const avg     = data.slice(2, 14).reduce((a, b) => a + b, 0) / 12;
        const isTalking = avg > SPEAK_THRESHOLD && !isMuted;
        setSpeaking('vp-self', isTalking);
        updateOverlaySpeaking('self', isTalking);
      }
      loop();
    } catch(e) {}
  }

  function stopSelfSpeakingDetection() {
    if (selfRafId) cancelAnimationFrame(selfRafId);
    selfRafId = null;
    try { selfAnalyser?.ctx?.close(); } catch(e) {}
    selfAnalyser = null;
    setSpeaking('vp-self', false);
  }

  function startPeerSpeakingDetection(peerId, track) {
    try {
      const stream   = new MediaStream([track]);
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      const data  = new Uint8Array(analyser.frequencyBinCount);

      function loop() {
        const rafId = requestAnimationFrame(loop);
        speakingAnalysers.get(peerId) && (speakingAnalysers.get(peerId).rafId = rafId);
        analyser.getByteFrequencyData(data);
        const avg       = data.slice(2, 14).reduce((a, b) => a + b, 0) / 12;
        const isTalking = avg > SPEAK_THRESHOLD;
        setSpeaking(`vp-${peerId}`, isTalking);
        updateOverlaySpeaking(peerId, isTalking);
      }
      const rafId = requestAnimationFrame(loop);
      speakingAnalysers.set(peerId, { analyser, ctx, source, rafId });
    } catch(e) {}
  }

  function stopPeerSpeakingDetection(peerId) {
    const entry = speakingAnalysers.get(peerId);
    if (!entry) return;
    cancelAnimationFrame(entry.rafId);
    try { entry.ctx?.close(); } catch(e) {}
    speakingAnalysers.delete(peerId);
    setSpeaking(`vp-${peerId}`, false);
  }

  function setSpeaking(elemId, speaking) {
    const el = document.getElementById(elemId);
    if (!el) return;
    const avatar = el.querySelector('.rounded-full');
    if (!avatar) return;
    if (speaking) {
      avatar.classList.add('ring-2', 'ring-onkoz-danger', 'ring-offset-1', 'ring-offset-onkoz-surface');
    } else {
      avatar.classList.remove('ring-2', 'ring-onkoz-danger', 'ring-offset-1', 'ring-offset-onkoz-surface');
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
    overlayAddMember(peerId, username);
  }

  function removePeerFromUI(peerId) {
    document.getElementById(`vp-${peerId}`)?.remove();
    stopPeerSpeakingDetection(peerId);
    overlayRemoveMember(peerId);
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
    // Initialiser l'overlay avec soi-même
    overlayMembers.clear();
    overlayMembers.set('self', { username: user.username + ' (moi)', speaking: false });
    if (overlayVisible) renderOverlayMembers();
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
    announce(username, 'join');
  }

  function onPeerLeft({ peerId, username }) {
    const el   = document.getElementById(`vp-${peerId}`);
    const name = username || el?.querySelector('span')?.textContent?.trim() || 'Utilisateur';
    removePeerFromUI(peerId);
    announce(name, 'leave');
  }

  function onExistingPeers(peers) {
    // UI seulement — les producers arrivent via ms:existingProducers
    peers.forEach(p => addPeerToUI(p.peerId, p.username));
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
    toggleOverlay: () => overlayVisible ? hideOverlay() : showOverlay(),
    showOverlay,
    hideOverlay,
  };

})();
