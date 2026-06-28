(() => {
    if (window.__pitchChangerPatched) return;
    window.__pitchChangerPatched = true;

    const workletUrl = (() => {
        let url = window.__pitchShifterExtensionConfig?.workletUrl;
        if (!url) try { url = new URL("/__pitch_shifter_worklet.js", window.location.origin).href } catch (e) { }
        return url;
    })();

    const fallbackWorkletUrl = (() => {
        let url = window.__pitchShifterExtensionConfig?.fallbackWorkletUrl;
        if (!url) try { url = document.getElementById("__pitchShifterCfg")?.dataset?.fallbackWorkletUrl || "" } catch (e) { }
        return url;
    })();

    const soundsBaseUrl = (() => {
        let url = window.__pitchShifterExtensionConfig?.soundsBaseUrl;
        if (!url) try { url = document.getElementById("__pitchShifterCfg")?.dataset?.soundsBaseUrl || "" } catch (e) { }
        return url;
    })();

    const EQ_BANDS = [
        { frequency: 31.5, type: "lowshelf" },
        { frequency: 63, type: "peaking", q: 1.414214 },
        { frequency: 125, type: "peaking", q: 1.414214 },
        { frequency: 250, type: "peaking", q: 1.414214 },
        { frequency: 500, type: "peaking", q: 1.414214 },
        { frequency: 1000, type: "peaking", q: 1.414214 },
        { frequency: 2000, type: "peaking", q: 1.414214 },
        { frequency: 4000, type: "peaking", q: 1.414214 },
        { frequency: 8000, type: "peaking", q: 1.414214 },
        { frequency: 16000, type: "highshelf" }
    ];

    let audioCtx = null;
    let pitchNode = null;
    let eqFilters = [];
    let gainNode = null;
    let limiterNode = null;
    let isNodeReady = false;
    let sourceGain = null; // Единая точка входа для медиа перед процессорами
    let activeProcessorType = null; // 'signalsmith' | 'correlator'
    let correlatorNodes = null; // Храним узлы осцилляторов для коррелятора

    let howlerProbeTimer = null, usingHowler = false, howlerAttached = false, siteIsBlacklisted = false;
    const connectedMediaElements = new Set, connectingMediaElements = new WeakSet;
    let stereoSplitter, stereoMerger, subLeftGain, subRightGain, convolverNode, dryGainNode, wetGainNode, reverbMergeNode, stereoPannerNode, compressorNode, dolbyInputNode, dolbyOutputNode, surroundSplitter, surroundMerger, surroundCenterGain, defaultChannelCount = 2;
    const convolverCache = new Map;
    let lastConfiguredBlockMs = null, lastConfiguredSmart = null, pitchUpdateRafId = null;

    let settings = {
        volumeBoostDb: 0, pitchValueSemitones: 0, pitchValueCents: 0, windowSizeMilliseconds: 120,
        applySmartProcessing: true, speedUnits: 0, speedFine: 0, preservePitch: true, blacklistPatterns: [],
        eqGains: Array(10).fill(50), reverbType: null, reverbWet: 0, stereoWiden: 0, channelBalance: 0,
        compressorThreshold: -24, compressorKnee: 30, compressorRatio: 12, compressorAttack: 3, compressorRelease: 250, dolbyEnabled: false
    };


    function calcPlaybackRate() {
        const u = Number(settings.speedUnits) || 0;
        return ((u < 0 ? 100 + u : 100 + 5 * u) + (Number(settings.speedFine) || 0)) / 100;
    }

    function connectNodeSafe(node, target) { if (node && target) try { node.connect(target); } catch (e) { } }

    function bindResumeHandlers(ctx) {
        if (ctx.__pitchResumeBound) return;
        ctx.__pitchResumeBound = true;
        const unlock = async () => { try { if (ctx.state === "suspended") await ctx.resume(); } catch (e) { } };
        window.addEventListener("click", unlock, { capture: true });
        window.addEventListener("keydown", unlock, { capture: true });
        window.addEventListener("touchstart", unlock, { capture: true });
    }

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ CORRELATOR ---
    function createSawtooth(ctx, phase) {
        const n = 2048, real = new Float32Array(n), imag = new Float32Array(n);
        for (let i = 1; i < n; i++) {
            const amp = 2 / (i * Math.PI), sign = (i & 1) ? 1 : -1;
            real[i] = -sign * amp * Math.sin(phase * i);
            imag[i] = sign * amp * Math.cos(phase * i);
        }
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
        osc.frequency.value = 0;
        return osc;
    }

    function createSine(ctx, phase) {
        const n = 2048, real = new Float32Array(n), imag = new Float32Array(n);
        for (let i = 1; i < n; i++) {
            const amp = i <= 1 ? 1 : 0;
            real[i] = -amp * Math.sin(phase * i);
            imag[i] = amp * Math.cos(phase * i);
        }
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
        osc.frequency.value = 0;
        return osc;
    }

    // --- ИНИЦИАЛИЗАЦИЯ ПРОЦЕССОРОВ ---
    async function setupSignalsmithWorklet(ctx) {
        await ctx.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(ctx, "signalsmith-stretch", {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                try { node.disconnect(); } catch (_) { }
                reject(new Error("Signalsmith WASM timeout"));
            }, 1500);

            node.port.onmessage = e => {
                if (e?.data && e.data[0] === "ready") {
                    clearTimeout(timeout);
                    resolve(node);
                }
            };
        });
    }

    async function isWasmBlockedByCSP() {
        try {
            // Крошечный, но валидный пустой WebAssembly модуль
            const wasmBytes = new Uint8Array([
                0x00, 0x61, 0x73, 0x6d, // магическое число (\0asm)
                0x01, 0x00, 0x00, 0x00, // версия 1
                0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // секция типов
                0x03, 0x02, 0x01, 0x00, // секция функций
                0x07, 0x07, 0x01, 0x03, 0x66, 0x6e, 0x73, 0x00, 0x00, // секция экспорта
                0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b  // секция кода
            ]);
            await WebAssembly.compile(wasmBytes);
            return false; // WASM работает, CSP не блокирует
        } catch (e) {
            // Если ошибка именно из-за CSP
            return e instanceof WebAssembly.CompileError && e.message.includes("Content Security Policy");
        }
    }

    async function setupCorrelatorWorklet(ctx) {
        if (!fallbackWorkletUrl) throw new Error("Fallback worklet URL is missing");
        await ctx.audioWorklet.addModule(fallbackWorkletUrl);
        const node = new AudioWorkletNode(ctx, "pitch-correlator", {
            numberOfInputs: 2, numberOfOutputs: 1, channelCount: 2, outputChannelCount: [2]
        });

        const gain = (val, dest) => {
            const g = ctx.createGain();
            if (typeof val === 'number') g.gain.value = val;
            else { g.gain.value = 0; val.connect(g.gain); }
            g.connect(dest); return g;
        };
        const constantSource = ctx.createConstantSource(); constantSource.offset.value = 1;
        const saw1 = createSawtooth(ctx, 0), saw2 = createSawtooth(ctx, Math.PI), sine = createSine(ctx, 3 * Math.PI / 2);

        const freqSrc = ctx.createConstantSource(); freqSrc.offset.value = 0;
        freqSrc.connect(saw1.frequency); freqSrc.connect(saw2.frequency); freqSrc.connect(sine.frequency);

        const wss = ctx.createConstantSource(); wss.offset.value = 0;
        const delay1 = ctx.createDelay(), delay2 = ctx.createDelay();

        const makeFilter = dest => { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1760; f.connect(dest); return f; };
        const filter1 = makeFilter(gain(wss, delay1.delayTime)); saw1.connect(filter1);
        const filter2 = makeFilter(gain(wss, delay2.delayTime)); saw2.connect(filter2);

        const csGain1 = gain(0.5, filter1), csGain2 = gain(0.5, filter2);
        constantSource.connect(csGain1); constantSource.connect(csGain2);

        delay1.connect(node, 0, 0); delay2.connect(node, 0, 1);
        sine.connect(node.parameters.get("c"));

        sourceGain.connect(delay1);
        sourceGain.connect(delay2);
        node.connect(eqFilters[0]);

        // ФИКС: Стартуем осцилляторы только когда контекст действительно готов
        const startOscillators = () => {
            const now = ctx.currentTime;
            try {
                [constantSource, freqSrc, wss, sine, saw1, saw2].forEach(n => n.start(now));
            } catch (e) {
                // Игнорируем, если контекст умер или они уже были запущены
            }
        };

        if (ctx.state === "running") {
            // Если контекст уже активен (например, юзер кликнул до того, как скрипт дошел сюда)
            startOscillators();
        } else {
            // КРИТИЧЕСКИЙ ФИКС: Мы НЕ вызываем ctx.resume().
            // Видео, которое уже играет, само "разбудит" AudioContext за доли секунды.
            // Мы просто вешаем уши на изменение состояния и стартуем осцилляторы только тогда,
            // когда браузер сам официально скажет, что контекст запущен.
            ctx.onstatechange = () => {
                if (ctx.state === "running") {
                    startOscillators();
                    ctx.onstatechange = null; // Снимаем слушатель, он больше не нужен
                }
            };
        }

        pitchNode = node;
        correlatorNodes = { node, freqSrc, wss, saw1, saw2, sine, delay1, delay2, constantSource };
        activeProcessorType = 'correlator';
        isNodeReady = true;
        refreshPitchNode(true);
    }


    async function ensurePitchGraph(ctx) {
        if (!ctx) throw new Error("No AudioContext");
        if (audioCtx && audioCtx !== ctx) {
            try { pitchNode?.disconnect() } catch { }
            try { gainNode?.disconnect() } catch { }
            try { limiterNode?.disconnect() } catch { }
            try { pitchNode?.port?.close?.() } catch { }
            eqFilters.forEach(f => { try { f.disconnect() } catch { } });
            pitchNode = null; eqFilters = []; gainNode = null; limiterNode = null; isNodeReady = false; sourceGain = null;
            lastConfiguredBlockMs = null; lastConfiguredSmart = null;
        }

        audioCtx = ctx;
        if (!sourceGain) sourceGain = ctx.createGain();

        if (!pitchNode) {
            // 1. Собираем базовый граф (EQ, Gain, Limiter и т.д.)
            eqFilters = EQ_BANDS.map(band => {
                const filter = ctx.createBiquadFilter();
                filter.type = band.type; filter.frequency.value = band.frequency;
                if (band.q) filter.Q.value = band.q;
                return filter;
            });
            for (let i = 0; i < eqFilters.length - 1; i++) eqFilters[i].connect(eqFilters[i + 1]);

            gainNode = ctx.createGain();
            limiterNode = ctx.createDynamicsCompressor();
            limiterNode.threshold.value = -1; limiterNode.knee.value = 0; limiterNode.ratio.value = 20;
            limiterNode.attack.value = 0.003; limiterNode.release.value = 0.25;

            try {
                // ... (весь блок создания стерео базы, реверберации, компрессора и долби из твоего оригинального кода) ...
                stereoSplitter = ctx.createChannelSplitter(2); stereoMerger = ctx.createChannelMerger(2);
                subLeftGain = ctx.createGain(); subLeftGain.gain.value = 0;
                subRightGain = ctx.createGain(); subRightGain.gain.value = 0;
                let directLeft = ctx.createGain(); directLeft.gain.value = 1;
                let directRight = ctx.createGain(); directRight.gain.value = 1;

                eqFilters[eqFilters.length - 1].connect(stereoSplitter);
                stereoSplitter.connect(directLeft, 0); stereoSplitter.connect(subRightGain, 1);
                directLeft.connect(stereoMerger, 0, 0); subRightGain.connect(stereoMerger, 0, 0);
                stereoSplitter.connect(directRight, 1); stereoSplitter.connect(subLeftGain, 0);
                directRight.connect(stereoMerger, 0, 1); subLeftGain.connect(stereoMerger, 0, 1);

                convolverNode = ctx.createConvolver(); dryGainNode = ctx.createGain(); dryGainNode.gain.value = 1;
                wetGainNode = ctx.createGain(); wetGainNode.gain.value = 0; reverbMergeNode = ctx.createGain();
                stereoMerger.connect(dryGainNode); stereoMerger.connect(convolverNode);
                convolverNode.connect(wetGainNode); dryGainNode.connect(reverbMergeNode); wetGainNode.connect(reverbMergeNode);

                compressorNode = ctx.createDynamicsCompressor(); stereoPannerNode = ctx.createStereoPanner();
                limiterNode = ctx.createDynamicsCompressor(); // пересоздаем с правильными параметрами
                limiterNode.threshold.value = -1; limiterNode.knee.value = 0; limiterNode.ratio.value = 20;
                limiterNode.attack.value = 0.003; limiterNode.release.value = 0.25;

                dolbyInputNode = ctx.createGain(); dolbyOutputNode = ctx.createGain();
                surroundSplitter = ctx.createChannelSplitter(2); surroundMerger = ctx.createChannelMerger(6);
                surroundCenterGain = ctx.createGain(); surroundCenterGain.gain.value = 0.2;

                reverbMergeNode.connect(compressorNode); compressorNode.connect(gainNode);
                gainNode.connect(stereoPannerNode); stereoPannerNode.connect(limiterNode); limiterNode.connect(ctx.destination);

                dolbyInputNode.connect(surroundSplitter);
                surroundSplitter.connect(surroundMerger, 0, 0); surroundSplitter.connect(surroundMerger, 1, 1);
                surroundSplitter.connect(surroundCenterGain, 0); surroundCenterGain.connect(surroundMerger, 0, 2);
                surroundSplitter.connect(surroundMerger, 0, 3); surroundSplitter.connect(surroundMerger, 0, 4);
                surroundSplitter.connect(surroundMerger, 1, 5); surroundMerger.connect(dolbyOutputNode);
            } catch (e) {
                console.error("[WS] Graph failed, safe bypass:", e);
                gainNode = ctx.createGain();
                limiterNode = ctx.createDynamicsCompressor();
                limiterNode.threshold.value = -1; limiterNode.knee.value = 0; limiterNode.ratio.value = 20;
                limiterNode.attack.value = 0.003; limiterNode.release.value = 0.25;
                eqFilters[eqFilters.length - 1].connect(gainNode); gainNode.connect(limiterNode); limiterNode.connect(ctx.destination);
            }

            const cspBlocksWasm = await isWasmBlockedByCSP();

            if (!cspBlocksWasm) {
                // На 99% сайтов мы пойдем сюда
                try {
                    const node = await setupSignalsmithWorklet(ctx);
                    pitchNode = node;
                    sourceGain.connect(pitchNode);
                    pitchNode.connect(eqFilters[0]);
                    activeProcessorType = 'signalsmith';
                    isNodeReady = true;
                    refreshPitchNode(true);
                } catch (e) {
                    // Фоллбэк, если Signalsmith завис по другой причине
                    console.warn("[WS] Signalsmith failed, falling back to Correlator:", e.message);
                    pitchNode = null;
                    try {
                        await setupCorrelatorWorklet(ctx);
                    } catch (e2) {
                        console.error("[WS] Correlator also failed:", e2.message);
                        sourceGain.connect(eqFilters[0]);
                    }
                }
            } else {
                // На Reddit мы попадем ровно сюда. Ни единой красной строки.
                console.log("%c[WS] WebAssembly is restricted by CSP. Using fallback processor.", "color: #f0ad4e; font-weight: bold;");
                try {
                    await setupCorrelatorWorklet(ctx);
                } catch (e) {
                    console.error("[WS] Correlator failed:", e.message);
                    sourceGain.connect(eqFilters[0]);
                }
            }
        }
    }

    function refreshEqualizer() {
        if (!eqFilters.length) return;
        const gains = settings.eqGains;
        if (gains && gains.length === 10) {
            eqFilters.forEach((filter, i) => {
                const db = (gains[i] - 50) / 5;
                filter.gain.value = db;
            });
        }
    }

    function refreshReverb() {
        if (!convolverNode) return;
        wetGainNode.gain.value = (settings.reverbWet || 0) / 100;
        const type = settings.reverbType;
        if (convolverCache.has(type)) { convolverNode.buffer = convolverCache.get(type); return; }

        if (!type || type === "null") {
            convolverNode.buffer = null; return;
        }
        const soundUrl = soundsBaseUrl + type + '.wav';
        console.log('soundUrl', soundUrl);

        fetch(soundUrl).then(r => r.arrayBuffer()).then(buf => audioCtx.decodeAudioData(buf)).then(buffer => {
            convolverCache.set(type, buffer); convolverNode.buffer = buffer;
        }).catch(e => console.error("[WS] Reverb load failed", e));
    }

    function refreshStereoWiden() {
        if (!subLeftGain) return;
        const val = -(settings.stereoWiden || 0) / 100;
        subLeftGain.gain.value = val; subRightGain.gain.value = val;
    }

    function refreshChannelBalance() {
        if (!stereoPannerNode) return;
        stereoPannerNode.pan.value = (settings.channelBalance || 0) / 100;
    }

    function routeHowler(bypass) {
        const howler = window.Howler;
        if (howler?.masterGain && audioCtx) {
            if (bypass) {
                connectNodeSafe(howler.masterGain, audioCtx.destination);
                try { howler.masterGain.disconnect(sourceGain) } catch (e) { }
            } else if (sourceGain) { // ИЗМЕНЕНО: было pitchNode
                connectNodeSafe(howler.masterGain, sourceGain);
                try { howler.masterGain.disconnect(audioCtx.destination) } catch (e) { }
            }
        }
    }

    async function attachHowler() {
        if (siteIsBlacklisted) return false;
        const howler = window.Howler;
        if (!howler?.ctx || !howler?.masterGain) return false;

        usingHowler = true;
        bindResumeHandlers(howler.ctx);
        await ensurePitchGraph(howler.ctx);
        if (!howlerAttached) howlerAttached = true;

        routeHowler(false); // Используем правильный роутинг
        syncHowlerSpeed();

        refreshAllNodes();

        return true;
    }

    function refreshGainNode() {
        if (!gainNode) return;
        const db = settings.volumeBoostDb || 0;
        gainNode.gain.value = Math.pow(10, db / 20);
    }

    function sendPitchUpdate() {
        if (!pitchNode || !isNodeReady) return;
        const finalSemitones = settings.pitchValueSemitones + settings.pitchValueCents / 100 + function getPitchCompensation() {
            const rate = calcPlaybackRate();
            return !usingHowler || !settings.preservePitch || rate <= 0 ? 0 : -12 * Math.log2(rate);
        }();

        pitchNode.port.postMessage([null, "start", {
            active: true,
            semitones: finalSemitones,
            tonalityHz: 8800
        }]);
    }

    function refreshPitchNode(forceConfig = false) {
        if (!pitchNode || !isNodeReady) return;

        // Если в черном списке, принудительно выдаем нейтральный питч (0)
        const isBlack = siteIsBlacklisted;

        if (activeProcessorType === 'signalsmith') {
            if (forceConfig || lastConfiguredBlockMs !== settings.windowSizeMilliseconds || lastConfiguredSmart !== settings.applySmartProcessing) {
                lastConfiguredBlockMs = settings.windowSizeMilliseconds;
                lastConfiguredSmart = settings.applySmartProcessing;
                pitchNode.port.postMessage([null, "configure", { blockMs: lastConfiguredBlockMs, splitComputation: !lastConfiguredSmart }]);
            }
            if (!pitchUpdateRafId) {
                pitchUpdateRafId = requestAnimationFrame(() => {
                    pitchUpdateRafId = null;
                    if (!pitchNode || !isNodeReady) return;

                    const finalSemitones = isBlack ? 0 : (settings.pitchValueSemitones + settings.pitchValueCents / 100 + (() => {
                        const rate = calcPlaybackRate();
                        return !usingHowler || !settings.preservePitch || rate <= 0 ? 0 : -12 * Math.log2(rate);
                    })());

                    pitchNode.port.postMessage([null, "start", { active: !isBlack, semitones: finalSemitones, tonalityHz: 8800 }]);
                });
            }
        } else if (activeProcessorType === 'correlator' && correlatorNodes) {
            const finalSemitones = isBlack ? 0 : (settings.pitchValueSemitones + settings.pitchValueCents / 100 + (() => {
                const rate = calcPlaybackRate();
                return !usingHowler || !settings.preservePitch || rate <= 0 ? 0 : -12 * Math.log2(rate);
            })());

            const factor = isBlack ? 1 : Math.pow(2, finalSemitones / 12);
            const windowSec = settings.windowSizeMilliseconds / 1000;

            if (factor === 1) {
                correlatorNodes.freqSrc.offset.value = 0;
                correlatorNodes.wss.offset.value = 0;
            } else {
                correlatorNodes.freqSrc.offset.value = 1.17915 / windowSec * (1 - factor);
                correlatorNodes.wss.offset.value = windowSec;
            }
        }
    }

    function refreshCompressor() {
        if (!compressorNode) return;
        compressorNode.threshold.value = settings.compressorThreshold || 0;
        compressorNode.knee.value = settings.compressorKnee || 30;
        compressorNode.ratio.value = settings.compressorRatio || 1;
        compressorNode.attack.value = (settings.compressorAttack || 3) / 1e3;
        compressorNode.release.value = (settings.compressorRelease || 250) / 1e3
    }


    function refreshDolby() {
        if (!dolbyInputNode || !surroundSplitter) return;
        try {
            stereoPannerNode.disconnect();
            if (settings.dolbyEnabled) {
                defaultChannelCount = audioCtx.destination.channelCount;
                audioCtx.destination.channelCount = 6;
                stereoPannerNode.connect(dolbyInputNode);
                dolbyOutputNode.connect(limiterNode)
            } else {
                audioCtx.destination.channelCount = defaultChannelCount || 2;
                stereoPannerNode.connect(limiterNode)
            }
        } catch (e) {
            console.error("[WS] Dolby toggle err", e);
            stereoPannerNode.connect(limiterNode)
        }
    }

    function refreshAllNodes() {
        if (siteIsBlacklisted) return;
        refreshPitchNode();
        refreshEqualizer();
        refreshGainNode();
        refreshReverb();
        refreshStereoWiden();
        refreshChannelBalance();
        refreshCompressor();
        refreshDolby();
    }

    function applySpeedSettings(mediaEl) {
        // Если сайт в блэклисте, жестко возвращаем стандартную скорость
        if (siteIsBlacklisted) {
            try {
                if (mediaEl.playbackRate !== 1 || mediaEl.defaultPlaybackRate !== 1) {
                    mediaEl.playbackRate = 1;
                    mediaEl.defaultPlaybackRate = 1;
                    mediaEl.__lastRateSetByUs = Date.now();
                }
                const preservePitch = true;
                if (mediaEl.preservesPitch !== preservePitch) {
                    mediaEl.preservesPitch = preservePitch;
                    if ("webkitPreservesPitch" in mediaEl) mediaEl.webkitPreservesPitch = preservePitch;
                }
            } catch (e) { }
            return;
        }

        // Оригинальная логика ниже...
        const rate = calcPlaybackRate();
        if (mediaEl.playbackRate === rate && mediaEl.defaultPlaybackRate === rate) {
            const preservePitch = !!settings.preservePitch;
            return void (mediaEl.preservesPitch !== preservePitch && (mediaEl.preservesPitch = preservePitch, "webkitPreservesPitch" in mediaEl && (mediaEl.webkitPreservesPitch = preservePitch)))
        }
        mediaEl.playbackRate = rate, mediaEl.defaultPlaybackRate = rate;
        const preservePitch = !!settings.preservePitch;
        "preservesPitch" in mediaEl && (mediaEl.preservesPitch = preservePitch), "webkitPreservesPitch" in mediaEl && (mediaEl.webkitPreservesPitch = preservePitch), mediaEl.__lastRateSetByUs = Date.now()
    }

    function handleRateChange(e) {
        const mediaEl = e?.target;
        if (!siteIsBlacklisted && mediaEl && (mediaEl.tagName === "AUDIO" || mediaEl.tagName === "VIDEO")) {
            const now = Date.now();
            if (mediaEl.__lastRateSetByUs && now - mediaEl.__lastRateSetByUs < 100) return;
            applySpeedSettings(mediaEl);
        }
    }

    function syncHowlerSpeed() {
        const howler = window.Howler;
        if (!howler) return;
        const rate = calcPlaybackRate(), preservePitch = !!settings.preservePitch;
        const howls = Array.isArray(howler._howls) ? howler._howls : [];
        for (const howl of howls) {
            try { if (typeof howl.rate === "function") howl.rate(rate); howl._rate = rate; } catch (e) { }
            const sounds = Array.isArray(howler._sounds) ? howl._sounds : [];
            for (const sound of sounds) {
                try {
                    const node = sound?._node; if (!node) continue;
                    if ("playbackRate" in node) try { node.playbackRate = rate; } catch { }
                    if (node.bufferSource?.playbackRate) try { node.bufferSource.playbackRate.value = rate; } catch { }
                    if ("preservesPitch" in node) try { node.preservesPitch = preservePitch; } catch { }
                    if ("webkitPreservesPitch" in node) try { node.webkitPreservesPitch = preservePitch; } catch { }
                    sound._rate = rate;
                } catch (e) { }
            }
        }
    }

    async function connectMediaElement(mediaEl) {
        if (mediaEl && mediaEl.nodeType === Node.ELEMENT_NODE && !connectingMediaElements.has(mediaEl)) {
            connectingMediaElements.add(mediaEl);
            try {
                // ФИКС ДЛЯ WIKIPEDIA И CORS (Логика из v1.2):
                // Если файл с чужого домена - принудительно включаем ему CORS и мягко перезагружаем.
                const ensureCorsEnabled = () => {
                    let src = mediaEl.currentSrc || mediaEl.src;

                    // Если на самом элементе нет URL, ищем внутри <source> (как делает Wikipedia)
                    if (!src) {
                        const sourceEl = mediaEl.querySelector('source');
                        if (sourceEl) src = sourceEl.src;
                    }
                    if (!src) return true; // Нет URL, пропускаем проверку

                    // Если тот же домен - проблем нет
                    if (new URL(src, location.href).origin === location.origin) return true;

                    // Если CORS уже включен - проблем нет
                    if (mediaEl.crossOrigin === "anonymous") return true;

                    // Чужой домен без CORS. Включаем и перезагружаем файл бесшовно.
                    console.log("[WS] Enabling CORS for:", src);
                    mediaEl.crossOrigin = "anonymous";
                    mediaEl.__ws_justCorsReloaded = true; // Ставим флажок
                    
                    const t = mediaEl.currentTime;
                    const wasPlaying = !mediaEl.paused;
                    mediaEl.src = src; // Это заставит браузер запросить файл с заголовком CORS

                    // Восстанавливаем воспроизведение после перезагрузки
                    mediaEl.addEventListener("loadedmetadata", async () => {
                        try { mediaEl.currentTime = t; } catch (e) { }
                        if (wasPlaying) {
                            try { await mediaEl.play(); } catch (e) { }
                        }
                    }, { once: true });

                    return false; // Сообщаем, что нужно прервать текущее подключение (файл перезагружается)
                };

                if (!ensureCorsEnabled()) {
                    connectingMediaElements.delete(mediaEl);
                    return; // Прерываемся. Как только файл перезагрузится, сработает событие 'play' и мы подключим его заново уже с CORS
                }

                const ctx = audioCtx && audioCtx.state !== "closed" ? audioCtx : new (window.AudioContext || window.webkitAudioContext);
                bindResumeHandlers(ctx);
                await ensurePitchGraph(ctx);

                if (!mediaEl.__speedListenersAdded) {
                    mediaEl.addEventListener("ratechange", handleRateChange);
                    mediaEl.__speedListenersAdded = true;
                    mediaEl.addEventListener("emptied", () => { mediaEl.__pitchConnected = false; mediaEl.__pitchSource = null; connectMediaElement(mediaEl); });
                }
                applySpeedSettings(mediaEl);

                                if (!mediaEl.__pitchSource) {
                    const source = audioCtx.createMediaElementSource(mediaEl);
                    mediaEl.__pitchSource = source;
                    source.connect(sourceGain); 

                    // ФИКС БАГА "ДУЭТА" НА WIKIPEDIA: 
                    // Применяем хак с mute ТОЛЬКО если мы только что принудительно перезагрузили файл для CORS.
                    // На Spotify, Youtube и других сайтах этот флажок не стоит, поэтому их внутренний
                    // аудио-граф не ломается при переключении треков.
                    if (mediaEl.__ws_justCorsReloaded) {
                        const wasMuted = mediaEl.muted;
                        mediaEl.muted = true; 
                        if (!wasMuted) mediaEl.muted = false;
                        delete mediaEl.__ws_justCorsReloaded;
                    }

                    // ФИКС ДЛЯ REDDIT AUTOPLAY: 
                    // Reddit запускает видео замученным. Клик по "Unmute" — это user gesture.
                    // Перехватываем его, чтобы разблокировать AudioContext прямо в этот момент.
                    if (!mediaEl.__unmuteHandlerBound) {
                        mediaEl.__unmuteHandlerBound = true;
                        mediaEl.addEventListener('unmute', () => {
                            if (audioCtx && audioCtx.state === 'suspended') {
                                audioCtx.resume();
                            }
                        });
                    }
                }

                connectedMediaElements.add(mediaEl);
                mediaEl.__pitchConnected = true;
                refreshAllNodes();
            } catch (e) {
                mediaEl.__pitchConnected = false;
            } finally {
                connectingMediaElements.delete(mediaEl);
            }
        }
    }

    window.addEventListener("message", async e => {
        if (e.source !== window) return;
        const data = e.data;
        if (!data || data.type !== "PITCH_UPDATE") return;

        settings = { ...settings, ...(data.settings || {}) };

        let isNowBlacklisted = false;
        try {
            isNowBlacklisted = function matchURLPatterns(url, urlPatterns) {
                urlPatterns = typeof urlPatterns === "string" ? [urlPatterns] : urlPatterns || [];
                return urlPatterns?.some(pattern => {
                    const np = pattern.trim();
                    if (!np) return false;
                    const escaped = np.replace(new RegExp("[-[\\]{}()*+?&.,\\\\^$|#'\"]", "gim"), "\\$&").replace(/\\\*/gim, ".*");
                    return url.match(new RegExp("^" + escaped + "$", ""));
                });
            }(location.href, settings.blacklistPatterns);
        } catch (err) {
            console.error("[PitchShifter] Blacklist regex error:", err);
        }

        if (isNowBlacklisted !== siteIsBlacklisted) {
            siteIsBlacklisted = isNowBlacklisted;

            if (siteIsBlacklisted) {
                if (pitchNode && isNodeReady) {
                    if (activeProcessorType === 'signalsmith') {
                        pitchNode.port.postMessage([null, "start", { active: true, semitones: 0, tonalityHz: 8800 }]);
                    } else if (activeProcessorType === 'correlator' && correlatorNodes) {
                        // Для коррелятора сброс питча — это возврат осцилляторов в нейтраль (factor = 1)
                        correlatorNodes.freqSrc.offset.value = 0;
                        correlatorNodes.wss.offset.value = 0;
                    }
                }
                if (gainNode) gainNode.gain.value = 1;
                eqFilters.forEach(f => { f.gain.value = 0; });

                if (wetGainNode) wetGainNode.gain.value = 0;
                if (subLeftGain) subLeftGain.gain.value = 0;
                if (subRightGain) subRightGain.gain.value = 0;
                if (stereoPannerNode) stereoPannerNode.pan.value = 0;
                if (compressorNode) {
                    compressorNode.threshold.value = 0,
                        compressorNode.knee.value = 30,
                        compressorNode.ratio.value = 1,
                        compressorNode.attack.value = .003,
                        compressorNode.release.value = .25
                }

                if (settings.dolbyEnabled && dolbyInputNode) {
                    refreshDolby();
                }

                connectedMediaElements.forEach(el => {
                    try {
                        el.playbackRate = 1; el.defaultPlaybackRate = 1;
                        if ("preservesPitch" in el) el.preservesPitch = true;
                        if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = true;
                        el.__lastRateSetByUs = Date.now();
                    } catch (e) { }
                });

                if (usingHowler) {
                    routeHowler(true); // Безопасно возвращаем на прямый выход
                    const howler = window.Howler;
                    if (howler) {
                        const howls = Array.isArray(howler._howls) ? howler._howls : [];
                        for (const howl of howls) {
                            try { if (typeof howl.rate === "function") howl.rate(1); howl._rate = 1; } catch (e) { }
                            const sounds = Array.isArray(howler._sounds) ? howl._sounds : [];
                            for (const sound of sounds) {
                                sound._rate = 1;
                                const node = sound?._node;
                                if (node?.playbackRate) node.playbackRate.value = 1;
                                if (node?.bufferSource?.playbackRate) node.bufferSource.playbackRate.value = 1;
                            }
                        }
                    }
                }
            } else {
                // Граф УЖЕ собран (мы делаем это при любом Play).
                // Просто обновляем параметры - эффекты применятся мгновенно.
                refreshAllNodes();
                connectedMediaElements.forEach(el => applySpeedSettings(el));
                usingHowler && syncHowlerSpeed();

                // На случай если видео появилось пока были в блэклисте
                const mediaElements = Array.from(document.querySelectorAll("audio, video"));
                for (const el of mediaElements) {
                    if (!el.__pitchSource) await connectMediaElement(el);
                }

                usingHowler && (await attachHowler());
            }
        } else if (!siteIsBlacklisted) {
            if (usingHowler) syncHowlerSpeed();
            else connectedMediaElements.forEach(el => applySpeedSettings(el));

            refreshAllNodes();
        }
    });

    const observer = new MutationObserver(mutations => {

        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches?.("audio, video")) connectMediaElement(node);
                    node.querySelectorAll?.("audio, video").forEach(connectMediaElement);
                }
            }
        }

    });

    function startObserver() {
        document.body && (observer.observe(document.body, { childList: true, subtree: true }), function connectAllMedia() {
            document.querySelectorAll("audio, video").forEach(connectMediaElement);
        }());
    }

    document.body ? startObserver() : document.addEventListener("DOMContentLoaded", startObserver);

    document.addEventListener("play", async e => {
        const el = e?.target;
        if (el && (el.tagName === "AUDIO" || el.tagName === "VIDEO")) {
            try { await connectMediaElement(el); } catch (err) { }
        }
    }, true);

    (function hookMediaElementPlay() {
        if (window.__pitchMediaPlayHooked) return;
        window.__pitchMediaPlayHooked = true;
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (...args) {
            const mediaEl = this;
            try {
                if (mediaEl && (mediaEl.tagName === "AUDIO" || mediaEl.tagName === "VIDEO")) {
                    queueMicrotask(async () => {
                        try {
                            if (await connectMediaElement(mediaEl)) return;
                            if (siteIsBlacklisted) return;
                            applySpeedSettings(mediaEl);

                            refreshAllNodes();


                        } catch (e) { }
                    });
                }
            } catch (e) { }
            return originalPlay.apply(mediaEl, args);
        };
    })();

    (function probeHowler() {
        howlerProbeTimer || (howlerProbeTimer = setInterval(() => {
            if (window.Howler && window.Howl) {
                function hookHowler() {
                    if (window.__pitchHowlerHooked) return;
                    if (!window.Howl || !window.Howl.prototype) return;
                    window.__pitchHowlerHooked = true;
                    const originalPlay = window.Howl.prototype.play;
                    window.Howl.prototype.play = function (...args) {
                        const result = originalPlay.apply(this, args);
                        queueMicrotask(async () => {
                            try {
                                if (siteIsBlacklisted) return;
                                await attachHowler();
                                syncHowlerSpeed();

                                refreshAllNodes();
                            } catch (e) { }
                        });
                        return result;
                    };
                }
                clearInterval(howlerProbeTimer);
                howlerProbeTimer = null;
                hookHowler();
                if (!siteIsBlacklisted) attachHowler().catch(e => { });
            }
        }, 250));
    })();

    (function startSpeedEnforcer() {
        setInterval(() => {
            if (siteIsBlacklisted || connectedMediaElements.size === 0) return;
            const rate = calcPlaybackRate();
            if (Math.abs(rate - 1) < 0.001) return;
            const preservePitch = !!settings.preservePitch;
            connectedMediaElements.forEach(el => {
                try {
                    if (el.paused || el.readyState < 2) return;
                    if (el.playbackRate !== rate) {
                        el.playbackRate = rate; el.defaultPlaybackRate = rate;
                        el.__lastRateSetByUs = Date.now();
                    }
                    if (el.preservesPitch !== preservePitch) {
                        el.preservesPitch = preservePitch;
                        if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = preservePitch;
                    }
                } catch (e) { }
            });
        }, 250);
    })();
})();