(() => {
    if (window.__pitchChangerPatched) return;
    function log(...args) {}
    
    window.__pitchChangerPatched = true;
    performance.now();

    const workletUrl = (() => {
        let url = window.__pitchShifterExtensionConfig?.workletUrl;
        if (!url) {
            try {
                url = new URL("/__pitch_shifter_worklet.js", window.location.origin).href;
            } catch (error) {}
        }
        return url;
    })();

    if (!workletUrl) return;

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
    let howlerProbeTimer = null;
    let usingHowler = false;
    let howlerAttached = false;
    let siteIsBlacklisted = false;

    const connectedMediaElements = new Set();
    const connectingMediaElements = new WeakSet();

    let settings = {
        volumeBoostDb: 0,
        pitchValueSemitones: 0,
        pitchValueCents: 0,
        windowSizeMilliseconds: 120,
        applySmartProcessing: true,
        speedUnits: 0,
        speedFine: 0,
        preservePitch: true,
        blacklistPatterns: [],
        eqGains: Array(10).fill(50)
    };

    function calcPlaybackRate() {
        const u = Number(settings.speedUnits) || 0;
        return ((u < 0 ? 100 + u : 100 + 5 * u) + (Number(settings.speedFine) || 0)) / 100;
    }

    function connectNodeSafe(node, target) {
        if (node && target) {
            try {
                node.connect(target);
            } catch (e) {}
        }
    }

    function bindResumeHandlers(ctx) {
        if (ctx.__pitchResumeBound) return;
        ctx.__pitchResumeBound = true;
        const unlock = async () => {
            try {
                if (ctx.state === "suspended") await ctx.resume();
            } catch (e) {}
        };
        window.addEventListener("click", unlock, { capture: true });
        window.addEventListener("keydown", unlock, { capture: true });
        window.addEventListener("touchstart", unlock, { capture: true });
    }

    async function ensurePitchGraph(ctx) {
        if (!ctx) throw new Error("No AudioContext");
        
        if (audioCtx && audioCtx !== ctx) {
            function destroyPitchGraph() {
                try { pitchNode?.disconnect(); } catch {}
                try { gainNode?.disconnect(); } catch {}
                try { limiterNode?.disconnect(); } catch {}
                try { pitchNode?.port?.close?.(); } catch {}
                eqFilters.forEach(f => { try { f.disconnect(); } catch {} });
                pitchNode = null;
                eqFilters = [];
                gainNode = null;
                limiterNode = null;
                isNodeReady = false;
            }
            destroyPitchGraph();
        }
        
        audioCtx = ctx;
        if (!pitchNode) {
            await async function setupWorklet(ctx) {
                await ctx.audioWorklet.addModule(workletUrl);
                pitchNode = new AudioWorkletNode(ctx, "signalsmith-stretch", {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2]
                });

                pitchNode.port.onmessage = e => {
                    const data = e?.data;
                    if (data && data[0] === "ready") {
                        isNodeReady = true;
                        refreshPitchNode();
                    }
                };

                eqFilters = EQ_BANDS.map(band => {
                    const filter = ctx.createBiquadFilter();
                    filter.type = band.type;
                    filter.frequency.value = band.frequency;
                    if (band.q) filter.Q.value = band.q;
                    return filter;
                });

                for (let i = 0; i < eqFilters.length - 1; i++) {
                    eqFilters[i].connect(eqFilters[i + 1]);
                }

                gainNode = ctx.createGain();
                limiterNode = ctx.createDynamicsCompressor();
                limiterNode.threshold.value = -1;
                limiterNode.knee.value = 0;
                limiterNode.ratio.value = 20;
                limiterNode.attack.value = 0.003;
                limiterNode.release.value = 0.25;

                pitchNode.connect(eqFilters[0]);
                eqFilters[eqFilters.length - 1].connect(gainNode);
                gainNode.connect(limiterNode);
                limiterNode.connect(ctx.destination);
            }(audioCtx);
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

    async function attachHowler() {
        if (siteIsBlacklisted) return false;
        const howler = window.Howler;
        if (!howler?.ctx || !howler?.masterGain) return false;

        usingHowler = true;
        bindResumeHandlers(howler.ctx);
        await ensurePitchGraph(howler.ctx);
        
        if (!howlerAttached) howlerAttached = true;
        
        routeHowler(false);
        syncHowlerSpeed();
        refreshPitchNode();
        return true;
    }

    function refreshGainNode() {
        if (!gainNode) return;
        const db = settings.volumeBoostDb || 0;
        gainNode.gain.value = Math.pow(10, db / 20);
    }

    function refreshPitchNode() {
        if (!pitchNode || !isNodeReady) return;
        const finalSemitones = settings.pitchValueSemitones + settings.pitchValueCents / 100 + function getPitchCompensation() {
            const rate = calcPlaybackRate();
            return !usingHowler || !settings.preservePitch || rate <= 0 ? 0 : -12 * Math.log2(rate);
        }();
        
        pitchNode.port.postMessage([null, "configure", { blockMs: settings.windowSizeMilliseconds, splitComputation: !settings.applySmartProcessing }]);
        pitchNode.port.postMessage([null, "start", { active: true, semitones: finalSemitones, tonalityHz: 8800 }]);
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

    function routeMediaElement(mediaEl, bypass) {
        const source = mediaEl.__pitchSource;
        if (source && audioCtx) {
            if (bypass) {
                connectNodeSafe(source, audioCtx.destination);
                try { source.disconnect(pitchNode); } catch (e) {}
            } else {
                if (pitchNode) {
                    connectNodeSafe(source, pitchNode);
                    try { source.disconnect(audioCtx.destination); } catch (e) {}
                }
            }
        }
    }

    function routeHowler(bypass) {
        const howler = window.Howler;
        if (howler?.masterGain && audioCtx) {
            if (bypass) {
                connectNodeSafe(howler.masterGain, audioCtx.destination);
                try { howler.masterGain.disconnect(pitchNode); } catch (e) {}
            } else {
                if (pitchNode) {
                    connectNodeSafe(howler.masterGain, pitchNode);
                    try { howler.masterGain.disconnect(audioCtx.destination); } catch (e) {}
                }
            }
        }
    }

    function syncHowlerSpeed() {
        const howler = window.Howler;
        if (!howler) return;
        
        const rate = calcPlaybackRate();
        const preservePitch = !!settings.preservePitch;
        const howls = Array.isArray(howler._howls) ? howler._howls : [];
        
        for (const howl of howls) {
            try {
                if (typeof howl.rate === "function") howl.rate(rate);
                howl._rate = rate;
            } catch (e) { log() }
            
            const sounds = Array.isArray(howl._sounds) ? howl._sounds : [];
            for (const sound of sounds) {
                try {
                    const node = sound?._node;
                    if (!node) continue;
                    if ("playbackRate" in node) try { node.playbackRate = rate; } catch {}
                    if (node.bufferSource?.playbackRate) try { node.bufferSource.playbackRate.value = rate; } catch {}
                    if ("preservesPitch" in node) try { node.preservesPitch = preservePitch; } catch {}
                    if ("webkitPreservesPitch" in node) try { node.webkitPreservesPitch = preservePitch; } catch {}
                    sound._rate = rate;
                } catch (e) { log() }
            }
        }
    }

    async function connectMediaElement(mediaEl) {
        if (mediaEl && mediaEl.nodeType === Node.ELEMENT_NODE && !siteIsBlacklisted && !connectingMediaElements.has(mediaEl)) {
            connectingMediaElements.add(mediaEl);
            try {
                const ctx = audioCtx && audioCtx.state !== "closed" ? audioCtx : new (window.AudioContext || window.webkitAudioContext);
                bindResumeHandlers(ctx);
                await ensurePitchGraph(ctx);

                if (!mediaEl.__speedListenersAdded) {
                    mediaEl.addEventListener("ratechange", handleRateChange);
                    mediaEl.__speedListenersAdded = true;
                    mediaEl.addEventListener("emptied", () => {
                        mediaEl.__pitchConnected = false;
                        mediaEl.__pitchSource = null;
                        connectMediaElement(mediaEl);
                    });
                }

                applySpeedSettings(mediaEl);

                if (!mediaEl.__pitchSource) {
                    const source = audioCtx.createMediaElementSource(mediaEl);
                    mediaEl.__pitchSource = source;
                }

                routeMediaElement(mediaEl, false);
                connectedMediaElements.add(mediaEl);
                mediaEl.__pitchConnected = true;
                
                refreshPitchNode();
                refreshEqualizer();
                refreshGainNode();
            } catch (e) {
                mediaEl.__pitchConnected = false;
            } finally {
                connectingMediaElements.delete(mediaEl);
            }
        }
    }

    function connectAllMedia() {
        if (!siteIsBlacklisted) {
            document.querySelectorAll("audio, video").forEach(connectMediaElement);
        }
    }

    // НОВОЕ: Принудительное поддержание скорости (Решает баг с YouTube Shorts)
    function startSpeedEnforcer() {
        setInterval(() => {
            // Не тратим ресурсы, если сайт в черном списке или нет подключенных элементов
            if (siteIsBlacklisted || connectedMediaElements.size === 0) return;
            
            const rate = calcPlaybackRate();
            // Если скорость стандартная (1x), нет смысла принудительно её применять
            if (Math.abs(rate - 1.0) < 0.001) return;

            const preservePitch = !!settings.preservePitch;
            
            connectedMediaElements.forEach(el => {
                try {
                    // Проверяем только те элементы, которые реально воспроизводятся
                    if (el.paused || el.readyState < 2) return;
                    
                    // Если YouTube или другой сайт сбросил скорость, возвращаем её обратно
                    if (el.playbackRate !== rate) {
                        el.playbackRate = rate;
                        el.defaultPlaybackRate = rate;
                        el.__lastRateSetByUs = Date.now();
                    }
                    if (el.preservesPitch !== preservePitch) {
                        el.preservesPitch = preservePitch;
                        if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = preservePitch;
                    }
                } catch (e) {}
            });
        }, 250); // Проверяем 4 раза в секунду — незаметно для глаз, но достаточно быстро для аудио
    }

    window.addEventListener("message", async e => {
        if (e.source !== window) return;
        const data = e.data;
        if (!data || data.type !== "PITCH_UPDATE") return;

        settings = { ...settings, ...data.settings || {} };

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
                connectedMediaElements.forEach(el => {
                    routeMediaElement(el, true);
                    try {
                        el.playbackRate = 1;
                        el.defaultPlaybackRate = 1;
                        if ("preservesPitch" in el) el.preservesPitch = true;
                        if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = true;
                        el.__lastRateSetByUs = Date.now();
                    } catch (e) {}
                });

                if (usingHowler) {
                    routeHowler(true);
                    try {
                        const howler = window.Howler;
                        if (howler) {
                            const howls = Array.isArray(howler._howls) ? howler._howls : [];
                            for (const howl of howls) {
                                if (typeof howl.rate === "function") howl.rate(1);
                                howl._rate = 1;
                                const sounds = Array.isArray(howl._sounds) ? howl._sounds : [];
                                for (const sound of sounds) {
                                    sound._rate = 1;
                                    const node = sound?._node;
                                    if (node?.playbackRate) node.playbackRate.value = 1;
                                    if (node?.bufferSource?.playbackRate) node.bufferSource.playbackRate.value = 1;
                                }
                            }
                        }
                    } catch (e) {}
                }
            } else {
                if (audioCtx && !pitchNode) {
                    await ensurePitchGraph(audioCtx);
                }
                
                connectedMediaElements.forEach(el => routeMediaElement(el, false));
                
                if (usingHowler) {
                    routeHowler(false);
                    syncHowlerSpeed();
                }

                if (isNodeReady) refreshPitchNode();
                refreshEqualizer();
                refreshGainNode();
                connectedMediaElements.forEach(el => applySpeedSettings(el));
            }
        } else if (!siteIsBlacklisted) {
            if (usingHowler) {
                syncHowlerSpeed();
            } else {
                connectedMediaElements.forEach(el => applySpeedSettings(el));
            }
            refreshPitchNode();
            refreshEqualizer();
            refreshGainNode();
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
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
            connectAllMedia();
        }
    }

    if (document.body) {
        startObserver();
    } else {
        document.addEventListener("DOMContentLoaded", startObserver);
    }

    document.addEventListener("play", async e => {
        const el = e?.target;
        if (el && (el.tagName === "AUDIO" || el.tagName === "VIDEO") && !siteIsBlacklisted) {
            try {
                await connectMediaElement(el);
            } catch (err) {}
        }
    }, true);

    function hookMediaElementPlay() {
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
                            refreshPitchNode();
                            refreshEqualizer();
                            refreshGainNode();
                        } catch (e) {}
                    });
                }
            } catch (e) {}
            
            return originalPlay.apply(mediaEl, args);
        };
    }

    hookMediaElementPlay();

    function probeHowler() {
        if (howlerProbeTimer) return;
        howlerProbeTimer = setInterval(() => {
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
                                refreshPitchNode();
                                refreshEqualizer();
                                refreshGainNode();
                            } catch (e) {}
                        });
                        return result;
                    };
                }

                clearInterval(howlerProbeTimer);
                howlerProbeTimer = null;
                hookHowler();
                
                if (!siteIsBlacklisted) {
                    attachHowler().catch(e => {});
                }
            }
        }, 250);
    }

    probeHowler();
    startSpeedEnforcer();
})();