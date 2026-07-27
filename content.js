(async () => {
  const DEFAULT_SETTINGS = {
    pitchValueSemitones: 0,
    pitchValueCents: 0,
    windowSizeMilliseconds: 120,
    applySmartProcessing: true,
    speedUnits: 0,
    speedFine: 0,
    preservePitch: true,
    blacklistPatterns: [],
    channelBalance: 0,
  };

  const stored = await chrome.storage.local.get('pitchSettings');

  const pitchSettings = {
    ...DEFAULT_SETTINGS,
    ...(stored.pitchSettings || {}),
  };

  const workletUrl = chrome.runtime.getURL("__pitch_shifter_worklet.js");
  const fallbackWorkletUrl = chrome.runtime.getURL("src/js/pitch-correlator-processor.js");
  const phaseVocoderUrl = chrome.runtime.getURL("src/js/phase-vocoder-processor.js");
  const hookUrl = chrome.runtime.getURL("page-hook.js");
  const soundsBaseUrl = chrome.runtime.getURL("src/sounds/");

  window.__pitchShifterExtensionConfig = {
    workletUrl,
    fallbackWorkletUrl,
    phaseVocoderUrl,
    soundsBaseUrl,
    initialSettings: pitchSettings
  };

  // DOM fallback config
  try {
    let meta = document.getElementById("__pitchShifterCfg");
    if (!meta) {
      meta = document.createElement("meta");
      meta.id = "__pitchShifterCfg";
      (document.head || document.documentElement).appendChild(meta);
    }
    meta.dataset.workletUrl = workletUrl;
    meta.dataset.fallbackWorkletUrl = fallbackWorkletUrl;
    meta.dataset.phaseVocoderUrl = phaseVocoderUrl;
    meta.dataset.soundsBaseUrl = soundsBaseUrl;
    meta.dataset.initialSettings = JSON.stringify(pitchSettings);
  } catch (e) {
    console.log(e);
  }

  // inject page-hook.js into MAIN world
  const hookScript = document.createElement('script');

  hookScript.src =
    `${hookUrl}?workletUrl=${encodeURIComponent(workletUrl)}`;

  const injected = await new Promise(resolve => {
    hookScript.onload = () => {
      console.log('[PitchShifter] page-hook injected');
      resolve(true);
    };

    hookScript.onerror = err => {
      console.log('[PitchShifter] page-hook inject failed, fallback to background', err);

      resolve(false);
    };

    (document.documentElement || document.head)
      .appendChild(hookScript);
  });

  hookScript.remove();

  // fallback via background.js
  if (!injected) {
    try {
      await chrome.runtime.sendMessage({
        type: 'WS_INJECT_PAGE_HOOK_FALLBACK',
      });

      console.log(
        '[PitchShifter] background fallback injection requested'
      );
    } catch (err) {
      console.error(
        '[PitchShifter] background fallback failed',
        err
      );
    }
  }

  // sync settings updates
  chrome.runtime.onMessage.addListener(
    (msg, _sender, sendResponse) => {
      if (msg?.type === 'updateSettings') {
        window.postMessage({
          type: "PITCH_UPDATE",
          settings: msg.settings,
          overlayPresets: msg.overlayPresets,
          overlayConfig: msg.overlayConfig
        }, "*"),

          sendResponse({ status: 'ok' });
      }

      return true;
    }
  );

  // initial settings push
  // Решаем пресеты для первичной загрузки (чтобы оверлей работал сразу)
  let initialOverlayPresets = null;

  if (
    pitchSettings.overlayEnabled &&
    Array.isArray(pitchSettings.overlayPresets) &&
    pitchSettings.overlayPresets.length > 0
  ) {
    // Чистый базовый пресет (только те настройки, которые использует аудио-граф оверлея)
    const defaultPresetValues = {
      pitchValueSemitones: 0,
      pitchValueCents: 0,
      windowSizeMilliseconds: 120,
      applySmartProcessing: !0,
      gainOutputDb: 0,
      gainInputDb: 0,
      eqGains: Array(10).fill(50),
      reverbType: null,
      reverbWet: 0,
      centerCancel: 0,
      channelBalance: 0,
      modulationLayers: [],
      distortionLayers: [],
      distMix: 0,
      delayTime: 250,
      delayFeedback: 40,
      delayMix: 0,
      definitionMix: 0,
      stereoWidthMix: 0,
      stereoCenterMix: 0,
      stereoFocusMix: 0,
      subbassMix: 0,
      warmthMix: 0
    };

    const allPresets = {
      default: { values: defaultPresetValues },
      ...(pitchSettings.globalPresets || {})
    };

    const rawPresets = [...new Set(pitchSettings.overlayPresets)].map(id => {
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
      initialOverlayPresets = unique.slice(0, 10);
    }

  }

  window.postMessage({
    type: "PITCH_UPDATE",
    settings: pitchSettings,
    overlayPresets: initialOverlayPresets,
    overlayConfig: { MAX_OVERLAY_CHAINS: 10, MAX_SIGNALSMITH_CHAINS: 2 }
  }, "*")

  // Добавить как отдельную конструкцию верхнего уровня файла, ПОСЛЕ основной IIFE:
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "ws-eq-viz") return;
    const onWindowMessage = e => {
      if (e.source !== window) return;
      if (e.data?.type === "WS_VIZ_DATA") {
        try { port.postMessage(e.data) } catch (err) { }
      }
    };
    window.addEventListener("message", onWindowMessage);
    port.onMessage.addListener(msg => {
      if (msg?.command === "start") window.postMessage({ type: "WS_VIZ_CONTROL", command: "start" }, "*");
      else if (msg?.command === "stop") window.postMessage({ type: "WS_VIZ_CONTROL", command: "stop" }, "*");
    });
    port.onDisconnect.addListener(() => {
      window.removeEventListener("message", onWindowMessage);
      window.postMessage({ type: "WS_VIZ_CONTROL", command: "stop" }, "*");
    });
  });

})();