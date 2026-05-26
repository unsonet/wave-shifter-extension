

(async () => {
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

    const { pitchSettings } = await chrome.storage.local.get('pitchSettings');

    if (pitchSettings) {
        window.postMessage(
            {
                type: 'PITCH_UPDATE',
                settings: pitchSettings
            },
            '*'
        );
    }
})();