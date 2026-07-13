(() => {
    if (window.__pitchChangerPatched) return;
    window.__pitchChangerPatched = true;

    // --- OVERLAY ARCHITECTURE ---
    let overlayMode = false;
    let overlayPresetsData = null;
    let overlayConfig = { MAX_OVERLAY_CHAINS: 10, MAX_SIGNALSMITH_CHAINS: 2 };
    let parallelChains = [];
    let globalMergeNode = null;
    let globalCompressorNode = null;
    let globalStereoPannerNode = null;
    let globalLimiterNode = null;
    let globalDolbyInputNode = null;
    let globalDolbyOutputNode = null;
    let globalSurroundSplitter = null;
    let globalSurroundMerger = null;
    let globalSurroundCenterGain = null;
    let defaultChannelCount = 2;
    let overlayGraphBuilt = false; // Флаг, чтобы не перестраивать граф для каждого нового audio тега

    // ИНИЦИАЛИЗАЦИЯ ОВЕРЛЕЯ ПРИ ЗАГРУЗКЕ (Решает проблему Race Condition)
    try {
        const initMeta = document.getElementById("__pitchShifterCfg");
        if (initMeta && initMeta.dataset.initialSettings) {
            const initData = JSON.parse(initMeta.dataset.initialSettings);

            if (
                initData.overlayEnabled &&
                Array.isArray(initData.overlayPresets) &&
                initData.overlayPresets.length > 0
            ) {
                // Чистый базовый пресет (только те настройки, которые использует аудио-граф оверлея)
                const defaultPresetValues = {
                    pitchValueSemitones: 0,
                    pitchValueCents: 0,
                    windowSizeMilliseconds: 120,
                    applySmartProcessing: true,
                    gainOutputDb: 0,
                    effectsMix: 50,
                    eqGains: Array(10).fill(50),
                    reverbType: null,
                    reverbWet: 0,
                    centerCancel: 0,
                    channelBalance: 0,
                    modulationLayers: []

                };

                const allPresets = {
                    default: { values: defaultPresetValues },
                    ...(initData.globalPresets || {})
                };

                const rawPresets = [...new Set(initData.overlayPresets)].map(id => {
                    const pValues = allPresets[id]?.values || {};
                    return {
                        id: id,
                        values: { ...defaultPresetValues, ...pValues }
                    };
                });

                const seen = new Set;
                const unique = rawPresets.filter(p => {
                    const hash = JSON.stringify(p.values);
                    if (seen.has(hash)) return false;
                    seen.add(hash);
                    return true;
                });

                if (unique.length > 0) {
                    overlayMode = true;
                    overlayPresetsData = unique.slice(0, 10);
                }
            }
        }
    } catch (e) { }

    async function rebuildGraph() {
        if (rebuildGraph._isRunning) return;
        rebuildGraph._isRunning = true;

        try {
            if (!audioCtx || !sourceGain) return;

            // --- ДИАГНОСТИКА ЭХА: СТАТИСТИКА СБОРКИ ---
            const chainsToBuild = overlayPresetsData || [settings];

            // 1. АГРЕССИВНАЯ ОЧИСТКА СТАРЫХ ЦЕПОЧЕК
            parallelChains.forEach(chain => {
                try { chain.pitchNode?.port?.close?.() } catch (e) { }
                try { chain.pitchNode?.disconnect() } catch (e) { }

                chain.eqs.forEach(f => { try { f.disconnect() } catch (e) { } });

                try { chain.convolver?.disconnect() } catch (e) { }
                try { chain.balance?.disconnect() } catch (e) { }
                try { chain.gain?.disconnect() } catch (e) { }

                // Очистка новых узлов дисторшна и делэя
                try { chain.distIn?.disconnect() } catch (e) { }
                try { chain.distOut?.disconnect() } catch (e) { }
                try { chain.delayIn?.disconnect() } catch (e) { }
                try { chain.delayOut?.disconnect() } catch (e) { }

                // Очистка коррелятора
                chain.correlatorNodes?.oscillators && chain.correlatorNodes.oscillators.forEach(osc => {
                    try { osc.stop() } catch (e) { }
                });

                // Правильная очистка дисторшна (distNodes теперь массив!)
                if (chain.distNodes) {
                    chain.distNodes.forEach(n => {
                        try { n.input?.disconnect() } catch (e) { }
                        try { n.output?.disconnect() } catch (e) { }
                        if (n.processors) {
                            n.processors.forEach(p => { try { p.disconnect() } catch (e) { } });
                        }
                    });
                }

                // Правильная очистка делэя (delayNodes - объект от buildDelayGraph)
                if (chain.delayNodes) {
                    try { chain.delayNodes.input?.disconnect() } catch (e) { }
                    try { chain.delayNodes.output?.disconnect() } catch (e) { }
                    try { chain.delayNodes.delayL?.disconnect() } catch (e) { }
                    try { chain.delayNodes.delayR?.disconnect() } catch (e) { }
                    try { chain.delayNodes.fbL?.disconnect() } catch (e) { }
                    try { chain.delayNodes.fbR?.disconnect() } catch (e) { }
                    try { chain.delayNodes.dryGain?.disconnect() } catch (e) { }
                    try { chain.delayNodes.wetGain?.disconnect() } catch (e) { }
                }

                // Очистка модуляций цепи
                if (chain.modNodes) {
                    chain.modNodes.forEach(n => {
                        try { n.input?.disconnect() } catch (e) { }
                        try { n.output?.disconnect() } catch (e) { }
                        n.oscillators?.forEach(osc => { try { osc.stop() } catch (e) { } });
                    });
                }
            });
            parallelChains = [];


            // 2. АГРЕССИВНАЯ ОЧИСТКА ГЛОБАЛЬНЫХ НОД
            [globalMergeNode, globalCompressorNode, globalStereoPannerNode, globalLimiterNode, globalDolbyInputNode, globalDolbyOutputNode].forEach(n => {
                if (n) try { n.disconnect(); } catch (e) { }
            });
            globalMergeNode = null; globalCompressorNode = null; globalStereoPannerNode = null;
            globalLimiterNode = null; globalDolbyInputNode = null; globalDolbyOutputNode = null;

            // 3. СОЗДАНИЕ НОВЫХ ГЛОБАЛЬНЫХ НОД
            globalMergeNode = audioCtx.createGain();
            globalCompressorNode = audioCtx.createDynamicsCompressor();
            globalStereoPannerNode = audioCtx.createStereoPanner();
            globalLimiterNode = audioCtx.createDynamicsCompressor();
            globalLimiterNode.threshold.value = -1; globalLimiterNode.knee.value = 0; globalLimiterNode.ratio.value = 20; globalLimiterNode.attack.value = 0.003; globalLimiterNode.release.value = 0.25;

            try {
                globalDolbyInputNode = audioCtx.createGain(); globalDolbyOutputNode = audioCtx.createGain();
                globalSurroundSplitter = audioCtx.createChannelSplitter(2); globalSurroundMerger = audioCtx.createChannelMerger(6);
                globalSurroundCenterGain = audioCtx.createGain(); globalSurroundCenterGain.gain.value = 0.2;
                globalDolbyInputNode.connect(globalSurroundSplitter);
                globalSurroundSplitter.connect(globalSurroundMerger, 0, 0); globalSurroundSplitter.connect(globalSurroundMerger, 1, 1);
                globalSurroundSplitter.connect(globalSurroundCenterGain, 0); globalSurroundCenterGain.connect(globalSurroundMerger, 0, 2);
                globalSurroundSplitter.connect(globalSurroundMerger, 0, 3); globalSurroundSplitter.connect(globalSurroundMerger, 0, 4);
                globalSurroundSplitter.connect(globalSurroundMerger, 1, 5); globalSurroundMerger.connect(globalDolbyOutputNode);
            } catch (e) { console.error("[WS] Dolby init err", e); }

            globalMergeNode.connect(globalCompressorNode); globalCompressorNode.connect(globalStereoPannerNode);
            const connectGlobalEnd = () => {
                try { globalStereoPannerNode.disconnect(); } catch (e) { }
                if (settings.dolbyEnabled && globalDolbyInputNode) {
                    defaultChannelCount = audioCtx.destination.channelCount;
                    audioCtx.destination.channelCount = 6;
                    globalStereoPannerNode.connect(globalDolbyInputNode);
                    globalDolbyOutputNode.connect(globalLimiterNode);
                } else {
                    audioCtx.destination.channelCount = defaultChannelCount || 2;
                    globalStereoPannerNode.connect(globalLimiterNode);
                }
            };
            connectGlobalEnd();
            globalLimiterNode.connect(audioCtx.destination);



            // Проверяем CSP для WASM (используем существующую функцию)
            const isWasmBlocked = await isWasmBlockedByCSP();

            for (let i = 0; i < chainsToBuild.length; i++) {
                try {
                    // Извлекаем настройки, адаптируясь под новый формат { id, values }
                    const pSet = chainsToBuild[i].values || chainsToBuild[i];
                    // Если WASM заблокирован политиками сайта, принудительно используем Correlator для всех цепей
                    const useSignalsmith = !isWasmBlocked && (i < overlayConfig.MAX_SIGNALSMITH_CHAINS);
                    const chainEqs = EQ_BANDS.map(band => { const f = audioCtx.createBiquadFilter(); f.type = band.type; f.frequency.value = band.frequency; if (band.q) f.Q.value = band.q; return f; });
                    for (let j = 0; j < chainEqs.length - 1; j++) chainEqs[j].connect(chainEqs[j + 1]);
                    const chainSplitter = audioCtx.createChannelSplitter(2), chainMerger = audioCtx.createChannelMerger(2);
                    const chainSubL = audioCtx.createGain(); chainSubL.gain.value = 0; const chainSubR = audioCtx.createGain(); chainSubR.gain.value = 0;
                    const chainDirectL = audioCtx.createGain(); chainDirectL.gain.value = 1; const chainDirectR = audioCtx.createGain(); chainDirectR.gain.value = 1;
                    chainEqs[chainEqs.length - 1].connect(chainSplitter);
                    chainSplitter.connect(chainDirectL, 0); chainSplitter.connect(chainSubR, 1); chainSplitter.connect(chainDirectR, 1); chainSplitter.connect(chainSubL, 0);
                    chainDirectL.connect(chainMerger, 0, 0); chainSubR.connect(chainMerger, 0, 0); chainDirectR.connect(chainMerger, 0, 1); chainSubL.connect(chainMerger, 0, 1);
                    const chainConvolver = audioCtx.createConvolver(), chainDry = audioCtx.createGain(); chainDry.gain.value = 1;
                    const chainWet = audioCtx.createGain(); chainWet.gain.value = 0, chainReverbMerge = audioCtx.createGain();
                    chainMerger.connect(chainDry); chainMerger.connect(chainConvolver); chainConvolver.connect(chainWet); chainDry.connect(chainReverbMerge); chainWet.connect(chainReverbMerge);
                    const chainBalance = audioCtx.createStereoPanner(), chainGain = audioCtx.createGain();
                    chainGain.gain.value = Math.pow(10, (pSet.gainOutputDb || 0) / 20);
                    chainReverbMerge.connect(chainBalance);




                    var chainDistIn = audioCtx.createGain(),
                        chainDistOut = audioCtx.createGain(),
                        chainDistDry = audioCtx.createGain(),
                        chainDefIn = audioCtx.createGain(),
                        chainDefOut = audioCtx.createGain(),
                        chainDefDry = audioCtx.createGain(),
                        chainDefHp = audioCtx.createBiquadFilter(),
                        chainDefExciter = audioCtx.createWaveShaper(),
                        chainDefLp = audioCtx.createBiquadFilter(),
                        chainDefWet = audioCtx.createGain();
                    chainDefHp.type = "highpass", chainDefHp.frequency.value = 3e3, chainDefPre.gain.value = 1, chainDefExciter.curve = makeDefCurve(), chainDefExciter.oversample = "4x", chainDefLp.type = "lowpass", chainDefLp.frequency.value = 14e3, chainDefDry.gain.value = 1, chainDefWet.gain.value = 0,
                        chainDistIn.connect(chainDistDry),
                        chainDistDry.connect(chainDistOut),
                        chainDelayIn.connect(chainDelayOut),
                        chainDelayOut.connect(chainDefIn),
                        chainDefIn.connect(chainDefDry),
                        chainDefDry.connect(chainDefOut),
                        chainDefIn.connect(chainDefHp),
                        chainDefHp.connect(chainDefExciter),
                        chainDefExciter.connect(chainDefLp),
                        chainDefLp.connect(chainDefWet),
                        chainDefWet.connect(chainDefOut),
                        chainDefOut.connect(chainGain), chainGain.connect(globalMergeNode), ovEffectsWetNode = audioCtx.createGain(), ovEffectsDryNode = audioCtx.createGain(), globalMergeNode.connect(ovEffectsWetNode), ovEffectsWetNode.connect(globalCompressorNode), sourceGain.connect(ovEffectsDryNode), ovEffectsDryNode.connect(globalCompressorNode);



                    let pitchNode = null, correlatorNodes = null, procType = null;
                    try {
                        if (useSignalsmith) {
                            const node = await new Promise(async (resolve, reject) => {
                                try { await audioCtx.audioWorklet.addModule(workletUrl); } catch (e) { }
                                const n = new AudioWorkletNode(audioCtx, "signalsmith-stretch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
                                const timeout = setTimeout(() => reject(new Error("Timeout")), 1500);
                                n.port.onmessage = e => { if (e?.data && e.data[0] === "ready") { clearTimeout(timeout); resolve(n); } };
                            });
                            pitchNode = node; procType = "signalsmith";
                        }
                    } catch (e) { console.warn(`[WS] Chain ${i} Signalsmith failed, using Correlator`); }

                    if (!pitchNode) {
                        try {
                            try { await audioCtx.audioWorklet.addModule(fallbackWorkletUrl); } catch (e) { }
                            pitchNode = new AudioWorkletNode(audioCtx, "pitch-correlator", { numberOfInputs: 2, numberOfOutputs: 1, channelCount: 2, outputChannelCount: [2] });
                            const cGain = (val, dest) => {
                                const g = audioCtx.createGain();
                                if (typeof val === "number") g.gain.value = val;
                                else { val.connect(g.gain); g.gain.value = 0; }
                                g.connect(dest);
                                return g;
                            };

                            const oscillatorsToStore = []; // Сохраняем осцилляторы, чтобы потом их убить
                            const cConstantSource = audioCtx.createConstantSource(); cConstantSource.offset.value = 1; oscillatorsToStore.push(cConstantSource);
                            const cSaw1 = createSawtooth(audioCtx, 0); oscillatorsToStore.push(cSaw1);
                            const cSaw2 = createSawtooth(audioCtx, Math.PI); oscillatorsToStore.push(cSaw2);
                            const cSine = createSine(audioCtx, 3 * Math.PI / 2); oscillatorsToStore.push(cSine);
                            const cFreqSrc = audioCtx.createConstantSource(); cFreqSrc.offset.value = 0; oscillatorsToStore.push(cFreqSrc);
                            const cWss = audioCtx.createConstantSource(); cWss.offset.value = 0; oscillatorsToStore.push(cWss);

                            cFreqSrc.connect(cSaw1.frequency); cFreqSrc.connect(cSaw2.frequency); cFreqSrc.connect(cSine.frequency);
                            const cDelay1 = audioCtx.createDelay(), cDelay2 = audioCtx.createDelay();
                            const cMakeFilter = dest => { const f = audioCtx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1760; f.connect(dest); return f; };
                            const cFilter1 = cMakeFilter(cGain(cWss, cDelay1.delayTime)); cSaw1.connect(cFilter1);
                            const cFilter2 = cMakeFilter(cGain(cWss, cDelay2.delayTime)); cSaw2.connect(cFilter2);
                            const cCsGain1 = cGain(0.5, cFilter1);
                            const cCsGain2 = cGain(0.5, cFilter2);
                            cConstantSource.connect(cCsGain1);
                            cConstantSource.connect(cCsGain2);
                            cDelay1.connect(pitchNode, 0, 0); cDelay2.connect(pitchNode, 0, 1); cSine.connect(pitchNode.parameters.get("c"));

                            const now = audioCtx.currentTime;
                            try { oscillatorsToStore.forEach(n => n.start(now)); } catch (e) { }

                            correlatorNodes = {
                                freqSrc: cFreqSrc, wss: cWss, delay1: cDelay1, delay2: cDelay2,
                                oscillators: oscillatorsToStore
                            };
                            procType = "correlator";
                        } catch (e) {
                            // Если Correlator упал, отключаем питч для этой цепи, но НЕ молчим!
                            console.warn(`[WS] Chain ${i} Correlator failed, bypassing pitch.`);
                            pitchNode = null;
                            procType = "bypass";
                        }
                    }

                    if (procType === "signalsmith") { sourceGain.connect(pitchNode); pitchNode.connect(chainEqs[0]); }
                    else if (procType === "correlator" && correlatorNodes) { sourceGain.connect(correlatorNodes.delay1); sourceGain.connect(correlatorNodes.delay2); pitchNode.connect(chainEqs[0]); }
                    else {
                        // Запасной вариант: если оба процессора упали, подключаем источник напрямую к EQ, чтобы не было тишины
                        console.warn(`[WS] Chain ${i} processors failed, bypassing pitch`);
                        sourceGain.connect(chainEqs[0]);
                    }

                    parallelChains.push({
                        pitchNode: pitchNode,
                        eqs: chainEqs,
                        procType: procType,
                        correlatorNodes: correlatorNodes,
                        subL: chainSubL,
                        subR: chainSubR,
                        convolver: chainConvolver,
                        dry: chainDry,
                        wet: chainWet,
                        balance: chainBalance,
                        gain: chainGain,
                        settings: pSet,
                        lastBlockMs: null,
                        lastSmart: null,
                        delayIn: chainDelayIn,
                        delayOut: chainDelayOut,
                        delayNodes: null,
                        distIn: chainDistIn,
                        distOut: chainDistOut,
                        distDry: chainDistDry,
                        distNodes: null,
                        defIn: chainDefIn,
                        defOut: chainDefOut,
                        defDry: chainDefDry,
                        defWet: chainDefWet
                    });

                } catch (chainError) {
                    console.error(`[WS] Critical error building chain ${i}, skipping it:`, chainError);
                }
            }
            if (parallelChains.length === 0) sourceGain.connect(globalMergeNode);
            refreshOverlayNodes();
            overlayGraphBuilt = true; // Граф успешно собран
        } catch (error) {
            console.error("[WS] Graph rebuild error:", error);
        } finally {
            // Снимаем замок в любом случае, даже если была ошибка
            rebuildGraph._isRunning = false;
        }
    }

    async function refreshOverlayNodes() {
        if (siteIsBlacklisted) { parallelChains.forEach(c => { try { c.pitchNode?.port?.postMessage([null, "start", { active: !1, semitones: 0, tonalityHz: 8800 }]) } catch (e) { } }); return; }
        const globalRate = calcPlaybackRate();
        parallelChains.forEach(chain => {
            const pSet = chain.settings;

            if (chain.pitchNode && "signalsmith" === chain.procType) {
                const newBlock = pSet.windowSizeMilliseconds,
                    newSmart = !pSet.applySmartProcessing;
                chain.lastBlockMs === newBlock && chain.lastSmart === newSmart || (chain.pitchNode.port.postMessage([null, "configure", {
                    blockMs: newBlock,
                    splitComputation: newSmart
                }]), chain.lastBlockMs = newBlock, chain.lastSmart = newSmart);
                const finalSemitones = pSet.pitchValueSemitones + pSet.pitchValueCents / 100 + (!usingHowler || !settings.preservePitch || globalRate <= 0 ? 0 : -12 * Math.log2(globalRate));
                chain.pitchNode.port.postMessage([null, "start", {
                    active: !0,
                    semitones: finalSemitones,
                    tonalityHz: 8800
                }])
            } else if (chain.procType === "correlator" && chain.correlatorNodes) {
                const finalSemitones = pSet.pitchValueSemitones + pSet.pitchValueCents / 100 + (!usingHowler || !settings.preservePitch || globalRate <= 0 ? 0 : -12 * Math.log2(globalRate));
                const factor = Math.pow(2, finalSemitones / 12), windowSec = pSet.windowSizeMilliseconds / 1000;
                if (factor === 1) { chain.correlatorNodes.freqSrc.offset.value = 0; chain.correlatorNodes.wss.offset.value = 0; }
                else { chain.correlatorNodes.freqSrc.offset.value = 1.17915 / windowSec * (1 - factor); chain.correlatorNodes.wss.offset.value = windowSec; }
            }
            const gains = pSet.eqGains || Array(10).fill(50); chain.eqs.forEach((f, i) => { f.gain.value = (gains[i] - 50) / 5; });
            const centerCancelVal = -(pSet.centerCancel || 0) / 100;
            chain.subL.gain.value = centerCancelVal;
            chain.subR.gain.value = centerCancelVal;
            // КРИТИЧЕСКИЙ ФИКС: Если тип ревербера "null", жестко глушим wet канал.
            // В некоторых браузерах ConvolverNode с buffer=null создает задержку в 1 блок (эхо).
            if (pSet.reverbType && pSet.reverbType !== "null") {
                chain.wet.gain.value = (pSet.reverbWet || 0) / 100;
                if (!convolverCache.has(pSet.reverbType)) {
                    fetch(soundsBaseUrl + pSet.reverbType + ".wav").then(r => r.arrayBuffer()).then(buf => audioCtx.decodeAudioData(buf)).then(buffer => {
                        convolverCache.set(pSet.reverbType, buffer);
                        chain.convolver.buffer = buffer;
                    }).catch(e => console.error(e));
                } else {
                    chain.convolver.buffer = convolverCache.get(pSet.reverbType);
                }
            } else {
                chain.wet.gain.value = 0; // Глушим wet, чтобы избежать фленжера/эха от null buffer
                chain.convolver.buffer = null;
            }
            chain.balance.pan.value = (pSet.channelBalance || 0) / 100;

            // --- Переключение модуляции ВНУТРИ цепи ---
            if (chain.modNodes) {
                chain.modNodes.forEach(function (n) {
                    try { n.input.disconnect(); } catch (e) { }
                    try { n.output.disconnect(); } catch (e) { }
                    if (n.oscillators) {
                        n.oscillators.forEach(function (osc) {
                            try { osc.stop(); } catch (e) { }
                        });
                    }
                });
            }
            chain.modNodes = [];

            try { chain.balance.disconnect(chain.gain); } catch (e) { }

            var cLayers = pSet.modulationLayers,
                needsMod = !!(cLayers && cLayers.length > 0);
            if (chain.modNodes && chain.modNodes.length > 0 || needsMod) {
                chain.modNodes && chain.modNodes.forEach(function (n) {
                    try {
                        n.input.disconnect()
                    } catch (e) { }
                    try {
                        n.output.disconnect()
                    } catch (e) { }
                    n.oscillators && n.oscillators.forEach(function (osc) {
                        try {
                            osc.stop()
                        } catch (e) { }
                    })
                }), chain.modNodes = [];
                if (needsMod) {
                    var cCurr = audioCtx.createGain();
                    if (!chain._hasOvMod) {
                        try {
                            chain.balance.disconnect(chain.distIn)
                        } catch (e) { }
                        chain._hasOvMod = !0
                    }
                    chain.balance.connect(cCurr);
                    for (var mi = 0; mi < cLayers.length; mi++) {
                        var mL = cLayers[mi];
                        if (mL && mL.type) {
                            var mEff;
                            try {
                                mEff = createModulationEffect(audioCtx, mL.type, mL.params || {})
                            } catch (err) {
                                console.error("[WS Overlay Mod]", err);
                                continue
                            }
                            cCurr.connect(mEff.input), cCurr = mEff.output, chain.modNodes.push(mEff)
                        }
                    }
                    cCurr.connect(chain.distIn)
                } else {
                    if (chain._hasOvMod) {
                        try {
                            chain.balance.disconnect(chain.distIn)
                        } catch (e) { }
                        chain.balance.connect(chain.distIn), chain._hasOvMod = !1
                    }
                }
            }
        });
        if (globalCompressorNode) { globalCompressorNode.threshold.value = settings.compressorThreshold || 0; globalCompressorNode.knee.value = settings.compressorKnee || 30; globalCompressorNode.ratio.value = settings.compressorRatio || 1; globalCompressorNode.attack.value = (settings.compressorAttack || 3) / 1000; globalCompressorNode.release.value = (settings.compressorRelease || 250) / 1000; }
        if (globalDolbyInputNode) {
            try { globalStereoPannerNode.disconnect(); } catch (e) { }
            if (settings.dolbyEnabled) {
                defaultChannelCount = audioCtx.destination.channelCount;
                audioCtx.destination.channelCount = 6;
                globalStereoPannerNode.connect(globalDolbyInputNode);
                globalDolbyOutputNode.connect(globalLimiterNode);
            }
            else {
                audioCtx.destination.channelCount = defaultChannelCount || 2;
                globalStereoPannerNode.connect(globalLimiterNode);
            }
        }
        refreshModulationGraph();
        var eMixM = (settings.effectsMix || 0) / 100;
        ovEffectsWetNode && ovEffectsWetNode.gain.linearRampToValueAtTime(eMixM, audioCtx.currentTime + .02),
            ovEffectsDryNode && ovEffectsDryNode.gain.linearRampToValueAtTime(1 - eMixM, audioCtx.currentTime + .02);


        // Применяем Distortion и Delay для КАЖДОЙ цепи, читая ИМЕННО ИЗ ЕЁ ПРЕСЕТА
        for (let i = 0; i < parallelChains.length; i++) {
            let chain = parallelChains[i];

            // --- Обновление Distortion ---
            await (async function (c) {
                if (!c || !c.distIn) return;

                var pSet = c.settings || settings;
                var layers = pSet.distortionLayers;
                var mix = (pSet.distMix || 0) / 100;

                if (!layers || !layers.length) {
                    if (c.distNodes) {
                        c.distNodes.forEach(function (n) { try { n.input.disconnect() } catch (e) { } try { n.output.disconnect() } catch (e) { } n.processors && n.processors.forEach(function (p) { try { p.disconnect() } catch (e) { } }) });
                        c.distNodes = null;
                        c._lastDistLayersHash = null;
                    }
                    if (c.distDry) c.distDry.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02);
                } else {
                    var chainHash = layers.map(function (l) { return l.type }).join("-");
                    if (c.distNodes && c._lastDistLayersHash === chainHash) {
                        c.distNodes.forEach(function (node, idx) {
                            var l = layers[idx];
                            if (l && node.workletNode && node.workletNode.parameters) {
                                var p = node.workletNode.parameters;
                                "bitcrusher" === l.type ? (p.has("bits") && (p.get("bits").value = l.params.bits || 8), p.has("normRange") && (p.get("normRange").value = l.params.normRange || 40)) : "cdskipper" === l.type ? (p.has("loopMs") && (p.get("loopMs").value = l.params.loopMs || 200), p.has("repeats") && (p.get("repeats").value = l.params.repeats || 4)) : "vinyl" === l.type && (p.has("noise") && (p.get("noise").value = (l.params.noise || 0) / 100), p.has("crackle") && (p.get("crackle").value = (l.params.crackle || 0) / 100))
                            } else if (l && node.processors) {
                                node.processors.forEach(function (p) { "distortion" === l.type && (p.shaper && (p.shaper.curve = makeDistCurve((l.params.amount || 50) / 100)), p.tone && (p.tone.frequency.value = 2e3 + (l.params.tone || 50) / 100 * 8e3)) })
                            }
                        });
                    } else {
                        c.distNodes && c.distNodes.forEach(function (n) { try { n.input.disconnect() } catch (e) { } try { n.output.disconnect() } catch (e) { } n.processors && n.processors.forEach(function (p) { try { p.disconnect() } catch (e) { } }) });
                        c.distNodes = [];
                        for (var current = c.distIn, j = 0; j < layers.length; j++) {
                            var effect = await createDistEffect(audioCtx, layers[j].type, layers[j].params || {});
                            current.connect(effect.input), current = effect.output, c.distNodes.push(effect);
                        }
                        current.connect(c.distOut);
                        c._lastDistLayersHash = chainHash;
                    }
                    // Proper Dry/Wet mix
                    if (c.distDry) c.distDry.gain.linearRampToValueAtTime(1 - mix, audioCtx.currentTime + 0.02);
                    if (c.distNodes && c.distNodes.length > 0) c.distNodes[c.distNodes.length - 1].output.gain.linearRampToValueAtTime(mix, audioCtx.currentTime + 0.02);
                }
            })(chain);

            (function (c) { if (c && c.defWet && c.defPre) { var m = (c.settings?.definitionMix || 0) / 100; var d = 1 + Math.pow(m, 1.5) * 3, w = Math.pow(m, 0.8) * 0.55; c.defPre.gain.linearRampToValueAtTime(d, audioCtx.currentTime + .02), c.defWet.gain.linearRampToValueAtTime(w, audioCtx.currentTime + .02) } })(chain);
            // --- Обновление Delay ---
            (function (c) {
                if (!c || !c.delayIn) return;

                var pSet = c.settings || settings;
                var t = (pSet.delayTime || 250) / 1000;
                var f = (pSet.delayFeedback || 40) / 100;
                var m = (pSet.delayMix || 0) / 100;

                if (m <= 0) {
                    if (c.delayNodes) {
                        updateDelayNodes(c.delayNodes, 0.001, 0, 0);
                    } else if (!c._delayBypassed) {
                        try { c.delayIn.disconnect(c.delayOut); } catch (e) { }
                        c.delayIn.connect(c.delayOut);
                        c._delayBypassed = true;
                    }
                } else {
                    c._delayBypassed = false;
                    if (!c.delayNodes) {
                        c.delayNodes = buildDelayGraph(audioCtx);
                        c.delayIn.connect(c.delayNodes.input);
                        c.delayNodes.output.connect(c.delayOut);
                    }
                    updateDelayNodes(c.delayNodes, t, f, m);
                }
            })(chain);
        }
    }


    // --- END OVERLAY ARCHITECTURE ---


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

    let effectsWorkletLoaded = null;
    async function loadEffectsWorklet() {
        if (!effectsWorkletLoaded) {
            // Формируем путь к новому файлу на основе пути fallback процессора
            const effectsWorkletUrl = fallbackWorkletUrl.replace('pitch-correlator-processor.js', 'audio-effects-worklet.js');
            effectsWorkletLoaded = audioCtx.audioWorklet.addModule(effectsWorkletUrl).catch(e => {
                console.error("[WS] Effects Worklet failed to load", e);
                throw e;
            });
        }
        return effectsWorkletLoaded;
    }

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
    let stereoSplitter, stereoMerger, subLeftGain, subRightGain, convolverNode, dryGainNode, wetGainNode, reverbMergeNode, stereoPannerNode, compressorNode, dolbyInputNode, dolbyOutputNode, surroundSplitter, surroundMerger, surroundCenterGain, modulationInputNode = null, modulationOutputNode = null, modulationLayersNodes = [], delayInputNode = null, delayOutputNode = null, delayNodes = null, distInputNode = null, distOutputNode = null, distDryGain = null, distNodes = null, lastDistType = null, defInputNode = null, defOutputNode = null, defDryGain = null, defHpFilter = null, defPreGain = null, defExciter = null, defLpFilter = null, defWetGain = null, effectsWetNode = null, effectsDryNode = null, ovEffectsWetNode = null, ovEffectsDryNode = null;
    const convolverCache = new Map;
    let lastConfiguredBlockMs = null, lastConfiguredSmart = null, pitchUpdateRafId = null;

    let settings = {
        gainOutputDb: 0, pitchValueSemitones: 0, pitchValueCents: 0, windowSizeMilliseconds: 120,
        applySmartProcessing: true, speedUnits: 0, speedFine: 0, preservePitch: true, blacklistPatterns: [],
        eqGains: Array(10).fill(50), reverbType: null, reverbWet: 0, centerCancel: 0, channelBalance: 0, definitionMix: 0, effectsMix: 50,
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
        if (overlayMode) {
            const contextChanged = !audioCtx || audioCtx !== ctx;
            if (contextChanged) {
                // Безопасное переключение: НЕ закрываем старый контекст, чтобы не убить Howler
                audioCtx = ctx;
                if (!sourceGain) sourceGain = ctx.createGain();
                bindResumeHandlers(ctx);
                await rebuildGraph();
            } else {
                bindResumeHandlers(ctx);
            }
            return;
        }
        if (audioCtx && audioCtx !== ctx) {
            try {
                pitchNode?.disconnect()
            } catch { }
            try {
                gainNode?.disconnect()
            } catch { }
            try {
                limiterNode?.disconnect()
            } catch { }
            try {
                pitchNode?.port?.close?.()
            } catch { }
            eqFilters.forEach(f => {
                try {
                    f.disconnect()
                } catch { }
            }), pitchNode = null, eqFilters = [], gainNode = null, limiterNode = null, isNodeReady = !1, sourceGain = null, lastConfiguredBlockMs = null, lastConfiguredSmart = null, modulationInputNode = null, modulationOutputNode = null, modulationLayersNodes = [], delayInputNode = null, delayOutputNode = null, distInputNode = null, distOutputNode = null, distNodes = null, defInputNode = null, defOutputNode = null, defDryGain = null, defHpFilter = null, defPreGain = null, defExciter = null, defLpFilter = null, defWetGain = null, effectsWetNode = null, effectsDryNode = null;
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
                // --- СТЕРЕО БАЗА ---
                stereoSplitter = ctx.createChannelSplitter(2);
                stereoMerger = ctx.createChannelMerger(2);
                subLeftGain = ctx.createGain(); subLeftGain.gain.value = 0;
                subRightGain = ctx.createGain(); subRightGain.gain.value = 0;
                let directLeft = ctx.createGain(); directLeft.gain.value = 1;
                let directRight = ctx.createGain(); directRight.gain.value = 1;

                eqFilters[eqFilters.length - 1].connect(stereoSplitter);
                stereoSplitter.connect(directLeft, 0);
                stereoSplitter.connect(subRightGain, 1);
                directLeft.connect(stereoMerger, 0, 0);
                subRightGain.connect(stereoMerger, 0, 0);
                stereoSplitter.connect(directRight, 1);
                stereoSplitter.connect(subLeftGain, 0);
                directRight.connect(stereoMerger, 0, 1);
                subLeftGain.connect(stereoMerger, 0, 1);

                // --- РЕВЕРБЕРАТОР ---
                convolverNode = ctx.createConvolver();
                dryGainNode = ctx.createGain(); dryGainNode.gain.value = 1;
                wetGainNode = ctx.createGain(); wetGainNode.gain.value = 0;
                reverbMergeNode = ctx.createGain();

                stereoMerger.connect(dryGainNode);
                stereoMerger.connect(convolverNode);
                convolverNode.connect(wetGainNode);
                dryGainNode.connect(reverbMergeNode);
                wetGainNode.connect(reverbMergeNode);

                // --- МАСТЕР УЗЛЫ ---
                compressorNode = ctx.createDynamicsCompressor();
                stereoPannerNode = ctx.createStereoPanner();
                limiterNode = ctx.createDynamicsCompressor();
                limiterNode.threshold.value = -1; limiterNode.knee.value = 0; limiterNode.ratio.value = 20;
                limiterNode.attack.value = 0.003; limiterNode.release.value = 0.25;

                // --- DOLBY ---
                dolbyInputNode = ctx.createGain();
                dolbyOutputNode = ctx.createGain();
                surroundSplitter = ctx.createChannelSplitter(2);
                surroundMerger = ctx.createChannelMerger(6);
                surroundCenterGain = ctx.createGain(); surroundCenterGain.gain.value = 0.2;

                // --- УЗЛЫ ЭФФЕКТОВ (LO-FI, DELAY, DEFINITION) ---
                distInputNode = ctx.createGain();
                distOutputNode = ctx.createGain();
                distDryGain = ctx.createGain();
                delayInputNode = ctx.createGain();
                delayOutputNode = ctx.createGain();
                defInputNode = ctx.createGain();
                defOutputNode = ctx.createGain();
                defDryGain = ctx.createGain();
                defHpFilter = ctx.createBiquadFilter();
                defPreGain = ctx.createGain();
                defExciter = ctx.createWaveShaper();
                defLpFilter = ctx.createBiquadFilter();
                defWetGain = ctx.createGain();

                defHpFilter.type = "highpass"; defHpFilter.frequency.value = 3e3;
                defPreGain.gain.value = 1;
                defExciter.curve = makeDefCurve(); defExciter.oversample = "4x";
                defLpFilter.type = "lowpass"; defLpFilter.frequency.value = 14e3;
                defDryGain.gain.value = 1; defWetGain.gain.value = 0;

                // --- WET PATH (Сигнал идет через все эффекты) ---
                reverbMergeNode.connect(distInputNode);
                distInputNode.connect(distDryGain);
                distDryGain.connect(distOutputNode);
                distOutputNode.connect(delayInputNode);
                delayInputNode.connect(delayOutputNode);
                delayOutputNode.connect(defInputNode);
                defInputNode.connect(defDryGain);
                defDryGain.connect(defOutputNode);
                defInputNode.connect(defHpFilter);
                defHpFilter.connect(defPreGain);
                defPreGain.connect(defExciter);
                defExciter.connect(defLpFilter);
                defLpFilter.connect(defWetGain);
                defWetGain.connect(defOutputNode);

                // --- ТОЧКА СМЕШИВАНИЯ EFFECTS MIX ---
                effectsWetNode = ctx.createGain();
                effectsDryNode = ctx.createGain();

                defOutputNode.connect(effectsWetNode);
                effectsWetNode.connect(compressorNode);

                // --- DRY PATH (Чистый сигнал в обход ВСЕХ эффектов) ---
                stereoMerger.connect(effectsDryNode);
                effectsDryNode.connect(compressorNode);

                // --- ВЫХОД ---
                compressorNode.connect(gainNode);
                gainNode.connect(stereoPannerNode);
                stereoPannerNode.connect(limiterNode);
                limiterNode.connect(ctx.destination);

                // --- ВНУТРЕННЯЯ МАРШРУТИЗАЦИЯ DOLBY ---
                dolbyInputNode.connect(surroundSplitter);
                surroundSplitter.connect(surroundMerger, 0, 0);
                surroundSplitter.connect(surroundMerger, 1, 1);
                surroundSplitter.connect(surroundCenterGain, 0);
                surroundCenterGain.connect(surroundMerger, 0, 2);
                surroundSplitter.connect(surroundMerger, 0, 3);
                surroundSplitter.connect(surroundMerger, 0, 4);
                surroundSplitter.connect(surroundMerger, 1, 5);
                surroundMerger.connect(dolbyOutputNode);

            } catch (e) {
                console.error("[WS] Graph failed, safe bypass:", e);
                gainNode = ctx.createGain();
                limiterNode = ctx.createDynamicsCompressor();
                limiterNode.threshold.value = -1; limiterNode.knee.value = 0; limiterNode.ratio.value = 20;
                limiterNode.attack.value = 0.003; limiterNode.release.value = 0.25;
                eqFilters[eqFilters.length - 1].connect(gainNode);
                gainNode.connect(limiterNode);
                limiterNode.connect(ctx.destination);
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

    function refreshCenterCancel() {
        if (!subLeftGain) return;
        const val = -(settings.centerCancel || 0) / 100;
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
        const db = settings.gainOutputDb || 0;
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

    function createModulationEffect(ctx, type, params) {
        var input = ctx.createGain();
        var output = ctx.createGain();
        var oscillators = [];

        if (type === "tremolo") {
            var depth = (params.depth || 50) / 100;
            var radius = params.rate || 5;
            var shape = params.shape || 0;
            var waveTypes = ["sine", "triangle", "square"];

            var tremoloGain = ctx.createGain();
            tremoloGain.gain.value = 1.0;

            var lfo = ctx.createOscillator();
            lfo.type = waveTypes[shape] || "sine";
            lfo.frequency.value = radius;

            var lfoDepth = ctx.createGain();
            lfoDepth.gain.value = depth / 2;

            lfo.connect(lfoDepth);
            lfoDepth.connect(tremoloGain.gain);
            input.connect(tremoloGain);
            tremoloGain.connect(output);

            try {
                lfo.start();
            } catch (e) {
                console.log("[WS] Context suspended, modulation activates on interaction");
            }
            oscillators.push(lfo);
        } else if (type === "chorus") {
            var chDepth = (params.depth || 50) / 100;
            var chRate = params.rate || 1.5;
            var chDelay = (params.delay || 20) / 1000;

            var chDelay1 = ctx.createDelay(0.1);
            var chDelay2 = ctx.createDelay(0.1);
            var chLfo1 = ctx.createOscillator();
            var chLfo2 = ctx.createOscillator();
            var chLfoGain1 = ctx.createGain();
            var chLfoGain2 = ctx.createGain();

            chDelay1.delayTime.value = chDelay;
            chDelay2.delayTime.value = chDelay * 1.2;

            chLfo1.type = "sine";
            chLfo1.frequency.value = chRate;
            chLfo2.type = "sine";
            chLfo2.frequency.value = chRate * 1.3;

            chLfoGain1.gain.value = 0.005 * chDepth;
            chLfoGain2.gain.value = 0.004 * chDepth;

            chLfo1.connect(chLfoGain1);
            chLfoGain1.connect(chDelay1.delayTime);
            chLfo2.connect(chLfoGain2);
            chLfoGain2.connect(chDelay2.delayTime);

            input.connect(chDelay1);
            input.connect(chDelay2);
            chDelay1.connect(output);
            chDelay2.connect(output);

            try { chLfo1.start(); } catch (e) { }
            try { chLfo2.start(); } catch (e) { }
            oscillators.push(chLfo1, chLfo2);

        } else if (type === "flanger") {
            var flDepth = (params.depth || 70) / 100;
            var flRate = params.rate || 0.5;
            var flFeedback = (params.feedback || 50) / 100;
            var flDelay = (params.delay || 2) / 1000;

            var flDelayNode = ctx.createDelay(0.05);
            var flLfo = ctx.createOscillator();
            var flLfoGain = ctx.createGain();
            var flFeedbackGain = ctx.createGain();

            flDelayNode.delayTime.value = flDelay;
            flLfo.type = "sine";
            flLfo.frequency.value = flRate;
            flLfoGain.gain.value = flDepth * 0.005; // макс модуляция ~5мс
            flFeedbackGain.gain.value = flFeedback;

            flLfo.connect(flLfoGain);
            flLfoGain.connect(flDelayNode.delayTime);

            input.connect(flDelayNode);
            flDelayNode.connect(flFeedbackGain);
            flFeedbackGain.connect(flDelayNode); // петля обратной связи
            flDelayNode.connect(output);

            try { flLfo.start(); } catch (e) { }
            oscillators.push(flLfo);

        } else if (type === "Vibrato") {
            var vbDepth = (params.depth || 50) / 100;
            var vbRate = params.rate || 5;

            var vbDelay = ctx.createDelay(0.05);
            var vbLfo = ctx.createOscillator();
            var vbLfoGain = ctx.createGain();

            vbDelay.delayTime.value = 0.01; // базовая задержка 10мс
            vbLfo.type = "sine";
            vbLfo.frequency.value = vbRate;
            vbLfoGain.gain.value = 0.005 * vbDepth; // модуляция до 5мс в каждую сторону

            vbLfo.connect(vbLfoGain);
            vbLfoGain.connect(vbDelay.delayTime);

            input.connect(vbDelay);
            vbDelay.connect(output);

            try { vbLfo.start(); } catch (e) { }
            oscillators.push(vbLfo);

        } else if (type === "autoPanner") {
            var apDepth = (params.depth || 80) / 100;
            var apRate = params.rate || 2;

            var apPanner = ctx.createStereoPanner();
            var apLfo = ctx.createOscillator();
            var apLfoGain = ctx.createGain();

            apPanner.pan.value = 0;
            apLfo.type = "sine";
            apLfo.frequency.value = apRate;
            apLfoGain.gain.value = apDepth; // от -1 до 1

            apLfo.connect(apLfoGain);
            apLfoGain.connect(apPanner.pan);

            input.connect(apPanner);
            apPanner.connect(output);

            try { apLfo.start(); } catch (e) { }
            oscillators.push(apLfo);

        } else if (type === "phaser") {
            var phRate = params.rate || 0.5;
            var phDepth = (params.depth || 60) / 100;
            var phFeedback = (params.feedback || 40) / 100;
            var phStages = params.stages || 4;

            var phFilters = [];
            for (var pi = 0; pi < phStages; pi++) {
                var phF = ctx.createBiquadFilter();
                phF.type = "allpass";
                // Распределяем базовые частоты фильтров по спектру
                phF.frequency.value = 500 + (1500 * pi / phStages);
                phF.Q.value = 5; // Высокий Q делает "свип" более выраженным
                phFilters.push(phF);
            }

            // Соединяем фильтры последовательно
            for (var pj = 0; pj < phFilters.length - 1; pj++) {
                phFilters[pj].connect(phFilters[pj + 1]);
            }

            var phLfo = ctx.createOscillator();
            var phLfoGain = ctx.createGain();
            var phFeedbackGain = ctx.createGain();

            phLfo.type = "sine";
            phLfo.frequency.value = phRate;
            // Глубина модуляции: какой размах частот будет у LFO
            phLfoGain.gain.value = phDepth * 2000;
            phFeedbackGain.gain.value = phFeedback;

            // Подключаем LFO ко всем фильтрам одновременно
            phLfo.connect(phLfoGain);
            phFilters.forEach(function (f) {
                phLfoGain.connect(f.frequency);
            });

            // Сигнальный путь: input -> цепочка фильтров -> output
            input.connect(phFilters[0]);
            phFilters[phFilters.length - 1].connect(output);

            // Петля обратной связи: последний фильтр -> feedback -> первый фильтр
            phFilters[phFilters.length - 1].connect(phFeedbackGain);
            phFeedbackGain.connect(phFilters[0]);

            try { phLfo.start(); } catch (e) { }
            oscillators.push(phLfo);

        } else if (type === "autoFilter") {
            var afRate = params.rate || 2;
            var afDepth = (params.depth || 50) / 100;
            var afBaseFreq = params.baseFreq || 1000;
            var afOctaves = params.octaves || 2;

            var afFilter = ctx.createBiquadFilter();
            var afLfo = ctx.createOscillator();
            var afLfoGain = ctx.createGain();

            afFilter.type = "lowpass";
            afFilter.frequency.value = afBaseFreq;
            afFilter.Q.value = 10; // Резонанс придаёт характерное "квакание"

            afLfo.type = "sine";
            afLfo.frequency.value = afRate;

            // LFO ходит от -X до +X. Считаем амплитуду, чтобы частота 
            // менялась от baseFreq до baseFreq * 2^octaves
            var afMaxFreq = afBaseFreq * Math.pow(2, afOctaves);
            afLfoGain.gain.value = (afMaxFreq - afBaseFreq) / 2;

            afLfo.connect(afLfoGain);
            afLfoGain.connect(afFilter.frequency);

            input.connect(afFilter);
            afFilter.connect(output);

            try { afLfo.start(); } catch (e) { }
            oscillators.push(afLfo);

        } else if (type === "rotarySpeaker") {
            var rsDepth = (params.depth || 70) / 100;
            var rsRate = params.rate || 1;

            var rsDelay = ctx.createDelay(0.05);
            rsDelay.delayTime.value = 0.01; // Базовая задержка для доплеровского эффекта

            var rsLfo = ctx.createOscillator();
            rsLfo.type = "sine";
            rsLfo.frequency.value = rsRate;

            // 1. Модуляция задержки (Допплер)
            var rsDelayLfoGain = ctx.createGain();
            rsDelayLfoGain.gain.value = 0.005 * rsDepth; // Макс модуляция ~5мс
            rsLfo.connect(rsDelayLfoGain);
            rsDelayLfoGain.connect(rsDelay.delayTime);

            // 2. Амплитудная модуляция (Тремоло-составляющая)
            var rsAmpGain = ctx.createGain();
            rsAmpGain.gain.value = 1 - 0.5 * rsDepth; // Центральная громкость
            var rsAmpLfoGain = ctx.createGain();
            rsAmpLfoGain.gain.value = 0.5 * rsDepth;
            rsLfo.connect(rsAmpLfoGain);
            rsAmpLfoGain.connect(rsAmpGain.gain);

            // 3. Пространственное вращение (Стерео-панорама)
            var rsPanner = ctx.createStereoPanner();
            var rsPanLfoGain = ctx.createGain();
            rsPanLfoGain.gain.value = rsDepth; // Полная ширина панорамы при depth=100
            rsLfo.connect(rsPanLfoGain);
            rsPanLfoGain.connect(rsPanner.pan);

            // Собираем сигнал
            input.connect(rsDelay);
            rsDelay.connect(rsAmpGain);
            rsAmpGain.connect(rsPanner);
            rsPanner.connect(output);

            try { rsLfo.start(); } catch (e) { }
            oscillators.push(rsLfo);

        } else if (type === "ringModulator") {
            var rmFreq = params.frequency || 440;
            var rmMix = (params.mix || 50) / 100;

            // Dry путь
            var rmDryGain = ctx.createGain();
            rmDryGain.gain.value = 1 - rmMix;

            // Wet путь (Сам Ring Modulator)
            var rmWetGain = ctx.createGain();
            rmWetGain.gain.value = rmMix;

            // Магия Ring Mod нативно: Gain с базовым значением 0.
            // Выход = Input * (0 + Carrier * 1) = Input * Carrier
            var rmModulatorGain = ctx.createGain();
            rmModulatorGain.gain.value = 0;

            var rmCarrier = ctx.createOscillator();
            rmCarrier.type = "sine";
            rmCarrier.frequency.value = rmFreq;
            rmCarrier.connect(rmModulatorGain.gain);

            // Роутинг
            input.connect(rmDryGain);
            input.connect(rmModulatorGain);
            rmModulatorGain.connect(rmWetGain);

            rmDryGain.connect(output);
            rmWetGain.connect(output);

            try { rmCarrier.start(); } catch (e) { }
            oscillators.push(rmCarrier);

        } else if (type === "vowelFilter") {
            var vfRate = params.rate || 2;
            var vfVowel = Math.round(params.vowel || 0);

            // Формантные частоты [F1, F2] для гласных А, Э, И, О, У
            var vfFormants = [
                [800, 1200],  // A
                [400, 2200],  // E
                [270, 2300],  // I
                [500, 1000],  // O
                [325, 800]    // U
            ];
            var vfCurrent = vfFormants[vfVowel] || vfFormants[0];

            // Два резонансных фильтра для формант
            var vfFilter1 = ctx.createBiquadFilter();
            vfFilter1.type = "peaking";
            vfFilter1.frequency.value = vfCurrent[0];
            vfFilter1.Q.value = 12;
            vfFilter1.gain.value = 15; // Усиление для явного выделения формант

            var vfFilter2 = ctx.createBiquadFilter();
            vfFilter2.type = "peaking";
            vfFilter2.frequency.value = vfCurrent[1];
            vfFilter2.Q.value = 12;
            vfFilter2.gain.value = 15;

            // Статический сигнал (если rate = 0)
            input.connect(vfFilter1);
            vfFilter1.connect(vfFilter2);
            vfFilter2.connect(output);

            // Если rate > 0, добавляем LFO для "пения"
            if (vfRate > 0) {
                var vfLfo = ctx.createOscillator();
                vfLfo.type = "sine";
                vfLfo.frequency.value = vfRate;

                // LFO добавляется к базовой частоте. 
                // Рассчитываем амплитуду, чтобы LFO (-1..1) покрывал весь диапазон формант:
                // F1: от 270 до 800. Середина ~535, амплитуда ~265.
                var vfLfoGain1 = ctx.createGain();
                vfLfoGain1.gain.value = 265;
                vfLfo.connect(vfLfoGain1);
                vfLfoGain1.connect(vfFilter1.frequency);

                // F2: от 800 до 2300. Середина ~1550, амплитуда ~750.
                var vfLfoGain2 = ctx.createGain();
                vfLfoGain2.gain.value = 750;
                vfLfo.connect(vfLfoGain2);
                vfLfoGain2.connect(vfFilter2.frequency);

                try { vfLfo.start(); } catch (e) { }
                oscillators.push(vfLfo);
            }

        } else {
            console.warn("[WS Modulation] Unknown effect type:", type);
            input.connect(output);
        }

        return { input: input, output: output, oscillators: oscillators };
    }

    function buildDelayGraph(ctx) {
        var input = ctx.createGain(), dryGain = ctx.createGain(), wetGain = ctx.createGain(), output = ctx.createGain();
        var splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2);
        var delayL = ctx.createDelay(2), delayR = ctx.createDelay(2), fbL = ctx.createGain(), fbR = ctx.createGain();
        input.connect(dryGain), input.connect(splitter);
        splitter.connect(delayL, 0), splitter.connect(delayR, 1);
        delayL.connect(fbR), delayR.connect(fbL), fbL.connect(delayL), fbR.connect(delayR);
        delayL.connect(merger, 0, 1), delayR.connect(merger, 0, 0); // Ping-Pong swap
        merger.connect(wetGain);
        dryGain.connect(output), wetGain.connect(output);
        dryGain.gain.value = 1, wetGain.gain.value = 0;
        return { input: input, output: output, delayL: delayL, delayR: delayR, fbL: fbL, fbR: fbR, dryGain: dryGain, wetGain: wetGain }
    }
    function updateDelayNodes(nodes, timeSec, feedback, mix) {
        if (!nodes) return;
        var t = Math.max(0.001, timeSec);
        var now = audioCtx.currentTime;
        nodes.delayL.delayTime.linearRampToValueAtTime(t, now + 0.05);
        nodes.delayR.delayTime.linearRampToValueAtTime(t, now + 0.05);
        nodes.fbL.gain.linearRampToValueAtTime(feedback, now + 0.05);
        nodes.fbR.gain.linearRampToValueAtTime(feedback, now + 0.05);
        nodes.dryGain.gain.linearRampToValueAtTime(1 - mix, now + 0.02);
        nodes.wetGain.gain.linearRampToValueAtTime(mix, now + 0.02);
    }


    function makeDefCurve() { const curve = new Float32Array(44100); for (let i = 0; i < 44100; i++) { const x = 2 * i / 44100 - 1; curve[i] = Math.tanh(x * 2) } return curve }

    function makeDistCurve(amount) {
        var k = amount * 100, samples = 44100, curve = new Float32Array(samples);
        for (var i = 0; i < samples; i++) { var x = i * 2 / samples - 1; if (amount < 0.3) curve[i] = Math.tanh(x * (1 + k)); else if (amount < 0.7) curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x)); else curve[i] = Math.max(-0.8, Math.min(0.8, (Math.PI + k) * x / (Math.PI + k * Math.abs(x)))) } return curve;
    }
    function makeBitcrusherCurve(bits) {
        var steps = Math.pow(2, bits), samples = 44100, curve = new Float32Array(samples);
        for (var i = 0; i < samples; i++) { var x = i * 2 / samples - 1; curve[i] = Math.round(x * steps) / steps } return curve;
    }
    function getDistHash(layers) { return layers && layers.length ? layers.map(l => l.type).join('-') : ''; }
    async function createDistEffect(ctx, type, params) {
        var input = ctx.createGain();
        var output = ctx.createGain();
        var processors = [];
        var workletNode = null;

        if ("distortion" === type) {
            var distShaper = ctx.createWaveShaper();
            distShaper.curve = makeDistCurve((params.amount || 50) / 100);
            distShaper.oversample = "4x";
            var tone = ctx.createBiquadFilter();
            tone.type = "lowpass"; tone.frequency.value = 2000 + ((params.tone || 50) / 100) * 8000; tone.Q.value = 1;
            input.connect(distShaper); distShaper.connect(tone); tone.connect(output);
            processors.push({ shaper: distShaper, tone: tone });

        } else if ("bitcrusher" === type || "cdskipper" === type || "vinyl" === type) {
            await loadEffectsWorklet();

            var nodeName = '';
            var nodeOptions = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] };

            if (type === "bitcrusher") {
                nodeName = 'bitcrusher-processor';
                nodeOptions.parameterData = { bits: params.bits || 8, normRange: params.normRange || 40 };
            } else if (type === "cdskipper") {
                nodeName = 'cd-skipper-processor';
                nodeOptions.parameterData = { loopMs: params.loopMs || 200, repeats: params.repeats || 4 };
            } else if (type === "vinyl") {
                nodeName = 'vinyl-processor';
                nodeOptions.parameterData = { noise: (params.noise || 0) / 100, crackle: (params.crackle || 0) / 100 };
            }

            try {
                workletNode = new AudioWorkletNode(ctx, nodeName, nodeOptions);
            } catch (e) {
                console.error("[WS] Failed to create worklet node:", nodeName, e);
                input.connect(output);
                return { input, output, processors, workletNode: null };
            }

            // Для винила добавляем фильтры для правильного тона шума
            if (type === "vinyl") {
                var hpFilter = ctx.createBiquadFilter(); hpFilter.type = "highpass"; hpFilter.frequency.value = 200; hpFilter.Q.value = 0.7;
                var lpFilter = ctx.createBiquadFilter(); lpFilter.type = "lowpass"; lpFilter.frequency.value = 8000; lpFilter.Q.value = 0.5;
                input.connect(workletNode); workletNode.connect(hpFilter); hpFilter.connect(lpFilter); lpFilter.connect(output);
                processors.push({ _isFilter: true, hp: hpFilter, lp: lpFilter });
            } else {
                input.connect(workletNode); workletNode.connect(output);
            }
            processors.push(workletNode);

        } else {
            input.connect(output);
        }

        return { input, output, processors, workletNode };
    }
    async function refreshDistGraph() {
        if (!audioCtx || !distInputNode || !distOutputNode) return;
        var layers = settings.distortionLayers;
        var mix = (settings.distMix || 0) / 100;

        if (!layers || !layers.length) {
            if (distNodes) {
                distNodes.forEach(function (n) { try { n.input.disconnect() } catch (e) { } try { n.output.disconnect() } catch (e) { } n.processors && n.processors.forEach(function (p) { try { p.disconnect() } catch (e) { } }) });
                distNodes = null;
                lastDistType = null;
            }
            if (distDryGain) distDryGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02);
        } else {
            var currentHash = layers.map(function (l) { return l.type }).join("-");
            if (currentHash !== lastDistType) {
                if (distNodes) {
                    distNodes.forEach(function (n) { try { n.input.disconnect() } catch (e) { } try { n.output.disconnect() } catch (e) { } n.processors && n.processors.forEach(function (p) { try { p.disconnect() } catch (e) { } }) });
                    distNodes = null;
                    lastDistType = null;
                }
                distNodes = [];
                for (var current = distInputNode, i = 0; i < layers.length; i++) {
                    var effect = await createDistEffect(audioCtx, layers[i].type, layers[i].params || {});
                    current.connect(effect.input), current = effect.output, distNodes.push(effect);
                }
                // Wet path connects to output alongside the dry path
                current.connect(distOutputNode);
                lastDistType = currentHash;
            } else {
                distNodes.forEach(function (node, i) {
                    var l = layers[i];
                    if (l && node.workletNode && node.workletNode.parameters) {
                        var p = node.workletNode.parameters;
                        "bitcrusher" === l.type ? (p.has("bits") && (p.get("bits").value = l.params.bits || 8), p.has("normRange") && (p.get("normRange").value = l.params.normRange || 40)) : "cdskipper" === l.type ? (p.has("loopMs") && (p.get("loopMs").value = l.params.loopMs || 200), p.has("repeats") && (p.get("repeats").value = l.params.repeats || 4)) : "vinyl" === l.type && (p.has("noise") && (p.get("noise").value = (l.params.noise || 0) / 100), p.has("crackle") && (p.get("crackle").value = (l.params.crackle || 0) / 100))
                    } else if (l && node.processors) {
                        node.processors.forEach(function (p) { "distortion" === l.type && (p.shaper && (p.shaper.curve = makeDistCurve((l.params.amount || 50) / 100)), p.tone && (p.tone.frequency.value = 2e3 + (l.params.tone || 50) / 100 * 8e3)) })
                    }
                });
            }
            // Proper Dry/Wet mix
            if (distDryGain) distDryGain.gain.linearRampToValueAtTime(1 - mix, audioCtx.currentTime + 0.02);
            if (distNodes && distNodes.length > 0) distNodes[distNodes.length - 1].output.gain.linearRampToValueAtTime(mix, audioCtx.currentTime + 0.02);
        }
    }

    function refreshEffectsMix() {
        var m = (settings.effectsMix || 0) / 100;
        effectsWetNode && effectsWetNode.gain.linearRampToValueAtTime(m, audioCtx.currentTime + .02), effectsDryNode && effectsDryNode.gain.linearRampToValueAtTime(1 - m, audioCtx.currentTime + .02)
    }

    function refreshDefinitionGraph() {
        if (audioCtx && defInputNode && defOutputNode) {
            var m = (settings.definitionMix || 0) / 100,
                d = 1 + Math.pow(m, 1.5) * 3,
                w = .55 * Math.pow(m, .8);
            defPreGain && defPreGain.gain.linearRampToValueAtTime(d, audioCtx.currentTime + .02), defWetGain && defWetGain.gain.linearRampToValueAtTime(w, audioCtx.currentTime + .02)
        }
    }
    function refreshDelayGraph() {
        if (audioCtx && delayInputNode && delayOutputNode) {
            var t = (settings.delayTime || 250) / 1e3,
                f = (settings.delayFeedback || 40) / 100,
                m = (settings.delayMix || 0) / 100;
            if (m <= 0) {
                if (delayNodes) updateDelayNodes(delayNodes, .001, 0, 0);
                else {
                    try {
                        delayInputNode.disconnect(delayOutputNode)
                    } catch (e) { }
                    delayInputNode.connect(delayOutputNode)
                }
            } else {
                if (!delayNodes || delayInputNode.context !== audioCtx) {
                    delayNodes = buildDelayGraph(audioCtx);
                    try {
                        delayInputNode.disconnect(delayOutputNode)
                    } catch (e) { }
                    delayInputNode.connect(delayNodes.input), delayNodes.output.connect(delayOutputNode)
                }
                updateDelayNodes(delayNodes, t, f, m)
            }
        }
    }

    function refreshModulationGraph() {
        if (!audioCtx) return;

        // В режиме overlay модуляция обрабатывается внутри каждой цепи (в refreshOverlayNodes)
        if (overlayMode) {
            var srcOv = globalStereoPannerNode;
            var dstOv = globalLimiterNode;
            if (!srcOv || !dstOv) return;

            // Очищаем глобальные модуляционные ноды, если они остались
            for (var ci = 0; ci < modulationLayersNodes.length; ci++) {
                var cn = modulationLayersNodes[ci];
                try { cn.input.disconnect(); } catch (e) { }
                try { cn.output.disconnect(); } catch (e) { }
                for (var cj = 0; cj < cn.oscillators.length; cj++) { try { cn.oscillators[cj].stop(); } catch (e) { } }
            }
            modulationLayersNodes = [];
            try { modulationInputNode.disconnect(); } catch (e) { }
            try { modulationOutputNode.disconnect(); } catch (e) { }

            // Просто пропускаем сигнал мимо глобальной модуляции
            try { srcOv.disconnect(dstOv); } catch (e) { }
            try { srcOv.disconnect(modulationInputNode); } catch (e) { }
            srcOv.connect(dstOv);
            return;
        }

        var src = overlayMode ? globalStereoPannerNode : stereoPannerNode;
        var dst = overlayMode ? globalLimiterNode : limiterNode;
        if (!src || !dst) return;

        if (!modulationInputNode || modulationInputNode.context !== audioCtx) {
            modulationInputNode = audioCtx.createGain();
            modulationOutputNode = audioCtx.createGain();
        }

        // --- очистка старых эффектов ---
        for (var i = 0; i < modulationLayersNodes.length; i++) {
            var n = modulationLayersNodes[i];
            try { n.input.disconnect(); } catch (e) { }
            try { n.output.disconnect(); } catch (e) { }
            for (var j = 0; j < n.oscillators.length; j++) {
                try { n.oscillators[j].stop(); } catch (e) { }
            }
        }
        modulationLayersNodes = [];

        // --- отключаем I/O ноды от всего ---
        try { modulationInputNode.disconnect(); } catch (e) { }
        try { modulationOutputNode.disconnect(); } catch (e) { }

        // --- читаем слои ---
        var layers = settings.modulationLayers;

        if (!layers || !layers.length) {
            // НЕТ модуляции — прямое соединение, обязательно отключаем модуляционный вход
            try { src.disconnect(dst); } catch (e) { }
            try { src.disconnect(modulationInputNode); } catch (e) { }
            src.connect(dst);
            return;
        }

        // --- строим цепь ---
        var current = modulationInputNode;
        for (var k = 0; k < layers.length; k++) {
            var layer = layers[k];
            if (!layer || !layer.type) continue;
            var effect;
            try {
                effect = createModulationEffect(audioCtx, layer.type, layer.params || {});
            } catch (err) {
                console.error("[WS Modulation] createModulationEffect error:", layer.type, err);
                continue;
            }
            current.connect(effect.input);
            current = effect.output;
            modulationLayersNodes.push(effect);
        }

        // --- подключаем: src → цепь модуляции → dst ---
        try { src.disconnect(dst); } catch (e) { }
        try { src.disconnect(modulationInputNode); } catch (e) { }
        src.connect(modulationInputNode);
        current.connect(modulationOutputNode);
        modulationOutputNode.connect(dst);

        console.log("[WS Modulation] Chain active:", layers.map(function (l) { return l.type; }).join(" → "));
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
        refreshEffectsMix();
        refreshPitchNode();
        refreshEqualizer();
        refreshGainNode();
        refreshReverb();
        refreshCenterCancel();
        refreshChannelBalance();
        refreshCompressor();
        refreshDolby(),
            refreshModulationGraph(),
            refreshDistGraph(),
            refreshDelayGraph();
        refreshDefinitionGraph();
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
                // 0. КРИТИЧЕСКИЙ ФИКС ДЛЯ YOUTUBE SHORTS:
                // Если элемент только что создан (нет src, нет текущего источника и нет данных), 
                // НЕ влезаем в него. Даем сайту (YT) время прикрепить MediaSource/DASH поток.
                // Наш перехват функции play() безопасно подключит граф, когда видео реально запустится.
                if (mediaEl.readyState === 0 && !mediaEl.src && !mediaEl.currentSrc && !mediaEl.querySelector("source")) {
                    return;
                }

                // 1. Проверка и применение CORS
                if (!(() => {
                    let src = mediaEl.currentSrc || mediaEl.src;
                    if (!src) {
                        const sourceEl = mediaEl.querySelector("source");
                        if (sourceEl) src = sourceEl.src;
                    }
                    if (!src) return true;

                    // КРИТИЧЕСКИЙ ФИКС ДЛЯ YOUTUBE SHORTS И REDDIT:
                    // Никогда не трогаем blob:, data: ссылки и элементы, которые уже начали буферизацию (readyState > 0).
                    // Иначе мы уничтожим MediaSource поток и видео зависнет намертво.
                    if (src.startsWith('blob:') || src.startsWith('data:') || mediaEl.readyState > 0) return true;

                    if (new URL(src, location.href).origin === location.origin) return true;
                    if ("anonymous" === mediaEl.crossOrigin) return true;

                    mediaEl.crossOrigin = "anonymous";
                    mediaEl.__ws_justCorsReloaded = true;

                    const t = mediaEl.currentTime;
                    const wasPlaying = !mediaEl.paused;
                    mediaEl.src = src;

                    mediaEl.addEventListener("loadedmetadata", async () => {
                        try { mediaEl.currentTime = t; } catch (e) { }
                        if (wasPlaying) {
                            try { await mediaEl.play(); } catch (e) { }
                        }
                    }, { once: true });

                    return false;
                })()) {
                    return void connectingMediaElements.delete(mediaEl);
                }

                // 2. Получение или создание AudioContext
                const ctx = (audioCtx && "closed" !== audioCtx.state)
                    ? audioCtx
                    : new (window.AudioContext || window.webkitAudioContext)();

                bindResumeHandlers(ctx);
                await ensurePitchGraph(ctx);

                // 3. Навешиваем слушатели скорости (один раз)
                if (!mediaEl.__speedListenersAdded) {
                    mediaEl.addEventListener("ratechange", handleRateChange);
                    mediaEl.__speedListenersAdded = true;

                    // ФИКС YOUTUBE SHORTS: Не уничтожаем __pitchSource при смене видео!
                    mediaEl.addEventListener("emptied", () => {
                        mediaEl.__pitchConnected = false;
                        // НЕ ДЕЛАЕМ: mediaEl.__pitchSource = null; 
                        // Источник звука привязан к тегу намертво браузером. 
                        // Если мы обнулим его, при следующем play будет InvalidStateError.
                        // Просто пытаемся переподключить его к графу.
                        if (mediaEl.__pitchSource) {
                            try { mediaEl.__pitchSource.connect(sourceGain); } catch (e) { }
                            mediaEl.__pitchConnected = true;
                            if (overlayMode) refreshOverlayNodes(); else refreshAllNodes();
                        }
                    });
                }

                // 4. Применяем настройки скорости
                applySpeedSettings(mediaEl);

                // 5. Создание источника звука
                if (!mediaEl.__pitchSource) {
                    let source = null;

                    // ЖЕЛЕЗОБЕТОННАЯ ЗАЩИТА ОТ INVALID STATE ERROR
                    try {
                        source = audioCtx.createMediaElementSource(mediaEl);
                    } catch (e) {
                        if (e.name === "InvalidStateError") {
                            console.warn("[WS] Элемент уже захвачен этим AudioContext. Пропускаем пере-захват.");
                            mediaEl.__pitchConnected = true;
                            return; // Просто выходим, чтобы не крашить страницу
                        }
                        throw e;
                    }

                    mediaEl.__pitchSource = source;

                    // Очистка мертвых элементов (Reddit/HLS), но БЕЗ обнуления __pitchSource
                    connectedMediaElements.forEach(oldEl => {
                        if (oldEl !== mediaEl && oldEl.__pitchSource) {
                            const isInDom = document.body.contains(oldEl) ||
                                (oldEl.getRootNode && oldEl.getRootNode().host && oldEl.getRootNode().contains(oldEl));
                            const isActuallyPlaying = !oldEl.paused && oldEl.readyState >= 2;

                            if (!isInDom || !isActuallyPlaying) {
                                try { oldEl.__pitchSource.disconnect(); } catch (e) { }
                                // НЕ ДЕЛАЕМ: oldEl.__pitchSource = null; 
                                // Иначе YouTube Shorts упадет с ошибкой при возврате к этому видео
                                oldEl.__pitchConnected = false;
                            }
                        }
                    });

                    source.connect(sourceGain);

                    // 6. Фикс для перезагруженных CORS элементов
                    if (mediaEl.__ws_justCorsReloaded) {
                        const wasMuted = mediaEl.muted;
                        mediaEl.muted = true;
                        if (!wasMuted) mediaEl.muted = false;
                        delete mediaEl.__ws_justCorsReloaded;
                    }

                    if (!mediaEl.__unmuteHandlerBound) {
                        mediaEl.__unmuteHandlerBound = true;
                        mediaEl.addEventListener("unmute", () => {
                            if (audioCtx && "suspended" === audioCtx.state) audioCtx.resume();
                        });
                    }
                }

                // 7. Финализация
                connectedMediaElements.add(mediaEl);
                mediaEl.__pitchConnected = !0;
                // Apply bypass if site is blacklisted (handles case when graph is built for the first time while blacklisted)
                if (siteIsBlacklisted && sourceGain && audioCtx) {
                    if (overlayMode) {
                        try { globalLimiterNode?.disconnect() } catch (e) { }
                    } else {
                        try { limiterNode?.disconnect() } catch (e) { }
                    }
                    try { sourceGain?.connect(audioCtx.destination) } catch (e) { }
                } else if (overlayMode && !overlayGraphBuilt) {
                    await rebuildGraph();
                } else if (!overlayMode) {
                    refreshAllNodes();
                }

            } catch (e) {
                console.error("[WS] connectMediaElement error:", e);
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
                // --- САЙТ В БЛЭКЛИСТЕ: Полный сброс ---
                // Bypass: disconnect processing chain from destination, connect sourceGain directly to destination
                if (overlayMode) {
                    try { globalLimiterNode?.disconnect() } catch (e) { }
                    try { sourceGain?.connect(audioCtx.destination) } catch (e) { }
                } else {
                    try { limiterNode?.disconnect() } catch (e) { }
                    try { sourceGain?.connect(audioCtx.destination) } catch (e) { }
                }
                // Reset media element playback rates
                connectedMediaElements.forEach(el => {
                    try {
                        el.playbackRate = 1;
                        el.defaultPlaybackRate = 1;
                        "preservesPitch" in el && (el.preservesPitch = !0);
                        "webkitPreservesPitch" in el && (el.webkitPreservesPitch = !0);
                        el.__lastRateSetByUs = Date.now();
                    } catch (e) { }
                });
                // Bypass Howler

                if (usingHowler) {
                    routeHowler(!0);
                    const howler = window.Howler;
                    if (howler) {
                        const howls = Array.isArray(howler._howls) ? howler._howls : [];
                        for (const howl of howls) {
                            try { "function" == typeof howl.rate && howl.rate(1), howl._rate = 1 } catch (e) { }
                        }
                        const sounds = Array.isArray(howler._sounds) ? howler._sounds : [];
                        for (const sound of sounds) {
                            sound._rate = 1;
                            const node = sound?._node;
                            node?.playbackRate && (node.playbackRate.value = 1);
                            node?.bufferSource?.playbackRate && (node.bufferSource.playbackRate.value = 1);
                        }
                    }
                }
            } else {
                // Remove bypass: disconnect sourceGain from destination (chain will be reconnected below)
                try { sourceGain?.disconnect(audioCtx.destination) } catch (e) { }
            }
        }

        // --- ОСНОВНАЯ ЛОГИКА (Выполняется ВСЕГДА, если сайт не в блэклисте) ---
        if (!siteIsBlacklisted) {
            // Reconnect processing chain to destination (reversing bypass)
            if (overlayMode) {
                try { globalLimiterNode?.connect(audioCtx.destination) } catch (e) { }
            } else if (limiterNode) {
                try { limiterNode?.connect(audioCtx.destination) } catch (e) { }
            }
            usingHowler ? syncHowlerSpeed() : connectedMediaElements.forEach(el => applySpeedSettings(el));
            const mediaElements = Array.from(document.querySelectorAll("audio, video"));
            for (const el of mediaElements) el.__pitchSource || await connectMediaElement(el);
            usingHowler && await attachHowler();

            const newOverlayMode = !!(e.data.settings?.overlayEnabled && e.data.overlayPresets && Array.isArray(e.data.overlayPresets) && e.data.overlayPresets.length >= 1);

            // СРАВНИВАЕМ ТОЛЬКО ID ПРЕСЕТОВ, А НЕ ИХ НАСТРОЙКИ!
            const getIds = (presets) => (presets || []).map(p => p.id || p).join(',');
            const newIds = getIds(e.data.overlayPresets);
            const oldIds = getIds(overlayPresetsData);

            const needsRebuild = newOverlayMode !== overlayMode || (newOverlayMode && newIds !== oldIds);

            if (needsRebuild) {
                overlayMode = newOverlayMode;
                overlayPresetsData = e.data.overlayPresets;
                if (e.data.overlayConfig) overlayConfig = e.data.overlayConfig;

                if (overlayMode) {
                    try { limiterNode?.disconnect(); } catch (e) { }
                    try { dolbyOutputNode?.disconnect(); } catch (e) { }
                    await rebuildGraph();
                } else {
                    parallelChains.forEach(chain => {
                        try { chain.pitchNode?.port?.close?.(); } catch (e) { }
                        try { chain.pitchNode?.disconnect(); } catch (e) { }
                        chain.eqs.forEach(f => { try { f.disconnect(); } catch (e) { } });
                        try { chain.gain?.disconnect(); } catch (e) { }

                        if (chain.correlatorNodes?.oscillators) {
                            chain.correlatorNodes.oscillators.forEach(osc => { try { osc.stop(); } catch (e) { } });

                            if (chain.modNodes) {
                                chain.modNodes.forEach(n => {
                                    if (n.oscillators) n.oscillators.forEach(osc => {
                                        try {
                                            osc.stop()
                                        } catch (e) { }
                                    })
                                })
                            }
                        }
                    });
                    parallelChains = [];
                    try { globalMergeNode?.disconnect(); globalCompressorNode?.disconnect(); globalLimiterNode?.disconnect(); globalStereoPannerNode?.disconnect(); } catch (e) { }
                    pitchNode = null; eqFilters = []; isNodeReady = false;
                    try { gainNode?.disconnect(); limiterNode?.disconnect(); } catch (e) { }
                    gainNode = null; limiterNode = null;
                    overlayGraphBuilt = false; // Сбрасываем флаг, чтобы стандартный граф мог собраться
                    if (audioCtx) await ensurePitchGraph(audioCtx);
                    refreshAllNodes();
                }
            } else if (overlayMode) {
                // Структура пресетов та же, но поменялись значения (двигали ползунки).
                // Просто обновляем данные в цепочках и применяем легкое обновление.
                overlayPresetsData = e.data.overlayPresets;
                parallelChains.forEach((chain, index) => {
                    if (overlayPresetsData[index]) {
                        // Безопасно извлекаем значения (поддерживаем и старый, и новый формат)
                        chain.settings = overlayPresetsData[index].values || overlayPresetsData[index];
                    }
                });
                refreshOverlayNodes();
            } else {
                refreshAllNodes();
            }
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

    // Заменили 'play' на 'playing'. 
    // Событие 'play' срабатывает в ту же миллисекунду, когда вызывается .play(), даже если буфер еще пуст (это ломало YT Shorts).
    // Событие 'playing' срабатывает ТОЛЬКО когда браузер реально начал воспроизводить данные. Это на 100% безопасно.
    document.addEventListener("playing", async e => {
        const el = e?.target;
        if (el && ("AUDIO" === el.tagName || "VIDEO" === el.tagName)) try { await connectMediaElement(el) } catch (err) { }
    }, !0),

        (function hookMediaElementPlay() {
            if (window.__pitchMediaPlayHooked) return;
            window.__pitchMediaPlayHooked = true;
            const originalPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function (...args) {
                const mediaEl = this;
                try {
                    !mediaEl || "AUDIO" !== mediaEl.tagName && "VIDEO" !== mediaEl.tagName || queueMicrotask(async () => {
                        try {
                            if (mediaEl.__pitchSource && !mediaEl.__pitchConnected) {
                                try {
                                    // ПРИНУДИТЕЛЬНЫЙ РЕЗЮМ КОНТЕКСТА (Решает замолкаание на YouTube Shorts)
                                    if (audioCtx && audioCtx.state === 'suspended') {
                                        await audioCtx.resume();
                                    }

                                    // ПЕРЕПОДКЛЮЧАЕМ ЭЛЕМЕНТ, если он был отключен
                                    if (mediaEl.__pitchSource && !mediaEl.__pitchConnected) {
                                        try { mediaEl.__pitchSource.connect(sourceGain); } catch (e) { }
                                        mediaEl.__pitchConnected = true;
                                    }
                                } catch (e) {
                                    // Если источник сдох (YouTube уничтожил тег и создал новый), сбрасываем и пересоздаем
                                    mediaEl.__pitchSource = null;
                                    await connectMediaElement(mediaEl);
                                    return;
                                }
                            }

                            if (await connectMediaElement(mediaEl)) return;
                            if (siteIsBlacklisted) return;
                            applySpeedSettings(mediaEl);
                            if (overlayMode) { refreshOverlayNodes(); } else { refreshAllNodes(); }
                        } catch (e) { }
                    })
                } catch (e) { }
                return originalPlay.apply(mediaEl, args)
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