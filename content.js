(async () => {
  const DEFAULT_SETTINGS = {
    pitchValueSemitones: 0,
    pitchValueCents: 0,
    windowSizeMilliseconds: 120,
    applySmartProcessing: true,
    speedUnits: 0,
    speedFine: 0,
    preservePitch: true,
    blacklistPatterns: []
  };

  const hookScript = document.createElement('script');
  hookScript.src = chrome.runtime.getURL('page-hook.js');

  await new Promise(resolve => {
    hookScript.onload = resolve;
    document.documentElement.appendChild(hookScript);
  });

  hookScript.remove();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'updateSettings') {
      window.postMessage({ type: 'PITCH_UPDATE', settings: msg.settings }, '*');
      sendResponse({ status: 'ok' });
    }
    return true;
  });

  const result = await chrome.storage.local.get('pitchSettings');
  const pitchSettings = {
    ...DEFAULT_SETTINGS,
    ...(result.pitchSettings || {})
  };

  window.postMessage(
    {
      type: 'PITCH_UPDATE',
      settings: pitchSettings
    },
    '*'
  );
})();