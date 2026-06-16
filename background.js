chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'WS_INJECT_PAGE_HOOK_FALLBACK') return;

  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') {
    sendResponse({ ok: false, error: 'No tabId' });
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId, allFrames: true },
      files: ['page-hook.js'],
      world: 'MAIN',
    },
    () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true });
      }
    }
  );

  return true;
});