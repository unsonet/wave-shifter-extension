const simpleModal = globalThis['simpleModal'];
(async () => {
    // --- НАСТРОЙКИ ОВЕРЛЕЯ И ПРОЦЕССОРОВ ---
    const OVERLAY_CONFIG = {
        MAX_OVERLAY_CHAINS: 10,
        MAX_SIGNALSMITH_CHAINS: 2
    };
    let userDisabledCustomInOverlay = !1;
    let suppressCustomSync = !1;
    let vizPort = null, vizElementsCache = null;

    const DEFAULT_SETTINGS = {
        pitchValueSemitones: 0,
        pitchValueCents: 0,
        windowSizeMilliseconds: 120,
        applySmartProcessing: true,
        speedUnits: 0,
        speedFine: 0,
        preservePitch: true,
        blacklistPatterns: [],
        gainOutputDb: 0,
        effectsMix: 50,
        toggleState: {
            gainSettings: false,
            pitchSettings: true,
            speedSettings: true,
            eqSettings: false,
            stereoSettings: false,
            reverbSettings: false,
            bassSettings: false,
            claritySettings: false,
            dynamicsSettings: false,
            surroundSettings: false,
            modulationSettings: false,
        },
        eqGains: Array(10).fill(50),
        eqPreset: "flat",
        reverbType: null, reverbWet: 0, centerCancel: 0, channelBalance: 0,
        stereoWidthMix: 0, stereoCenterMix: 0, stereoFocusMix: 0,
        delayTime: 250, delayFeedback: 40, delayMix: 0, definitionMix: 0, subbassMix: 0, warmthMix: 0,
        distortionLayers: [], distMix: 0,
        compressorThreshold: -24,
        compressorKnee: 30,
        compressorRatio: 12,
        compressorAttack: 3,
        compressorRelease: 250,
        dolbyEnabled: !1,
        overlayEnabled: !1,
        overlayPresets: [],
        globalPresets: {},
        modulationLayers: [],
        enableVisualization: !0,
    };

    // Схема описывает, какие слайдеры есть у каждого типа модуляции.
    // Это позволит легко добавлять Ring Mod, Vowel и т.д. без изменения логики рендера.
    const MODULATION_SCHEMAS = {
        chorus: {
            name: "Chorus",
            options: [{ id: "rate", label: "Rate", min: .1, max: 10, step: .1, def: 1.5, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "delay", label: "Delay", min: 0, max: 50, step: .5, def: 20, unit: "ms" }, { id: "feedback", label: "Feedback", min: 0, max: 90, step: 1, def: 0, unit: "%" }, { id: "spread", label: "Spread", min: 0, max: 100, step: 1, def: 50, unit: "%" }]
        },
        flanger: {
            name: "Flanger",
            options: [{ id: "rate", label: "Rate", min: .1, max: 10, step: .1, def: .5, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 70, unit: "%" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "delay", label: "Delay", min: 0, max: 10, step: .1, def: 2, unit: "ms" }, { id: "feedback", label: "Feedback", min: 0, max: 90, step: 1, def: 50, unit: "%" }]
        },
        phaser: {
            name: "Phaser",
            options: [{ id: "rate", label: "Rate", min: .1, max: 10, step: .1, def: .5, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 60, unit: "%" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "feedback", label: "Feedback", min: 0, max: 90, step: 1, def: 40, unit: "%" }, { id: "stages", label: "Stages", min: 1, max: 12, step: 1, def: 4, unit: "" }]
        },
        tremolo: {
            name: "Tremolo",
            options: [{ id: "rate", label: "Rate", min: .1, max: 20, step: .1, def: 5, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "shape", label: "Shape", min: 0, max: 2, step: 1, def: 0, unit: "" }]
        },
        Vibrato: {
            name: "Vibrato",
            options: [{ id: "rate", label: "Rate", min: .1, max: 10, step: .1, def: 5, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 50, unit: "%" }]
        },
        rotarySpeaker: {
            name: "Rotary Speaker",
            options: [{ id: "rate", label: "Rate", min: .1, max: 8, step: .1, def: 1, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 70, unit: "%" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 100, unit: "%" }]
        },
        ringModulator: {
            name: "Ring Modulator",
            options: [{ id: "frequency", label: "Freq", min: 20, max: 5e3, step: 1, def: 440, unit: "Hz" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 50, unit: "%" }]
        },
        vowelFilter: {
            name: "Vowel Filter",
            options: [{ id: "rate", label: "Rate", min: .1, max: 5, step: .1, def: 2, unit: "Hz" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "vowel", label: "Vowel", min: 0, max: 4, step: 1, def: 0, unit: "" }]
        },
        autoPanner: {
            name: "Auto Panner",
            options: [{ id: "rate", label: "Rate", min: 0.1, max: 10, step: 0.1, def: 2, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 80, unit: "%" }]
        },
        autoFilter: {
            name: "Auto Filter",
            options: [{ id: "rate", label: "Rate", min: 0.1, max: 10, step: 0.1, def: 2, unit: "Hz" }, { id: "depth", label: "Depth", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "baseFreq", label: "Base Freq", min: 100, max: 5000, step: 10, def: 1000, unit: "Hz" }, { id: "octaves", label: "Octaves", min: 0.5, max: 4, step: 0.5, def: 2, unit: "oct" }]
        }
    };

    const LOFI_SCHEMAS = {
        distortion: {
            name: "Distortion",
            options: [{ id: "amount", label: "Amount", min: 0, max: 100, step: 1, def: 50, unit: "%" }, { id: "tone", label: "Tone", min: 0, max: 100, step: 1, def: 50, unit: "%" }]
        },
        bitcrusher: {
            name: "Bitcrusher",
            options: [{ id: "bits", label: "Bit Depth", min: 1, max: 16, step: 1, def: 8, unit: "bits" }, { id: "normRange", label: "Sample Rate", min: 0, max: 100, step: 1, def: 40, unit: "%" }]
        },
        cdskipper: {
            name: "CD Skipper",
            options: [{ id: "loopMs", label: "Loop Size", min: 50, max: 1000, step: 10, def: 200, unit: "ms" }, { id: "repeats", label: "Repeats", min: 1, max: 16, step: 1, def: 4, unit: "" }]
        },
        vinyl: {
            name: "Vinyl",
            options: [
                { id: "noise", label: "Hiss", min: 0, max: 100, step: 1, def: 30, unit: "%" },
                { id: "crackle", label: "Crackle", min: 0, max: 100, step: 1, def: 50, unit: "%" }
            ]
        }
    };

    const SECTION_DEFAULTS = {
        '#gainPanel': {
            gainOutputDb: DEFAULT_SETTINGS.gainOutputDb,
            effectsMix: DEFAULT_SETTINGS.effectsMix,
        },
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
            eqPreset: DEFAULT_SETTINGS.eqPreset,
            enableVisualization: DEFAULT_SETTINGS.enableVisualization
        },

        "#stereoPanel": {
            centerCancel: DEFAULT_SETTINGS.centerCancel,
            channelBalance: DEFAULT_SETTINGS.channelBalance,
            stereoWidthMix: DEFAULT_SETTINGS.stereoWidthMix,
            stereoCenterMix: DEFAULT_SETTINGS.stereoCenterMix,
            stereoFocusMix: DEFAULT_SETTINGS.stereoFocusMix
        },
        "#reverbPanel": {
            reverbType: DEFAULT_SETTINGS.reverbType,
            reverbWet: DEFAULT_SETTINGS.reverbWet,
        },
        "#bassPanel": { subbassMix: 0, warmthMix: 0 },
        "#clarityPanel": { definitionMix: 0 },
        "#delayPanel": {
            delayTime: 250,
            delayFeedback: 40,
            delayMix: 0
        },

        "#distortionPanel": { distortionLayers: [], distMix: 0 },
        "#dynamicsPanel": {
            compressorThreshold: -24,
            compressorKnee: 30,
            compressorRatio: 12,
            compressorAttack: 3,
            compressorRelease: 250
        },
        "#surroundPanel": {
            dolbyEnabled: false
        },
        "#modulationPanel": { modulationLayers: [] }
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
    const eqPresetManageBtn = document.getElementById("eqPresetManageBtn");
    const eqPresetNameInput = document.getElementById("eqPresetNameInput");
    const eqPresetGenresInput = document.getElementById("eqPresetGenresInput");
    const eqPresetAddBtn = document.getElementById("eqPresetAddBtn");
    const eqPresetList = document.getElementById("eqPresetList");
    const eqSvgLine = document.querySelector(".eq-svg-line");
    const eqSvgLineShadow = document.querySelector(".eq-svg-line-shadow");
    const enableVisualizationCheck = document.getElementById("enableVisualization");
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
    const gainOutputSlider = document.getElementById("gainOutputDb");
    const gainOutputVal = document.getElementById("gainOutputVal");
    const effectsMixSlider = document.getElementById("effectsMix");
    const effectsMixVal = document.getElementById("effectsMixVal");
    const gainPanel = document.getElementById("gainPanel");
    const optimisationDelayCheck = document.getElementById("optimisationDelay");
    const stereoPanel = document.getElementById("stereoPanel"),
        reverbPanel = document.getElementById("reverbPanel"),
        reverbPresetSelect = document.getElementById("reverbPreset"),
        reverbWetSlider = document.getElementById("reverbWet"),
        reverbWetVal = document.getElementById("reverbWetVal"),
        centerCancelSlider = document.getElementById("centerCancel"),
        centerCancelVal = document.getElementById("centerCancelVal"),
        channelBalanceSlider = document.getElementById("channelBalance"),
        channelBalanceVal = document.getElementById("channelBalanceVal"),
        stereoWidthMixSlider = document.getElementById("stereoWidthMix"),
        stereoWidthMixVal = document.getElementById("stereoWidthMixVal"),
        stereoCenterMixSlider = document.getElementById("stereoCenterMix"),
        stereoCenterMixVal = document.getElementById("stereoCenterMixVal"),
        stereoFocusMixSlider = document.getElementById("stereoFocusMix"),
        stereoFocusMixVal = document.getElementById("stereoFocusMixVal"),
        bassPanel = document.getElementById("bassPanel"),
        subbassMixSlider = document.getElementById("subbassMix"),
        subbassMixVal = document.getElementById("subbassMixVal"),
        warmthMixSlider = document.getElementById("warmthMix"),
        warmthMixVal = document.getElementById("warmthMixVal"),
        clarityPanel = document.getElementById("clarityPanel"),
        definitionMixSlider = document.getElementById("definitionMix"),
        definitionMixVal = document.getElementById("definitionMixVal"),
        delayPanel = document.getElementById("delayPanel"),
        delayTimeSlider = document.getElementById("delayTime"),
        delayTimeVal = document.getElementById("delayTimeVal"),
        delayFeedbackSlider = document.getElementById("delayFeedback"),
        delayFeedbackVal = document.getElementById("delayFeedbackVal"),
        delayMixSlider = document.getElementById("delayMix"),
        delayMixVal = document.getElementById("delayMixVal");

    const distortionPanel = document.getElementById("distortionPanel"),
        distMixSlider = document.getElementById("distMix"), distMixVal = document.getElementById("distMixVal");
    const dynamicsPanel = document.getElementById("dynamicsPanel"),
        surroundPanel = document.getElementById("surroundPanel"),
        modulationPanel = document.getElementById("modulationPanel"),

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
        dolbyEnabledCheck = document.getElementById("dolbyEnabled"),
        globalPresetSelect = document.getElementById("globalPresetSelect"),
        overlayCheck = document.getElementById("overlay"),
        globalPresetsBtn = document.getElementById("globalPresetsBtn"),
        globalPresetNameInput = document.getElementById("globalPresetNameInput"),
        globalPresetAddBtn = document.getElementById("globalPresetAddBtn"),
        globalPresetList = document.getElementById("globalPresetList");


    let currentSettings = await async function loadSettings() {
        const result = await chrome.storage.local.get("pitchSettings");
        let defaultSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        const saved = result.pitchSettings || {};

        // ФИКС: Накатываем дефолтные значения на ВСЕ сохраненные пресеты.
        // Если пресет был создан в старой версии (без дисторшна/делэя), 
        // мы добавляем ему недостающие ключи, чтобы он корректно распознавался как дефолтный.
        if (saved.globalPresets) {
            const presetDefaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            for (const pId in saved.globalPresets) {
                if (saved.globalPresets[pId] && saved.globalPresets[pId].values) {
                    saved.globalPresets[pId].values = {
                        ...presetDefaults,
                        ...saved.globalPresets[pId].values
                    };
                }
            }
        }

        return {
            ...defaultSettings,
            ...saved,
            eqGains: saved.eqGains || defaultSettings.eqGains,
            modulationLayers: saved.modulationLayers || defaultSettings.modulationLayers,
            distortionLayers: saved.distortionLayers || defaultSettings.distortionLayers,
            distMix: saved.distMix != null ? saved.distMix : defaultSettings.distMix,
            delayTime: saved.delayTime != null ? saved.delayTime : defaultSettings.delayTime,
            delayFeedback: saved.delayFeedback != null ? saved.delayFeedback : defaultSettings.delayFeedback,
            delayMix: saved.delayMix != null ? saved.delayMix : defaultSettings.delayMix,
            blacklistPatterns: saved.blacklistPatterns || defaultSettings.blacklistPatterns,
            eqPresets: saved.eqPresets || {},
            globalPresets: saved.globalPresets || {},
            overlayPresets: saved.overlayPresets || []
        };
    }();

    function syncVisualSlider(inputEl) {
        const min = parseFloat(inputEl.min), max = parseFloat(inputEl.max);
        const pct = (parseFloat(inputEl.value) - min) / (max - min);
        inputEl.parentElement.style.setProperty("--pct", pct);
    }

    function calcSpeedPercentage(units, fine) {
        return (units < 0 ? 100 + 1 * units : 100 + 5 * units) + fine;
    }

    let applyTimeout = null;

    function syncUIToActivePresets() {
        if (isOverlayActive()) {
            const activeIds = currentSettings.overlayPresets || [],
                allPresets = getAllGlobalPresets();
            activeIds.forEach(pId => {
                if (!currentSettings.globalPresets) currentSettings.globalPresets = {};
                if (!currentSettings.globalPresets[pId]) {
                    const src = allPresets[pId];
                    currentSettings.globalPresets[pId] = {
                        name: src?.name || pId,
                        values: {
                            ...DEFAULT_SETTINGS,
                            ...src?.values || {}
                        }
                    }
                }
                if (!currentSettings.globalPresets[pId].values) currentSettings.globalPresets[pId].values = {};
                //currentSettings.globalPresets[pId].values.gainOutputDb = currentSettings.gainOutputDb
            })
        }
        if (suppressCustomSync) {
            suppressCustomSync = !1;
            return void updateGlobalPresetSelectUI();
        }
        if (currentSettings.modulationLayers === undefined) currentSettings.modulationLayers = [];
        if (currentSettings.distortionLayers === undefined) currentSettings.distortionLayers = [];
        if (currentSettings.distMix == null) currentSettings.distMix = 0;
        if (currentSettings.delayTime == null) currentSettings.delayTime = 250;
        if (currentSettings.delayFeedback == null) currentSettings.delayFeedback = 40;
        if (currentSettings.delayMix == null) currentSettings.delayMix = 0;

        let isDefault = true;
        const excludeKeys = ["blacklistPatterns", "toggleState", "eqPresets", "globalPresets", "overlayPresets", "overlayEnabled", "optimisationDelay"];
        for (const key in DEFAULT_SETTINGS) {
            if (!excludeKeys.includes(key) && JSON.stringify(DEFAULT_SETTINGS[key]) !== JSON.stringify(currentSettings[key])) {
                isDefault = false;
                break;
            }
        }

        if (isDefault) {
            // 1. Если мы на нем стояли - переключаемся на default
            const wasCustom = "custom" === currentSettings.globalPreset;
            if (wasCustom) {
                currentSettings.globalPreset = "default";
                globalPresetSelect.value = "default";
            }

            // 2. Убираем из активных цепей overlay
            if (!isOverlayActive() && currentSettings.overlayPresets?.includes("custom")) {
                currentSettings.overlayPresets = currentSettings.overlayPresets.filter(id => "custom" !== id);
            }

            // 3. ФИЗИЧЕСКИ УДАЛЯЕМ из памяти ВСЕГДА, без всяких условий!
            if (wasCustom) {
                delete currentSettings.globalPresets?.custom;
            }

            // 4. СБРАСЫВАЕМ блокировку, чтобы при следующих изменениях custom снова появился
            userDisabledCustomInOverlay = false;
            updateGlobalPresetSelectUI();
            return;
        }

        currentSettings.globalPresets || (currentSettings.globalPresets = {});
        currentSettings.globalPresets.custom || (currentSettings.globalPresets.custom = { name: "Custom", values: {} });

        const pValues = currentSettings.globalPresets.custom.values;
        pValues.pitchValueSemitones = currentSettings.pitchValueSemitones;
        pValues.pitchValueCents = currentSettings.pitchValueCents;
        pValues.windowSizeMilliseconds = currentSettings.windowSizeMilliseconds;
        pValues.applySmartProcessing = currentSettings.applySmartProcessing;
        pValues.gainOutputDb = currentSettings.gainOutputDb;
        pValues.effectsMix = currentSettings.effectsMix;
        pValues.eqGains = [...currentSettings.eqGains];
        pValues.reverbType = currentSettings.reverbType;
        pValues.reverbWet = currentSettings.reverbWet;
        pValues.centerCancel = currentSettings.centerCancel;
        pValues.channelBalance = currentSettings.channelBalance;
        pValues.modulationLayers = JSON.parse(JSON.stringify(currentSettings.modulationLayers || []));
        pValues.distortionLayers = JSON.parse(JSON.stringify(currentSettings.distortionLayers || []));
        pValues.distMix = currentSettings.distMix || 0;
        pValues.delayTime = currentSettings.delayTime || 250;
        pValues.delayFeedback = currentSettings.delayFeedback || 40;
        pValues.delayMix = currentSettings.delayMix || 0;

        pValues.delayMix = currentSettings.delayMix || 0,
            pValues.subbassMix = currentSettings.subbassMix || 0,
            pValues.warmthMix = currentSettings.warmthMix || 0,
            pValues.stereoWidthMix = currentSettings.stereoWidthMix || 0,
            pValues.stereoCenterMix = currentSettings.stereoCenterMix || 0,
            pValues.stereoFocusMix = currentSettings.stereoFocusMix || 0,
            pValues.definitionMix = currentSettings.definitionMix || 0;

        if (isOverlayActive()) {
            if (!userDisabledCustomInOverlay && !currentSettings.overlayPresets.includes("custom")) {
                currentSettings.overlayPresets.push("custom");
                updateGlobalPresetSelectUI();
            }
        } else {
            if ("default" === currentSettings.globalPreset) {
                currentSettings.globalPreset = "custom";
                globalPresetSelect.value = "custom";
                updateGlobalPresetSelectUI();
            }
        }
    }

    async function scheduleApply() {
        syncUIToActivePresets(); // Синхронизируем ПЕРЕД отправкой
        if (currentSettings.optimisationDelay) applyTimeout && clearTimeout(applyTimeout), applyTimeout = setTimeout(async () => { applyTimeout = null, await applySettings() }, 150); else { if (applyTimeout) return; applyTimeout = setTimeout(async () => { applyTimeout = null, await applySettings() }, 16) }
    }

    function isOverlayActive() {
        return !!currentSettings.overlayEnabled;
    }

    function getAllGlobalPresets() {
        const all = { default: { name: "Default", values: { ...DEFAULT_SETTINGS } }, ...currentSettings.globalPresets || {} };

        if (all.default && all.default.values) {
            all.default.values = { ...DEFAULT_SETTINGS, ...all.default.values }
        }
        // Скрываем "призрачный" custom из списка, если его настройки дефолтные
        if (all.custom && all.custom.values) {
            let isCustomDefault = true;
            const excludeKeys = ["blacklistPatterns", "toggleState", "eqPresets", "globalPresets", "overlayPresets", "overlayEnabled", "optimisationDelay"];
            for (const key in DEFAULT_SETTINGS) {
                if (!excludeKeys.includes(key)) {
                    if (all.custom.values[key] === undefined) {
                        all.custom.values[key] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key]));
                    }
                    if (JSON.stringify(all.custom.values[key]) !== JSON.stringify(DEFAULT_SETTINGS[key])) {
                        isCustomDefault = false;
                        break;
                    }
                }

            }

            if (isCustomDefault && !(isOverlayActive() && (currentSettings.overlayPresets || []).includes("custom"))) {
                delete all.custom; // Удаляем только из отрисовки, чтобы не моргало
            }
        }

        return all;
    }

    function getActiveOverlayPresets() {
        if (!isOverlayActive()) return null;
        let selectedIds = Array.from(globalPresetSelect.selectedOptions).map(o => o.value).filter(Boolean);
        0 === selectedIds.length && (selectedIds = currentSettings.overlayPresets || ["default"]);
        const all = getAllGlobalPresets(), seenIds = new Set;
        return selectedIds.filter(id => !seenIds.has(id) && (seenIds.add(id), !0)).map(id => {
            const presetValues = all[id]?.values || {}; return { id, values: { ...DEFAULT_SETTINGS, ...presetValues } }
        }).slice(0, OVERLAY_CONFIG.MAX_OVERLAY_CHAINS)
    }

    function switchToCustomIfNeeded() {
        // В режиме оверлея не переключаем, там юзер сам выбирает пресеты мышкой
        if (isOverlayActive()) return;

        if (currentSettings.globalPreset === "default") {
            currentSettings.globalPreset = "custom";
            if (!currentSettings.globalPresets) currentSettings.globalPresets = {};

            const presetValues = {};
            for (const key in DEFAULT_SETTINGS) {
                if (!["blacklistPatterns", "toggleState", "eqPresets", "globalPresets", "overlayPresets", "overlayEnabled", "optimisationDelay"].includes(key)) {
                    presetValues[key] = JSON.parse(JSON.stringify(currentSettings[key]));
                }
            }
            currentSettings.globalPresets["custom"] = { name: "Custom", values: presetValues };

            // Принудительно даем команду селектору переключиться визуально
            globalPresetSelect.value = "custom";
            updateGlobalPresetSelectUI();
        }
    }

    function toggleGlobalUIControls(disabled) {
        const sections = [speedSettingsPanel, dynamicsPanel, surroundPanel];
        sections.forEach(s => {
            s.querySelectorAll('input, select, button').forEach(el => el.disabled = disabled);
            if (disabled) s.classList.add('disabled-section'); else s.classList.remove('disabled-section');
        });
    }

    // Функция рендеринга слоев модуляции
    function renderModulationLayers() {
        console.log("[WS Debug] renderModulationLayers отработал");
        const container = document.getElementById("modulation-items");
        container.innerHTML = "";

        if (Array.isArray(currentSettings.modulationLayers)) {
            currentSettings.modulationLayers.forEach((layer, layerIndex) => {
                const schema = MODULATION_SCHEMAS[layer.type];
                if (!schema) return;

                const row = document.createElement("div");
                row.className = "modulation-row";
                row.dataset.id = layer.id;

                const header = document.createElement("div");
                header.className = "modulation-row__header";
                const title = document.createElement("span");
                title.textContent = MODULATION_SCHEMAS[layer.type]?.name || (layer.type.charAt(0).toUpperCase() + layer.type.slice(1));
                const closeBtn = document.createElement("button");
                closeBtn.className = "close";
                closeBtn.type = "button";
                closeBtn.textContent = "×";
                header.appendChild(title);
                header.appendChild(closeBtn);

                const slidersContainer = document.createElement("div");
                slidersContainer.className = "modulation-container";
                slidersContainer.style.display = "flex";
                slidersContainer.style.alignItems = "center";
                slidersContainer.style.height = "150px";
                slidersContainer.style.gap = "8px";

                schema.options.forEach(param => {
                    const currentVal = void 0 !== layer.params[param.id] ? layer.params[param.id] : param.def;

                    const sliderWrapper = document.createElement("div");
                    sliderWrapper.className = "range-slider legend-bottom legend-top";
                    sliderWrapper.style.setProperty("--orientation", "vertical");
                    sliderWrapper.style.height = "100%";

                    const input = document.createElement("input");
                    input.type = "range";
                    input.setAttribute("orient", "vertical");
                    input.min = param.min;
                    input.max = param.max;
                    input.step = param.step;
                    input.value = currentVal;
                    input.dataset.layerId = layer.id;
                    input.dataset.paramId = param.id;
                    sliderWrapper.appendChild(input);
                    sliderWrapper.insertAdjacentHTML("beforeend", '<div class="range-slider__track"></div><div class="range-slider__bar"></div><div class="range-slider__thumb"></div>');

                    // Логика форматирования значения для верхнего лейбла
                    const labelTop = document.createElement("div");
                    labelTop.className = "range-slider__legend-top";
                    let displayVal = currentVal;

                    if (param.unit) {
                        if (param.step >= 1) {
                            displayVal = Math.round(currentVal);
                        } else if (param.step < 0.1) {
                            displayVal = currentVal.toFixed(2);
                        } else {
                            displayVal = currentVal.toFixed(1);
                        }
                        labelTop.textContent = displayVal + " " + param.unit;
                    } else {
                        labelTop.textContent = currentVal;
                    }

                    sliderWrapper.appendChild(labelTop);

                    const labelBottom = document.createElement("div");
                    labelBottom.className = "range-slider__legend-bottom";
                    labelBottom.textContent = param.label;
                    sliderWrapper.appendChild(labelBottom);

                    slidersContainer.appendChild(sliderWrapper);
                });

                row.appendChild(header);
                row.appendChild(slidersContainer);
                container.appendChild(row);
            });
            container.querySelectorAll(".range-slider input").forEach(syncVisualSlider);
        } else {
            currentSettings.modulationLayers = [];
        }
    }

    function updateGlobalPresetSelectUI() {
        const all = getAllGlobalPresets();
        globalPresetSelect.innerHTML = "";

        // 1. Сначала просто отрисовываем все опции без выделения
        for (const [id, preset] of Object.entries(all)) {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = preset.name;
            globalPresetSelect.appendChild(opt);
        }

        // 2. Жестко и надежно управляем выделением в зависимости от режима селектора
        if (globalPresetSelect.multiple) {
            // Режим OVERLAY: выделяем то, что лежит в массиве overlayPresets
            const activeIds = currentSettings.overlayPresets || [];
            Array.from(globalPresetSelect.options).forEach(opt => {
                opt.selected = activeIds.includes(opt.value);
            });
        } else {
            // Обычный режим: выделяем один текущий пресет
            globalPresetSelect.value = currentSettings.globalPreset || "default";
        }
    }

    function renderGlobalPresetList() {
        const all = getAllGlobalPresets();
        globalPresetList.innerHTML = "";
        for (const [id, preset] of Object.entries(all)) {
            if (id === "default" || id === "custom") continue; // Скрываем системные пресеты
            const row = document.createElement("div");
            row.className = "blacklist-item";
            row.dataset.id = id;
            const nameInp = document.createElement("input");
            nameInp.type = "text"; nameInp.value = preset.name; nameInp.spellcheck = false;
            nameInp.className = "blacklist-item-input"; nameInp.style.flex = "1";
            row.appendChild(nameInp);
            const del = document.createElement("button");
            del.type = "button"; del.textContent = "×"; del.className = "blacklist-item-delete btn-vk secondary";
            row.appendChild(del);
            globalPresetList.appendChild(row);
        }
    }

    async function addGlobalPreset() {
        let name = globalPresetNameInput.value.trim() || "My Preset";
        let id = name.toLowerCase().replace(/\s+/g, "_");
        let counter = 1;
        while (getAllGlobalPresets()[id]) id = `${name.toLowerCase().replace(/\s+/g, "_")}_${counter++}`;

        // Сохраняем только параллельные настройки
        const presetValues = {};
        for (const key in DEFAULT_SETTINGS) {
            if (!["blacklistPatterns", "toggleState", "eqPresets", "globalPresets", "overlayPresets", "overlayEnabled", "optimisationDelay"].includes(key)) {
                presetValues[key] = JSON.parse(JSON.stringify(currentSettings[key]));
            }
        }

        currentSettings.globalPresets = { ...(currentSettings.globalPresets || {}), [id]: { name, values: presetValues } };
        currentSettings.globalPreset = id;
        globalPresetNameInput.value = "";
        renderGlobalPresetList();
        updateGlobalPresetSelectUI();
        scheduleApply();
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

    document.addEventListener("click", e => {
        const resetIcon = e.target.closest(".reset-icon");
        if (!resetIcon) return;
        e.stopPropagation(), e.preventDefault();
        const sectionId = resetIcon.dataset.section, defaults = SECTION_DEFAULTS[sectionId];
        if (defaults) {
            for (const key in defaults) currentSettings[key] = Array.isArray(defaults[key]) ? [...defaults[key]] : defaults[key];
            updateUI(), scheduleApply()
        }
    })

    document.getElementById("lofiLayerAddBtn").addEventListener("click", () => {
        const type = document.getElementById("lofiLayer").value;
        if (!type || !LOFI_SCHEMAS[type]) return;
        if (!Array.isArray(currentSettings.distortionLayers)) currentSettings.distortionLayers = [];
        if (currentSettings.distortionLayers.some(l => l.type === type)) return;

        const newLayer = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            type: type,
            params: {}
        };
        LOFI_SCHEMAS[type].options.forEach(p => { newLayer.params[p.id] = p.def; });
        currentSettings.distortionLayers.push(newLayer);

        renderLoFiLayers();
        updateSectionResetIcons();
        switchToCustomIfNeeded();
        scheduleApply();
    });

    document.getElementById("lofi-items").addEventListener("click", e => {
        if (e.target.closest(".close")) {
            const row = e.target.closest(".modulation-row");
            if (!row) return;
            const layerId = row.dataset.id;
            currentSettings.distortionLayers = (currentSettings.distortionLayers || []).filter(l => l.id !== layerId);
            renderLoFiLayers();
            updateSectionResetIcons();
            switchToCustomIfNeeded();
            scheduleApply();
        }
    });

    document.getElementById("lofi-items").addEventListener("input", e => {
        if (e.target.matches("input[type=range]")) {
            const layerId = e.target.dataset.layerId;
            const paramId = e.target.dataset.paramId;
            const val = parseFloat(e.target.value);
            const layer = (currentSettings.distortionLayers || []).find(l => l.id === layerId);
            if (layer && layer.params && paramId) {
                layer.params[paramId] = val;
                syncVisualSlider(e.target);
                const paramDef = LOFI_SCHEMAS[layer.type] ? LOFI_SCHEMAS[layer.type].options.find(function (p) { return p.id === paramId }) : null;
                const unit = paramDef ? paramDef.unit : "";
                const wrapper = e.target.closest(".range-slider");
                if (wrapper) {
                    const topLabel = wrapper.querySelector(".range-slider__legend-top");
                    if (topLabel) {
                        let displayVal = val;
                        if (paramDef) displayVal = paramDef.step >= 1 ? Math.round(val) : paramDef.step < 0.1 ? val.toFixed(2) : val.toFixed(1);
                        topLabel.textContent = displayVal + (unit ? " " + unit : "");
                    }
                }
                updateSectionResetIcons();
                switchToCustomIfNeeded();
                scheduleApply();
            }
        }
    });

    // Обработчик добавления слоя модуляции
    document.getElementById('modulationLayerAddBtn').addEventListener('click', () => {
        const select = document.getElementById('modulationLayer');
        const type = select.value;
        if (!type || !MODULATION_SCHEMAS[type]) return;

        if (!Array.isArray(currentSettings.modulationLayers)) {
            currentSettings.modulationLayers = [];
        }

        // Проверяем, нет ли уже такого типа модуляции (запрещаем дубликаты)
        if (currentSettings.modulationLayers.some(l => l.type === type)) {
            return;
        }

        // Генерируем уникальный ID для слоя
        const newLayer = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            type: type,
            params: {}
        };

        // Заполняем параметры дефолтными значениями из схемы
        MODULATION_SCHEMAS[type].options.forEach(p => { newLayer.params[p.id] = p.def });

        currentSettings.modulationLayers.push(newLayer);
        renderModulationLayers();
        updateSectionResetIcons();
        switchToCustomIfNeeded();
        scheduleApply();
    });

    // Делегированный обработчик кликов внутри контейнера модуляций (удаление слоев)
    document.getElementById('modulation-items').addEventListener('click', (e) => {
        if (e.target.closest('.close')) {
            const row = e.target.closest('.modulation-row');
            if (!row) return;
            const layerId = row.dataset.id;

            currentSettings.modulationLayers = (currentSettings.modulationLayers || []).filter(l => l.id !== layerId);
            renderModulationLayers();
            updateSectionResetIcons();
            switchToCustomIfNeeded();
            scheduleApply();
        }
    });

    // Делегированный обработчик изменения слайдеров модуляции
    document.getElementById("modulation-items").addEventListener("input", e => {
        if (e.target.matches("input[type=range]")) {
            const layerId = e.target.dataset.layerId,
                paramId = e.target.dataset.paramId,
                val = parseFloat(e.target.value),
                layer = (currentSettings.modulationLayers || []).find(l => l.id === layerId);
            if (layer && layer.params && paramId) {
                layer.params[paramId] = val, syncVisualSlider(e.target);
                const schema = MODULATION_SCHEMAS[layer.type];
                const paramDef = schema ? schema.options.find(function (p) { return p.id === paramId }) : null;
                const unit = paramDef ? paramDef.unit : "";
                const wrapper = e.target.closest(".range-slider");
                if (wrapper) {
                    const topLabel = wrapper.querySelector(".range-slider__legend-top");
                    if (topLabel) {
                        let displayVal = val;
                        paramDef && (paramDef.step >= 1 ? displayVal = Math.round(val) : paramDef.step < .1 ? displayVal = val.toFixed(2) : displayVal = val.toFixed(1));
                        topLabel.textContent = displayVal + (unit ? " " + unit : "")
                    }
                }
                updateSectionResetIcons(), switchToCustomIfNeeded(), scheduleApply()
            }
        }
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
            updateEqualizerGraph(), updateEqPresetSelectUI();
            document.querySelectorAll("#eqSettingsPanel .eq-container .range-slider").forEach((w, i) => updateEqLegend(i, currentSettings.eqGains[i]))
        }
    }

    function renderLoFiLayers() {
        const container = document.getElementById("lofi-items");
        container.innerHTML = "";
        if (!Array.isArray(currentSettings.distortionLayers)) currentSettings.distortionLayers = [];

        currentSettings.distortionLayers.forEach((layer, idx) => {
            const schema = LOFI_SCHEMAS[layer.type];
            if (!schema) return;

            const row = document.createElement("div");
            row.className = "modulation-row";
            row.dataset.id = layer.id;

            const header = document.createElement("div");
            header.className = "modulation-row__header";
            const title = document.createElement("span");
            title.textContent = schema.name;
            const closeBtn = document.createElement("button");
            closeBtn.className = "close"; closeBtn.type = "button"; closeBtn.textContent = "×";
            header.appendChild(title); header.appendChild(closeBtn);

            const slidersContainer = document.createElement("div");
            slidersContainer.className = "modulation-container";
            slidersContainer.style.display = "flex"; slidersContainer.style.alignItems = "center";
            slidersContainer.style.height = "150px"; slidersContainer.style.gap = "8px";

            schema.options.forEach(param => {
                const currentVal = void 0 !== layer.params[param.id] ? layer.params[param.id] : param.def;
                const sliderWrapper = document.createElement("div");
                sliderWrapper.className = "range-slider legend-bottom legend-top";
                sliderWrapper.style.setProperty("--orientation", "vertical");
                sliderWrapper.style.height = "100%";

                const input = document.createElement("input");
                input.type = "range"; input.setAttribute("orient", "vertical");
                input.min = param.min; input.max = param.max; input.step = param.step; input.value = currentVal;
                input.dataset.layerId = layer.id; input.dataset.paramId = param.id;
                sliderWrapper.appendChild(input);
                sliderWrapper.insertAdjacentHTML("beforeend", '<div class="range-slider__track"></div><div class="range-slider__bar"></div><div class="range-slider__thumb"></div>');

                const labelTop = document.createElement("div");
                labelTop.className = "range-slider__legend-top";
                let displayVal = currentVal;
                if (param.unit) {
                    displayVal = param.step >= 1 ? Math.round(currentVal) : param.step < 0.1 ? currentVal.toFixed(2) : currentVal.toFixed(1);
                    labelTop.textContent = displayVal + " " + param.unit;
                } else { labelTop.textContent = currentVal; }
                sliderWrapper.appendChild(labelTop);

                const labelBottom = document.createElement("div");
                labelBottom.className = "range-slider__legend-bottom";
                labelBottom.textContent = param.label;
                sliderWrapper.appendChild(labelBottom);
                slidersContainer.appendChild(sliderWrapper);
            });

            row.appendChild(header); row.appendChild(slidersContainer);
            container.appendChild(row);
        });

        container.querySelectorAll(".range-slider input").forEach(syncVisualSlider);
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
        gainPanel.open = currentSettings.toggleState?.gainSettings ?? true;

        eqPresetSelect.value = currentSettings.eqPreset || "flat";
        gainOutputSlider.value = currentSettings.gainOutputDb;
        gainOutputVal.textContent = formatDb(currentSettings.gainOutputDb);
        effectsMixSlider.value = currentSettings.effectsMix;
        effectsMixVal.textContent = currentSettings.effectsMix + "%";

        stereoPanel.open = currentSettings.toggleState?.stereoSettings ?? !1,
            reverbPanel.open = currentSettings.toggleState?.reverbSettings ?? !1,
            reverbPresetSelect.value = currentSettings.reverbType || "null",
            reverbWetSlider.value = currentSettings.reverbWet,
            reverbWetVal.textContent = currentSettings.reverbWet + "%",
            centerCancelSlider.value = currentSettings.centerCancel,
            centerCancelVal.textContent = currentSettings.centerCancel,
            channelBalanceSlider.value = currentSettings.channelBalance,
            channelBalanceVal.textContent = currentSettings.channelBalance,
            stereoWidthMixSlider.value = currentSettings.stereoWidthMix,
            stereoWidthMixVal.textContent = currentSettings.stereoWidthMix + "%",
            stereoCenterMixSlider.value = currentSettings.stereoCenterMix,
            stereoCenterMixVal.textContent = currentSettings.stereoCenterMix + "%",
            stereoFocusMixSlider.value = currentSettings.stereoFocusMix,
            stereoFocusMixVal.textContent = currentSettings.stereoFocusMix + "%",
            bassPanel.open = currentSettings.toggleState?.bassSettings ?? !1,
            subbassMixSlider.value = currentSettings.subbassMix,
            subbassMixVal.textContent = currentSettings.subbassMix + "%",
            warmthMixSlider.value = currentSettings.warmthMix,
            warmthMixVal.textContent = currentSettings.warmthMix + "%",
            clarityPanel.open = currentSettings.toggleState?.claritySettings ?? !1,
            definitionMixSlider.value = currentSettings.definitionMix,
            definitionMixVal.textContent = currentSettings.definitionMix + "%",
            delayPanel.open = currentSettings.toggleState?.delaySettings ?? !1,
            delayTimeSlider.value = currentSettings.delayTime, delayTimeVal.textContent = currentSettings.delayTime + " ms",
            delayFeedbackSlider.value = currentSettings.delayFeedback, delayFeedbackVal.textContent = currentSettings.delayFeedback + "%",
            delayMixSlider.value = currentSettings.delayMix, delayMixVal.textContent = currentSettings.delayMix + "%",


            distortionPanel.open = currentSettings.toggleState?.distortionSettings ?? !1,
            distMixSlider.value = currentSettings.distMix, distMixVal.textContent = currentSettings.distMix + "%",
            renderLoFiLayers(),

            dynamicsPanel.open = currentSettings.toggleState?.dynamicsSettings ?? !1,
            surroundPanel.open = currentSettings.toggleState?.surroundSettings ?? !1,
            modulationPanel.open = currentSettings.toggleState?.modulationSettings ?? !1,

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
            optimisationDelayCheck.checked = currentSettings.optimisationDelay || !1,
            enableVisualizationCheck.checked = currentSettings.enableVisualization !== !1,
            overlayCheck.checked = currentSettings.overlayEnabled || !1,
            globalPresetSelect.multiple = overlayCheck.checked
        // Восстанавливаем выделение в мультиселекте при загрузке
        if (overlayCheck.checked) {
            const activeIds = currentSettings.overlayPresets || ["default"];
            Array.from(globalPresetSelect.options).forEach(opt => { opt.selected = activeIds.includes(opt.value) });
        }
        const eqSliders = document.querySelectorAll('#eqSettingsPanel .eq-container .range-slider input');
        eqSliders.forEach((input, i) => {
            const targetVal = void 0 !== currentSettings.eqGains[i] ? currentSettings.eqGains[i] : 50;
            if (input.value !== String(targetVal)) {
                input.value = input.min;
                input.offsetWidth; // Принудительный reflow для корректного обновления CSS
            }
            input.value = targetVal;
            syncVisualSlider(input);
            updateEqLegend(i, targetVal);
        });

        document.querySelectorAll(".range-slider input").forEach(syncVisualSlider);
        updateEqualizerGraph(), updateEqPresetSelectUI(), updateSectionResetIcons(), renderModulationLayers(),
            currentSettings.enableVisualization !== !1 ? startVisualization() : stopVisualization()
    }

    function formatDb(val) { return val > 0 ? `+${val} dB` : `${val} dB`; }

    function updateEqLegend(index, val) {
        const wrapper = document.querySelectorAll("#eqSettingsPanel .eq-container .range-slider")[index];
        if (!wrapper) return;
        const legend = wrapper.querySelector(".range-slider__legend-top");
        if (!legend) return;
        const db = Math.round((val - 50) / 5);
        legend.textContent = db > 0 ? `+${db}` : `${db}`;
    }

    function getEqBarElements() {
        return vizElementsCache || (vizElementsCache = Array.from(document.querySelectorAll("#eqSettingsPanel .eq-container .range-slider")))
    }

    function applyVizLevels(levels) {
        const wrappers = getEqBarElements();
        levels.forEach((lvl, i) => { wrappers[i] && wrappers[i].style.setProperty("--bar-pct", Math.max(0, Math.min(1, lvl))) })
    }

    function clearVizLevels() {
        getEqBarElements().forEach(w => w.style.removeProperty("--bar-pct"))
    }

    function startVisualization() {
        if (vizPort) return;
        chrome.tabs.query({ active: !0, currentWindow: !0 }).then(([tab]) => {
            if (!tab?.id) return;

            try {
                vizPort = chrome.tabs.connect(tab.id, { name: "ws-eq-viz" });

                // ПРОВЕРКА: Если не удалось подключиться (например, это chrome:// страница),
                // chrome устанавливает lastError. Мы проверяем это, чтобы избежать ошибки в консоли.
                if (chrome.runtime.lastError) {
                    // console.log("Viz connect skipped:", chrome.runtime.lastError.message);
                    vizPort = null;
                    return;
                }

                vizPort.onMessage.addListener(msg => {
                    if (msg?.type === "WS_VIZ_DATA") {
                        const wrappers = getEqBarElements();
                        msg.levels.forEach((lvl, i) => {
                            if (wrappers[i]) wrappers[i].style.setProperty("--bar-pct", Math.max(0, Math.min(1, lvl)));
                        });
                    }
                });

                vizPort.onDisconnect.addListener(() => {
                    vizPort = null;
                });

                vizPort.postMessage({ command: "start" });
            } catch (e) {
                vizPort = null;
            }
        });
    }

    function stopVisualization() {
        if (vizPort) { try { vizPort.postMessage({ command: "stop" }) } catch (e) { } try { vizPort.disconnect() } catch (e) { } vizPort = null }
        clearVizLevels()
    }

    function updateDistSubUI(type) {
        document.querySelectorAll('.dist-sub').forEach(el => {
            el.style.display = el.dataset.type === type ? '' : 'none';
        });
    }

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
        // ЖЕЛЕЗОБЕТОННАЯ ЗАЩИТА: если в currentSettings пресеты случайно затерлись пустым объектом, 
        // но в storage они есть, мы их не удаляем.
        const storageSnap = await chrome.storage.local.get("pitchSettings");
        const savedPresets = storageSnap.pitchSettings?.globalPresets;
        if (savedPresets && Object.keys(savedPresets).length > 0 &&
            (!currentSettings.globalPresets || Object.keys(currentSettings.globalPresets).length === 0)) {
            currentSettings.globalPresets = savedPresets;
        }

        await chrome.storage.local.set({ pitchSettings: currentSettings });
        const [tab] = await chrome.tabs.query({ active: !0, currentWindow: !0 });
        if (tab?.id) {
            try {
                const payload = {
                    type: "updateSettings",
                    settings: currentSettings,
                    overlayPresets: getActiveOverlayPresets(),
                    overlayConfig: OVERLAY_CONFIG
                };
                await chrome.tabs.sendMessage(tab.id, payload)
            } catch (e) { }
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
            gainSettings: gainPanel.open,
            pitchSettings: pitchSettingsPanel.open,
            speedSettings: speedSettingsPanel.open,
            eqSettings: eqSettingsPanel.open,
            stereoSettings: stereoPanel.open,
            reverbSettings: reverbPanel.open,
            claritySettings: clarityPanel.open,
            bassSettings: bassPanel.open,
            dynamicsSettings: dynamicsPanel.open,
            surroundSettings: surroundPanel.open,
            modulationSettings: modulationPanel.open,
            delaySettings: delayPanel.open,
            distortionSettings: distortionPanel.open
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
            if ("gainOutputDb" === id) {
                currentSettings.gainOutputDb = val;
                gainOutputVal.textContent = formatDb(val);
                if (isOverlayActive()) {
                    const selectedOptions = Array.from(globalPresetSelect.selectedOptions);
                    if (selectedOptions.length > 0) {
                        const lastOption = selectedOptions[selectedOptions.length - 1];
                        const presetId = lastOption.value;
                        if (currentSettings.globalPresets[presetId]) {
                            currentSettings.globalPresets[presetId].values.gainOutputDb = val;
                        }
                    }
                }
            }


            if (id === "effectsMix") {
                currentSettings.effectsMix = val;
                effectsMixVal.textContent = val + "%"
            }

            if (id === "reverbWet") {
                currentSettings.reverbWet = val;
                reverbWetVal.textContent = val + "%";
            }
            if (id === "centerCancel") {
                currentSettings.centerCancel = val;
                centerCancelVal.textContent = val;
            }
            if (id === "channelBalance") {
                currentSettings.channelBalance = val;
                channelBalanceVal.textContent = val;
            }


            if (id === "stereoWidthMix") { currentSettings.stereoWidthMix = val, stereoWidthMixVal.textContent = val + "%" }
            if (id === "stereoCenterMix") { currentSettings.stereoCenterMix = val, stereoCenterMixVal.textContent = val + "%" }
            if (id === "stereoFocusMix") { currentSettings.stereoFocusMix = val, stereoFocusMixVal.textContent = val + "%" }

            if (id == "definitionMix") {
                currentSettings.definitionMix = val;
                definitionMixVal.textContent = val + "%";
            }

            if ("subbassMix" === id) {
                currentSettings.subbassMix = val, subbassMixVal.textContent = val + "%"
            }
            if ("warmthMix" === id) {
                currentSettings.warmthMix = val, warmthMixVal.textContent = val + "%"
            }
            if ("definitionMix" === id) {
                currentSettings.definitionMix = val, definitionMixVal.textContent = val + "%"
            }


            if (id === "delayTime") {
                currentSettings.delayTime = val;
                delayTimeVal.textContent = val + " ms";
            }
            if (id === "delayFeedback") {
                currentSettings.delayFeedback = val;
                delayFeedbackVal.textContent = val + "%";
            }
            if (id === "delayMix") {
                currentSettings.delayMix = val;
                delayMixVal.textContent = val + "%";
            }

            if (id === "delayMix") { currentSettings.delayMix = val, delayMixVal.textContent = val + "%" }

            if (id === "distMix") { currentSettings.distMix = val, distMixVal.textContent = val + "%" }


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
                if (index < currentSettings.eqGains.length) {
                    currentSettings.eqGains[index] = val;
                    currentSettings.eqPreset = "custom";
                    currentSettings.eqPresets = {
                        ...currentSettings.eqPresets || {},
                        custom: {
                            name: "Custom",
                            genres: [],
                            values: [...currentSettings.eqGains]
                        }
                    };
                    updateEqualizerGraph(); updateEqPresetSelectUI(); updateEqLegend(index, val);
                }
            }
            updateSectionResetIcons(), switchToCustomIfNeeded(), scheduleApply();
        });
    });

    smartCheck.addEventListener("change", e => { currentSettings.applySmartProcessing = e.target.checked, updateSectionResetIcons(), switchToCustomIfNeeded(), scheduleApply() });
    preservePitchCheck.addEventListener("change", e => { currentSettings.preservePitch = e.target.checked, updateSectionResetIcons(), switchToCustomIfNeeded(), scheduleApply() });

    optimisationDelayCheck.addEventListener("change", e => {
        currentSettings.optimisationDelay = e.target.checked;
        scheduleApply()
    });

    dolbyEnabledCheck.addEventListener("change", e => {
        currentSettings.dolbyEnabled = e.target.checked;
        updateSectionResetIcons();
        switchToCustomIfNeeded();
        scheduleApply();
    })

    reverbPresetSelect.addEventListener("change", e => {
        currentSettings.reverbType = e.target.value === "null" ? null : e.target.value;
        updateSectionResetIcons();
        switchToCustomIfNeeded();
        scheduleApply();
    });

    eqPresetSelect.addEventListener("change", e => { applyEqPresetToUI(e.target.value), updateSectionResetIcons(), switchToCustomIfNeeded(), scheduleApply() })

    enableVisualizationCheck.addEventListener("change", e => {
        currentSettings.enableVisualization = e.target.checked;
        e.target.checked ? startVisualization() : stopVisualization();
        scheduleApply()
    });

    resetBtn.addEventListener("click", async () => {
        // 1. СОХРАНЯЕМ пользовательские пресеты в безопасное место ДО сброса
        const savedUserPresets = JSON.parse(JSON.stringify(currentSettings.globalPresets || {}));
        delete savedUserPresets.custom; // Временный системный пресет удаляем

        let defaultSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

        // 2. Собираем настройки, гарантируя что пресеты не затрутся дефолтным пустым объектом
        currentSettings = {
            ...defaultSettings,
            blacklistPatterns: currentSettings.blacklistPatterns || [],
            toggleState: currentSettings.toggleState || defaultSettings.toggleState,
            eqPresets: currentSettings.eqPresets || {},
            globalPresets: savedUserPresets, // Возвращаем только то, что создал юзер
            globalPreset: "default",
            overlayEnabled: false,
            overlayPresets: []
        };

        updateUI(), renderBlacklistList(), renderGlobalPresetList(), updateGlobalPresetSelectUI(), await applySettings()
    })

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

    // --- ОБРАБОТЧИКИ ОВЕРЛЕЯ И ГЛОБАЛЬНЫХ ПРЕСЕТОВ ---
    overlayCheck.addEventListener("change", e => {
        if (currentSettings.overlayEnabled = e.target.checked, globalPresetSelect.multiple = e.target.checked, e.target.checked) {
            // Берем то, что сейчас выбрано в выпадающем списке (как в старой версии)
            const sel = globalPresetSelect.value || "default";
            currentSettings.overlayPresets = [sel];
            userDisabledCustomInOverlay = false;
            toggleGlobalUIControls(true);
        } else {
            currentSettings.globalPreset = currentSettings.overlayPresets?.[0] || "default";
            userDisabledCustomInOverlay = false;
            toggleGlobalUIControls(false);
        }
        updateGlobalPresetSelectUI();
        scheduleApply();
    });

    globalPresetSelect.addEventListener("change", e => {
        if (isOverlayActive()) {
            const newIds = Array.from(globalPresetSelect.selectedOptions).map(o => o.value);
            const previouslyHadCustom = (currentSettings.overlayPresets || []).includes("custom");
            const nowHasCustom = newIds.includes("custom");
            previouslyHadCustom && !nowHasCustom && (userDisabledCustomInOverlay = true);
            nowHasCustom && (userDisabledCustomInOverlay = false);
            currentSettings.overlayPresets = newIds;

            if (newIds.length === 1) {
                applyGlobalPresetToUI(newIds[0]);
            } else {
                // Показываем громкость последнего выбранного пресета
                const lastId = newIds[newIds.length - 1];
                const preset = currentSettings.globalPresets[lastId];
                if (preset && preset.values.gainOutputDb !== undefined) {
                    const gain = preset.values.gainOutputDb;
                    currentSettings.gainOutputDb = gain;
                    gainOutputSlider.value = gain;
                    gainOutputVal.textContent = formatDb(gain);
                }
            }
        } else {
            currentSettings.globalPreset = globalPresetSelect.value;
            applyGlobalPresetToUI(globalPresetSelect.value);
        }
        scheduleApply();
    });

    function applyGlobalPresetToUI(presetId) {
        const preset = getAllGlobalPresets()[presetId];
        if (!preset) return;
        suppressCustomSync = !0; // это ЗАГРУЗКА пресета, а не правка пользователя — не трогаем "custom"
        currentSettings.globalPreset = presetId;
        const vals = preset.values, skip = new Set(["eqGains", "blacklistPatterns", "toggleState", "eqPresets", "globalPresets", "overlayPresets", "overlayEnabled", "optimisationDelay"]);
        for (const key in vals) skip.has(key) || (currentSettings[key] = JSON.parse(JSON.stringify(vals[key])));
        updateUI()
    }

    globalPresetsBtn.addEventListener("click", () => {
        renderGlobalPresetList();
        simpleModal.openModal("globalPresetModal", "#globalPresetNameInput");
    });

    globalPresetAddBtn.addEventListener("click", addGlobalPreset);
    globalPresetNameInput.addEventListener("keydown", async e => {
        if (e.key === "Enter") { e.preventDefault(); await addGlobalPreset(); }
        if (e.key === "Escape") simpleModal.closeModal("globalPresetModal");
    });

    globalPresetList.addEventListener("input", e => {
        const row = e.target.closest(".blacklist-item");
        if (!row) return;
        const id = row.dataset.id;
        const nameInp = row.querySelector("input:nth-child(1)");
        currentSettings.globalPresets[id].name = nameInp.value.trim() || "Unnamed";
        if (currentSettings.globalPreset === id || (currentSettings.overlayPresets || []).includes(id)) updateGlobalPresetSelectUI();
        scheduleApply();
    });

    globalPresetList.addEventListener("click", async e => {
        const btn = e.target.closest(".blacklist-item-delete");
        if (!btn) return;
        const id = btn.closest(".blacklist-item")?.dataset.id;
        if (id) {
            delete currentSettings.globalPresets[id];
            if (currentSettings.globalPreset === id) applyGlobalPresetToUI("default");
            currentSettings.overlayPresets = (currentSettings.overlayPresets || []).filter(pId => pId !== id);
            renderGlobalPresetList();
            updateGlobalPresetSelectUI();
            scheduleApply();
        }
    });

    [gainPanel, pitchSettingsPanel, speedSettingsPanel, eqSettingsPanel, stereoPanel, reverbPanel, bassPanel, clarityPanel, delayPanel, distortionPanel, dynamicsPanel, surroundPanel, modulationPanel].forEach(p => p.addEventListener("toggle", saveToggleState));

    updateUI(), renderBlacklistList(), renderEqPresetList(), renderGlobalPresetList(), updateGlobalPresetSelectUI(), renderModulationLayers(), await refreshSiteStatus()
})();