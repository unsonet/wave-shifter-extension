(() => {
    if (window.__pitchChangerPatched) return;
    function log(...args) { }
    window.__pitchChangerPatched = true;
    performance.now();

    const workletUrl = (() => {
        let url = window.__pitchShifterExtensionConfig?.workletUrl;
        if (!url) try { url = new URL("/__pitch_shifter_worklet.js", window.location.origin).href; } catch (error) { }
        return url;
    })();
    if (!workletUrl) return;

    const soundsBaseUrl = (() => {
        let url = window.__pitchShifterExtensionConfig?.soundsBaseUrl;
        if (!url) try {
            url = document.getElementById("__pitchShifterCfg")?.dataset?.soundsBaseUrl || "";
        } catch (error) {

        }
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

    let audioCtx = null, pitchNode = null, eqFilters = [], gainNode = null, limiterNode = null, isNodeReady = false;
    let howlerProbeTimer = null, usingHowler = false, howlerAttached = false, siteIsBlacklisted = false;
    const connectedMediaElements = new Set, connectingMediaElements = new WeakSet;


    let stereoSplitter = null, stereoMerger = null, subLeftGain = null, subRightGain = null, convolverNode = null, dryGainNode = null, wetGainNode = null, reverbMergeNode = null, stereoPannerNode = null, compressorNode = null, dolbyInputNode = null, dolbyOutputNode = null, surroundSplitter = null, surroundMerger = null, surroundCenterGain = null, defaultChannelCount = 2;
    const convolverCache = new Map;


    let lastConfiguredBlockMs = null;
    let lastConfiguredSmart = null;
    let pitchUpdateRafId = null;

    let settings = {
        volumeBoostDb: 0,
        pitchValueSemitones: 0,
        pitchValueCents: 0,
        windowSizeMilliseconds: 120,
        applySmartProcessing: !0,
        speedUnits: 0,
        speedFine: 0,
        preservePitch: !0,
        blacklistPatterns: [],
        eqGains: Array(10).fill(50),
        reverbType: null,
        reverbWet: 0,
        stereoWiden: 0,
        channelBalance: 0,
        compressorThreshold: -24,
        compressorKnee: 30,
        compressorRatio: 12,
        compressorAttack: 3,
        compressorRelease: 250,
        dolbyEnabled: !1
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

    async function ensurePitchGraph(ctx) {
        if (!ctx) throw new Error("No AudioContext");
        if (audioCtx && audioCtx !== ctx) {
            function destroyPitchGraph() {
                try { pitchNode?.disconnect(); } catch { }
                try { gainNode?.disconnect(); } catch { }
                try { limiterNode?.disconnect(); } catch { }
                try { pitchNode?.port?.close?.(); } catch { }
                eqFilters.forEach(f => { try { f.disconnect(); } catch { } });
                pitchNode = null; eqFilters = []; gainNode = null; limiterNode = null; isNodeReady = false;
                lastConfiguredBlockMs = null; lastConfiguredSmart = null;
            }
            destroyPitchGraph();
        }
        audioCtx = ctx;
        if (!pitchNode) await async function setupWorklet(ctx) {
            await ctx.audioWorklet.addModule(workletUrl);
            pitchNode = new AudioWorkletNode(ctx, "signalsmith-stretch", {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
            });

            pitchNode.port.onmessage = e => {
                const data = e?.data;
                if (data && data[0] === "ready") {
                    isNodeReady = true;
                    refreshPitchNode(true);
                }
            };

            eqFilters = EQ_BANDS.map(band => {
                const filter = ctx.createBiquadFilter();
                filter.type = band.type;
                filter.frequency.value = band.frequency;
                if (band.q) filter.Q.value = band.q;
                return filter;
            });

            for (let i = 0; i < eqFilters.length - 1; i++) eqFilters[i].connect(eqFilters[i + 1]);

            gainNode = ctx.createGain();
            limiterNode = ctx.createDynamicsCompressor();
            limiterNode.threshold.value = -1;
            limiterNode.knee.value = 0;
            limiterNode.ratio.value = 20;
            limiterNode.attack.value = 0.003;
            limiterNode.release.value = 0.25;

            pitchNode.connect(eqFilters[0]);

            try {
                stereoSplitter = ctx.createChannelSplitter(2); stereoMerger = ctx.createChannelMerger(2); subLeftGain = ctx.createGain(); subLeftGain.gain.value = 0; subRightGain = ctx.createGain(); subRightGain.gain.value = 0;
                let directLeft = ctx.createGain(); directLeft.gain.value = 1; let directRight = ctx.createGain(); directRight.gain.value = 1;
                eqFilters[eqFilters.length - 1].connect(stereoSplitter); stereoSplitter.connect(directLeft, 0); stereoSplitter.connect(subRightGain, 1); directLeft.connect(stereoMerger, 0, 0); subRightGain.connect(stereoMerger, 0, 0); stereoSplitter.connect(directRight, 1); stereoSplitter.connect(subLeftGain, 0); directRight.connect(stereoMerger, 0, 1); subLeftGain.connect(stereoMerger, 0, 1);
                convolverNode = ctx.createConvolver(); dryGainNode = ctx.createGain(); dryGainNode.gain.value = 1; wetGainNode = ctx.createGain(); wetGainNode.gain.value = 0; reverbMergeNode = ctx.createGain(); stereoMerger.connect(dryGainNode); stereoMerger.connect(convolverNode); convolverNode.connect(wetGainNode); dryGainNode.connect(reverbMergeNode); wetGainNode.connect(reverbMergeNode);
                compressorNode = ctx.createDynamicsCompressor();
                gainNode = ctx.createGain(); stereoPannerNode = ctx.createStereoPanner();
                limiterNode = ctx.createDynamicsCompressor(); limiterNode.threshold.value = -1; limiterNode.knee.value = 0; limiterNode.ratio.value = 20; limiterNode.attack.value = .003; limiterNode.release.value = .25;
                dolbyInputNode = ctx.createGain(); dolbyOutputNode = ctx.createGain(); surroundSplitter = ctx.createChannelSplitter(2); surroundMerger = ctx.createChannelMerger(6); surroundCenterGain = ctx.createGain(); surroundCenterGain.gain.value = 0.2;
                reverbMergeNode.connect(compressorNode); compressorNode.connect(gainNode); gainNode.connect(stereoPannerNode);
                stereoPannerNode.connect(limiterNode); limiterNode.connect(ctx.destination);
                dolbyInputNode.connect(surroundSplitter); surroundSplitter.connect(surroundMerger, 0, 0); surroundSplitter.connect(surroundMerger, 1, 1); surroundSplitter.connect(surroundCenterGain, 0); surroundCenterGain.connect(surroundMerger, 0, 2); surroundSplitter.connect(surroundMerger, 0, 3); surroundSplitter.connect(surroundMerger, 0, 4); surroundSplitter.connect(surroundMerger, 1, 5); surroundMerger.connect(dolbyOutputNode);
            } catch (e) {
                console.error("[WS] Graph failed, safe bypass:", e);
                gainNode = ctx.createGain();
                limiterNode = ctx.createDynamicsCompressor();
                limiterNode.threshold.value = -1;
                limiterNode.knee.value = 0;
                limiterNode.ratio.value = 20;
                limiterNode.attack.value = .003;
                limiterNode.release.value = .25;
                eqFilters[eqFilters.length - 1].connect(gainNode); gainNode.connect(limiterNode); limiterNode.connect(ctx.destination)
            }
        }(audioCtx)
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
                try { howler.masterGain.disconnect(pitchNode); } catch (e) { }
            } else if (pitchNode) {
                connectNodeSafe(howler.masterGain, pitchNode);
                // ВАЖНО: Отключаем от прямого выхода, иначе будет двойной звук!
                try { howler.masterGain.disconnect(audioCtx.destination); } catch (e) { }
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

        const configChanged = forceConfig ||
            lastConfiguredBlockMs !== settings.windowSizeMilliseconds ||
            lastConfiguredSmart !== settings.applySmartProcessing;

        if (configChanged) {
            lastConfiguredBlockMs = settings.windowSizeMilliseconds;
            lastConfiguredSmart = settings.applySmartProcessing;

            pitchNode.port.postMessage([null, "configure", {
                blockMs: lastConfiguredBlockMs,
                splitComputation: !lastConfiguredSmart
            }]);
        }

        if (!pitchUpdateRafId) {
            pitchUpdateRafId = requestAnimationFrame(() => {
                pitchUpdateRafId = null;
                sendPitchUpdate();
            });
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
        const rate = calcPlaybackRate();
        if (mediaEl.playbackRate === rate && mediaEl.defaultPlaybackRate === rate) {
            const preservePitch = !!settings.preservePitch;
            if (mediaEl.preservesPitch !== preservePitch) {
                mediaEl.preservesPitch = preservePitch;
                if ("webkitPreservesPitch" in mediaEl) mediaEl.webkitPreservesPitch = preservePitch;
            }
            return;
        }
        mediaEl.playbackRate = rate;
        mediaEl.defaultPlaybackRate = rate;
        const preservePitch = !!settings.preservePitch;
        if ("preservesPitch" in mediaEl) mediaEl.preservesPitch = preservePitch;
        if ("webkitPreservesPitch" in mediaEl) mediaEl.webkitPreservesPitch = preservePitch;
        mediaEl.__lastRateSetByUs = Date.now();
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
        if (mediaEl && mediaEl.nodeType === Node.ELEMENT_NODE && !siteIsBlacklisted && !connectingMediaElements.has(mediaEl)) {
            connectingMediaElements.add(mediaEl);
            try {
                const ctx = audioCtx && audioCtx.state !== "closed" ? audioCtx : new (window.AudioContext || window.webkitAudioContext)();
                bindResumeHandlers(ctx);
                await ensurePitchGraph(ctx);

                if (!mediaEl.__speedListenersAdded) {
                    mediaEl.addEventListener("ratechange", handleRateChange);
                    mediaEl.__speedListenersAdded = true;
                    mediaEl.addEventListener("emptied", () => {
                        mediaEl.__pitchConnected = false; mediaEl.__pitchSource = null;
                        connectMediaElement(mediaEl);
                    });
                }

                applySpeedSettings(mediaEl);
                if (!mediaEl.__pitchSource) {
                    const source = audioCtx.createMediaElementSource(mediaEl);
                    mediaEl.__pitchSource = source;
                    source.connect(pitchNode);
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
                    pitchNode.port.postMessage([null, "start", { active: true, semitones: 0, tonalityHz: 8800 }]);
                }
                if (gainNode) gainNode.gain.value = 1;
                eqFilters.forEach(f => { f.gain.value = 0; });

                if (wetGainNode) wetGainNode.gain.value = 0;
                if (subLeftGain) subLeftGain.gain.value = 0;
                if (subRightGain) subRightGain.gain.value = 0;
                if (stereoPannerNode) stereoPannerNode.pan.value = 0;
                if (compressorNode) {
                    compressorNode.threshold.value=0,
                    compressorNode.knee.value=30,
                    compressorNode.ratio.value=1,
                    compressorNode.attack.value=.003,
                    compressorNode.release.value=.25
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
                refreshAllNodes();

                connectedMediaElements.forEach(el => applySpeedSettings(el));
                if (usingHowler) syncHowlerSpeed();

                const mediaElements = Array.from(document.querySelectorAll("audio, video"));
                for (const el of mediaElements) {
                    if (!el.__pitchSource) {
                        if (!el.paused) {
                            try {
                                const rate = calcPlaybackRate();
                                el.playbackRate = rate;
                                el.defaultPlaybackRate = rate;
                                el.preservesPitch = !!settings.preservePitch;
                                if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = !!settings.preservePitch;
                                el.__lastRateSetByUs = Date.now();
                            } catch (e) { }
                        } else {
                            await connectMediaElement(el);
                        }
                    }
                }

                if (window.Howler) await attachHowler();
            }
        } else if (!siteIsBlacklisted) {
            if (usingHowler) syncHowlerSpeed();
            else connectedMediaElements.forEach(el => applySpeedSettings(el));

            refreshAllNodes();
        }
    });

    const observer = new MutationObserver(mutations => {
        if (!siteIsBlacklisted) {
            for (const mut of mutations) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches?.("audio, video")) connectMediaElement(node);
                        node.querySelectorAll?.("audio, video").forEach(connectMediaElement);
                    }
                }
            }
        }
    });

    function startObserver() {
        document.body && (observer.observe(document.body, { childList: true, subtree: true }), function connectAllMedia() {
            if (!siteIsBlacklisted) document.querySelectorAll("audio, video").forEach(connectMediaElement);
        }());
    }

    document.body ? startObserver() : document.addEventListener("DOMContentLoaded", startObserver);

    document.addEventListener("play", async e => {
        const el = e?.target;
        if (el && (el.tagName === "AUDIO" || el.tagName === "VIDEO") && !siteIsBlacklisted) {
            try { await connectMediaElement(el); } catch (err) { }
        }
    }, true);

    (function hookMediaElementPlay() {
        if (window.__pitchMediaPlayHooked) return;
        window.__pitchMediaPlayHooked = true;
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (...args) {
            const mediaEl = this;
            if (siteIsBlacklisted) return originalPlay.apply(mediaEl, args);
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