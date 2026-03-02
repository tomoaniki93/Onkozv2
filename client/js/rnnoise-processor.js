/* ── rnnoise-processor.js ─────────────────────────────────────────────────────
   AudioWorkletProcessor utilisant RNNoise (deep learning WASM).
   
   RNNoise traite exactement 480 samples à 48kHz.
   L'AudioWorklet fournit 128 samples par quantum → on bufferise.
   
   Fixes appliqués :
   - importScripts (pas d'ES module dans AudioWorklet scope)
   - await module.ready avant d'utiliser les fonctions WASM
   - Gestion correcte des buffers HEAPF32
   ─────────────────────────────────────────────────────────────────────────── */

importScripts('/js/rnnoise-sync.js');

const FRAME_SIZE = 480; // samples par frame RNNoise à 48kHz (~10ms)

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._ready      = false;   // WASM prêt
    this._failed     = false;   // init échouée → passthrough
    this._module     = null;
    this._state      = 0;
    this._inPtr      = 0;
    this._outPtr     = 0;

    // Ring buffer : accumule les 128-sample quanta jusqu'à 480
    this._inBuf      = new Float32Array(FRAME_SIZE);
    this._outBuf     = new Float32Array(FRAME_SIZE);
    this._inWrote    = 0;   // samples en attente dans _inBuf
    this._outRead    = 0;   // curseur de lecture dans _outBuf

    this._initRNNoise();
  }

  async _initRNNoise() {
    try {
      // createRNNWasmModule est assigné sur globalThis par rnnoise-sync.js
      const factory = globalThis.createRNNWasmModule || self.createRNNWasmModule;
      if (!factory) throw new Error('createRNNWasmModule introuvable');

      // Instancier le module et attendre que le WASM soit prêt
      const mod = factory({});
      await mod.ready;

      this._module = mod;

      // Créer l'état RNNoise
      this._state = this._module._rnnoise_create(0);
      if (!this._state) throw new Error('rnnoise_create a retourné 0');

      // Allouer les buffers WASM (Float32 → 4 octets/sample)
      this._inPtr  = this._module._malloc(FRAME_SIZE * 4);
      this._outPtr = this._module._malloc(FRAME_SIZE * 4);

      if (!this._inPtr || !this._outPtr) throw new Error('malloc échoué');

      this._ready = true;
      console.log('[RNNoise] ✅ Initialisé avec succès');

    } catch (e) {
      console.error('[RNNoise] ❌ Init échouée, passthrough audio brut :', e.message);
      this._failed = true;
    }
  }

  process(inputs, outputs) {
    const input  = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    // Pas encore prêt ou échec → passe l'audio brut
    if (!this._ready || this._failed) {
      output.set(input);
      return true;
    }

    const heapF32 = this._module.HEAPF32;
    const inOff   = this._inPtr  >> 2;   // offset en Float32
    const outOff  = this._outPtr >> 2;

    let inputIdx = 0;

    while (inputIdx < input.length) {
      // 1. Remplir le buffer d'entrée
      const space    = FRAME_SIZE - this._inWrote;
      const avail    = input.length - inputIdx;
      const toCopy   = Math.min(space, avail);

      this._inBuf.set(input.subarray(inputIdx, inputIdx + toCopy), this._inWrote);
      this._inWrote += toCopy;
      inputIdx      += toCopy;

      // 2. Dès qu'on a 480 samples → traiter avec RNNoise
      if (this._inWrote >= FRAME_SIZE) {
        // Copier vers heap WASM en scalant Float32 [-1,1] → [-32768,32768]
        for (let i = 0; i < FRAME_SIZE; i++) {
          heapF32[inOff + i] = this._inBuf[i] * 32768.0;
        }

        // ── Traitement RNNoise ──
        this._module._rnnoise_process_frame(this._state, this._outPtr, this._inPtr);

        // Recopier le résultat en Float32 normalisé
        for (let i = 0; i < FRAME_SIZE; i++) {
          this._outBuf[i] = heapF32[outOff + i] / 32768.0;
        }

        this._inWrote = 0;
        this._outRead = 0;
      }
    }

    // 3. Copier depuis _outBuf vers la sortie du quantum actuel
    const len = output.length;
    if (this._outRead + len <= FRAME_SIZE) {
      output.set(this._outBuf.subarray(this._outRead, this._outRead + len));
      this._outRead += len;
    } else {
      // Bord de frame : compléter avec des zéros (artefact ~1 frame = 10ms)
      output.fill(0);
    }

    return true; // garder le processor vivant
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
