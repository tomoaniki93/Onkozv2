/* ── NoiseGateProcessor v2 (AudioWorklet) ────────────────────────────────────
   Gate avancé avec :
   - Détection de transitoires (clics souris, frappes clavier)
   - Hold time : le gate reste fermé X ms après un transitoire
   - RMS sur fenêtre glissante (voix vs bruit impulsif)
   - Lissage asymétrique ouverture rapide / fermeture douce
   ─────────────────────────────────────────────────────────────────────────── */

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold',         defaultValue: 0.015, minValue: 0,    maxValue: 1      },
      { name: 'smoothing',         defaultValue: 0.980, minValue: 0,    maxValue: 0.9999 },
      { name: 'transientSuppress', defaultValue: 1,     minValue: 0,    maxValue: 1      },
      { name: 'holdMs',            defaultValue: 80,    minValue: 0,    maxValue: 500    },
    ];
  }

  constructor() {
    super();
    this._gain      = 0.0;
    this._holdSamps = 0;
    this._prevRMS   = 0;

    // Fenêtre glissante RMS — 256 samples (~5ms à 48kHz)
    this._rmsWin  = new Float32Array(256).fill(0);
    this._rmsIdx  = 0;
    this._rmsSum  = 0;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const threshold         = parameters.threshold[0];
    const smoothing         = parameters.smoothing[0];
    const transientSuppress = parameters.transientSuppress[0] > 0.5;
    const holdMs            = parameters.holdMs[0];
    const holdSampsMax      = Math.floor((holdMs / 1000) * sampleRate);

    // 1. RMS instantané
    let sum = 0;
    for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
    const rmsNow = Math.sqrt(sum / inp.length);

    // 2. RMS lissé sur fenêtre glissante
    this._rmsSum -= this._rmsWin[this._rmsIdx];
    this._rmsWin[this._rmsIdx] = rmsNow * rmsNow;
    this._rmsSum += this._rmsWin[this._rmsIdx];
    this._rmsIdx = (this._rmsIdx + 1) % this._rmsWin.length;
    const rmsSmooth = Math.sqrt(Math.max(0, this._rmsSum / this._rmsWin.length));

    // 3. Détection transitoire : pic isolé vs voix (qui monte progressivement)
    //    Ratio instantané/lissé >> 1 + delta fort = clic/frappe
    let isTransient = false;
    if (transientSuppress) {
      const delta = rmsNow - this._prevRMS;
      const ratio = rmsSmooth > 0.0001 ? rmsNow / (rmsSmooth + 0.0001) : 0;
      isTransient  = (delta > threshold * 2.5) && (ratio > 3.5) && (rmsSmooth < threshold * 2.5);
    }
    this._prevRMS = rmsNow;

    // 4. Décision gate
    let targetGain;
    if (isTransient) {
      targetGain      = 0.0;
      this._holdSamps = holdSampsMax;
    } else if (this._holdSamps > 0) {
      this._holdSamps -= inp.length;
      targetGain = 0.0;
    } else {
      targetGain = rmsSmooth > threshold ? 1.0 : 0.0;
    }

    // 5. Lissage asymétrique
    const coeff = targetGain > this._gain
      ? (1 - smoothing) * 4   // ouverture rapide
      : (1 - smoothing);      // fermeture douce

    for (let i = 0; i < inp.length; i++) {
      this._gain += (targetGain - this._gain) * coeff;
      this._gain  = Math.max(0, Math.min(1, this._gain));
      out[i] = inp[i] * this._gain;
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
