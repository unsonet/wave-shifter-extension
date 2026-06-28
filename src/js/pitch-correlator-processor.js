
"use strict";

const MIN_CORRELATION = Math.pow(10, -1.2); // ≈ 0.063

/* =======================================================================
 * SAMPLE ACCESS
 * ======================================================================= */

function readSample(prev, curr, channel, index) {
  const prevLen = prev[0].length;
  const wrappedIndex = index % prevLen;
  
  if (index < prevLen) {
    return prev[channel][wrappedIndex];
  }
  return curr[channel][wrappedIndex];
}

/* =======================================================================
 * CLONE UTILITY
 * ======================================================================= */

function cloneChannels(input) {
  const out = new Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i].slice();
  }
  return out;
}

/* =======================================================================
 * CORRELATION ENGINE (Exact original brute-force logic)
 * ======================================================================= */

function findAlignment(pairA, offsetA, pairB) {
  const prevA = pairA[0], currA = pairA[1];
  const prevB = pairB[0], currB = pairB[1];

  const channels = Math.min(prevA.length, currA.length, prevB.length, currB.length);
  const blockSize = prevA[0].length;
  const step = (blockSize / 8) | 0;

  let bestScore = 0;
  let bestShift = 0;
  let totalEnergy = 0;

  const dot = new Array(channels);
  const eA = new Array(channels);
  const eB = new Array(channels);

  for (let shift = 0; shift < blockSize; shift++) {
    dot.fill(0);
    eA.fill(0);
    eB.fill(0);

    for (let i = 0; i < blockSize; i += step) {
      const indexA = offsetA + i;
      const indexB = shift + i;

      for (let ch = 0; ch < channels; ch++) {
        const a = readSample(prevA, currA, ch, indexA);
        const b = readSample(prevB, currB, ch, indexB);

        dot[ch] += a * b;
        eA[ch] += a * a;
        eB[ch] += b * b;
      }
    }

    let score = 0;
    for (let ch = 0; ch < channels; ch++) {
      score += dot[ch] / Math.sqrt(eA[ch] * eB[ch] + 1e-12);
    }

    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
      
      let sumE = 0;
      for (let ch = 0; ch < channels; ch++) {
        sumE += eA[ch] + eB[ch];
      }
      totalEnergy = Math.sqrt(sumE / (8 * channels * 2));
    }
  }

  return [bestShift, totalEnergy * MIN_CORRELATION];
}

/* =======================================================================
 * AUDIO WORKLET PROCESSOR
 * ======================================================================= */

class PitchCorrelatorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.prevA = [new Float32Array(0)];
    this.prevB = [new Float32Array(0)];

    this.offsetA = 0;
    this.offsetB = 0;
    this.threshold = MIN_CORRELATION;
  }

  static get parameterDescriptors() {
    return [{
      name: 'c',
      defaultValue: 0,
      minValue: -1,
      maxValue: 1,
      automationRate: 'a-rate'
    }];
  }

  process(inputs, outputs, parameters) {
    const inputA = inputs[0];
    const inputB = inputs[1];
    const output = outputs[0];
    const cParam = parameters.c;

    // 1. Защита от полностью пустых тиков (инициализация графов)
    if (!inputA || !inputB || !output) return true;
    if (inputA.length === 0 || inputB.length === 0 || output.length === 0) return true;
    if (!(inputA[0] instanceof Float32Array) || !(inputB[0] instanceof Float32Array)) return true;

    const channels = Math.min(inputA.length, inputB.length, output.length);
    const outChannels = output.length;
    const blockSize = output[0].length;
    
    if (blockSize === 0) return true;

    // 2. ЗАЩИТА ОТ СМЕНЫ КАНАЛОВ (Моно <-> Стерео на лету)
    // Если браузер прислал стерео, а мы ждали моно - безопасно сбрасываем буферы.
    if (this.prevA.length !== channels || this.prevB.length !== channels) {
      this.prevA = cloneChannels(inputA);
      this.prevB = cloneChannels(inputB);
      this.offsetA = 0;
      this.offsetB = 0;
      this.threshold = MIN_CORRELATION;
      return true; // Пропускаем 1 тик (3мс), чтобы избежать щелчка. Пользователь этого не заметит.
    }

    /* -------------------------------------------------------
     * FIRST CALL INITIALIZATION
     * ------------------------------------------------------- */
    if (this.prevA[0].length === 0) {
      this.prevA = cloneChannels(inputA);
      this.prevB = cloneChannels(inputB);
      return true;
    }

    if (this.threshold < 1e-12) {
      this.threshold = MIN_CORRELATION;
    }

    let foundOffsetB = false;
    let foundOffsetA = false;
    let hasSignal = false;

    /* -------------------------------------------------------
     * SAMPLE-BY-SAMPLE PROCESSING
     * ------------------------------------------------------- */
    for (let i = 0; i < blockSize; i++) {

      // Безопасное чтение параметра кроссфейда
      const cVal = cParam.length > 0 ? (cParam.length === 1 ? cParam[0] : cParam[i]) : 0;
      
      const gainA = 0.5 * cVal + 0.5;
      const gainB = -0.5 * cVal + 0.5;

      if (hasSignal) {
        if (!foundOffsetB && gainB < this.threshold) {
          const result = findAlignment(
            [this.prevA, inputA], this.offsetA,
            [this.prevB, inputB]
          );
          this.offsetB = result[0];
          this.threshold = result[1];
          foundOffsetB = true;
        } else if (!foundOffsetA && gainA < this.threshold) {
          const result = findAlignment(
            [this.prevB, inputB], this.offsetB,
            [this.prevA, inputA]
          );
          this.offsetA = result[0];
          this.threshold = result[1];
          foundOffsetA = true;
        }
      }

      const readPosA = i + this.offsetA;
      const readPosB = i + this.offsetB;

      /* ---------------------------------------------------
       * OUTPUT MIXING
       * --------------------------------------------------- */
      if (channels === 1 && outChannels > 1) {
        const sA = readSample(this.prevA, inputA, 0, readPosA);
        const sB = readSample(this.prevB, inputB, 0, readPosB);
        const mixed = sA * gainA + sB * gainB;
        
        output[0][i] = mixed;
        output[1][i] = mixed;
        
        if (!hasSignal && mixed !== 0) hasSignal = true;
      } else {
        for (let ch = 0; ch < channels; ch++) {
          const sA = readSample(this.prevA, inputA, ch, readPosA);
          const sB = readSample(this.prevB, inputB, ch, readPosB);
          const mixed = sA * gainA + sB * gainB;
          
          output[ch][i] = mixed;
          
          if (!hasSignal && mixed !== 0) hasSignal = true;
        }
      }
    }

    /* -------------------------------------------------------
     * UPDATE HISTORY
     * ------------------------------------------------------- */
    this.prevA = cloneChannels(inputA);
    this.prevB = cloneChannels(inputB);

    return true;
  }
}

/* =======================================================================
 * REGISTER PROCESSOR
 * ======================================================================= */

registerProcessor("pitch-correlator", PitchCorrelatorProcessor);