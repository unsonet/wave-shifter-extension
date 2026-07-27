class PhaseVocoderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: "pitchFactor",
      defaultValue: 1,
      minValue: 0.25,
      maxValue: 4,
      automationRate: "k-rate"
    }];
  }

  constructor() {
    super();
    this.N = 2048;
    this.H = 512;
    this.half = this.N >> 1;

    this.win = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.N - 1)));
    }

    this.expPh = new Float32Array(this.half + 1);
    for (let k = 0; k <= this.half; k++) {
      this.expPh[k] = 2 * Math.PI * k * this.H / this.N;
    }

    this.olaGain = new Float32Array(this.H);
    for (let n = 0; n < this.H; n++) {
      let sum = 0;
      for (let i = n; i < this.N; i += this.H) {
        sum += this.win[i] * this.win[i];
      }
      this.olaGain[n] = sum > 0 ? 1 / sum : 1;
    }

    this.channels = 2;
    this.state = [];
    for (let ch = 0; ch < this.channels; ch++) {
      this.state.push({
        ringIn: new Float32Array(131072),
        ringOut: new Float32Array(131072),
        iW: 0, iR: 0,
        oW: 0, oR: 0,
        ola: new Float32Array(this.N),
        re: new Float32Array(this.N),
        im: new Float32Array(this.N),
        prevPh: new Float32Array(this.half + 1),
        synPh: new Float32Array(this.half + 1),
        first: true,
        lastPf: 1,
        silenceCount: 0
      });
    }

    this._synRe = new Float32Array(this.N);
    this._synIm = new Float32Array(this.N);
    this._mag = new Float32Array(this.half + 1);
    this._omega = new Float32Array(this.half + 1);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    if (!input || !output) return true;

    const pf = parameters.pitchFactor[0];

    for (let ch = 0; ch < Math.min(input.length, output.length, this.channels); ch++) {
      const inCh = input[ch] || input[0];
      const outCh = output[ch];
      const s = this.state[ch];

      // 1. Пишем вход в кольцевой буфер, одновременно ищем максимальную амплитуду
      let maxAmp = 0;
      for (let i = 0; i < inCh.length; i++) {
        const sample = inCh[i];
        s.ringIn[s.iW] = sample;
        s.iW = (s.iW + 1) % s.ringIn.length;
        maxAmp = Math.max(maxAmp, Math.abs(sample));
      }

      // 2. Сброс состояния при длительной тишине или резком изменении pitchFactor
      if (maxAmp < 1e-8) {
        s.silenceCount++;
        if (s.silenceCount > 100) {
          s.first = true;
          s.prevPh.fill(0);
          s.synPh.fill(0);
          s.silenceCount = 0;
        }
      } else {
        s.silenceCount = 0;
      }

      if (Math.abs(pf - s.lastPf) > 0.05) {
        s.first = true;
        s.synPh.fill(0);
      }
      s.lastPf = pf;

      // 3. Обрабатываем накопленные фреймы
      let av = (s.iW - s.iR + s.ringIn.length) % s.ringIn.length;
      while (av >= this.N) {
        this.processFrame(s, pf);
        av = (s.iW - s.iR + s.ringIn.length) % s.ringIn.length;
      }

      // 4. Читаем выход из кольцевого буфера
      for (let i = 0; i < outCh.length; i++) {
        if (s.oR !== s.oW) {
          outCh[i] = s.ringOut[s.oR];
          s.oR = (s.oR + 1) % s.ringOut.length;
        } else {
          outCh[i] = 0;
        }
      }
    }

    // Моно -> стерео
    for (let ch = input.length; ch < output.length; ch++) {
      if (output[ch] && output[0]) {
        for (let i = 0; i < output[ch].length; i++) {
          output[ch][i] = output[0][i];
        }
      }
    }

    return true;
  }

  processFrame(s, pf) {
    const N = this.N, H = this.H, half = this.half, TWO_PI = 2 * Math.PI;

    // === АНАЛИЗ (STFT) ===
    for (let i = 0; i < N; i++) {
      s.re[i] = s.ringIn[(s.iR + i) % s.ringIn.length] * this.win[i];
      s.im[i] = 0;
    }
    this.fft(s.re, s.im, false);

    const re = s.re, im = s.im;
    const mag = this._mag;
    const omega = this._omega;
    const synRe = this._synRe;
    const synIm = this._synIm;

    // === ВЫЧИСЛЕНИЕ МГНОВЕННОЙ ЧАСТОТЫ ===
    for (let k = 0; k <= half; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      const currentPh = Math.atan2(im[k], re[k]);

      if (s.first) {
        omega[k] = TWO_PI * k / N;
        s.synPh[k] = currentPh;
      } else {
        let delta = currentPh - s.prevPh[k] - this.expPh[k];
        while (delta > Math.PI) delta -= TWO_PI;
        while (delta < -Math.PI) delta += TWO_PI;
        omega[k] = TWO_PI * k / N + delta / H;
      }
      s.prevPh[k] = currentPh;
    }

    // === СИНТЕЗ ===
    if (Math.abs(pf - 1) < 0.001) {
      // BYPASS: прямое копирование спектра
      for (let k = 0; k <= half; k++) {
        synRe[k] = re[k];
        synIm[k] = im[k];
        s.synPh[k] = s.prevPh[k];
      }
    } else {
      // КЛАССИЧЕСКИЙ PHASE VOCODER
      for (let k = 0; k <= half; k++) {
        const src = k / pf;
        const i0 = Math.floor(src);
        const i1 = i0 + 1;
        const frac = src - i0;

        if (i0 < 0 || i0 > half) { synRe[k] = 0; synIm[k] = 0; continue; }
        if (i1 > half && frac > 0) { synRe[k] = 0; synIm[k] = 0; continue; }

        // Интерполяция магнитуд
        const m0 = mag[i0];
        const m1 = (i1 <= half) ? mag[i1] : m0;
        const m = m0 + (m1 - m0) * frac;

        // Интерполяция мгновенных частот
        const f0 = omega[i0];
        const f1 = (i1 <= half) ? omega[i1] : f0;
        const f = (f0 + (f1 - f0) * frac) * pf;

        // Продвигаем фазу синтеза
        s.synPh[k] += f * H;
        // Ограничиваем накопление фазы для сохранения точности Float32
        s.synPh[k] -= Math.floor(s.synPh[k] / TWO_PI) * TWO_PI;

        if (k === 0 || k === half) {
          synRe[k] = m;
          synIm[k] = 0;
        } else {
          synRe[k] = m * Math.cos(s.synPh[k]);
          synIm[k] = m * Math.sin(s.synPh[k]);
        }
      }
    }

    // === ГЕРМЕТИЧНОСТЬ СПЕКТРА ===
    synIm[0] = 0;
    synIm[half] = 0;
    for (let k = 1; k < half; k++) {
      synRe[N - k] = synRe[k];
      synIm[N - k] = -synIm[k];
    }

    // === ОБРАТНОЕ БПФ (ISTFT) ===
    this.fft(synRe, synIm, true);

    // === OVERLAP-ADD ===
    for (let i = 0; i < N; i++) {
      s.ola[i] += synRe[i] * this.win[i];
    }

    for (let i = 0; i < H; i++) {
      s.ringOut[s.oW] = s.ola[i] * this.olaGain[i];
      s.oW = (s.oW + 1) % s.ringOut.length;
    }

    s.ola.copyWithin(0, H);
    for (let i = N - H; i < N; i++) {
      s.ola[i] = 0;
    }

    s.iR = (s.iR + H) % s.ringIn.length;
    s.first = false;
  }

  // === БПФ (Cooley-Tukey) ===
  fft(real, imag, invert) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = real[i]; real[i] = real[j]; real[j] = t;
        t = imag[i]; imag[i] = imag[j]; imag[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (invert ? 1 : -1);
      const wCos = Math.cos(ang), wSin = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wRe = 1, wIm = 0;
        for (let j = 0; j < len >> 1; j++) {
          const uRe = real[i + j], uIm = imag[i + j];
          const vRe = real[i + j + (len >> 1)] * wRe - imag[i + j + (len >> 1)] * wIm;
          const vIm = real[i + j + (len >> 1)] * wIm + imag[i + j + (len >> 1)] * wRe;
          real[i + j] = uRe + vRe;
          imag[i + j] = uIm + vIm;
          real[i + j + (len >> 1)] = uRe - vRe;
          imag[i + j + (len >> 1)] = uIm - vIm;
          const nextWRe = wRe * wCos - wIm * wSin;
          wIm = wRe * wSin + wIm * wCos;
          wRe = nextWRe;
        }
      }
    }
    if (invert) {
      const scale = 1 / n;
      for (let i = 0; i < n; i++) { real[i] *= scale; imag[i] *= scale; }
    }
  }
}

registerProcessor("phase-vocoder-processor", PhaseVocoderProcessor);