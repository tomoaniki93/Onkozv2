/* ── NoiseReducer ─────────────────────────────────────────────────────────────
   Chaîne de traitement audio temps réel sans crépitement.

   Pipeline :
   MediaStreamSource
     → HighPassFilter  (coupe < 80-120 Hz : bourdonnements, vibrations)
     → LowPassFilter   (coupe > 5500-7500 Hz : parasites HF)
     → DynamicsCompressor (atténue les pics)
     → NoiseGateWorklet   (AudioWorklet — thread dédié, sans crépitement)
     → GainNode        (compensation de volume)
     → MediaStreamDestination → mediasoup
   ─────────────────────────────────────────────────────────────────────────── */
const NoiseReducer = (() => {

  const KEY_ENABLED   = 'onkoz_nr_enabled';
  const KEY_INTENSITY = 'onkoz_nr_intensity';

  const PRESETS = {
    1: { highPassFreq: 80,  lowPassFreq: 7500, compThreshold: -24, compRatio: 3,  gateThreshold: 0.008, outputGain: 1.2 },
    2: { highPassFreq: 100, lowPassFreq: 6500, compThreshold: -30, compRatio: 6,  gateThreshold: 0.018, outputGain: 1.4 },
    3: { highPassFreq: 120, lowPassFreq: 5500, compThreshold: -36, compRatio: 10, gateThreshold: 0.030, outputGain: 1.6 },
  };

  let audioCtx    = null;
  let destination = null;
  let sourceNode  = null;
  let isActive    = false;

  function isEnabled()    { return localStorage.getItem(KEY_ENABLED) !== 'false'; }
  function getIntensity() { return parseInt(localStorage.getItem(KEY_INTENSITY) || '2'); }

  // ── Traiter un MediaStream ─────────────────────────────────────────────────
  async function process(rawStream) {
    const intensity = getIntensity();
    const preset    = PRESETS[intensity];

    if (!isEnabled() || !preset) {
      return applyNativeConstraints(rawStream, false);
    }

    const stream = await applyNativeConstraints(rawStream, true);

    try {
      audioCtx    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      destination = audioCtx.createMediaStreamDestination();
      sourceNode  = audioCtx.createMediaStreamSource(stream);

      // 1. Filtre passe-haut
      const highPass = audioCtx.createBiquadFilter();
      highPass.type            = 'highpass';
      highPass.frequency.value = preset.highPassFreq;
      highPass.Q.value         = 0.5;

      // 2. Filtre passe-bas
      const lowPass = audioCtx.createBiquadFilter();
      lowPass.type            = 'lowpass';
      lowPass.frequency.value = preset.lowPassFreq;
      lowPass.Q.value         = 0.5;

      // 3. Compresseur dynamique
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = preset.compThreshold;
      compressor.knee.value      = 12;
      compressor.ratio.value     = preset.compRatio;
      compressor.attack.value    = 0.005;
      compressor.release.value   = 0.15;

      // 4. Gain de compensation
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = preset.outputGain;

      // 5. Tenter le noise gate via AudioWorklet
      let lastNode = compressor;
      try {
        await audioCtx.audioWorklet.addModule('/js/noise-gate-processor.js');
        const gateNode = new AudioWorkletNode(audioCtx, 'noise-gate-processor');

        // Paramètre threshold avec lissage côté worklet
        gateNode.parameters.get('threshold').value = preset.gateThreshold;
        // Lissage du gain : plus doux = moins de clics (0.995 ≈ 50 ms)
        gateNode.parameters.get('smoothing').value = 0.992;

        compressor.connect(gateNode);
        lastNode = gateNode;
        console.log('[NoiseReducer] AudioWorklet gate actif');
      } catch (e) {
        // AudioWorklet non supporté (HTTP sans HTTPS) → on saute le gate
        console.warn('[NoiseReducer] AudioWorklet indisponible, gate désactivé :', e.message);
      }

      // Connecter la chaîne
      sourceNode
        .connect(highPass)
        .connect(lowPass)
        .connect(lastNode);

      lastNode.connect(gainNode);
      gainNode.connect(destination);

      isActive = true;
      console.log(`[NoiseReducer] Actif — intensité ${intensity}`);
      return destination.stream;

    } catch (err) {
      console.error('[NoiseReducer] Erreur init :', err);
      dispose();
      return stream; // fallback : stream brut
    }
  }

  // ── Contraintes natives du navigateur ─────────────────────────────────────
  async function applyNativeConstraints(stream, enhanced) {
    const track = stream.getAudioTracks()[0];
    if (!track) return stream;
    try {
      await track.applyConstraints({
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: enhanced },
        autoGainControl:  { ideal: enhanced },
      });
    } catch (e) {
      console.warn('[NoiseReducer] applyConstraints:', e.message);
    }
    return stream;
  }

  // ── Libérer les ressources ─────────────────────────────────────────────────
  function dispose() {
    try { sourceNode?.disconnect(); } catch {}
    try { audioCtx?.close(); } catch {}
    audioCtx = destination = sourceNode = null;
    isActive = false;
  }

  return { process, dispose, isEnabled, getIntensity, isActive: () => isActive };
})();
