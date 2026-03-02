/* ── NoiseReducer ─────────────────────────────────────────────────────────────
   Pipeline audio avec RNNoise (deep learning) en priorité,
   fallback sur noise gate AudioWorklet si RNNoise indisponible.

   Pipeline :
   MediaStreamSource
     → HighPassFilter  (coupe < 80 Hz : vibrations bras de micro)
     → RNNoiseWorklet  (IA deep learning — suppression bruit fond)
       OU NoiseGateWorklet (fallback)
     → GainNode        (compensation de volume)
     → MediaStreamDestination → mediasoup
   ─────────────────────────────────────────────────────────────────────────── */
const NoiseReducer = (() => {

  const KEY_ENABLED   = 'onkoz_nr_enabled';
  const KEY_INTENSITY = 'onkoz_nr_intensity';
  const KEY_ENGINE    = 'onkoz_nr_engine'; // 'rnnoise' | 'gate'

  // Presets pour le fallback noise gate
  const GATE_PRESETS = {
    1: { highPassFreq: 80,  gateThreshold: 0.008, outputGain: 1.2 },
    2: { highPassFreq: 100, gateThreshold: 0.018, outputGain: 1.4 },
    3: { highPassFreq: 120, gateThreshold: 0.030, outputGain: 1.6 },
  };

  let audioCtx    = null;
  let destination = null;
  let sourceNode  = null;
  let isActive    = false;
  let activeEngine = null; // 'rnnoise' | 'gate' | null

  function isEnabled()    { return localStorage.getItem(KEY_ENABLED) !== 'false'; }
  function getIntensity() { return parseInt(localStorage.getItem(KEY_INTENSITY) || '2'); }
  function getEngine()    { return localStorage.getItem(KEY_ENGINE) || 'rnnoise'; }

  // ── Traiter un MediaStream ─────────────────────────────────────────────────
  async function process(rawStream) {
    if (!isEnabled()) return applyNativeConstraints(rawStream, false);

    const stream = await applyNativeConstraints(rawStream, true);

    try {
      audioCtx    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      destination = audioCtx.createMediaStreamDestination();
      sourceNode  = audioCtx.createMediaStreamSource(stream);

      // ── Filtre passe-haut — coupe les vibrations mécaniques ──────────────────
      // Bras de micro → rumble basses fréquences → coupe à 100Hz avec Q élevé
      const highPass = audioCtx.createBiquadFilter();
      highPass.type            = 'highpass';
      highPass.frequency.value = 100;  // 100Hz (était 80Hz, plus efficace pour bras)
      highPass.Q.value         = 0.8;  // légèrement résonant pour pente plus raide

      // Second filtre passe-haut en cascade pour atténuation plus forte
      const highPass2 = audioCtx.createBiquadFilter();
      highPass2.type            = 'highpass';
      highPass2.frequency.value = 80;
      highPass2.Q.value         = 0.5;

      // Gain de sortie
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 1.2;

      sourceNode.connect(highPass);
      highPass.connect(highPass2);

      // ── Essayer RNNoise en premier ─────────────────────────────────────────
      let processed = false;
      if (getEngine() !== 'gate') {
        try {
          await audioCtx.audioWorklet.addModule('/js/rnnoise-processor.js');
          const rnnoiseNode = new AudioWorkletNode(audioCtx, 'rnnoise-processor', {
            numberOfInputs:  1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });

          highPass2.connect(rnnoiseNode);
          rnnoiseNode.connect(gainNode);
          gainNode.connect(destination);

          activeEngine = 'rnnoise';
          processed    = true;
          console.log('[NoiseReducer] RNNoise actif ✅');
        } catch (e) {
          console.warn('[NoiseReducer] RNNoise indisponible, fallback noise gate:', e.message);
        }
      }

      // ── Fallback : noise gate ──────────────────────────────────────────────
      if (!processed) {
        const intensity = getIntensity();
        const preset    = GATE_PRESETS[intensity] || GATE_PRESETS[2];

        try {
          await audioCtx.audioWorklet.addModule('/js/noise-gate-processor.js');
          const gateNode = new AudioWorkletNode(audioCtx, 'noise-gate-processor');
          gateNode.parameters.get('threshold').value = preset.gateThreshold;
          gateNode.parameters.get('smoothing').value = 0.992;
          gainNode.gain.value = preset.outputGain;

          highPass2.connect(gateNode);
          gateNode.connect(gainNode);
          gainNode.connect(destination);

          activeEngine = 'gate';
          processed    = true;
          console.log('[NoiseReducer] Noise gate actif (fallback)');
        } catch (e) {
          console.warn('[NoiseReducer] AudioWorklet indisponible:', e.message);
        }
      }

      // ── Dernier recours : passe-haut + gain seuls ──────────────────────────
      if (!processed) {
        highPass2.connect(gainNode);
        gainNode.connect(destination);
        activeEngine = 'passthrough';
      }

      isActive = true;
      return destination.stream;

    } catch (err) {
      console.error('[NoiseReducer] Erreur init :', err);
      dispose();
      return stream;
    }
  }

  // ── Contraintes natives ────────────────────────────────────────────────────
  async function applyNativeConstraints(stream, enhanced) {
    const track = stream.getAudioTracks()[0];
    if (!track) return stream;
    try {
      await track.applyConstraints({
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: false }, // on gère nous-mêmes avec RNNoise
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
    activeEngine = null;
  }

  return {
    process, dispose, isEnabled, getIntensity,
    isActive:    () => isActive,
    getEngine:   () => activeEngine,
  };
})();
