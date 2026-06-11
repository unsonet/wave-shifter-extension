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
  const blacklistBtn = document.getElementById('blacklistBtn');

  const blacklistModal = document.getElementById('blacklistModal');
  const blacklistModalClose = document.getElementById('blacklistModalClose');
  const blacklistModalCloseBtn = document.getElementById('blacklistModalCloseBtn');
  const blacklistInput = document.getElementById('blacklistInput');
  const blacklistAddBtn = document.getElementById('blacklistAddBtn');
  const blacklistList = document.getElementById('blacklistList');

  const siteStatusDot = document.getElementById('siteStatusDot');
  const siteStatusText = document.getElementById('siteStatusText');

  let currentSettings = await loadSettings();

  function normalizePattern(value) {
    return String(value ?? '').trim();
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchURLPatterns(url, urlPatterns) {
    const patterns = typeof urlPatterns === 'string'
      ? [urlPatterns]
      : Array.isArray(urlPatterns)
        ? urlPatterns
        : [];

    const target = String(url || '');

    return patterns.some((pattern) => {
      const normalizedPattern = normalizePattern(pattern);
      if (!normalizedPattern) return false;

      // wildcard mode
      if (normalizedPattern.includes('*')) {
        const regex = new RegExp(
          '^' + escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*') + '$'
        );
        return regex.test(target);
      }

      // exact mode (root page style)
      return target === normalizedPattern;
    });
  }

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
    await refreshSiteStatus();
  }

  function openBlacklistModal() {
    renderBlacklistList();
    blacklistModal.classList.add('open');
    blacklistModal.setAttribute('aria-hidden', 'false');
    blacklistInput.focus();
  }

  function closeBlacklistModal() {
    blacklistModal.classList.remove('open');
    blacklistModal.setAttribute('aria-hidden', 'true');
  }

  function renderBlacklistList() {
    const patterns = Array.isArray(currentSettings.blacklistPatterns)
      ? currentSettings.blacklistPatterns
      : [];

    blacklistList.innerHTML = '';

    if (!patterns.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '0.7';
      empty.style.fontSize = '13px';
      empty.textContent = 'Blacklist is empty';
      blacklistList.appendChild(empty);
      return;
    }

    patterns.forEach((pattern, index) => {
      const row = document.createElement('div');
      row.className = 'blacklist-item';
      row.dataset.index = String(index);

      const input = document.createElement('input');
      input.type = 'text';
      input.value = pattern;
      input.spellcheck = false;
      input.className = 'blacklist-item-input';
      input.title = pattern;

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.className = 'blacklist-item-delete';

      row.appendChild(input);
      row.appendChild(del);
      blacklistList.appendChild(row);
    });
  }

  async function addBlacklistPattern() {
    const pattern = normalizePattern(blacklistInput.value);
    if (!pattern) return;

    const patterns = Array.isArray(currentSettings.blacklistPatterns)
      ? [...currentSettings.blacklistPatterns]
      : [];

    if (!patterns.includes(pattern)) {
      patterns.push(pattern);
      currentSettings.blacklistPatterns = patterns;
      await applySettings();
    }

    blacklistInput.value = '';
    renderBlacklistList();
  }

  async function refreshSiteStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';

    const blacklisted = matchURLPatterns(url, currentSettings.blacklistPatterns || []);

    siteStatusDot.classList.remove('active', 'inactive');
    siteStatusDot.classList.add(blacklisted ? 'inactive' : 'active');
    siteStatusText.textContent = blacklisted ? 'inactive' : 'active';
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
    currentSettings = {
      ...DEFAULT_SETTINGS,
      blacklistPatterns: currentSettings.blacklistPatterns || []
    };
    updateUI();
    renderBlacklistList();
    await applySettings();
  });

  blacklistBtn.addEventListener('click', openBlacklistModal);
  blacklistModalClose.addEventListener('click', closeBlacklistModal);
  blacklistModalCloseBtn.addEventListener('click', closeBlacklistModal);

  blacklistAddBtn.addEventListener('click', addBlacklistPattern);

  blacklistInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await addBlacklistPattern();
    }
    if (e.key === 'Escape') {
      closeBlacklistModal();
    }
  });

  blacklistList.addEventListener('input', async (e) => {
    const input = e.target.closest('.blacklist-item-input');
    if (!input) return;

    const row = input.closest('.blacklist-item');
    const index = Number(row?.dataset.index);
    if (!Number.isFinite(index)) return;

    const patterns = Array.isArray(currentSettings.blacklistPatterns)
      ? [...currentSettings.blacklistPatterns]
      : [];

    patterns[index] = normalizePattern(input.value);
    currentSettings.blacklistPatterns = patterns.filter(Boolean);
    await applySettings();
  });

  blacklistList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.blacklist-item-delete');
    if (!btn) return;

    const row = btn.closest('.blacklist-item');
    const index = Number(row?.dataset.index);
    if (!Number.isFinite(index)) return;

    const patterns = Array.isArray(currentSettings.blacklistPatterns)
      ? [...currentSettings.blacklistPatterns]
      : [];

    patterns.splice(index, 1);
    currentSettings.blacklistPatterns = patterns;
    await applySettings();
    renderBlacklistList();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && blacklistModal.classList.contains('open')) {
      closeBlacklistModal();
    }
  });

  blacklistModal.addEventListener('click', (e) => {
    if (e.target === blacklistModal) {
      closeBlacklistModal();
    }
  });

  updateUI();
  renderBlacklistList();
  await refreshSiteStatus();
})();