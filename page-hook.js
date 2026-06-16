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
  let isNodeReady = false;

  let initPromise = null;
  let howlerProbeTimer = null;

  let usingHowler = false;
  let howlerAttached = false;

  const connectedMediaElements =
    new Set();

  const connectingMediaElements =
    new WeakSet();

  let settings = {
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

    pitchNode.port.onmessage = (
      e
    ) => {
      const data = e?.data;

      if (
        data &&
        data[0] === "ready"
      ) {
        isNodeReady = true;

        log("pitchNode ready");

        refreshPitchNode();
      }
    };

    pitchNode.connect(
      ctx.destination
    );

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

  async function ensurePitchGraph(
    ctx
  ) {
    if (!ctx) {
      throw new Error(
        "No AudioContext"
      );
    }

    if (
      audioCtx &&
      audioCtx !== ctx
    ) {
      log(
        "AudioContext changed, rebuilding graph"
      );

      destroyPitchGraph();
    }

    audioCtx = ctx;

    if (!pitchNode) {
      await setupWorklet(audioCtx);
    }
  }

  async function attachMedia() {
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

    if (
      mediaEl &&
      (mediaEl.tagName ===
        "AUDIO" ||
        mediaEl.tagName ===
        "VIDEO")
    ) {
      applySpeedSettings(
        mediaEl
      );
    }
  }

  function routeMediaElement(
    mediaEl,
    bypass
  ) {
    const source =
      mediaEl.__pitchSource;

    if (
      !source ||
      !audioCtx ||
      !pitchNode
    ) {
      return;
    }

    disconnectNodeSafe(
      source
    );

    connectNodeSafe(
      source,
      bypass
        ? audioCtx.destination
        : pitchNode
    );

    log(
      "routeMediaElement",
      {
        bypass,
      }
    );
  }

  function routeHowler(bypass) {
    const howler =
      window.Howler;

    if (
      !howler?.masterGain ||
      !audioCtx ||
      !pitchNode
    ) {
      return;
    }

    disconnectNodeSafe(
      howler.masterGain
    );

    connectNodeSafe(
      howler.masterGain,
      bypass
        ? audioCtx.destination
        : pitchNode
    );

    log("routeHowler", {
      bypass,
    });
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
        log("howl.rate failed",e);
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
          log("sound patch failed",e);
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
      Node.ELEMENT_NODE
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

      log(
        "connectMediaElement success"
      );
    } catch (e) {
      mediaEl.__pitchConnected =
        false;

      log("connectMediaElement failed",e);
    } finally {
      connectingMediaElements.delete(
        mediaEl
      );
    }
  }

  function connectAllMedia() {
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
              await attachHowler();

              syncHowlerSpeed();

              refreshPitchNode();
            } catch (e) {
              log("Howler play hook failed",e);
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

          attachHowler().catch(
            (e) => {
              log("attachHowler failed",e);
            }
          );
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

      log(
        "PITCH_UPDATE",
        settings
      );

      if (usingHowler) {
        syncHowlerSpeed();

        routeHowler(false);

        refreshPitchNode();

        return;
      }

      connectedMediaElements.forEach(
        (el) => {
          applySpeedSettings(el);
        }
      );

      refreshPitchNode();
    }
  );

  const observer =
    new MutationObserver(
      (mutations) => {
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
          "VIDEO")
      ) {
        return;
      }

      try {
        await connectMediaElement(
          el
        );
      } catch (err) {
        log("play activation failed",err);
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

                applySpeedSettings(mediaEl);

                refreshPitchNode();

                log(
                  'Media hooked from play()'
                );
              } catch (e) {
                log('play() hook failed',e);
              }
            });
          }
        } catch (e) {
          log('play interception failed',e);
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