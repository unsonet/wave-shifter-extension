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
  };

  const stored = await chrome.storage.local.get('pitchSettings');

  const pitchSettings = {
    ...DEFAULT_SETTINGS,
    ...(stored.pitchSettings || {}),
  };

  const workletUrl = chrome.runtime.getURL('__pitch_shifter_worklet.js');
  const hookUrl = chrome.runtime.getURL('page-hook.js');

  // shared config for MAIN world
  window.__pitchShifterExtensionConfig = {
    workletUrl,
    initialSettings: pitchSettings,
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
        window.postMessage(
          {
            type: 'PITCH_UPDATE',
            settings: msg.settings,
          },
          '*'
        );

        sendResponse({ status: 'ok' });
      }

      return true;
    }
  );

  // initial settings push
  window.postMessage(
    {
      type: 'PITCH_UPDATE',
      settings: pitchSettings,
    },
    '*'
  );
})();