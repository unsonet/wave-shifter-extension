(async () => {
  // Creating a script element to embed in the page
  const hookScript = document.createElement("script");
  hookScript.src = chrome.runtime.getURL("page-hook.js");

  // We pass the URL of the worker through the window to avoid difficulties with the paths in page-hook.js
  const workletBlobUrl = chrome.runtime.getURL("__pitch_shifter_worklet.js");
  // Temporary storage for the page-hook
  window.__pitchShifterExtensionConfig = { workletUrl: workletBlobUrl };

  await new Promise(resolve => {
    hookScript.onload = resolve;
    document.documentElement.appendChild(hookScript);
  });
  
  hookScript.remove();
  delete window.__pitchShifterExtensionConfig;

  // Listening to messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "updateSettings") {
      window.postMessage({ type: "PITCH_UPDATE", settings: msg.settings }, "*");
      sendResponse({ status: "ok" });
    }
    return true;
  });

  // Sending the initial settings
  const pitchSettings = {
    pitchValueSemitones: 0,
    pitchValueCents: 0,
    windowSizeMilliseconds: 120,
    applySmartProcessing: true,
    speedUnits: 0,
    speedFine: 0,
    preservePitch: true,
    blacklistPatterns: [],
    ...(await chrome.storage.local.get("pitchSettings")).pitchSettings || {}
  };
  window.postMessage({ type: "PITCH_UPDATE", settings: pitchSettings }, "*");
})();