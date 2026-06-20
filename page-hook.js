(() => {
  if (window.__pitchChangerPatched) return;
  window.__pitchChangerPatched = true;

  const DEBUG = false;

  const startedAt = performance.now();

  function log(...args) {
    if (!DEBUG) return;

    console.log(
      `[PitchShifter] +${(
        performance.now() - startedAt
      ).toFixed(1)}ms`,
      ...args
    );
  }

  function warn(...args) {
    console.warn(
      `[PitchShifter] +${(
        performance.now() - startedAt
      ).toFixed(1)}ms`,
      ...args
    );
  }

  // --- Blacklist Logic Utilities ---

  function matchURLPatterns(url, urlPatterns) {
    function escapeString(str, slashLength = 2) {
      return str.replace(new RegExp('[-[\\]{}()*+?&.,\\\\^$|#\'\"]', 'gim'), (`${[...new Array(slashLength)].map(i => '\\').join('')}$&`));
    };

    urlPatterns = typeof urlPatterns == 'string' ? [urlPatterns] : urlPatterns || [];

    return urlPatterns?.some(pattern => {
      return url.match(new RegExp('^' + escapeString(pattern, 1).replace(/\\\*/gim, '.*') + '$', ''));
    });
  }

  // --- Core Setup ---

  const workletUrl = (() => {
    let url = window.__pitchShifterExtensionConfig?.workletUrl;
    if (!url) {
      try {
        url = new URL("/__pitch_shifter_worklet.js", window.location.origin).href;
      } catch (error) {

      }
    }
    return url;
  })();

  if (!workletUrl) {
    log(
      '[PitchShifter] workletUrl is missing. page-hook must be injected from content.js'
    );
    return;
  }

  let audioCtx = null;
  let pitchNode = null;
  let gainNode = null;
  let limiterNode = null;
  let isNodeReady = false;

  let initPromise = null;
  let howlerProbeTimer = null;

  let usingHowler = false;
  let howlerAttached = false;

  let siteIsBlacklisted = false; // Blacklist state flag

  const connectedMediaElements =
    new Set();

  const connectingMediaElements =
    new WeakSet();

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
  };

  function calcPlaybackRate() {
    const u =
      Number(settings.speedUnits) || 0;

    return (
      ((u < 0
        ? 100 + u
        : 100 + u * 5) +
        (Number(settings.speedFine) ||
          0)) /
      100
    );
  }

  function disconnectNodeSafe(node) {
    if (!node) return;

    try {
      node.disconnect();
    } catch { }
  }

  function connectNodeSafe(
    node,
    target
  ) {
    if (!node || !target) return;

    try {
      node.connect(target);
    } catch { }
  }

  // --- Helper to reset speed/pitch to defaults ---
  function resetMediaSpeed(mediaEl) {
    if (!mediaEl) return;

    // We reset without performing any checks to return control to the native player or another extension
    mediaEl.playbackRate = 1.0;
    mediaEl.defaultPlaybackRate = 1.0;
    mediaEl.preservesPitch = true;
    if ("webkitPreservesPitch" in mediaEl) mediaEl.webkitPreservesPitch = true;

    // Resetting the timestamp so that our action does not trigger the handler
    mediaEl.__lastRateSetByUs = Date.now();

    log("resetMediaSpeed applied to", mediaEl);
  }

  function resetHowlerSpeed() {
    const howler = window.Howler;
    if (!howler) return;
    const howls = Array.isArray(howler._howls) ? howler._howls : [];
    for (const howl of howls) {
      try {
        howl.rate(1.0);
        howl._rate = 1.0;
        const sounds = Array.isArray(howl._sounds) ? howl._sounds : [];
        for (const sound of sounds) {
          sound._rate = 1.0;
          const node = sound?._node;
          if (node?.playbackRate) node.playbackRate.value = 1.0;
          if (node?.bufferSource?.playbackRate) node.bufferSource.playbackRate.value = 1.0;
        }
      } catch (e) {
        log("resetHowlerSpeed failed", e);
      }
    }
    log("resetHowlerSpeed applied");
  }

  function bindResumeHandlers(ctx) {
    if (ctx.__pitchResumeBound) {
      return;
    }

    ctx.__pitchResumeBound = true;

    const unlock = async () => {
      try {
        if (
          ctx.state === "suspended"
        ) {
          await ctx.resume();

          log("AudioContext resumed");
        }
      } catch (e) {
        log("resume failed", e);
      }
    };

    window.addEventListener(
      "click",
      unlock,
      {
        capture: true,
      }
    );

    window.addEventListener(
      "keydown",
      unlock,
      {
        capture: true,
      }
    );

    window.addEventListener(
      "touchstart",
      unlock,
      {
        capture: true,
      }
    );
  }

  async function setupWorklet(ctx) {
    log("setupWorklet");

    await ctx.audioWorklet.addModule(
      workletUrl
    );

    pitchNode =
      new AudioWorkletNode(
        ctx,
        "signalsmith-stretch",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        }
      );

    pitchNode.port.onmessage = (e) => {
      const data = e?.data;

      if (
        data && data[0] === "ready"
      ) {
        isNodeReady = true;

        log("pitchNode ready");

        refreshPitchNode();
      }
    };

    gainNode = ctx.createGain();

    limiterNode = ctx.createDynamicsCompressor();

    limiterNode.threshold.value = -1;
    limiterNode.knee.value = 0;
    limiterNode.ratio.value = 20;
    limiterNode.attack.value = 0.003;
    limiterNode.release.value = 0.25;

    pitchNode.connect(gainNode);
    gainNode.connect(limiterNode);
    limiterNode.connect(ctx.destination);

    log("pitchNode connected");
  }

  function destroyPitchGraph() {
    try {
      pitchNode?.disconnect();
    } catch { }

    try {
      pitchNode?.port?.close?.();
    } catch { }

    pitchNode = null;
    isNodeReady = false;
  }

  async function ensurePitchGraph(ctx) {
    if (!ctx) throw new Error("No AudioContext");

    if (audioCtx && audioCtx !== ctx) {
      function destroyPitchGraph() {
        try { pitchNode?.disconnect(); } catch { }
        try { gainNode?.disconnect(); } catch { }
        try { limiterNode?.disconnect(); } catch { }
        try { pitchNode?.port?.close?.(); } catch { }

        pitchNode = null;
        gainNode = null;
        limiterNode = null;
        isNodeReady = false;
      }
      destroyPitchGraph();
    }

    audioCtx = ctx;

    if (!pitchNode) {
      await setupWorklet(audioCtx);
    }
  }

  async function attachMedia() {
    if (siteIsBlacklisted) return; // Stop if blacklisted

    usingHowler = false;

    const ctx =
      audioCtx &&
        audioCtx.state !== "closed"
        ? audioCtx
        : new (
          window.AudioContext ||
          window.webkitAudioContext
        )();

    bindResumeHandlers(ctx);

    await ensurePitchGraph(ctx);

    log(
      "Media context ready",
      ctx.state
    );
  }

  async function attachHowler() {
    if (siteIsBlacklisted) return false; // Stop if blacklisted

    const howler =
      window.Howler;

    if (
      !howler?.ctx ||
      !howler?.masterGain
    ) {
      return false;
    }

    usingHowler = true;

    bindResumeHandlers(
      howler.ctx
    );

    await ensurePitchGraph(
      howler.ctx
    );

    if (!howlerAttached) {
      howlerAttached = true;

      log("Howler attached");
    }

    routeHowler(false);

    syncHowlerSpeed();

    refreshPitchNode();

    return true;
  }

  function getPitchCompensation() {
    const rate =
      calcPlaybackRate();

    if (
      !usingHowler ||
      !settings.preservePitch ||
      rate <= 0
    ) {
      return 0;
    }

    return (
      -12 * Math.log2(rate)
    );
  }

  function refreshGainNode() {
    if (!gainNode) return;

    const db = settings.volumeBoostDb || 0;

    gainNode.gain.value = Math.pow(10, db / 20);
  }

  function refreshPitchNode() {
    if (
      !pitchNode ||
      !isNodeReady
    ) {
      return;
    }

    const baseSemitones =
      settings.pitchValueSemitones +
      settings.pitchValueCents /
      100;

    const compensation =
      getPitchCompensation();

    const finalSemitones =
      baseSemitones +
      compensation;

    log("refreshPitchNode", {
      baseSemitones,
      compensation,
      finalSemitones,
      preservePitch:
        settings.preservePitch,
      usingHowler,
    });

    pitchNode.port.postMessage([
      null,
      "configure",
      {
        blockMs:
          settings.windowSizeMilliseconds,
        splitComputation:
          !settings.applySmartProcessing,
      },
    ]);

    pitchNode.port.postMessage([
      null,
      "start",
      {
        active: true,
        semitones:
          finalSemitones,
        tonalityHz: 8800,
      },
    ]);
  }

  function applySpeedSettings(
    mediaEl
  ) {
    const rate =
      calcPlaybackRate();

    // FIX: Check for conflicts.
    // If the speed is already what we need, do not touch the DOM (optimization).
    if (mediaEl.playbackRate === rate && mediaEl.defaultPlaybackRate === rate) {
      // However, you need to update the preservePitch, as it may have changed from the outside.
      const preservePitch = !!settings.preservePitch;
      if (mediaEl.preservesPitch !== preservePitch) {
        mediaEl.preservesPitch = preservePitch;
        if ("webkitPreservesPitch" in mediaEl) mediaEl.webkitPreservesPitch = preservePitch;
      }
      return;
    }

    mediaEl.playbackRate =
      rate;

    mediaEl.defaultPlaybackRate =
      rate;

    const preservePitch =
      !!settings.preservePitch;

    if (
      "preservesPitch" in mediaEl
    ) {
      mediaEl.preservesPitch =
        preservePitch;
    }

    if (
      "webkitPreservesPitch" in
      mediaEl
    ) {
      mediaEl.webkitPreservesPitch =
        preservePitch;
    }

    // FIX: We mark the time of the change. This is necessary for the handleRateChange.
    mediaEl.__lastRateSetByUs = Date.now();

    log(
      "applySpeedSettings",
      {
        rate,
        preservePitch,
      }
    );
  }

  function handleRateChange(e) {
    const mediaEl = e?.target;

    if (siteIsBlacklisted) return;

    if (
      mediaEl &&
      (mediaEl.tagName ===
        "AUDIO" ||
        mediaEl.tagName ===
        "VIDEO")
    ) {
      // FIX: Cooldown (Protection against cycles and conflicts).
      // If we changed the speed less than 100ms ago, ignore this event.
      // This breaks the endless cycle between the two extensions (Wave Shifter and VK Blue).
      const now = Date.now();
      if (mediaEl.__lastRateSetByUs && (now - mediaEl.__lastRateSetByUs < 100)) {
        return;
      }

      applySpeedSettings(
        mediaEl
      );
    }
  }

  function routeMediaElement(mediaEl, bypass) {
    const source = mediaEl.__pitchSource;
    if (source && audioCtx) {
      try {
        source.disconnect()
      } catch (e) { }
      if (bypass) {
        connectNodeSafe(source, gainNode)
      } else if (pitchNode) {
        connectNodeSafe(source, pitchNode)
      }
    }
  }

  function routeHowler(bypass) {
    const howler = window.Howler;
    if (howler?.masterGain && audioCtx) {
      try {
        howler.masterGain.disconnect()
      } catch (e) { }
      if (bypass) {
        connectNodeSafe(howler.masterGain, gainNode)
      } else if (pitchNode) {
        connectNodeSafe(howler.masterGain, pitchNode)
      }
    }
  }

  function syncHowlerSpeed() {
    const howler =
      window.Howler;

    if (!howler) {
      return;
    }

    const rate =
      calcPlaybackRate();

    const preservePitch =
      !!settings.preservePitch;

    const howls = Array.isArray(
      howler._howls
    )
      ? howler._howls
      : [];

    log("syncHowlerSpeed", {
      rate,
      preservePitch,
      howls: howls.length,
    });

    for (const howl of howls) {
      try {
        if (
          typeof howl.rate ===
          "function"
        ) {
          howl.rate(rate);
        }

        howl._rate = rate;
      } catch (e) {
        log("howl.rate failed", e);
      }

      const sounds = Array.isArray(
        howl._sounds
      )
        ? howl._sounds
        : [];

      for (const sound of sounds) {
        try {
          const node =
            sound?._node;

          if (!node) {
            continue;
          }

          if (
            "playbackRate" in node
          ) {
            try {
              node.playbackRate =
                rate;
            } catch { }
          }

          if (
            node.bufferSource
              ?.playbackRate
          ) {
            try {
              node.bufferSource.playbackRate.value =
                rate;
            } catch { }
          }

          if (
            "preservesPitch" in
            node
          ) {
            try {
              node.preservesPitch =
                preservePitch;
            } catch { }
          }

          if (
            "webkitPreservesPitch" in
            node
          ) {
            try {
              node.webkitPreservesPitch =
                preservePitch;
            } catch { }
          }

          sound._rate = rate;
        } catch (e) {
          log("sound patch failed", e);
        }
      }
    }
  }

  async function connectMediaElement(
    mediaEl
  ) {
    if (
      !mediaEl ||
      mediaEl.nodeType !==
      Node.ELEMENT_NODE ||
      siteIsBlacklisted // Check blacklist
    ) {
      return;
    }

    if (
      connectingMediaElements.has(
        mediaEl
      )
    ) {
      return;
    }

    connectingMediaElements.add(
      mediaEl
    );

    try {
      await attachMedia();

      if (
        !mediaEl.__speedListenersAdded
      ) {
        mediaEl.addEventListener(
          "ratechange",
          handleRateChange
        );

        mediaEl.__speedListenersAdded =
          true;

        mediaEl.addEventListener(
          'emptied',
          () => {
            log('media emptied');

            mediaEl.__pitchConnected = false;
            mediaEl.__pitchSource = null;

            connectMediaElement(mediaEl);
          }
        );
      }

      applySpeedSettings(
        mediaEl
      );

      if (
        !mediaEl.__pitchSource
      ) {
        const source =
          audioCtx.createMediaElementSource(
            mediaEl
          );

        mediaEl.__pitchSource =
          source;

        log(
          "MediaElementSource created"
        );
      }

      routeMediaElement(
        mediaEl,
        false
      );

      connectedMediaElements.add(
        mediaEl
      );

      mediaEl.__pitchConnected =
        true;

      refreshPitchNode();
      refreshGainNode();

      log(
        "connectMediaElement success"
      );
    } catch (e) {
      mediaEl.__pitchConnected =
        false;

      log("connectMediaElement failed", e);
    } finally {
      connectingMediaElements.delete(
        mediaEl
      );
    }
  }

  function connectAllMedia() {
    if (siteIsBlacklisted) return; // Check blacklist

    document
      .querySelectorAll(
        "audio, video"
      )
      .forEach(
        connectMediaElement
      );
  }

  function hookHowler() {
    if (
      window.__pitchHowlerHooked
    ) {
      return;
    }

    if (
      !window.Howl ||
      !window.Howl.prototype
    ) {
      return;
    }

    window.__pitchHowlerHooked =
      true;

    const originalPlay =
      window.Howl.prototype.play;

    window.Howl.prototype.play =
      function (...args) {
        const result =
          originalPlay.apply(
            this,
            args
          );

        queueMicrotask(
          async () => {
            try {
              if (!siteIsBlacklisted) {
                await attachHowler();
                syncHowlerSpeed();
                refreshPitchNode();
                refreshGainNode();
              }
            } catch (e) {
              log("Howler play hook failed", e);
            }
          }
        );

        return result;
      };

    log("Howler hooked");
  }

  function probeHowler() {
    if (
      howlerProbeTimer
    ) {
      return;
    }

    howlerProbeTimer =
      setInterval(() => {
        if (
          window.Howler &&
          window.Howl
        ) {
          clearInterval(
            howlerProbeTimer
          );

          howlerProbeTimer =
            null;

          log(
            "Howler detected"
          );

          hookHowler();

          if (!siteIsBlacklisted) {
            attachHowler().catch(
              (e) => {
                log("attachHowler failed", e);
              }
            );
          }
        }
      }, 250);
  }

  window.addEventListener(
    "message",
    async (e) => {
      if (
        e.source !== window
      ) {
        return;
      }

      const data = e.data;

      if (
        !data ||
        data.type !==
        "PITCH_UPDATE"
      ) {
        return;
      }

      settings = {
        ...settings,
        ...(data.settings ||
          {}),
      };

      // --- Blacklist Check Logic ---
      const isNowBlacklisted = matchURLPatterns(location.href, settings.blacklistPatterns);

      if (isNowBlacklisted !== siteIsBlacklisted) {
        siteIsBlacklisted = isNowBlacklisted;
        log("Blacklist status changed:", siteIsBlacklisted);

        // Switching logic
        if (siteIsBlacklisted) {
          // Adding it to the blacklist
          // 1. Turn off the processor output (pitchNode) to stop processing
          if (pitchNode) disconnectNodeSafe(pitchNode);

          // 2. Redirect all sources directly to destination
          // routeMediaElement now uses overlapping connections, so there will be no sound loss
          connectedMediaElements.forEach(el => {
            routeMediaElement(el, true);
            resetMediaSpeed(el);
          });

          if (usingHowler) {
            routeHowler(true);
            resetHowlerSpeed();
          }
        } else {
          // Removing it from the blacklist
          if (audioCtx && !pitchNode) {
            await ensurePitchGraph(audioCtx);
          }

          if (pitchNode && audioCtx) {
            connectNodeSafe(pitchNode, audioCtx.destination);
          }

          connectedMediaElements.forEach(el => routeMediaElement(el, false));

          if (usingHowler) {
            routeHowler(false);
            syncHowlerSpeed();
          }

          // FIX: We are trying to connect all media elements that could have been ignored
          connectAllMedia();

          // If Howler exists but was not connected (because it was in an emergency), connect it
          if (!usingHowler && window.Howler && window.Howl.ctx) {
            await attachHowler();
          }

          if (isNodeReady) {
            refreshPitchNode();
          }
        }
      }

      if (siteIsBlacklisted) return;

      log(
        "PITCH_UPDATE",
        settings
      );

      if (usingHowler) {
        syncHowlerSpeed();
        refreshPitchNode();
        refreshGainNode();
        return;
      }

      connectedMediaElements.forEach(
        (el) => {
          applySpeedSettings(el);
        }
      );

      refreshPitchNode();
      refreshGainNode();
    }
  );

  const observer =
    new MutationObserver(
      (mutations) => {
        if (siteIsBlacklisted) return;

        for (const mut of mutations) {
          for (const node of mut.addedNodes) {
            if (
              node.nodeType !==
              Node.ELEMENT_NODE
            ) {
              continue;
            }

            if (
              node.matches?.(
                "audio, video"
              )
            ) {
              connectMediaElement(
                node
              );
            }

            node
              .querySelectorAll?.(
                "audio, video"
              )
              .forEach(
                connectMediaElement
              );
          }
        }
      }
    );

  function startObserver() {
    if (!document.body) {
      return;
    }

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
      }
    );

    connectAllMedia();
  }

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      startObserver
    );
  }

  document.addEventListener(
    "play",
    async (e) => {
      const el = e?.target;

      if (
        !el ||
        (el.tagName !==
          "AUDIO" &&
          el.tagName !==
          "VIDEO") ||
        siteIsBlacklisted
      ) {
        return;
      }

      try {
        await connectMediaElement(
          el
        );
      } catch (err) {
        log("play activation failed", err);
      }
    },
    true
  );

  function hookMediaElementPlay() {
    if (window.__pitchMediaPlayHooked) {
      return;
    }

    window.__pitchMediaPlayHooked = true;

    const originalPlay =
      HTMLMediaElement.prototype.play;

    HTMLMediaElement.prototype.play =
      function (...args) {
        const mediaEl = this;

        if (siteIsBlacklisted) {
          return originalPlay.apply(mediaEl, args);
        }

        try {
          if (
            mediaEl &&
            (mediaEl.tagName === 'AUDIO' ||
              mediaEl.tagName === 'VIDEO')
          ) {
            log(
              'Intercepted media play',
              mediaEl.currentSrc || mediaEl.src
            );

            queueMicrotask(async () => {
              try {
                await connectMediaElement(mediaEl);

                if (siteIsBlacklisted) return;

                applySpeedSettings(mediaEl);
                refreshPitchNode();
                refreshGainNode();

                log(
                  'Media hooked from play()'
                );
              } catch (e) {
                log('play() hook failed', e);
              }
            });
          }
        } catch (e) {
          log('play interception failed', e);
        }

        return originalPlay.apply(
          mediaEl,
          args
        );
      };

    log('HTMLMediaElement.play hooked');
  }

  hookMediaElementPlay();
  probeHowler();

  log("page-hook loaded");
})();