/* global MonitorAudioRouterRules */
"use strict";

importScripts("shared/rule-engine.js");

const RULES = MonitorAudioRouterRules;
const STORAGE_KEY = "monitorAudioRouterSettings";
const SETTINGS_BACKUP_KEY = "monitorAudioRouterSettingsBackup";
const STATUS_KEY = "monitorAudioRouterStatus";
const MANUAL_OVERRIDES_KEY = "monitorAudioRouterManualOverrides";
const ROUTE_DEBOUNCE_MS = 350;
const BACKED_UP_SETTING_KEYS = [
  "version",
  "autoRoutingEnabled",
  "debugEnabled",
  "knownDevices",
  "cycleDeviceLabels",
  "systemDefaultDeviceLabel",
  "systemDefaultDeviceLabelNormalized",
  "monitorRoutingScope",
  "monitorRoutingSites",
  "monitorRoutingOverridesManual",
  "displayRules",
  "settingsSavedAt"
];

const DEFAULT_SETTINGS = {
  version: 1,
  autoRoutingEnabled: true,
  debugEnabled: false,
  knownDevices: [],
  cycleDeviceLabels: [],
  systemDefaultDeviceLabel: "",
  systemDefaultDeviceLabelNormalized: "",
  monitorRoutingScope: "all",
  monitorRoutingSites: [],
  monitorRoutingOverridesManual: true,
  displayRules: [],
  managedMicrophonePatterns: [],
  managedSoundPatterns: []
};

let routeTimer = null;
let lastRouteReason = "startup";
const manualTabOverrides = new Map();
const cycleIndexByTab = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(raw) {
  return {
    ...clone(DEFAULT_SETTINGS),
    ...(raw || {}),
    knownDevices: Array.isArray(raw && raw.knownDevices) ? raw.knownDevices : [],
    cycleDeviceLabels: Array.isArray(raw && raw.cycleDeviceLabels) ? raw.cycleDeviceLabels : [],
    systemDefaultDeviceLabel: typeof (raw && raw.systemDefaultDeviceLabel) === "string" ? raw.systemDefaultDeviceLabel : "",
    systemDefaultDeviceLabelNormalized: typeof (raw && raw.systemDefaultDeviceLabelNormalized) === "string" ? raw.systemDefaultDeviceLabelNormalized : "",
    monitorRoutingScope: raw && raw.monitorRoutingScope === "sites" ? "sites" : "all",
    monitorRoutingSites: Array.isArray(raw && raw.monitorRoutingSites) ? raw.monitorRoutingSites : [],
    monitorRoutingOverridesManual: raw && raw.monitorRoutingOverridesManual === false ? false : true,
    displayRules: Array.isArray(raw && raw.displayRules) ? raw.displayRules : [],
    siteRules: [],
    managedMicrophonePatterns: Array.isArray(raw && raw.managedMicrophonePatterns) ? raw.managedMicrophonePatterns : [],
    managedSoundPatterns: Array.isArray(raw && raw.managedSoundPatterns) ? raw.managedSoundPatterns : []
  };
}

function createSettingsBackup(settings) {
  const backup = {};
  for (const key of BACKED_UP_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      backup[key] = settings[key];
    }
  }
  return backup;
}

function savedAtValue(settings) {
  const time = Date.parse(settings && settings.settingsSavedAt || "");
  return Number.isNaN(time) ? 0 : time;
}

function chooseStoredSettings(localSettings, backupSettings) {
  if (!localSettings) {
    return backupSettings || null;
  }
  if (!backupSettings) {
    return localSettings;
  }
  return savedAtValue(backupSettings) > savedAtValue(localSettings)
    ? backupSettings
    : localSettings;
}

async function storageGet(area, key) {
  if (!area) {
    return null;
  }
  try {
    const result = await area.get(key);
    return result && result[key] || null;
  } catch (_) {
    return null;
  }
}

function manualOverrideStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function normalizeManualOverride(raw) {
  if (!raw || typeof raw !== "object" || !raw.deviceSelector || typeof raw.deviceSelector !== "object") {
    return null;
  }

  return {
    deviceSelector: raw.deviceSelector,
    label: String(raw.label || "시스템 기본 장치"),
    displayId: String(raw.displayId || ""),
    displayName: String(raw.displayName || ""),
    origin: String(raw.origin || ""),
    updatedAt: String(raw.updatedAt || "")
  };
}

async function getStoredManualOverrides() {
  const stored = await storageGet(manualOverrideStorageArea(), MANUAL_OVERRIDES_KEY);
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

async function saveStoredManualOverrides(overrides) {
  const area = manualOverrideStorageArea();
  if (!area) {
    return;
  }
  await area.set({ [MANUAL_OVERRIDES_KEY]: overrides });
}

async function getManualOverride(tabId) {
  if (!tabId) {
    return null;
  }

  const cached = manualTabOverrides.get(tabId);
  if (cached) {
    return cached;
  }

  const overrides = await getStoredManualOverrides();
  const override = normalizeManualOverride(overrides[String(tabId)]);
  if (!override) {
    return null;
  }

  manualTabOverrides.set(tabId, override);
  return override;
}

async function setManualOverride(tabId, override) {
  if (!tabId) {
    return;
  }

  const normalized = normalizeManualOverride(override);
  if (!normalized) {
    return;
  }

  manualTabOverrides.set(tabId, normalized);
  const overrides = await getStoredManualOverrides();
  overrides[String(tabId)] = normalized;
  await saveStoredManualOverrides(overrides);
}

async function deleteManualOverride(tabId) {
  if (!tabId) {
    return;
  }

  manualTabOverrides.delete(tabId);
  cycleIndexByTab.delete(tabId);
  const overrides = await getStoredManualOverrides();
  const key = String(tabId);
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    delete overrides[key];
    await saveStoredManualOverrides(overrides);
  }
}

async function saveSettingsBackup(settings) {
  if (!chrome.storage.sync) {
    return;
  }
  try {
    await chrome.storage.sync.set({
      [SETTINGS_BACKUP_KEY]: createSettingsBackup(settings)
    });
  } catch (_) {
    // chrome.storage.sync can be unavailable or quota-limited. Local storage remains authoritative.
  }
}

async function getSettings() {
  const localSettings = await storageGet(chrome.storage.local, STORAGE_KEY);
  const backupSettings = await storageGet(chrome.storage.sync, SETTINGS_BACKUP_KEY);
  const selected = chooseStoredSettings(localSettings, backupSettings);
  if (selected && selected === backupSettings && backupSettings !== localSettings) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: mergeSettings(backupSettings)
    });
  }
  return mergeSettings(selected);
}

async function saveSettings(settings) {
  const stamped = {
    ...mergeSettings(settings),
    settingsSavedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: stamped
  });
  await saveSettingsBackup(stamped);
}

async function getStatus() {
  const result = await chrome.storage.local.get(STATUS_KEY);
  return result[STATUS_KEY] || null;
}

async function setStatus(status) {
  const stamped = {
    ...status,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STATUS_KEY]: stamped });
  return stamped;
}

function scheduleRoute(reason) {
  lastRouteReason = reason || "unknown";
  if (routeTimer) {
    clearTimeout(routeTimer);
  }
  routeTimer = setTimeout(() => {
    routeTimer = null;
    routeActiveTab(lastRouteReason).catch((error) => {
      setStatus({
        result: "error",
        reason: lastRouteReason,
        error: error.message || String(error)
      });
    });
  }, ROUTE_DEBOUNCE_MS);
}

async function getLastFocusedNormalWindow() {
  try {
    return await chrome.windows.getLastFocused({
      populate: true,
      windowTypes: ["normal"]
    });
  } catch (_) {
    return null;
  }
}

function getActiveTabFromWindow(windowInfo) {
  if (!windowInfo || !Array.isArray(windowInfo.tabs)) {
    return null;
  }
  return windowInfo.tabs.find((tab) => tab.active) || null;
}

function getDisplayBounds(display) {
  return display && (display.bounds || display.workArea) || null;
}

function enrichDisplayRuleGeometry(settings, displays) {
  if (!settings || !Array.isArray(settings.displayRules) || !Array.isArray(displays)) {
    return false;
  }

  let changed = false;
  for (const rule of settings.displayRules) {
    if (!rule || !rule.displayId) {
      continue;
    }

    const display = displays.find((item) => item && item.id === rule.displayId);
    const displayBoundsKey = RULES.displayBoundsKey(display);
    if (!display || !displayBoundsKey) {
      continue;
    }

    if (rule.displayBoundsKey !== displayBoundsKey) {
      rule.displayBoundsKey = displayBoundsKey;
      changed = true;
    }

    const bounds = getDisplayBounds(display);
    if (bounds && JSON.stringify(rule.displayBounds || null) !== JSON.stringify(bounds)) {
      rule.displayBounds = bounds;
      changed = true;
    }
  }

  return changed;
}

async function getTabById(tabId) {
  if (!tabId) {
    return null;
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

function selectedRuleLabel(route) {
  if (!route) {
    return "없음";
  }
  if (route.source === "display") {
    return "모니터 규칙";
  }
  if (route.source === "shortcut") {
    return "단축키 수동 전환";
  }
  if (route.source === "disabled") {
    return "자동 라우팅 꺼짐";
  }
  if (route.source === "out-of-scope") {
    return "등록되지 않은 사이트";
  }
  return "기본 장치";
}

function monitorRoutingScopeLabel(settings) {
  return settings && settings.monitorRoutingScope === "sites"
    ? "등록한 사이트에서만 적용"
    : "모든 사이트에서 적용";
}

function isActiveOriginInScope(settings, origin) {
  if (settings && settings.autoRoutingEnabled === false) {
    return true;
  }
  return RULES.isMonitorRoutingAllowed(settings, origin);
}

async function setOutOfScopeStatus({ activeTab, display, origin, reason, settings }) {
  if (activeTab && activeTab.id) {
    await disableInjectedRoute(activeTab.id);
  }

  const registeredCount = RULES.getMonitorRoutingSites(settings)
    .filter((site) => site && site.enabled !== false && site.originPattern)
    .length;

  return await setStatus({
    tabId: activeTab && activeTab.id,
    tabTitle: activeTab && activeTab.title || "",
    tabUrl: activeTab && activeTab.url || "",
    origin,
    displayId: display && display.id || "",
    displayName: RULES.displayLabel(display),
    selectedRule: "등록되지 않은 사이트",
    selectedRuleSource: "out-of-scope",
    sinkLabel: "건드리지 않음",
    result: "skipped",
    reason,
    scope: monitorRoutingScopeLabel(settings),
    registeredSiteCount: registeredCount,
    error: registeredCount === 0
      ? "등록한 사이트에서만 적용 중이지만 등록된 사이트가 없어 아무 사이트에도 적용하지 않습니다."
      : "등록한 사이트에서만 적용하도록 설정되어 있어 이 사이트는 건드리지 않습니다."
  });
}

function getDeviceDisplayLabel(selector) {
  if (RULES.isDefaultSelector(selector)) {
    return "시스템 기본 장치";
  }
  return selector.labelExact || selector.labelNormalized || "선택된 장치";
}

function selectorOutputKey(settings, selector) {
  if (RULES.isDefaultSelector(selector)) {
    const defaultLabel = settings && (
      settings.systemDefaultDeviceLabel ||
      settings.systemDefaultDeviceLabelNormalized
    ) || "";
    const defaultKey = RULES.canonicalDeviceLabel(defaultLabel);
    return defaultKey || "__default__";
  }

  return RULES.canonicalDeviceLabel(
    selector.labelExact ||
    selector.labelNormalized ||
    ""
  );
}

function selectorsTargetSameOutput(settings, left, right) {
  const leftKey = selectorOutputKey(settings, left);
  const rightKey = selectorOutputKey(settings, right);

  if (!leftKey || !rightKey) {
    return false;
  }

  return leftKey === rightKey;
}

function isMonitorMovementReason(reason) {
  return reason === "window-bounds" || reason === "display-changed";
}

function shouldMonitorRouteOverrideManual(settings, route, override, display, reason) {
  if (!settings.monitorRoutingOverridesManual || !override || !isMonitorMovementReason(reason)) {
    return false;
  }
  if (!route || route.source === "disabled" || route.source === "out-of-scope") {
    return false;
  }

  const currentDisplayId = display && display.id || "";
  if (override.displayId && currentDisplayId && override.displayId === currentDisplayId) {
    return false;
  }

  return !selectorsTargetSameOutput(settings, route.deviceSelector, override.deviceSelector);
}

function cleanDeviceLabel(label) {
  return String(label || "")
    .replace(/^default\s*[-:]\s*/i, "")
    .replace(/^communications\s*[-:]\s*/i, "")
    .replace(/^(?:기본값|기본|시스템 기본 장치|시스템 기본)\s*[-:]\s*/i, "")
    .replace(/^(?:통신|커뮤니케이션)\s*[-:]\s*/i, "")
    .replace(/\s+\(default\)$/i, "")
    .replace(/\s+\(communications\)$/i, "")
    .replace(/\s+\((?:기본값|기본|시스템 기본 장치|시스템 기본)\)$/i, "")
    .replace(/\s+\((?:통신|커뮤니케이션)\)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rememberSystemDefaultDevice(settings, devices) {
  const defaultDevice = (Array.isArray(devices) ? devices : [devices])
    .find((device) => device && device.kind === "audiooutput" && device.deviceId === "default" && device.label);
  if (!defaultDevice) {
    return settings;
  }

  const label = cleanDeviceLabel(defaultDevice.label);
  const normalized = RULES.normalizeDeviceLabel(label);
  if (!label || !normalized) {
    return settings;
  }

  settings.systemDefaultDeviceLabel = label;
  settings.systemDefaultDeviceLabelNormalized = normalized;
  return settings;
}

function getCycleCurrentFromSelector(selector) {
  const isDefault = RULES.isDefaultSelector(selector);
  return {
    isDefault,
    label: isDefault ? "" : selector.labelExact || "",
    labelNormalized: isDefault ? "" : selector.labelNormalized || RULES.normalizeDeviceLabel(selector.labelExact)
  };
}

function getCycleDeviceLabels(settings, current) {
  return RULES.getCycleDeviceLabels(settings, current);
}

function chromeSettingSet(details) {
  return new Promise((resolve, reject) => {
    chrome.contentSettings.microphone.set(details, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function chromeSettingClear(details) {
  return new Promise((resolve, reject) => {
    chrome.contentSettings.microphone.clear(details, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function getExtensionMicrophonePattern() {
  return `*://${chrome.runtime.id}/*`;
}

function chromeSoundSettingClear(details) {
  return new Promise((resolve, reject) => {
    if (!chrome.contentSettings.sound || typeof chrome.contentSettings.sound.clear !== "function") {
      resolve(false);
      return;
    }

    chrome.contentSettings.sound.clear(details, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(true);
    });
  });
}

function chromeSoundSettingSet(details) {
  return new Promise((resolve, reject) => {
    if (!chrome.contentSettings.sound || typeof chrome.contentSettings.sound.set !== "function") {
      resolve(false);
      return;
    }

    chrome.contentSettings.sound.set(details, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(true);
    });
  });
}

async function ensureMicrophonePermission(tabUrl, settings) {
  const pattern = RULES.contentSettingsPatternFromUrl(tabUrl);
  if (!pattern) {
    return settings;
  }

  await chromeSettingSet({
    primaryPattern: pattern,
    setting: "allow",
    scope: "regular"
  });

  const soundSet = await chromeSoundSettingSet({
    primaryPattern: pattern,
    setting: "allow",
    scope: "regular"
  });

  if (!settings.managedMicrophonePatterns.includes(pattern)) {
    settings.managedMicrophonePatterns.push(pattern);
  }
  if (soundSet && !settings.managedSoundPatterns.includes(pattern)) {
    settings.managedSoundPatterns.push(pattern);
  }
  await saveSettings(settings);

  return settings;
}

async function ensureExtensionMicrophonePermission(settings) {
  const pattern = getExtensionMicrophonePattern();
  await chromeSettingSet({
    primaryPattern: pattern,
    setting: "allow",
    scope: "regular"
  });

  if (!settings.managedMicrophonePatterns.includes(pattern)) {
    settings.managedMicrophonePatterns.push(pattern);
    await saveSettings(settings);
  }

  return settings;
}

async function ensureInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["main-world.js"],
    world: "MAIN",
    injectImmediately: true
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-isolated.js"],
    world: "ISOLATED",
    injectImmediately: true
  });
}

async function sendApplyMessage(tabId, payload) {
  return await chrome.tabs.sendMessage(tabId, {
    type: "MAR_APPLY_ROUTE",
    payload
  });
}

async function disableInjectedRoute(tabId) {
  if (!tabId) {
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "MAR_DISABLE_ROUTE",
      payload: {}
    });
  } catch (firstError) {
    try {
      await ensureInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, {
        type: "MAR_DISABLE_ROUTE",
        payload: {}
      });
    } catch (_) {
      return {
        ok: false,
        error: firstError && firstError.message || String(firstError)
      };
    }
  }
}

function addKnownDevice(settings, device) {
  const output = device && !device.kind && device.label
    ? { ...device, kind: "audiooutput" }
    : device;
  RULES.reconcileKnownDevices(settings, [output], new Date().toISOString(), { markMissing: false });
  return settings;
}

function addKnownDevices(settings, devices) {
  RULES.reconcileKnownDevices(settings, devices, new Date().toISOString());
  return settings;
}

function selectorMatchesDeviceLabel(selector, label) {
  if (!selector || !label) {
    return false;
  }

  const normalized = RULES.normalizeDeviceLabel(label);
  return Boolean(normalized && (
    RULES.normalizeDeviceLabel(selector.labelExact) === normalized ||
    selector.labelNormalized === normalized
  ));
}

function rememberSelectorOriginDeviceId(selector, origin, deviceInfo) {
  if (!selector || !origin || !deviceInfo || !deviceInfo.deviceId || !deviceInfo.label) {
    return false;
  }
  if (!selectorMatchesDeviceLabel(selector, deviceInfo.label)) {
    return false;
  }

  selector.preferredOriginDeviceIds = selector.preferredOriginDeviceIds || {};
  if (selector.preferredOriginDeviceIds[origin] === deviceInfo.deviceId) {
    return false;
  }

  selector.preferredOriginDeviceIds[origin] = deviceInfo.deviceId;
  return true;
}

function forgetSelectorOriginDeviceId(selector, origin, deviceInfo) {
  if (!selector || !origin || !selector.preferredOriginDeviceIds) {
    return false;
  }
  const cachedId = selector.preferredOriginDeviceIds[origin];
  if (!cachedId || deviceInfo && deviceInfo.deviceId && cachedId !== deviceInfo.deviceId) {
    return false;
  }

  delete selector.preferredOriginDeviceIds[origin];
  return true;
}

function updateSelectedRuleOriginCache(settings, route, origin, deviceInfo) {
  if (!route || !origin || !deviceInfo || !deviceInfo.deviceId || route.source === "default") {
    return false;
  }

  const selector = route.rule && route.rule.deviceSelector || route.deviceSelector;
  return rememberSelectorOriginDeviceId(selector, origin, deviceInfo);
}

function syncGrantedOutputWithRules(settings, origin, deviceInfo) {
  let changed = false;
  for (const rule of Array.isArray(settings && settings.displayRules) ? settings.displayRules : []) {
    if (rememberSelectorOriginDeviceId(rule && rule.deviceSelector, origin, deviceInfo)) {
      changed = true;
    }
  }
  return changed;
}

async function syncGrantedOutputWithManualOverride(tabId, origin, deviceInfo) {
  const override = await getManualOverride(tabId);
  if (!override || !rememberSelectorOriginDeviceId(override.deviceSelector, origin, deviceInfo)) {
    return false;
  }

  await setManualOverride(tabId, override);
  return true;
}

async function buildContext(settings) {
  const windowInfo = await getLastFocusedNormalWindow();
  const activeTab = getActiveTabFromWindow(windowInfo);
  const displays = await chrome.system.display.getInfo();
  const display = RULES.determineDisplayForWindow(windowInfo, displays);
  const origin = activeTab && activeTab.url ? RULES.getOrigin(activeTab.url) : "";

  return {
    settings,
    windowInfo,
    activeTab,
    displays,
    display,
    origin
  };
}

async function buildTargetTabContext(settings) {
  return await buildContext(settings);
}

async function waitForTabComplete(tabId, timeoutMs = 12000) {
  const existing = await getTabById(tabId);
  if (existing && existing.status === "complete") {
    return existing;
  }

  return await new Promise((resolve) => {
    const timer = setTimeout(async () => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(await getTabById(tabId));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function reloadTargetTab(tabId) {
  await chrome.tabs.reload(tabId);
  return await waitForTabComplete(tabId);
}

async function routeActiveTab(reason) {
  let settings = await getSettings();
  const context = await buildContext(settings);
  const { windowInfo, activeTab, display, origin } = context;
  if (enrichDisplayRuleGeometry(settings, context.displays)) {
    await saveSettings(settings);
  }

  if (!windowInfo || !activeTab) {
    return await setStatus({
      result: "idle",
      reason,
      error: "포커스된 일반 Chrome 창 또는 활성 탭을 찾지 못했습니다."
    });
  }

  if (!RULES.isRoutableUrl(activeTab.url)) {
    return await setStatus({
      tabId: activeTab.id,
      tabTitle: activeTab.title || "",
      tabUrl: activeTab.url || "",
      origin,
      displayId: display && display.id || "",
      displayName: RULES.displayLabel(display),
      selectedRule: "지원하지 않는 URL",
      sinkLabel: "",
      result: "skipped",
      reason,
      error: "HTTPS 웹 페이지에서만 탭 오디오 출력 장치를 바꿀 수 있습니다."
    });
  }

  const route = RULES.selectRule(settings, display, origin);
  let override = await getManualOverride(activeTab.id);

  if (route.source === "out-of-scope" && !override) {
    return await setOutOfScopeStatus({
      activeTab,
      display,
      origin,
      reason,
      settings
    });
  }

  if (shouldMonitorRouteOverrideManual(settings, route, override, display, reason)) {
    await deleteManualOverride(activeTab.id);
    override = null;
  }
  const effectiveRoute = override ? {
    source: "shortcut",
    rule: null,
    deviceSelector: override.deviceSelector
  } : route;
  const selector = effectiveRoute.deviceSelector || RULES.DEFAULT_DEVICE_SELECTOR;
  const needsSpecificDevice = !RULES.isDefaultSelector(selector);

  if (effectiveRoute.source === "disabled") {
    return await setStatus({
      tabId: activeTab.id,
      tabTitle: activeTab.title || "",
      tabUrl: activeTab.url || "",
      origin,
      displayId: display && display.id || "",
      displayName: RULES.displayLabel(display),
      selectedRule: selectedRuleLabel(effectiveRoute),
      sinkLabel: "",
      result: "disabled",
      reason,
      error: ""
    });
  }

  if (needsSpecificDevice) {
    settings = await ensureMicrophonePermission(activeTab.url, settings);
  }

  try {
    await ensureInjected(activeTab.id);
    const previousStatus = await getStatus();
    const previousSameTabStatus = previousStatus &&
      previousStatus.tabId === activeTab.id &&
      previousStatus.result === "ok"
      ? previousStatus
      : null;
    const response = await sendApplyMessage(activeTab.id, {
      deviceSelector: selector,
      origin,
      debugEnabled: Boolean(settings.debugEnabled),
      notification: {
        reason,
        routeSource: effectiveRoute.source,
        routeLabel: selectedRuleLabel(effectiveRoute),
        displayName: RULES.displayLabel(display),
        systemDefaultDeviceLabel: settings.systemDefaultDeviceLabel || "",
        previousSinkLabel: previousSameTabStatus ? previousSameTabStatus.sinkLabel || "" : "",
        previousSinkDeviceId: previousSameTabStatus ? previousSameTabStatus.sinkDeviceId || "" : "",
        previousSinkIsDefault: previousSameTabStatus ? Boolean(previousSameTabStatus.sinkIsDefault) : false
      }
    });

    if (!response || response.ok !== true) {
      const cacheCleared = response &&
        response.error &&
        response.error.includes("AbortError") &&
        forgetSelectorOriginDeviceId(selector, origin, response.device);
      if (cacheCleared) {
        if (override) {
          await setManualOverride(activeTab.id, override);
        } else {
          await saveSettings(settings);
        }
      }

      const message = response && response.error || "콘텐츠 스크립트에서 응답을 받지 못했습니다.";
      throw new Error(cacheCleared
        ? `${message} 저장된 장치 ID 캐시를 지웠습니다. 탭을 새로고침한 뒤 다시 적용하세요.`
        : message);
    }

    let savedAfterCache = false;
    if (response.device) {
      addKnownDevice(settings, response.device);
      savedAfterCache = true;
    }
    if (response.device && response.device.stalePreferredId && forgetSelectorOriginDeviceId(selector, origin, {
      deviceId: response.device.stalePreferredId
    })) {
      if (override) {
        await setManualOverride(activeTab.id, override);
      } else {
        savedAfterCache = true;
      }
    }
    if (updateSelectedRuleOriginCache(settings, effectiveRoute, origin, response.device)) {
      if (override) {
        await setManualOverride(activeTab.id, override);
      } else {
        savedAfterCache = true;
      }
    }
    if (savedAfterCache) {
      await saveSettings(settings);
    }

    return await setStatus({
      tabId: activeTab.id,
      tabTitle: activeTab.title || "",
      tabUrl: activeTab.url || "",
      origin,
      displayId: display && display.id || "",
      displayName: RULES.displayLabel(display),
      selectedRule: selectedRuleLabel(effectiveRoute),
      selectedRuleSource: effectiveRoute.source,
      sinkLabel: response.device && response.device.label || getDeviceDisplayLabel(selector),
      sinkDeviceId: response.device && response.device.deviceId || "",
      sinkIsDefault: Boolean(response.device && (response.device.match === "default" || response.device.match === "missing-default")),
      result: "ok",
      reason,
      apply: response.apply || null,
      error: response.device && response.device.match === "missing-default"
        ? `선택 장치 "${response.device.missingLabel || getDeviceDisplayLabel(selector)}"를 찾지 못해 시스템 기본 장치로 적용됨`
        : ""
    });
  } catch (error) {
    return await setStatus({
      tabId: activeTab.id,
      tabTitle: activeTab.title || "",
      tabUrl: activeTab.url || "",
      origin,
      displayId: display && display.id || "",
      displayName: RULES.displayLabel(display),
      selectedRule: selectedRuleLabel(effectiveRoute),
      selectedRuleSource: effectiveRoute.source,
      sinkLabel: getDeviceDisplayLabel(selector),
      result: "error",
      reason,
      error: error.message || String(error)
    });
  }
}

async function getUiState() {
  await ensureExtensionMicrophonePermission(await getSettings());
  const settings = await getSettings();
  const context = await buildContext(settings);
  if (enrichDisplayRuleGeometry(settings, context.displays)) {
    await saveSettings(settings);
  }
  const status = await getStatus();
  const route = RULES.selectRule(settings, context.display, context.origin);
  const override = context.activeTab ? await getManualOverride(context.activeTab.id) : null;
  const effectiveRoute = override ? {
    source: "shortcut",
    rule: null,
    deviceSelector: override.deviceSelector
  } : route;

  return {
    settings,
    displays: context.displays,
    activeTab: context.activeTab ? {
      id: context.activeTab.id,
      title: context.activeTab.title || "",
      url: context.activeTab.url || "",
      audible: Boolean(context.activeTab.audible)
    } : null,
    activeOrigin: context.origin,
    activeDisplay: context.display,
    selectedRule: {
      source: effectiveRoute.source,
      label: selectedRuleLabel(effectiveRoute),
      sinkLabel: effectiveRoute.source === "out-of-scope"
        ? "건드리지 않음"
        : getDeviceDisplayLabel(effectiveRoute.deviceSelector)
    },
    monitorRouting: {
      scope: RULES.getMonitorRoutingScope(settings),
      sites: RULES.getMonitorRoutingSites(settings),
      currentOriginAllowed: isActiveOriginInScope(settings, context.origin)
    },
    cycleDeviceLabels: getCycleDeviceLabels(settings, getCycleCurrentFromSelector(effectiveRoute.deviceSelector)),
    manualOverride: override || null,
    status
  };
}

function selectorFromKnownDevice(settings, label) {
  if (!label) {
    return clone(RULES.DEFAULT_DEVICE_SELECTOR);
  }

  const known = settings.knownDevices.find((device) => device.label === label || device.labelNormalized === RULES.normalizeDeviceLabel(label));
  return {
    labelExact: known && known.label || label,
    labelNormalized: known && known.labelNormalized || RULES.normalizeDeviceLabel(label),
    preferredOriginDeviceIds: {}
  };
}

async function setMonitorRoutingScope(scope) {
  const settings = await getSettings();
  settings.monitorRoutingScope = scope === "sites" ? "sites" : "all";
  await saveSettings(settings);
  scheduleRoute("monitor-routing-scope");
  return await getUiState();
}

async function allowMonitorRoutingForActive() {
  const settings = await getSettings();
  const context = await buildContext(settings);
  if (!context.origin) {
    throw new Error("현재 활성 탭의 origin을 찾지 못했습니다.");
  }

  const existing = settings.monitorRoutingSites.find((site) => site.originPattern === context.origin);
  const siteRule = {
    originPattern: context.origin,
    enabled: true,
    addedAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, siteRule);
  } else {
    settings.monitorRoutingSites.push(siteRule);
  }

  await saveSettings(settings);
  scheduleRoute("monitor-routing-site-added");
  return await getUiState();
}

async function removeMonitorRoutingForActive() {
  const settings = await getSettings();
  const context = await buildContext(settings);
  if (!context.origin) {
    throw new Error("현재 활성 탭의 origin을 찾지 못했습니다.");
  }

  settings.monitorRoutingSites = settings.monitorRoutingSites
    .filter((site) => site.originPattern !== context.origin);

  await saveSettings(settings);
  scheduleRoute("monitor-routing-site-removed");
  return await getUiState();
}

async function clearManagedMicrophonePermissions() {
  const settings = await getSettings();
  await chromeSettingClear({ scope: "regular" });
  await chromeSoundSettingClear({ scope: "regular" });
  settings.managedMicrophonePatterns = [];
  settings.managedSoundPatterns = [];
  await saveSettings(settings);
  return await getUiState();
}

async function probeActiveTabDevices() {
  let settings = await getSettings();
  const context = await buildTargetTabContext(settings);
  const activeTab = context.activeTab;

  if (!activeTab || !RULES.isRoutableUrl(activeTab.url)) {
    throw new Error("활성 HTTPS 탭에서만 출력 장치를 감지할 수 있습니다.");
  }

  settings = await ensureMicrophonePermission(activeTab.url, settings);
  await reloadTargetTab(activeTab.id);
  await ensureInjected(activeTab.id);

  const response = await chrome.tabs.sendMessage(activeTab.id, {
    type: "MAR_PROBE_AUDIO_OUTPUTS",
    payload: {
      requestMicProbe: true,
      debugEnabled: Boolean(settings.debugEnabled)
    }
  });

  if (!response || response.ok !== true) {
    throw new Error(response && response.error || "활성 탭에서 출력 장치 목록을 받지 못했습니다.");
  }

  const outputs = Array.isArray(response.outputs) ? response.outputs : [];
  addKnownDevices(settings, outputs);
  await saveSettings(settings);

  const uiState = await getUiState();
  return {
    ...uiState,
    deviceProbe: {
      origin: response.origin,
      count: outputs.length,
      labeledCount: outputs.filter((item) => item.label).length,
      capabilities: response.capabilities || null
    }
  };
}

async function requestActiveTabOutputPermission() {
  let settings = await getSettings();
  const context = await buildTargetTabContext(settings);
  const activeTab = context.activeTab;

  if (!activeTab || !RULES.isRoutableUrl(activeTab.url)) {
    throw new Error("활성 HTTPS 탭에서만 출력 장치 권한을 요청할 수 있습니다.");
  }

  await ensureInjected(activeTab.id);

  const response = await chrome.tabs.sendMessage(activeTab.id, {
    type: "MAR_REQUEST_OUTPUT_PERMISSION",
    payload: {
      debugEnabled: Boolean(settings.debugEnabled)
    }
  });

  if (!response || response.ok !== true) {
    throw new Error(response && response.error || "활성 탭에서 출력 장치 권한을 얻지 못했습니다.");
  }

  if (response.selected && response.selected.label) {
    addKnownDevice(settings, response.selected);
  }
  addKnownDevices(settings, response.outputs);
  const ruleCacheUpdated = response.selected && response.selected.label
    ? syncGrantedOutputWithRules(settings, context.origin, response.selected)
    : false;
  const manualOverrideUpdated = response.selected && response.selected.label
    ? await syncGrantedOutputWithManualOverride(activeTab.id, context.origin, response.selected)
    : false;
  await saveSettings(settings);

  const uiState = await getUiState();
  return {
    ...uiState,
    permissionGrant: {
      origin: response.origin,
      selectedLabel: response.selected && response.selected.label || "",
      count: Array.isArray(response.outputs) ? response.outputs.length : 0,
      labeledCount: Array.isArray(response.outputs) ? response.outputs.filter((item) => item.label).length : 0,
      micGranted: Boolean(response.micGranted),
      selectAudioOutputAvailable: Boolean(response.selectAudioOutputAvailable),
      ruleCacheUpdated,
      manualOverrideUpdated
    }
  };
}

async function refreshCycleDeviceSnapshot(settings, activeTab) {
  if (!activeTab || !activeTab.id || !RULES.isRoutableUrl(activeTab.url)) {
    return settings;
  }

  try {
    settings = await ensureMicrophonePermission(activeTab.url, settings);
    await ensureInjected(activeTab.id);
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "MAR_PROBE_AUDIO_OUTPUTS",
      payload: {
        requestMicProbe: false,
        debugEnabled: Boolean(settings.debugEnabled)
      }
    });

    if (!response || response.ok !== true) {
      return settings;
    }

    const before = JSON.stringify({
      knownDevices: settings.knownDevices,
      cycleDeviceLabels: settings.cycleDeviceLabels,
      systemDefaultDeviceLabel: settings.systemDefaultDeviceLabel,
      systemDefaultDeviceLabelNormalized: settings.systemDefaultDeviceLabelNormalized
    });
    addKnownDevices(settings, response.outputs);
    const after = JSON.stringify({
      knownDevices: settings.knownDevices,
      cycleDeviceLabels: settings.cycleDeviceLabels,
      systemDefaultDeviceLabel: settings.systemDefaultDeviceLabel,
      systemDefaultDeviceLabelNormalized: settings.systemDefaultDeviceLabelNormalized
    });

    if (before !== after) {
      await saveSettings(settings);
    }
  } catch (_) {
    return settings;
  }

  return settings;
}

async function enableExtensionDeviceEnumeration() {
  const settings = await ensureExtensionMicrophonePermission(await getSettings());
  return {
    ...(await getUiState()),
    extensionDeviceEnumeration: {
      pattern: getExtensionMicrophonePattern(),
      microphoneAllowed: settings.managedMicrophonePatterns.includes(getExtensionMicrophonePattern())
    }
  };
}

async function cycleActiveTabOutput() {
  let settings = await getSettings();
  const context = await buildTargetTabContext(settings);
  const activeTab = context.activeTab;

  if (!activeTab || !RULES.isRoutableUrl(activeTab.url)) {
    throw new Error("활성 HTTPS 탭에서만 단축키로 출력 장치를 전환할 수 있습니다.");
  }

  settings = await refreshCycleDeviceSnapshot(settings, activeTab);

  const route = RULES.selectRule(settings, context.display, context.origin);
  const override = manualTabOverrides.get(activeTab.id);
  const currentSelector = override
    ? override.deviceSelector
    : route.deviceSelector || RULES.DEFAULT_DEVICE_SELECTOR;
  const labels = getCycleDeviceLabels(settings);
  if (labels.length === 0) {
    throw new Error("순환할 출력 장치가 없습니다. 설정에서 출력 장치를 먼저 등록해 주세요.");
  }

  const currentIndex = labels.findIndex((label) =>
    selectorsTargetSameOutput(settings, selectorFromKnownDevice(settings, label), currentSelector)
  );
  const startIndex = currentIndex >= 0
    ? currentIndex
    : cycleIndexByTab.has(activeTab.id)
    ? cycleIndexByTab.get(activeTab.id)
    : -1;
  let nextIndex = -1;
  for (let offset = 1; offset <= labels.length; offset += 1) {
    const candidateIndex = (startIndex + offset + labels.length) % labels.length;
    const candidateSelector = selectorFromKnownDevice(settings, labels[candidateIndex]);
    if (!selectorsTargetSameOutput(settings, candidateSelector, currentSelector)) {
      nextIndex = candidateIndex;
      break;
    }
  }
  if (nextIndex < 0) {
    throw new Error("현재 장치 외에 순환할 출력 장치가 없습니다. 설정에서 출력 장치를 먼저 등록해 주세요.");
  }

  const nextLabel = labels[nextIndex];
  const deviceSelector = selectorFromKnownDevice(settings, nextLabel);

  await setManualOverride(activeTab.id, {
    deviceSelector,
    label: nextLabel || "시스템 기본 장치",
    displayId: context.display && context.display.id || "",
    displayName: RULES.displayLabel(context.display),
    origin: context.origin,
    updatedAt: new Date().toISOString()
  });
  cycleIndexByTab.set(activeTab.id, nextIndex);

  await routeActiveTab("shortcut-cycle");
  return await getUiState();
}

async function clearActiveTabOverride() {
  const context = await buildContext(await getSettings());
  if (context.activeTab) {
    await deleteManualOverride(context.activeTab.id);
  }
  await routeActiveTab("shortcut-override-cleared");
  return await getUiState();
}

function bootstrapExtensionPermissions(reason) {
  getSettings()
    .then(ensureExtensionMicrophonePermission)
    .then(saveSettings)
    .catch(() => null)
    .finally(() => scheduleRoute(reason));
}

chrome.runtime.onInstalled.addListener(() => bootstrapExtensionPermissions("installed"));
chrome.runtime.onStartup.addListener(() => bootstrapExtensionPermissions("startup"));
chrome.windows.onBoundsChanged.addListener(() => scheduleRoute("window-bounds"));
chrome.windows.onFocusChanged.addListener(() => scheduleRoute("window-focus"));
chrome.tabs.onActivated.addListener(() => scheduleRoute("tab-activated"));
chrome.system.display.onDisplayChanged.addListener(() => scheduleRoute("display-changed"));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    scheduleRoute("tab-updated");
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  deleteManualOverride(tabId).catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "cycle-output-device") {
    cycleActiveTabOutput().catch((error) => {
      setStatus({
        result: "error",
        reason: "shortcut-cycle",
        error: error.message || String(error)
      });
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  (async () => {
    switch (message.type) {
      case "MAR_GET_STATE":
        return await getUiState();
      case "MAR_ROUTE_NOW":
        await routeActiveTab("manual");
        return await getUiState();
      case "MAR_SAVE_SETTINGS":
        await saveSettings(message.settings);
        scheduleRoute("settings-saved");
        return await getUiState();
      case "MAR_SET_AUTO_ENABLED": {
        const settings = await getSettings();
        settings.autoRoutingEnabled = Boolean(message.enabled);
        await saveSettings(settings);
        scheduleRoute("auto-toggle");
        return await getUiState();
      }
      case "MAR_SET_MONITOR_ROUTING_SCOPE":
        return await setMonitorRoutingScope(message.scope);
      case "MAR_ALLOW_MONITOR_ROUTING_FOR_ACTIVE":
        return await allowMonitorRoutingForActive();
      case "MAR_REMOVE_MONITOR_ROUTING_FOR_ACTIVE":
        return await removeMonitorRoutingForActive();
      case "MAR_ENABLE_EXTENSION_DEVICE_ENUMERATION":
        return await enableExtensionDeviceEnumeration();
      case "MAR_ADD_KNOWN_DEVICE": {
        const settings = await getSettings();
        addKnownDevice(settings, message.device);
        await saveSettings(settings);
        return await getUiState();
      }
      case "MAR_PROBE_ACTIVE_TAB_DEVICES":
        return await probeActiveTabDevices();
      case "MAR_REQUEST_ACTIVE_TAB_OUTPUT_PERMISSION":
        return await requestActiveTabOutputPermission();
      case "MAR_CYCLE_OUTPUT_DEVICE":
        return await cycleActiveTabOutput();
      case "MAR_CLEAR_TAB_OVERRIDE":
        return await clearActiveTabOverride();
      case "MAR_CLEAR_MIC_PERMISSIONS":
        return await clearManagedMicrophonePermissions();
      default:
        throw new Error(`알 수 없는 메시지: ${message.type}`);
    }
  })()
    .then((response) => sendResponse({ ok: true, ...response }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
