/* ── noise-gate-processor.js ──────────────────────────────────────────────────
   AudioWorkletProcessor : noise gate avec lissage exponentiel.
   Tourne sur le thread audio dédié → pas de crépitement.
   ─────────────────────────────────────────────────────────────────────────── */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: 0.015, minValue: 0, maxValue: 1 },
      { name: 'smoothing', defaultValue: 0.995, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this._envelope = 0;
    this._gain     = 0;  // gain actuel lissé
  }

  process(inputs, outputs, parameters) {
    const input     = inputs[0];
    const output    = outputs[0];
    if (!input || !input[0]) return true;

    const threshold = parameters.threshold[0];
    const smoothing = parameters.smoothing[0];

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch]  || new Float32Array(128);
      const out = output[ch] || new Float32Array(128);

      for (let i = 0; i < inp.length; i++) {
        const abs = Math.abs(inp[i]);

        // Suivre l'enveloppe du signal
        if (abs > this._envelope) {
          this._envelope = abs;                         // attaque rapide
        } else {
          this._envelope = this._envelope * 0.999 + abs * 0.001;  // release lent
        }

        // Gain cible : 1 si au-dessus du seuil, 0 sinon
        const targetGain = this._envelope > threshold ? 1.0 : 0.0;

        // Lisser le gain pour éviter les clics (tau ~50 ms)
        this._gain = this._gain * smoothing + targetGain * (1 - smoothing);

        out[i] = inp[i] * this._gain;
      }
    }
    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
