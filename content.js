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
  const hookUrl = chrome.runtime.getURL("page-hook.js");
  const soundsBaseUrl = chrome.runtime.getURL("src/sounds/");

  window.__pitchShifterExtensionConfig = {
    workletUrl,
    fallbackWorkletUrl,
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
  if (pitchSettings.overlayEnabled && Array.isArray(pitchSettings.overlayPresets) && pitchSettings.overlayPresets.length > 0) {
    const defaultPresetValues = { ...pitchSettings };
    delete defaultPresetValues.blacklistPatterns; delete defaultPresetValues.toggleState;
    delete defaultPresetValues.eqPresets; delete defaultPresetValues.globalPresets;
    delete defaultPresetValues.overlayPresets; delete defaultPresetValues.overlayEnabled;
    delete defaultPresetValues.optimisationDelay;

    const allPresets = { default: { values: defaultPresetValues }, ...(pitchSettings.globalPresets || {}) };
    const uniqueIds = [...new Set(pitchSettings.overlayPresets)];
    const rawPresets = uniqueIds.map(id => {
      const pValues = allPresets[id]?.values || {};
      return { id, values: { ...defaultPresetValues, ...pValues } };
    });
    const seen = new Set();
    const unique = rawPresets.filter(p => {
      const hash = JSON.stringify(p.values);
      if (seen.has(hash)) return false;
      seen.add(hash); return true;
    });
    if (unique.length > 0) initialOverlayPresets = unique.slice(0, 10);
  }

  window.postMessage({
    type: "PITCH_UPDATE",
    settings: pitchSettings,
    overlayPresets: initialOverlayPresets,
    overlayConfig: { MAX_OVERLAY_CHAINS: 10, MAX_SIGNALSMITH_CHAINS: 2 }
  }, "*")
})();