(function () {
    if (window.__pitchChangerPatched) return;
    window.__pitchChangerPatched = true;

    const workletUrl = new URL('/__pitch_shifter_worklet.js', window.location.origin).href;

    let audioCtx = null;
    let pitchNode = null;
    let isNodeReady = false;
    let initPromise = null;
    let startPromise = null;

    let settings = {
        pitchValueSemitones: 0,
        pitchValueCents: 0,
        windowSizeMilliseconds: 120,
        applySmartProcessing: true,
        speedUnits: 0,
        speedFine: 0,
        preservePitch: true,
        blacklistPatterns: []
    };

    let siteIsBlacklisted = false;

    const connectedMediaElements = new Set();
    const connectingMediaElements = new WeakSet();

    function normalizePattern(value) {
        return String(value ?? '').trim();
    }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function matchURLPatterns(url, urlPatterns) {
        const patterns = typeof urlPatterns === 'string'
            ? [urlPatterns]
            : Array.isArray(urlPatterns)
                ? urlPatterns
                : [];

        const target = String(url || '');

        return patterns.some((pattern) => {
            const normalizedPattern = normalizePattern(pattern);
            if (!normalizedPattern) return false;

            if (normalizedPattern.includes('*')) {
                const regex = new RegExp(
                    '^' + escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*') + '$'
                );
                return regex.test(target);
            }

            return target === normalizedPattern;
        });
    }

    function isBlacklisted() {
        return matchURLPatterns(location.href, settings.blacklistPatterns || []);
    }

    function applyPitchSettingsToNode(node, s) {
        if (!node || !node.port) return;

        const totalSemitones = s.pitchValueSemitones + s.pitchValueCents / 100;

        node.port.postMessage([
            null,
            'configure',
            {
                blockMs: s.windowSizeMilliseconds,
                splitComputation: !s.applySmartProcessing
            }
        ]);

        node.port.postMessage([
            null,
            'start',
            {
                active: true,
                semitones: totalSemitones,
                tonalityHz: 8800
            }
        ]);
    }

    function applySpeedSettings(mediaEl) {
        const u = Number(settings.speedUnits) || 0;
        const f = Number(settings.speedFine) || 0;
        const base = u < 0 ? 100 + 1 * u : 100 + 5 * u;
        const playbackRate = (base + f) / 100;

        if (
            mediaEl.playbackRate !== playbackRate ||
            mediaEl.defaultPlaybackRate !== playbackRate
        ) {
            mediaEl.playbackRate = playbackRate;
            mediaEl.defaultPlaybackRate = playbackRate;
        }

        const preservePitch = !!settings.preservePitch;

        if (mediaEl.preservesPitch !== preservePitch) {
            mediaEl.preservesPitch = preservePitch;
        }

        if (
            'webkitPreservesPitch' in mediaEl &&
            mediaEl.webkitPreservesPitch !== preservePitch
        ) {
            mediaEl.webkitPreservesPitch = preservePitch;
        }
    }

    function resetNativePlayback(mediaEl) {
        try {
            mediaEl.playbackRate = 1;
        } catch { }

        try {
            mediaEl.defaultPlaybackRate = 1;
        } catch { }

        try {
            if ('preservesPitch' in mediaEl) {
                mediaEl.preservesPitch = true;
            }
        } catch { }

        try {
            if ('webkitPreservesPitch' in mediaEl) {
                mediaEl.webkitPreservesPitch = true;
            }
        } catch { }
    }

    function handleRateChange(e) {
        const el = e && e.target;
        if (!el) return;
        if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') {
            applySpeedSettings(el);
        }
    }

    function unlockAudioContext(ctx) {
        const unlock = async () => {
            if (ctx.state !== 'suspended') return;

            try {
                await ctx.resume();
                console.log('[AudioContext] unlocked');
            } catch (e) {
                console.warn('[AudioContext] unlock failed', e);
            }

            window.removeEventListener('click', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };

        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
        window.addEventListener('touchstart', unlock, { once: true });
    }

    function disconnectNodeSafe(node) {
        if (!node) return;
        try {
            node.disconnect();
        } catch { }
    }

    function connectNodeSafe(node, target) {
        if (!node || !target) return;
        try {
            node.connect(target);
        } catch { }
    }

    function routeMediaElement(mediaEl, bypass) {
        const source = mediaEl.__pitchSource;
        if (!source || !audioCtx) return;

        disconnectNodeSafe(source);

        if (bypass) {
            connectNodeSafe(source, audioCtx.destination);
        } else {
            connectNodeSafe(source, pitchNode);
        }
    }

    function setBlacklistMode(enabled) {
        siteIsBlacklisted = enabled;

        if (!audioCtx || !pitchNode) return;

        disconnectNodeSafe(pitchNode);

        if (enabled) {
            connectedMediaElements.forEach((el) => routeMediaElement(el, true));
        } else {
            connectNodeSafe(pitchNode, audioCtx.destination);
            connectedMediaElements.forEach((el) => routeMediaElement(el, false));

            if (isNodeReady) {
                applyPitchSettingsToNode(pitchNode, settings);
            }
        }
    }

    async function initPitchShifter() {
        if (siteIsBlacklisted) return;

        if (audioCtx && audioCtx.state !== 'closed' && pitchNode) {
            return;
        }

        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            audioCtx = new AudioContext();
            unlockAudioContext(audioCtx);

            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            await audioCtx.audioWorklet.addModule(workletUrl);

            pitchNode = new AudioWorkletNode(audioCtx, 'signalsmith-stretch', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });

            pitchNode.port.onmessage = (e) => {
                const data = e && e.data;
                if (data && data[0] === 'ready') {
                    isNodeReady = true;
                    applyPitchSettingsToNode(pitchNode, settings);
                }
            };

            pitchNode.connect(audioCtx.destination);
        })().catch((err) => {
            initPromise = null;
            console.error('[PitchShifter] init failed:', err);
            throw err;
        });

        return initPromise;
    }

    function ensureCorsEnabled(mediaEl) {
        const src = mediaEl.currentSrc || mediaEl.src;
        if (!src) return true;

        const url = new URL(src, location.href);

        if (url.origin === location.origin) return true;

        if (mediaEl.crossOrigin !== 'anonymous') {
            mediaEl.crossOrigin = 'anonymous';
            return false;
        }

        return true;
    }

    async function connectMediaElement(mediaEl) {
        if (!mediaEl || mediaEl.nodeType !== Node.ELEMENT_NODE) return;

        if (siteIsBlacklisted) return;

        if (connectingMediaElements.has(mediaEl) || mediaEl.__pitchConnected) {
            applySpeedSettings(mediaEl);
            return;
        }

        connectingMediaElements.add(mediaEl);

        try {
            await bootstrap();

            if (siteIsBlacklisted) return;
            if (!audioCtx || !pitchNode) return;

            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            if (!mediaEl.__speedListenersAdded) {
                mediaEl.addEventListener('ratechange', handleRateChange);
                mediaEl.__speedListenersAdded = true;
            }

            applySpeedSettings(mediaEl);

            if (!ensureCorsEnabled(mediaEl)) {
                const src = mediaEl.currentSrc || mediaEl.src;
                if (src) {
                    const t = mediaEl.currentTime;
                    const wasPlaying = !mediaEl.paused;

                    mediaEl.src = src;
                    mediaEl.addEventListener('loadedmetadata', async () => {
                        try {
                            mediaEl.currentTime = t;
                        } catch { }
                        if (wasPlaying) {
                            try {
                                await mediaEl.play();
                            } catch { }
                        }
                    }, { once: true });
                }
                return;
            }

            if (!mediaEl.__pitchSource) {
                const source = audioCtx.createMediaElementSource(mediaEl);
                mediaEl.__pitchSource = source;
                mediaEl.__pitchContext = audioCtx;
            }

            routeMediaElement(mediaEl, siteIsBlacklisted);

            mediaEl.__pitchNode = pitchNode;
            mediaEl.__pitchConnected = true;
            connectedMediaElements.add(mediaEl);
        } catch (e) {
            mediaEl.__pitchConnected = false;
            console.error('[PitchShifter] Failed to connect media element:', e);
        } finally {
            connectingMediaElements.delete(mediaEl);
        }
    }

    function connectAllMedia() {
        if (siteIsBlacklisted) return;
        document.querySelectorAll('audio, video').forEach(connectMediaElement);
    }

    async function bootstrap() {
        if (siteIsBlacklisted) return;

        if (startPromise) {
            return startPromise;
        }

        startPromise = (async () => {
            await initPitchShifter();
            if (!siteIsBlacklisted) {
                connectAllMedia();
            }
        })().catch((err) => {
            startPromise = null;
            throw err;
        });

        return startPromise;
    }

    function refreshBlacklistState() {
        const blacklisted = isBlacklisted();

        if (blacklisted !== siteIsBlacklisted) {
            setBlacklistMode(blacklisted);
        } else {
            siteIsBlacklisted = blacklisted;
        }

        return siteIsBlacklisted;
    }

    window.addEventListener('message', async (e) => {
        if (e.source !== window) return;
        const data = e.data;

        if (data && data.type === 'PITCH_UPDATE') {
            settings = data.settings || settings;

            const blacklisted = isBlacklisted();
            if (blacklisted !== siteIsBlacklisted) {
                setBlacklistMode(blacklisted);
            } else {
                siteIsBlacklisted = blacklisted;
            }

            if (siteIsBlacklisted) {
                return;
            }

            await bootstrap();

            if (pitchNode && isNodeReady) {
                applyPitchSettingsToNode(pitchNode, settings);
            }

            connectedMediaElements.forEach((el) => {
                applySpeedSettings(el);
            });
        }
    });

    const observer = new MutationObserver((mutations) => {
        if (siteIsBlacklisted) return;

        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                if (node.matches && node.matches('audio, video')) {
                    connectMediaElement(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('audio, video').forEach(connectMediaElement);
                }
            }
        }
    });

    const startObserver = () => {
        if (!document.body) return;
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        connectAllMedia();
    };

    if (document.body) {
        startObserver();
    } else {
        document.addEventListener('DOMContentLoaded', startObserver);
    }

    document.addEventListener('play', (e) => {
        const el = e && e.target;
        if (el && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO')) {
            if (siteIsBlacklisted) return;

            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            connectMediaElement(el);
        }
    }, true);
})();