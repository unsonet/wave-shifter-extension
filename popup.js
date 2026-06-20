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
    toggleState: { pitchSettings: true, speedSettings: false, eqSettings: false },
    eqGains: Array(10).fill(50),
    eqPreset: 'flat'
  };

  // Элементы
  const semitonesSlider = document.getElementById("semitones");
  const centsSlider = document.getElementById("cents");
  const blockSizeSlider = document.getElementById("blockSize");
  const smartCheck = document.getElementById("smartProcessing");
  const semitonesVal = document.getElementById("semitonesVal");
  const centsVal = document.getElementById("centsVal");
  const blockSizeVal = document.getElementById("blockSizeVal");
  const speedUnitsSlider = document.getElementById("speedUnits");
  const speedFineSlider = document.getElementById("speedFine");
  const preservePitchCheck = document.getElementById("preservePitch");
  const speedUnitsVal = document.getElementById("speedUnitsVal");
  const speedFineVal = document.getElementById("speedFineVal");
  const resetBtn = document.getElementById("resetBtn");
  const eqPresetSelect = document.getElementById("eqPreset");
  const eqSvgLine = document.querySelector('.eq-svg-line');
  const eqSvgLineShadow = document.querySelector('.eq-svg-line-shadow');

  const blacklistBtn = document.getElementById("blacklistBtn");
  const blacklistModal = document.getElementById("blacklistModal");
  const blacklistModalClose = document.getElementById("blacklistModalClose");
  const blacklistModalCloseBtn = document.getElementById("blacklistModalCloseBtn");
  const blacklistInput = document.getElementById("blacklistInput");
  const blacklistAddBtn = document.getElementById("blacklistAddBtn");
  const blacklistList = document.getElementById("blacklistList");
  const siteStatus = document.getElementById("siteStatus");
  const siteStatusDot = document.getElementById("siteStatusDot");
  const siteStatusText = document.getElementById("siteStatusText");
  const pitchSettingsPanel = document.getElementById("pitchSettingsPanel");
  const speedSettingsPanel = document.getElementById("speedSettingsPanel");
  const eqSettingsPanel = document.getElementById("eqSettingsPanel");

  let saveTimeout;
  let currentSettings = await (async function loadSettings() {
    const result = await chrome.storage.local.get("pitchSettings");
    return {
      ...DEFAULT_SETTINGS,
      ...(result.pitchSettings || {}),
      eqGains: result.pitchSettings?.eqGains || DEFAULT_SETTINGS.eqGains
    };
  })();

  // --- МАГИЯ ПОЗИЦИОНИРОВАНИЯ СЛАЙДЕРОВ ---
  function syncVisualSlider(inputEl) {
    const min = parseFloat(inputEl.min);
    const max = parseFloat(inputEl.max);
    const val = parseFloat(inputEl.value);

    // Выдаем чистое число от 0 до 1 (например, 0.5 вместо 50%)
    const pct = (val - min) / (max - min);

    inputEl.parentElement.style.setProperty('--pct', pct);
  }

  function calcSpeedPercentage(units, fine) {
    return (units < 0 ? 100 + 1 * units : 100 + 5 * units) + fine;
  }

  function scheduleApply() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => { await applySettings(); }, 100);
  }

  function updateUI() {
    // Старые значения
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
    speedUnitsVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, 0) + "%";
    speedFineVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, currentSettings.speedFine) + "%";

    pitchSettingsPanel.open = currentSettings.toggleState?.pitchSettings ?? true;
    speedSettingsPanel.open = currentSettings.toggleState?.speedSettings ?? false;
    eqSettingsPanel.open = currentSettings.toggleState?.eqSettings ?? false;

    eqPresetSelect.value = currentSettings.eqPreset || 'flat';

    // ВАЖНО: Сначала возвращаем реальные значения из памяти в инпуты эквалайзера!
    const eqInputs = document.querySelectorAll('.range-slider[style*="vertical"] input');
    eqInputs.forEach((input, i) => {
      input.value = currentSettings.eqGains[i] !== undefined ? currentSettings.eqGains[i] : 50;
    });

    // Только потом натягиваем визуальные div-ы на эти значения
    document.querySelectorAll('.range-slider input').forEach(syncVisualSlider);

    // И рисуем линию
    updateEqualizerGraph();
  }

  // --- ЭКВАЛАЙЗЕР ГРАФИК ---
  const EQ_PRESETS = {
    flat: Array(10).fill(50),
    rock: [60, 55, 40, 30, 50, 65, 70, 65, 60, 55],
    pop: [45, 50, 65, 70, 60, 45, 40, 45, 50, 50],
    classical: [50, 50, 50, 50, 50, 40, 45, 50, 55, 55],
    bass: [80, 75, 65, 55, 50, 50, 50, 50, 50, 50]
  };

  function updateEqualizerGraph() {
    const gains = currentSettings.eqGains;
    const points = gains.map((val, i) => {
      // Добавляем отступы (по 4.5% с каждой стороны), чтобы линия 
      // начиналась ровно под первым thumb и заканчивалась под последним,
      // а не уходила в пустые углы контейнера.
      const padding = 4.5;
      const range = 100 - (padding * 2);
      const x = padding + (i / (gains.length - 1)) * range;

      // Y инвертируем (100 - val), т.к. в SVG 0 сверху
      const y = 100 - val;
      return { x, y };
    });

    if (points.length < 2) return;

    let d = `M ${points[0].x},${points[0].y}`;

    // Рисуем гладкую кривую (Catmull-Rom to Bezier)
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? i : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 === points.length ? i + 1 : i + 2];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }

    // Применяем к самой линии и к её тени
    eqSvgLine.setAttribute('d', d);
    eqSvgLineShadow.setAttribute('d', d);
  }

  // --- ЛОГИКА СОХРАНЕНИЯ ---
  async function applySettings() {
    await chrome.storage.local.set({ pitchSettings: currentSettings });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "updateSettings", settings: currentSettings });
    await refreshSiteStatus();
  }

  async function refreshSiteStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let statusText = function matchURLPatterns(url, urlPatterns) {
      const patterns = typeof urlPatterns === "string" ? [urlPatterns] : Array.isArray(urlPatterns) ? urlPatterns : [];
      const target = String(url || "");
      return patterns.some(pattern => {
        const np = pattern.trim(); if (!np) return false;
        if (np.includes("*")) return new RegExp("^" + np.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$").test(target);
        return target === np;
      });
    }(tab?.url || "", currentSettings.blacklistPatterns || []) ? "inactive" : "active";

    siteStatusDot.classList.remove("active", "inactive");
    siteStatusDot.classList.add(statusText);
    siteStatusText.textContent = statusText;
    siteStatus.title = statusText;
  }

  async function saveToggleState() {
    currentSettings.toggleState = {
      pitchSettings: pitchSettingsPanel.open,
      speedSettings: speedSettingsPanel.open,
      eqSettings: eqSettingsPanel.open
    };
    await chrome.storage.local.set({ pitchSettings: currentSettings });
  }

  // --- ОБРАБОТЧИКИ СОБЫТИЙ ---

  // Универсальный обработчик для всех слайдеров (и горизонтальных, и вертикальных)
  document.querySelectorAll('.range-slider input').forEach(input => {
    input.addEventListener('input', (e) => {
      syncVisualSlider(e.target); // Синхронизируем overlay div-ы в реальном времени

      const id = e.target.id;
      const val = parseFloat(e.target.value);

      if (id === 'semitones') { currentSettings.pitchValueSemitones = val; semitonesVal.textContent = val; }
      if (id === 'cents') { currentSettings.pitchValueCents = val; centsVal.textContent = val; }
      if (id === 'blockSize') { currentSettings.windowSizeMilliseconds = val; blockSizeVal.textContent = val; }
      if (id === 'speedUnits') { currentSettings.speedUnits = val; speedUnitsVal.textContent = calcSpeedPercentage(val, 0) + "%"; }
      if (id === 'speedFine') { currentSettings.speedFine = val; speedFineVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, val) + "%"; }

      // Если это EQ слайдер
      if (e.target.orient === 'vertical' || e.target.getAttribute('orient') === 'vertical') {
        const eqSliders = Array.from(document.querySelectorAll('.range-slider[style*="vertical"] input'));
        const index = eqSliders.indexOf(e.target);
        if (index !== -1) {
          currentSettings.eqGains[index] = val;
          currentSettings.eqPreset = 'custom';
          eqPresetSelect.value = 'custom';
          updateEqualizerGraph();
        }
      }
      scheduleApply();
    });
  });

  smartCheck.addEventListener("change", e => { currentSettings.applySmartProcessing = e.target.checked; scheduleApply(); });
  preservePitchCheck.addEventListener("change", e => { currentSettings.preservePitch = e.target.checked; scheduleApply(); });

  eqPresetSelect.addEventListener('change', (e) => {
    currentSettings.eqPreset = e.target.value;
    currentSettings.eqGains = [...(EQ_PRESETS[e.target.value] || EQ_PRESETS.flat)];

    // Обновляем инпуты эквалайзера и их визуал
    const eqInputs = document.querySelectorAll('.range-slider[style*="vertical"] input');
    eqInputs.forEach((input, i) => {
      input.value = currentSettings.eqGains[i];
      syncVisualSlider(input);
    });
    updateEqualizerGraph();
    scheduleApply();
  });

  resetBtn.addEventListener("click", async () => {
    currentSettings = { 
      ...DEFAULT_SETTINGS, 
      blacklistPatterns: currentSettings.blacklistPatterns || [],
      toggleState: currentSettings.toggleState || DEFAULT_SETTINGS.toggleState,
     };
    updateUI();
    renderBlacklistList();
    await applySettings();
  });

  // --- БЛЕКЛИСТ (без изменений) ---
  function closeBlacklistModal() { blacklistBtn.focus(); blacklistModal.classList.remove("open"); blacklistModal.setAttribute("aria-hidden", "true"); }
  function renderBlacklistList() {
    const patterns = Array.isArray(currentSettings.blacklistPatterns) ? currentSettings.blacklistPatterns : [];
    blacklistList.innerHTML = "";
    if (!patterns.length) { const e = document.createElement("div"); e.style.cssText = "opacity:0.7;font-size:13px"; e.textContent = "Blacklist is empty"; return void blacklistList.appendChild(e); }
    patterns.forEach((p, i) => { const r = document.createElement("div"); r.className = "blacklist-item"; r.dataset.index = String(i); const inp = document.createElement("input"); inp.type = "text"; inp.value = p; inp.spellcheck = false; inp.className = "blacklist-item-input"; const d = document.createElement("button"); d.type = "button"; d.textContent = "Delete"; d.className = "blacklist-item-delete btn-vk"; r.appendChild(inp); r.appendChild(d); blacklistList.appendChild(r); });
  }
  async function addBlacklistPattern() {
    const p = blacklistInput.value.trim(); if (!p) return;
    const arr = Array.isArray(currentSettings.blacklistPatterns) ? [...currentSettings.blacklistPatterns] : [];
    if (!arr.includes(p)) { arr.push(p); currentSettings.blacklistPatterns = arr; await applySettings(); }
    blacklistInput.value = ""; renderBlacklistList();
  }
  blacklistBtn.addEventListener("click", () => { renderBlacklistList(); blacklistModal.classList.add("open"); blacklistModal.setAttribute("aria-hidden", "false"); blacklistInput.focus(); });
  blacklistModalClose.addEventListener("click", closeBlacklistModal);
  blacklistModalCloseBtn.addEventListener("click", closeBlacklistModal);
  blacklistAddBtn.addEventListener("click", addBlacklistPattern);
  blacklistInput.addEventListener("keydown", async e => { if (e.key === "Enter") { e.preventDefault(); await addBlacklistPattern(); } if (e.key === "Escape") closeBlacklistModal(); });
  blacklistList.addEventListener("input", async e => {
    const inp = e.target.closest(".blacklist-item-input"); if (!inp) return;
    const row = inp.closest(".blacklist-item"), idx = Number(row?.dataset.index); if (!Number.isFinite(idx)) return;
    const arr = [...(currentSettings.blacklistPatterns || [])]; arr[idx] = inp.value.trim();
    currentSettings.blacklistPatterns = arr.filter(Boolean); await applySettings();
  });
  blacklistList.addEventListener("click", async e => {
    const btn = e.target.closest(".blacklist-item-delete"); if (!btn) return;
    const row = btn.closest(".blacklist-item"), idx = Number(row?.dataset.index); if (!Number.isFinite(idx)) return;
    const arr = [...(currentSettings.blacklistPatterns || [])]; arr.splice(idx, 1);
    currentSettings.blacklistPatterns = arr; await applySettings(); renderBlacklistList();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && blacklistModal.classList.contains("open")) closeBlacklistModal(); });
  blacklistModal.addEventListener("click", e => { if (e.target === blacklistModal) closeBlacklistModal(); });

  [pitchSettingsPanel, speedSettingsPanel, eqSettingsPanel].forEach(p => p.addEventListener("toggle", saveToggleState));

  // --- ИНИЦИАЛИЗАЦИЯ ---
  updateUI();
  renderBlacklistList();
  await refreshSiteStatus();
})();