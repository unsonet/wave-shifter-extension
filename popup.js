(async () => {
  const DEFAULT_SETTINGS = {
    pitchValueSemitones: 0,
    pitchValueCents: 0,
    windowSizeMilliseconds: 120,
    applySmartProcessing: true,
    speedUnits: 0,
    speedFine: 0,
    preservePitch: true
  };

  async function sendSettings(settings) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'updateSettings', settings });
    }
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ pitchSettings: settings });
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get('pitchSettings');
    return {
      ...DEFAULT_SETTINGS,
      ...(result.pitchSettings || {})
    };
  }

  const semitonesSlider = document.getElementById('semitones');
  const centsSlider = document.getElementById('cents');
  const blockSizeSlider = document.getElementById('blockSize');
  const smartCheck = document.getElementById('smartProcessing');
  const semitonesVal = document.getElementById('semitonesVal');
  const centsVal = document.getElementById('centsVal');
  const blockSizeVal = document.getElementById('blockSizeVal');

  const speedUnitsSlider = document.getElementById('speedUnits');
  const speedFineSlider = document.getElementById('speedFine');
  const preservePitchCheck = document.getElementById('preservePitch');
  const speedUnitsVal = document.getElementById('speedUnitsVal');
  const speedFineVal = document.getElementById('speedFineVal');

  const resetBtn = document.getElementById('resetBtn');

  let currentSettings = await loadSettings();

  function calcSpeedPercentage(units, fine) {
    const base = units < 0 ? 100 + 1 * units : 100 + 5 * units;
    return base + fine;
  }

  function updateUI() {
    semitonesSlider.value = currentSettings.pitchValueSemitones;
    centsSlider.value = currentSettings.pitchValueCents;
    blockSizeSlider.value = currentSettings.windowSizeMilliseconds;
    smartCheck.checked = currentSettings.applySmartProcessing;
    semitonesVal.textContent = currentSettings.pitchValueSemitones;
    centsVal.textContent = currentSettings.pitchValueCents;
    blockSizeVal.textContent = currentSettings.windowSizeMilliseconds;

    speedUnitsSlider.value = currentSettings.speedUnits;
    speedFineSlider.value = currentSettings.speedFine;
    preservePitchCheck.checked = currentSettings.preservePitch;

    speedUnitsVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, 0) + '%';
    speedFineVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, currentSettings.speedFine) + '%';
  }

  async function applySettings() {
    await saveSettings(currentSettings);
    await sendSettings(currentSettings);
  }

  semitonesSlider.addEventListener('input', async (e) => {
    currentSettings.pitchValueSemitones = parseInt(e.target.value, 10);
    semitonesVal.textContent = currentSettings.pitchValueSemitones;
    await applySettings();
  });

  centsSlider.addEventListener('input', async (e) => {
    currentSettings.pitchValueCents = parseInt(e.target.value, 10);
    centsVal.textContent = currentSettings.pitchValueCents;
    await applySettings();
  });

  blockSizeSlider.addEventListener('input', async (e) => {
    currentSettings.windowSizeMilliseconds = parseInt(e.target.value, 10);
    blockSizeVal.textContent = currentSettings.windowSizeMilliseconds;
    await applySettings();
  });

  smartCheck.addEventListener('change', async (e) => {
    currentSettings.applySmartProcessing = e.target.checked;
    await applySettings();
  });

  speedUnitsSlider.addEventListener('input', async (e) => {
    currentSettings.speedUnits = parseInt(e.target.value, 10);
    updateUI();
    await applySettings();
  });

  speedFineSlider.addEventListener('input', async (e) => {
    currentSettings.speedFine = parseInt(e.target.value, 10);
    updateUI();
    await applySettings();
  });

  preservePitchCheck.addEventListener('change', async (e) => {
    currentSettings.preservePitch = e.target.checked;
    await applySettings();
  });

  resetBtn.addEventListener('click', async () => {
    currentSettings = { ...DEFAULT_SETTINGS };
    updateUI();
    await applySettings();
  });

  updateUI();
})();