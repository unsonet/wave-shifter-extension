// --- BITCRUSHER ---
class BitcrusherProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
            { name: 'normRange', defaultValue: 40, minValue: 0, maxValue: 100, automationRate: 'k-rate' }
        ];
    }
    constructor() {
        super();
        this._lastSample = new Float32Array(2);
        this._counter = 0;
    }
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output) return true;
        
        const bits = Math.round(parameters.bits);
        const normRange = parameters.normRange;
        const step = Math.pow(2, bits - 1);
        const holdSamples = Math.max(1, Math.floor(32 * (normRange / 100)));

        for (let ch = 0; ch < input.length; ch++) {
            const inp = input[ch];
            const out = output[ch];
            if (!inp || !out) continue;
            for (let i = 0; i < inp.length; i++) {
                if (this._counter % holdSamples === 0) {
                    this._lastSample[ch] = inp[i];
                }
                out[i] = Math.round(this._lastSample[ch] * step) / step;
            }
        }
        this._counter++;
        return true;
    }
}

// --- CD SKIPPER ---
class CdSkipperProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'loopMs', defaultValue: 200, minValue: 50, maxValue: 1000, automationRate: 'k-rate' },
            { name: 'repeats', defaultValue: 4, minValue: 1, maxValue: 16, automationRate: 'k-rate' }
        ];
    }
    constructor() {
        super();
        this._s = {
            isCapturing: true, captureIdx: 0, playIdx: 0, count: 0, bufferSize: 0,
            capBufL: null, capBufR: null, playBufL: null, playBufR: null, sr: 0
        };
    }
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output) return true;
        if (this._s.sr !== sampleRate) this._s.sr = sampleRate;
        
        const loopMs = parameters.loopMs;
        const repeats = Math.round(parameters.repeats);
        const newBufSize = Math.max(1, Math.floor((loopMs / 1000) * this._s.sr));
        
        if (this._s.bufferSize !== newBufSize) {
            this._s.bufferSize = newBufSize;
            this._s.isCapturing = true; this._s.captureIdx = 0; this._s.playIdx = 0; this._s.count = 0;
            this._s.capBufL = new Float32Array(newBufSize); this._s.capBufR = new Float32Array(newBufSize);
            this._s.playBufL = new Float32Array(newBufSize); this._s.playBufR = new Float32Array(newBufSize);
        }
        const s = this._s;
        const inL = input[0], inR = input.length > 1 ? input[1] : input[0];
        const outL = output[0], outR = output.length > 1 ? output[1] : output[0];
        if (!inL || !outL) return true;

        for (let i = 0; i < inL.length; i++) {
            if (s.isCapturing) {
                s.capBufL[s.captureIdx] = inL[i]; s.capBufR[s.captureIdx] = inR[i];
                outL[i] = inL[i]; outR[i] = inR[i]; s.captureIdx++;
                if (s.captureIdx >= s.bufferSize) {
                    s.playBufL.set(s.capBufL); s.playBufR.set(s.capBufR);
                    s.isCapturing = false; s.playIdx = 0; s.count = 0;
                }
            } else {
                outL[i] = s.playBufL[s.playIdx]; outR[i] = s.playBufR[s.playIdx]; s.playIdx++;
                if (s.playIdx >= s.bufferSize) {
                    s.count++; s.playIdx = 0;
                    if (s.count >= repeats) { s.isCapturing = true; s.captureIdx = 0; s.count = 0; }
                }
            }
        }
        return true;
    }
}

// --- VINYL (С встроенным детектором тишины, чтобы не шумел на паузе) ---
class VinylProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'noise', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'crackle', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
        ];
    }
    constructor() { super(); this._crackleDecay = 0; }
    process(inputs, outputs, parameters) {
        const input = inputs[0]; const output = outputs[0];
        if (!input || !output) return true;
        
        const noise = parameters.noise; const crackle = parameters.crackle;
        const inL = input[0], inR = input.length > 1 ? input[1] : input[0];
        const outL = output[0], outR = output.length > 1 ? output[1] : output[0];
        if (!inL || !outL) return true;
        const len = inL.length;

        // Детектор тишины (RMS). Если музыка на паузе, шум не генерируется.
        let rms = 0;
        for (let i = 0; i < len; i += 64) {
            rms += inL[i] * inL[i];
            if (inR !== inL) rms += inR[i] * inR[i];
        }
        if (Math.sqrt(rms / (Math.ceil(len / 64) * (inR === inL ? 1 : 2))) < 0.0005) {
            for (let i = 0; i < len; i++) { outL[i] = inL[i]; if (outR !== outL) outR[i] = inR[i]; }
            return true;
        }

        const noiseVol = noise * 0.25;
        const popProb = 0.00015 * crackle; const crackleProb = 0.015 * crackle;

        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            if (Math.random() < popProb) this._crackleDecay = (0.6 + Math.random() * 0.4) * crackle;
            else if (Math.random() < crackleProb) this._crackleDecay = (0.05 + Math.random() * 0.15) * crackle;
            
            const crackleSound = white * this._crackleDecay;
            this._crackleDecay *= 0.97;
            const vinylNoise = (white * noiseVol) + crackleSound;

            outL[i] = inL[i] + vinylNoise;
            if (outR !== outL) outR[i] = inR[i] + (vinylNoise * (0.8 + Math.random() * 0.4));
            else outR[i] = outL[i];
        }
        return true;
    }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
registerProcessor('cd-skipper-processor', CdSkipperProcessor);
registerProcessor('vinyl-processor', VinylProcessor);