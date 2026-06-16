(function() {
  if (window.__pitchChangerPatched) return;
  window.__pitchChangerPatched = true;

  // Use URL passed from content.js or fallback to default
  const workletUrl = window.__pitchShifterExtensionConfig?.workletUrl || 
                     new URL("/__pitch_shifter_worklet.js", window.location.origin).href;

  let audioCtx = null;
  let pitchNode = null;
  let isNodeReady = false;
  let initPromise = null;
  let startPromise = null;
  
  const defaultSettings = {
    pitchValueSemitones: 0,
    pitchValueCents: 0,
    windowSizeMilliseconds: 120,
    applySmartProcessing: true,
    speedUnits: 0,
    speedFine: 0,
    preservePitch: true,
    blacklistPatterns: []
  };
  
  let settings = { ...defaultSettings };
  let siteIsBlacklisted = false;
  const connectedMediaElements = new Set();
  const connectingMediaElements = new WeakSet();

  // --- Utilities ---

  function isBlacklisted() {
    const patterns = Array.isArray(settings.blacklistPatterns) ? settings.blacklistPatterns : [];
    if (!patterns.length) return false;
    
    const target = location.href;
    return patterns.some(pattern => {
      const normalizedPattern = String(pattern || "").trim();
      if (!normalizedPattern) return false;
      if (normalizedPattern.includes("*")) {
        const regex = new RegExp("^" + normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$");
        return regex.test(target);
      }
      return target === normalizedPattern;
    });
  }

  function applyPitchSettingsToNode(node, s) {
    if (!node || !node.port) return;
    const totalSemitones = s.pitchValueSemitones + (s.pitchValueCents / 100);
    node.port.postMessage([null, "configure", {
      blockMs: s.windowSizeMilliseconds,
      splitComputation: !s.applySmartProcessing
    }]);
    node.port.postMessage([null, "start", {
      active: true,
      semitones: totalSemitones,
      tonalityHz: 8800
    }]);
  }

  function applySpeedSettings(mediaEl) {
    const u = Number(settings.speedUnits) || 0;
    const playbackRate = ((u < 0 ? 100 + 1 * u : 100 + 5 * u) + (Number(settings.speedFine) || 0)) / 100;
    
    if (mediaEl.playbackRate !== playbackRate || mediaEl.defaultPlaybackRate !== playbackRate) {
      mediaEl.playbackRate = playbackRate;
      mediaEl.defaultPlaybackRate = playbackRate;
    }

    const preservePitch = !!settings.preservePitch;
    if (mediaEl.preservesPitch !== preservePitch) mediaEl.preservesPitch = preservePitch;
    if ("webkitPreservesPitch" in mediaEl && mediaEl.webkitPreservesPitch !== preservePitch) {
      mediaEl.webkitPreservesPitch = preservePitch;
    }
  }

  function handleRateChange(e) {
    if (e && e.target && (e.target.tagName === "AUDIO" || e.target.tagName === "VIDEO")) {
      applySpeedSettings(e.target);
    }
  }

  function disconnectNodeSafe(node) {
    if (node) { try { node.disconnect(); } catch (e) {} }
  }

  function connectNodeSafe(node, target) {
    if (node && target) { try { node.connect(target); } catch (e) {} }
  }

  function routeMediaElement(mediaEl, bypass) {
    const source = mediaEl.__pitchSource;
    if (source && audioCtx) {
      disconnectNodeSafe(source);
      connectNodeSafe(source, bypass ? audioCtx.destination : pitchNode);
    }
  }

  // --- AudioContext Initialization (Strict Gesture Handling) ---
  
  async function initPitchShifter() {
    if (siteIsBlacklisted) return;
    if (audioCtx && audioCtx.state !== "closed") return;

    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // 1. Create AudioContext (it starts in 'suspended' state)
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 2. Setup Gesture Listeners
        // We do NOT call resume() here. We wait for the user to interact.
        // The listeners will fire on the FIRST interaction and then remove themselves.
        const resumeOnInteraction = async () => {
          if (audioCtx.state === "suspended") {
            try {
              await audioCtx.resume();
              console.log("[PitchShifter] AudioContext unlocked successfully");
            } catch (e) {
              console.warn("[PitchShifter] Resume failed (need interaction):", e);
            }
          }
        };

        // Attach listeners to window with { once: true }
        // We use capture: true to ensure we catch the event early
        window.addEventListener("click", resumeOnInteraction, { once: true, capture: true });
        window.addEventListener("keydown", resumeOnInteraction, { once: true, capture: true });
        window.addEventListener("touchstart", resumeOnInteraction, { once: true, capture: true });

        // 3. Load Worklet
        await audioCtx.audioWorklet.addModule(workletUrl);
        
        pitchNode = new AudioWorkletNode(audioCtx, "signalsmith-stretch", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });

        pitchNode.port.onmessage = (e) => {
          const data = e && e.data;
          if (data && data[0] === "ready") {
            isNodeReady = true;
            applyPitchSettingsToNode(pitchNode, settings);
          }
        };

        // Connect to destination only if not blacklisted
        if (!siteIsBlacklisted) {
            pitchNode.connect(audioCtx.destination);
        }

      } catch (err) {
        initPromise = null;
        console.log("[PitchShifter] init failed:", err);
        throw err;
      }
    })();

    return initPromise;
  }

  // --- Media Element Connection ---

  function ensureCorsEnabled(mediaEl) {
    const src = mediaEl.currentSrc || mediaEl.src;
    if (!src) return true;

    // If same origin, no CORS needed
    if (new URL(src, location.href).origin === location.origin) return true;

    // If already anonymous, we are good
    if (mediaEl.crossOrigin === "anonymous") return true;

    // Otherwise enable CORS (requires reload)
    console.log("[PitchShifter] Enabling CORS for:", src);
    mediaEl.crossOrigin = "anonymous";
    return false; 
  }

  async function connectMediaElement(mediaEl) {
    if (!mediaEl || mediaEl.nodeType !== Node.ELEMENT_NODE || siteIsBlacklisted) return;
    if (connectingMediaElements.has(mediaEl) || mediaEl.__pitchConnected) {
      applySpeedSettings(mediaEl);
      return;
    }

    connectingMediaElements.add(mediaEl);

    try {
      // Initialize AudioContext system (graph setup, but suspended)
      if (!startPromise) {
        startPromise = (async () => {
          await initPitchShifter(); // This now waits for user gesture
          if (!siteIsBlacklisted) connectAllMedia();
        })().catch(err => {
          startPromise = null;
          throw err;
        });
      }
      await startPromise;

      if (siteIsBlacklisted || !audioCtx || !pitchNode) return;

      // Note: We do NOT call audioCtx.resume() here.
      // It is handled by the global click/touch listeners attached in initPitchShifter.
      // If the user clicked play, the global listener will have resumed the context 
      // before this 'play' event bubbles up or completes, thanks to { capture: true }.

      if (!mediaEl.__speedListenersAdded) {
        mediaEl.addEventListener("ratechange", handleRateChange);
        mediaEl.__speedListenersAdded = true;
      }
      
      applySpeedSettings(mediaEl);

      // Handle CORS reload if necessary
      const needsReload = !ensureCorsEnabled(mediaEl);
      if (needsReload) {
        const src = mediaEl.currentSrc || mediaEl.src;
        if (src) {
          const t = mediaEl.currentTime;
          const wasPlaying = !mediaEl.paused;
          mediaEl.src = src; 
          mediaEl.addEventListener("loadedmetadata", async () => {
            try { mediaEl.currentTime = t; } catch (e) {}
            if (wasPlaying) {
              try { await mediaEl.play(); } catch (e) {}
            }
          }, { once: true });
          return; 
        }
      }

      if (!mediaEl.__pitchSource) {
        const source = audioCtx.createMediaElementSource(mediaEl);
        mediaEl.__pitchSource = source;
        mediaEl.__pitchContext = audioCtx;
      }

      routeMediaElement(mediaEl, false);
      mediaEl.__pitchNode = pitchNode;
      mediaEl.__pitchConnected = true;
      connectedMediaElements.add(mediaEl);

    } catch (e) {
      mediaEl.__pitchConnected = false;
      console.log("[PitchShifter] Failed to connect media element:", e);
    } finally {
      connectingMediaElements.delete(mediaEl);
    }
  }

  function connectAllMedia() {
    if (siteIsBlacklisted) return;
    // Cleanup removed elements from Set
    for (const el of connectedMediaElements) {
      if (!document.body.contains(el)) {
        connectedMediaElements.delete(el);
      }
    }
    document.querySelectorAll("audio, video").forEach(connectMediaElement);
  }

  // --- Event Listeners ---

  window.addEventListener("message", async e => {
    if (e.source !== window) return;
    const data = e.data;
    if (data && data.type === "PITCH_UPDATE") {
      settings = { ...settings, ...(data.settings || {}) };
      const blacklisted = isBlacklisted();
      
      if (blacklisted !== siteIsBlacklisted) {
        siteIsBlacklisted = blacklisted;
        if (audioCtx && pitchNode) {
          disconnectNodeSafe(pitchNode);
          if (siteIsBlacklisted) {
            connectedMediaElements.forEach(el => routeMediaElement(el, true));
          } else {
            connectNodeSafe(pitchNode, audioCtx.destination);
            connectedMediaElements.forEach(el => routeMediaElement(el, false));
            if (isNodeReady) applyPitchSettingsToNode(pitchNode, settings);
          }
        }
      } else {
        siteIsBlacklisted = blacklisted;
      }

      if (siteIsBlacklisted) return;

      connectedMediaElements.forEach(el => applySpeedSettings(el));
      if (pitchNode && isNodeReady) applyPitchSettingsToNode(pitchNode, settings);
    }
  });

  const observer = new MutationObserver(mutations => {
    if (siteIsBlacklisted) return;
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches && (node.matches("audio") || node.matches("video"))) {
            connectMediaElement(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll("audio, video").forEach(connectMediaElement);
          }
        }
      }
    }
  });

  const startObserver = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      connectAllMedia();
    }
  };

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startObserver);
  }

  // We listen to 'play' to connect the graph.
  // We do NOT call resume() here; the global window listeners handle unlocking.
  document.addEventListener("play", async e => {
    const el = e && e.target;
    if (el && (el.tagName === "AUDIO" || el.tagName === "VIDEO") && !siteIsBlacklisted) {
      try {
        if (!audioCtx) await initPitchShifter();
        await connectMediaElement(el);
      } catch (err) {
        console.warn("[PitchShifter] activation failed:", err);
      }
    }
  }, true);

})();