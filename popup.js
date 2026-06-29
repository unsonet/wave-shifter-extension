const simpleModal = globalThis['simpleModal'];
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
        volumeBoostDb: 0,
        toggleState: {
            volumeBoost: false,
            pitchSettings: true,
            speedSettings: true,
            eqSettings: false,
            spatialSettings: false,
            dynamicsSettings: false,
            surroundSettings: false
        },
        eqGains: Array(10).fill(50),
        eqPreset: "flat",
        reverbType: null,
        reverbWet: 0,
        stereoWiden: 0,
        channelBalance: 0,

        compressorThreshold: -24,
        compressorKnee: 30,
        compressorRatio: 12,
        compressorAttack: 3,
        compressorRelease: 250,
        dolbyEnabled: false,

    };

    const SECTION_DEFAULTS = {
        '#volumeBoostPanel': { volumeBoostDb: DEFAULT_SETTINGS.volumeBoostDb },
        '#pitchSettingsPanel': {
            pitchValueSemitones: DEFAULT_SETTINGS.pitchValueSemitones,
            pitchValueCents: DEFAULT_SETTINGS.pitchValueCents,
            windowSizeMilliseconds: DEFAULT_SETTINGS.windowSizeMilliseconds,
            applySmartProcessing: DEFAULT_SETTINGS.applySmartProcessing
        },
        '#speedSettingsPanel': {
            speedUnits: DEFAULT_SETTINGS.speedUnits,
            speedFine: DEFAULT_SETTINGS.speedFine,
            preservePitch: DEFAULT_SETTINGS.preservePitch
        },
        '#eqSettingsPanel': {
            eqGains: [...DEFAULT_SETTINGS.eqGains],
            eqPreset: DEFAULT_SETTINGS.eqPreset
        },
        "#spatialSettingsPanel": {
            reverbType: DEFAULT_SETTINGS.reverbType,
            reverbWet: DEFAULT_SETTINGS.reverbWet,
            stereoWiden: DEFAULT_SETTINGS.stereoWiden,
            channelBalance: DEFAULT_SETTINGS.channelBalance
        },
        "#dynamicsPanel": {
            compressorThreshold: -24,
            compressorKnee: 30,
            compressorRatio: 12,
            compressorAttack: 3,
            compressorRelease: 250
        },
        "#surroundPanel": {
            dolbyEnabled: false
        }
    };

    const BUILT_IN_EQ_PRESETS = {
        flat: { name: "Flat", genres: [], values: Array(10).fill(50) },
        rock: { name: "Rock", genres: ["rock"], values: [60, 55, 40, 30, 50, 65, 70, 65, 60, 55] },
        pop: { name: "Pop", genres: ["pop"], values: [45, 50, 65, 70, 60, 45, 40, 45, 50, 50] },
        classical: { name: "Classical", genres: ["classical"], values: [50, 50, 50, 50, 50, 40, 45, 50, 55, 55] },
        bass: { name: "Bass Boost", genres: ["bass", "hip-hop"], values: [80, 75, 65, 55, 50, 50, 50, 50, 50, 50] }
    };

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
    const eqSvgLine = document.querySelector(".eq-svg-line");
    const eqSvgLineShadow = document.querySelector(".eq-svg-line-shadow");
    const blacklistBtn = document.getElementById("blacklistBtn");
    const blacklistInput = document.getElementById("blacklistInput");
    const blacklistAddBtn = document.getElementById("blacklistAddBtn");
    const blacklistList = document.getElementById("blacklistList");
    const siteStatus = document.getElementById("siteStatus");
    const siteStatusDot = document.getElementById("siteStatusDot");
    const siteStatusText = document.getElementById("siteStatusText");
    const pitchSettingsPanel = document.getElementById("pitchSettingsPanel");
    const speedSettingsPanel = document.getElementById("speedSettingsPanel");
    const eqSettingsPanel = document.getElementById("eqSettingsPanel");
    const volumeBoostSlider = document.getElementById("volumeBoostDb");
    const volumeBoostVal = document.getElementById("volumeBoostVal");
    const volumeBoostPanel = document.getElementById("volumeBoostPanel");
    const eqPresetManageBtn = document.getElementById("eqPresetManageBtn");

    const eqPresetNameInput = document.getElementById("eqPresetNameInput");
    const eqPresetGenresInput = document.getElementById("eqPresetGenresInput");
    const eqPresetAddBtn = document.getElementById("eqPresetAddBtn");
    const eqPresetList = document.getElementById("eqPresetList");
    const optimisationDelayCheck = document.getElementById("optimisationDelay");
    const spatialSettingsPanel = document.getElementById("spatialSettingsPanel"),
        reverbPresetSelect = document.getElementById("reverbPreset"),
        reverbWetSlider = document.getElementById("reverbWet"),
        reverbWetVal = document.getElementById("reverbWetVal"),
        stereoWidenSlider = document.getElementById("stereoWiden"),
        stereoWidenVal = document.getElementById("stereoWidenVal"),
        channelBalanceSlider = document.getElementById("channelBalance"),
        channelBalanceVal = document.getElementById("channelBalanceVal");
    const dynamicsPanel = document.getElementById("dynamicsPanel"),
        surroundPanel = document.getElementById("surroundPanel"),

        compressorThresholdSlider = document.getElementById("compressorThreshold"),
        compressorThresholdVal = document.getElementById("compressorThresholdVal"),
        compressorKneeSlider = document.getElementById("compressorKnee"),
        compressorKneeVal = document.getElementById("compressorKneeVal"),
        compressorRatioSlider = document.getElementById("compressorRatio"),
        compressorRatioVal = document.getElementById("compressorRatioVal"),
        compressorAttackSlider = document.getElementById("compressorAttack"),
        compressorAttackVal = document.getElementById("compressorAttackVal"),
        compressorReleaseSlider = document.getElementById("compressorRelease"),
        compressorReleaseVal = document.getElementById("compressorReleaseVal"),
        dolbyEnabledCheck = document.getElementById("dolbyEnabled")


    let currentSettings = await (async function loadSettings() {
        const result = await chrome.storage.local.get("pitchSettings");
        let defaultSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        const saved = result.pitchSettings || {};

        return {
            ...defaultSettings,
            ...saved,
            eqGains: saved.eqGains || defaultSettings.eqGains,
            blacklistPatterns: saved.blacklistPatterns || defaultSettings.blacklistPatterns,
            eqPresets: saved.eqPresets || {}
        };
    })();

    function syncVisualSlider(inputEl) {
        const min = parseFloat(inputEl.min), max = parseFloat(inputEl.max);
        const pct = (parseFloat(inputEl.value) - min) / (max - min);
        inputEl.parentElement.style.setProperty("--pct", pct);
    }

    function calcSpeedPercentage(units, fine) {
        return (units < 0 ? 100 + 1 * units : 100 + 5 * units) + fine;
    }

    let applyTimeout = null;

    async function scheduleApply() {
        if (currentSettings.optimisationDelay) {
            // Режим жесткой оптимизации: ждем 150мс после остановки ползунка
            if (applyTimeout) clearTimeout(applyTimeout);
            applyTimeout = setTimeout(async () => { applyTimeout = null; await applySettings(); }, 150);
        } else {
            // ИДЕАЛЬНО ПЛАВНЫЙ РЕЖИМ: Троттлинг 16мс (ровно 60 FPS)
            // Это позволяет ползунку двигаться без рывков, но не спамит браузер миллионами сообщений
            if (applyTimeout) return;
            applyTimeout = setTimeout(async () => {
                applyTimeout = null;
                await applySettings();
            }, 16);
        }
    }

    function getAllEqPresets() { return { ...BUILT_IN_EQ_PRESETS, ...(currentSettings.eqPresets || {}) }; }
    function isBuiltInEqPreset(id) { return !!BUILT_IN_EQ_PRESETS[id]; }

    function updateSectionResetIcons() {
        document.querySelectorAll('.reset-icon').forEach(icon => {
            const sectionId = icon.dataset.section;
            const defaults = SECTION_DEFAULTS[sectionId];
            if (!defaults) return;

            let isModified = false;
            for (const key in defaults) {
                const defVal = defaults[key];
                const curVal = currentSettings[key];
                if (Array.isArray(defVal)) {
                    if (JSON.stringify(defVal) !== JSON.stringify(curVal)) { isModified = true; break; }
                } else {
                    if (defVal !== curVal) { isModified = true; break; }
                }
            }

            if (isModified) {
                icon.classList.add("visible");
            } else {
                icon.classList.remove("visible");
            }
        });
    }

    document.addEventListener('click', (e) => {
        const resetIcon = e.target.closest('.reset-icon');
        if (!resetIcon) return;

        e.stopPropagation();
        e.preventDefault();

        const sectionId = resetIcon.dataset.section;
        const defaults = SECTION_DEFAULTS[sectionId];
        if (!defaults) return;

        for (const key in defaults) {
            currentSettings[key] = Array.isArray(defaults[key]) ? [...defaults[key]] : defaults[key];
        }

        updateUI();
        scheduleApply();
    });

    function updateEqPresetSelectUI() {
        const select = eqPresetSelect, all = getAllEqPresets();
        select.innerHTML = "";
        for (const [id, preset] of Object.entries(all)) {
            if (id === "custom" && currentSettings.eqPreset !== "custom") continue;
            const opt = document.createElement("option");
            opt.value = id; opt.textContent = preset.name;
            if (id === currentSettings.eqPreset) opt.selected = true;
            select.appendChild(opt);
        }
    }

    function applyEqPresetToUI(presetId) {
        const preset = getAllEqPresets()[presetId];
        if (preset) {
            currentSettings.eqPreset = presetId;
            currentSettings.eqGains = [...preset.values];
            document.querySelectorAll('.range-slider[style*="vertical"] input').forEach((input, i) => {
                input.value = currentSettings.eqGains[i];
                syncVisualSlider(input);
            });
            updateEqualizerGraph();
            updateEqPresetSelectUI();
        }
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
        speedUnitsVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, 0) + "%";
        speedFineVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, currentSettings.speedFine) + "%";

        pitchSettingsPanel.open = currentSettings.toggleState?.pitchSettings ?? true;
        speedSettingsPanel.open = currentSettings.toggleState?.speedSettings ?? false;
        eqSettingsPanel.open = currentSettings.toggleState?.eqSettings ?? false;
        volumeBoostPanel.open = currentSettings.toggleState?.volumeBoost ?? true;

        eqPresetSelect.value = currentSettings.eqPreset || "flat";
        volumeBoostSlider.value = currentSettings.volumeBoostDb;
        volumeBoostVal.textContent = formatDb(currentSettings.volumeBoostDb);

        spatialSettingsPanel.open = currentSettings.toggleState?.spatialSettings ?? !1,
            reverbPresetSelect.value = currentSettings.reverbType || "null",
            reverbWetSlider.value = currentSettings.reverbWet,
            reverbWetVal.textContent = currentSettings.reverbWet + "%",
            stereoWidenSlider.value = currentSettings.stereoWiden,
            stereoWidenVal.textContent = currentSettings.stereoWiden,
            channelBalanceSlider.value = currentSettings.channelBalance,
            channelBalanceVal.textContent = currentSettings.channelBalance,

            dynamicsPanel.open = currentSettings.toggleState?.dynamicsSettings ?? !1,
            surroundPanel.open = currentSettings.toggleState?.surroundSettings ?? !1,

            compressorThresholdSlider.value = currentSettings.compressorThreshold,
            compressorThresholdVal.textContent = currentSettings.compressorThreshold + " dB",
            compressorKneeSlider.value = currentSettings.compressorKnee,
            compressorKneeVal.textContent = currentSettings.compressorKnee + " dB",
            compressorRatioSlider.value = currentSettings.compressorRatio,
            compressorRatioVal.textContent = currentSettings.compressorRatio + ":1",
            compressorAttackSlider.value = currentSettings.compressorAttack,
            compressorAttackVal.textContent = currentSettings.compressorAttack + " ms",
            compressorReleaseSlider.value = currentSettings.compressorRelease,
            compressorReleaseVal.textContent = currentSettings.compressorRelease + " ms",
            dolbyEnabledCheck.checked = currentSettings.dolbyEnabled,

            optimisationDelayCheck.checked = currentSettings.optimisationDelay || false;

        document.querySelectorAll('.range-slider[style*="vertical"] input').forEach((input, i) => {
            const targetVal = currentSettings.eqGains[i] !== undefined ? currentSettings.eqGains[i] : 50;
            if (input.value !== String(targetVal)) {
                input.value = input.min; input.offsetWidth;
            }
            input.value = targetVal;
            syncVisualSlider(input);
        });

        document.querySelectorAll(".range-slider input").forEach(syncVisualSlider);
        updateEqualizerGraph();
        updateEqPresetSelectUI();
        updateSectionResetIcons();
    }

    function formatDb(val) { return val > 0 ? `+${val} dB` : `${val} dB`; }

    function updateEqualizerGraph() {
        const gains = currentSettings.eqGains;
        const points = gains.map((val, i) => ({ x: 4.5 + i / (gains.length - 1) * 91, y: 100 - val }));
        if (points.length < 2) return;
        let d = `M ${points[0].x},${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[0 === i ? i : i - 1], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2 === points.length ? i + 1 : i + 2];
            d += ` C ${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
        }
        eqSvgLine.setAttribute("d", d);
        eqSvgLineShadow.setAttribute("d", d);
    }

    async function applySettings() {
        await chrome.storage.local.set({ pitchSettings: currentSettings });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            try { await chrome.tabs.sendMessage(tab.id, { type: "updateSettings", settings: currentSettings }); } catch (e) { }
        }
        await refreshSiteStatus();
    }

    async function refreshSiteStatus() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let statusText = function matchURLPatterns(url, urlPatterns) {
            const patterns = Array.isArray(urlPatterns) ? urlPatterns : [];
            return patterns.some(pattern => {
                const np = pattern.trim();
                if (!np) return false;
                const escaped = np.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
                return String(url || "").match(new RegExp("^" + escaped + "$"));
            });
        }(tab?.url || "", currentSettings.blacklistPatterns || []) ? "inactive" : "active";

        siteStatusDot.classList.remove("active", "inactive");
        siteStatusDot.classList.add(statusText);
        siteStatusText.textContent = statusText;
        siteStatus.title = statusText;
    }

    async function saveToggleState() {
        currentSettings.toggleState = {
            volumeBoost: volumeBoostPanel.open,
            pitchSettings: pitchSettingsPanel.open,
            speedSettings: speedSettingsPanel.open,
            eqSettings: eqSettingsPanel.open,
            spatialSettings: spatialSettingsPanel.open,
            dynamicsSettings: dynamicsPanel.open,
            surroundSettings: surroundPanel.open
        };
        await chrome.storage.local.set({ pitchSettings: currentSettings });
    }

    function renderBlacklistList() {
        const patterns = Array.isArray(currentSettings.blacklistPatterns) ? currentSettings.blacklistPatterns : [];
        blacklistList.innerHTML = "";
        if (!patterns.length) {
            const e = document.createElement("div");
            e.style.cssText = "opacity:0.7;font-size:13px";
            e.textContent = "Blacklist is empty";
            return void blacklistList.appendChild(e);
        }
        patterns.forEach((p, i) => {
            const r = document.createElement("div");
            r.className = "blacklist-item"; r.dataset.index = String(i);
            const inp = document.createElement("input");
            inp.type = "text"; inp.value = p; inp.spellcheck = false; inp.className = "blacklist-item-input";
            const d = document.createElement("button");
            d.type = "button"; d.textContent = "×"; d.className = "blacklist-item-delete btn-vk secondary";
            r.appendChild(inp); r.appendChild(d);
            blacklistList.appendChild(r);
        });
    }

    async function addBlacklistPattern() {
        const p = blacklistInput.value.trim();
        if (!p) return;
        const arr = Array.isArray(currentSettings.blacklistPatterns) ? [...currentSettings.blacklistPatterns] : [];
        if (!arr.includes(p)) {
            arr.push(p);
            currentSettings.blacklistPatterns = arr;
            await applySettings();
        }
        blacklistInput.value = "";
        renderBlacklistList();
    }

    function renderEqPresetList() {
        const all = getAllEqPresets();
        eqPresetList.innerHTML = "";
        for (const [id, preset] of Object.entries(all)) {
            const row = document.createElement("div");
            row.className = "blacklist-item"; row.dataset.id = id;
            const nameInp = document.createElement("input");
            nameInp.type = "text"; nameInp.value = preset.name; nameInp.spellcheck = false;
            nameInp.className = "blacklist-item-input"; nameInp.style.flex = "1"; nameInp.disabled = isBuiltInEqPreset(id);
            const genresInp = document.createElement("input");
            genresInp.type = "text"; genresInp.value = preset.genres.join(", "); genresInp.spellcheck = false;
            genresInp.className = "blacklist-item-input"; genresInp.style.flex = "1"; genresInp.disabled = isBuiltInEqPreset(id);
            row.appendChild(nameInp); row.appendChild(genresInp);
            if (!isBuiltInEqPreset(id)) {
                const del = document.createElement("button");
                del.type = "button"; del.textContent = "×"; del.className = "blacklist-item-delete btn-vk secondary";
                row.appendChild(del);
            }
            eqPresetList.appendChild(row);
        }
    }

    async function addEqPreset() {
        let name = eqPresetNameInput.value.trim() || "My EQ Preset";
        const genresStr = eqPresetGenresInput.value.trim();
        const genres = genresStr ? genresStr.split(",").map(g => g.trim().toLowerCase()).filter(Boolean) : [];
        let id = name.toLowerCase().replace(/\s+/g, "_"), counter = 1;
        while (getAllEqPresets()[id]) id = `${name.toLowerCase().replace(/\s+/g, "_")}_${counter++}`;

        currentSettings.eqPresets = { ...(currentSettings.eqPresets || {}) };
        currentSettings.eqPresets[id] = { name, genres, values: [...currentSettings.eqGains] };
        currentSettings.eqPreset = id;
        eqPresetNameInput.value = ""; eqPresetGenresInput.value = "";
        renderEqPresetList(); updateEqPresetSelectUI(); scheduleApply();
    }

    document.querySelectorAll(".range-slider input").forEach(input => {
        input.addEventListener("input", e => {
            syncVisualSlider(e.target);
            const id = e.target.id;
            let val = parseFloat(e.target.value);

            if (id === "semitones") { currentSettings.pitchValueSemitones = val; semitonesVal.textContent = val; }
            if (id === "cents") { currentSettings.pitchValueCents = val; centsVal.textContent = val; }
            if (id === "blockSize") { currentSettings.windowSizeMilliseconds = val; blockSizeVal.textContent = val; }
            if (id === "speedUnits") { currentSettings.speedUnits = val; speedUnitsVal.textContent = calcSpeedPercentage(val, 0) + "%"; }
            if (id === "speedFine") { currentSettings.speedFine = val; speedFineVal.textContent = calcSpeedPercentage(currentSettings.speedUnits, val) + "%"; }
            if (id === "volumeBoostDb") {
                currentSettings.volumeBoostDb = val;
                volumeBoostVal.textContent = formatDb(val);
            }

            if (id === "reverbWet") {
                currentSettings.reverbWet = val;
                reverbWetVal.textContent = val + "%";
            }
            if (id === "stereoWiden") {
                currentSettings.stereoWiden = val;
                stereoWidenVal.textContent = val;
            }

            if (id === "channelBalance") {
                currentSettings.channelBalance = val;
                channelBalanceVal.textContent = val;
            }

            if (id === "compressorThreshold") {
                currentSettings.compressorThreshold = val;
                compressorThresholdVal.textContent = val + " dB";
            }
            if (id === "compressorKnee") {
                currentSettings.compressorKnee = val;
                compressorKneeVal.textContent = val + " dB";
            }
            if (id === "compressorRatio") {
                currentSettings.compressorRatio = val;
                compressorRatioVal.textContent = val + ":1";
            }
            if (id === "compressorAttack") {
                currentSettings.compressorAttack = val;
                compressorAttackVal.textContent = val + " ms";
            }
            if (id === "compressorRelease") {
                currentSettings.compressorRelease = val;
                compressorReleaseVal.textContent = val + " ms";
            }

            if (e.target.orient === "vertical" || e.target.getAttribute("orient") === "vertical") {
                const index = Array.from(document.querySelectorAll('.range-slider[style*="vertical"] input')).indexOf(e.target);
                if (index !== -1) {
                    currentSettings.eqGains[index] = val;
                    currentSettings.eqPreset = "custom";
                    currentSettings.eqPresets = { ...(currentSettings.eqPresets || {}), custom: { name: "Custom", genres: [], values: [...currentSettings.eqGains] } };
                    updateEqualizerGraph(); updateEqPresetSelectUI();
                }
            }
            updateSectionResetIcons();
            scheduleApply();
        });
    });

    smartCheck.addEventListener("change", e => { currentSettings.applySmartProcessing = e.target.checked; updateSectionResetIcons(); scheduleApply(); });
    preservePitchCheck.addEventListener("change", e => { currentSettings.preservePitch = e.target.checked; updateSectionResetIcons(); scheduleApply(); });

    optimisationDelayCheck.addEventListener("change", e => {
        currentSettings.optimisationDelay = e.target.checked;
        scheduleApply()
    });

    dolbyEnabledCheck.addEventListener("change", e => {
        currentSettings.dolbyEnabled = e.target.checked;
        updateSectionResetIcons();
        scheduleApply();
    })

    reverbPresetSelect.addEventListener("change", e => {
        currentSettings.reverbType = e.target.value === "null" ? null : e.target.value;
        updateSectionResetIcons();
        scheduleApply();
    });



    eqPresetSelect.addEventListener("change", e => { applyEqPresetToUI(e.target.value); updateSectionResetIcons(); scheduleApply(); });

    resetBtn.addEventListener("click", async () => {
        let defaultSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        currentSettings = { ...defaultSettings, blacklistPatterns: currentSettings.blacklistPatterns || [], toggleState: currentSettings.toggleState || defaultSettings.toggleState, eqPresets: currentSettings.eqPresets || {} };
        updateUI(); renderBlacklistList(); await applySettings();
    });

    blacklistBtn.addEventListener("click", () => {
        renderBlacklistList();
        simpleModal.openModal("blacklistModal", "#blacklistInput");
    });

    blacklistAddBtn.addEventListener("click", addBlacklistPattern);
    blacklistInput.addEventListener("keydown", async e => {
        if (e.key === "Enter") {
            e.preventDefault();
            await addBlacklistPattern();
        }
        if (e.key === "Escape") simpleModal.closeModal("blacklistModal");
    });
    blacklistList.addEventListener("input", async e => {
        const inp = e.target.closest(".blacklist-item-input"); if (!inp) return;
        const row = inp.closest(".blacklist-item"), idx = Number(row?.dataset.index);
        if (!Number.isFinite(idx)) return;
        const arr = [...(currentSettings.blacklistPatterns || [])];
        arr[idx] = inp.value.trim();
        currentSettings.blacklistPatterns = arr.filter(Boolean);
        await applySettings();
    });

    blacklistList.addEventListener("click", async e => {
        const btn = e.target.closest(".blacklist-item-delete"); if (!btn) return;
        const row = btn.closest(".blacklist-item"), idx = Number(row?.dataset.index);
        if (!Number.isFinite(idx)) return;
        const arr = [...(currentSettings.blacklistPatterns || [])];
        arr.splice(idx, 1);
        currentSettings.blacklistPatterns = arr;
        await applySettings(); renderBlacklistList();
    });

    eqPresetManageBtn.addEventListener("click", () => {
        renderEqPresetList();
        simpleModal.openModal("eqPresetModal", "#eqPresetNameInput");
    });
    eqPresetAddBtn.addEventListener("click", addEqPreset);
    eqPresetNameInput.addEventListener("keydown", async e => {
        if (e.key === "Enter") {
            e.preventDefault();
            await addEqPreset();
        }
        if (e.key === "Escape") simpleModal.closeModal("eqPresetModal");
    });
    eqPresetGenresInput.addEventListener("keydown", async e => {
        if (e.key === "Enter") {
            e.preventDefault();
            await addEqPreset();
        }
        if (e.key === "Escape") simpleModal.closeModal("eqPresetModal");
    });
    eqPresetList.addEventListener("input", e => {
        const row = e.target.closest(".blacklist-item"); if (!row) return;
        const id = row.dataset.id; if (isBuiltInEqPreset(id)) return;
        const nameInp = row.querySelector("input:nth-child(1)"), genresInp = row.querySelector("input:nth-child(2)");
        currentSettings.eqPresets[id].name = nameInp.value.trim() || "Unnamed";
        currentSettings.eqPresets[id].genres = genresInp.value.split(",").map(g => g.trim().toLowerCase()).filter(Boolean);
        if (currentSettings.eqPreset === id) updateEqPresetSelectUI();
        scheduleApply();
    });

    eqPresetList.addEventListener("click", async e => {
        const btn = e.target.closest(".blacklist-item-delete"); if (!btn) return;
        const id = btn.closest(".blacklist-item")?.dataset.id;
        if (id && !isBuiltInEqPreset(id)) {
            delete currentSettings.eqPresets[id];
            if (currentSettings.eqPreset === id) applyEqPresetToUI("flat");
            renderEqPresetList(); scheduleApply();
        }
    });

    [volumeBoostPanel, pitchSettingsPanel, speedSettingsPanel, eqSettingsPanel, spatialSettingsPanel, dynamicsPanel, surroundPanel].forEach(p => p.addEventListener("toggle", saveToggleState));

    updateUI(); renderBlacklistList(); renderEqPresetList(); await refreshSiteStatus();
})();