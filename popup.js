"use strict";

const el = {
  autoToggle: document.getElementById("autoToggle"),
  subtitle: document.getElementById("subtitle"),
  statusPill: document.getElementById("statusPill"),
  statusDetail: document.getElementById("statusDetail"),
  origin: document.getElementById("origin"),
  display: document.getElementById("display"),
  rule: document.getElementById("rule"),
  scopeSummary: document.getElementById("scopeSummary"),
  sink: document.getElementById("sink"),
  monitorScopeSelect: document.getElementById("monitorScopeSelect"),
  monitorPriorityToggle: document.getElementById("monitorPriorityToggle"),
  monitorScopeState: document.getElementById("monitorScopeState"),
  allowMonitorSite: document.getElementById("allowMonitorSite"),
  removeMonitorSite: document.getElementById("removeMonitorSite"),
  monitorSiteManager: document.getElementById("monitorSiteManager"),
  monitorSiteInput: document.getElementById("monitorSiteInput"),
  addMonitorSitePattern: document.getElementById("addMonitorSitePattern"),
  monitorSiteList: document.getElementById("monitorSiteList"),
  scanDevices: document.getElementById("scanDevices"),
  deviceSummary: document.getElementById("deviceSummary"),
  deviceList: document.getElementById("deviceList"),
  displayMap: document.getElementById("displayMap"),
  displayRules: document.getElementById("displayRules"),
  routeNow: document.getElementById("routeNow"),
  cycleNow: document.getElementById("cycleNow"),
  clearOverride: document.getElementById("clearOverride"),
  saveState: document.getElementById("saveState")
};

let state = null;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).then((response) => {
    if (!response || response.ok === false) {
      throw new Error(response && response.error || "확장 백그라운드 응답이 없습니다.");
    }
    return response;
  });
}

function text(value, fallback = "-") {
  return value || fallback;
}

function normalizeDeviceLabel(label) {
  return String(label || "")
    .replace(/\s+/g, " ")
    .replace(/^default\s*[-:]\s*/i, "")
    .replace(/^communications\s*[-:]\s*/i, "")
    .replace(/^(?:기본값|기본|시스템 기본 장치|시스템 기본)\s*[-:]\s*/i, "")
    .replace(/^(?:통신|커뮤니케이션)\s*[-:]\s*/i, "")
    .replace(/\s+\(default\)$/i, "")
    .replace(/\s+\(communications\)$/i, "")
    .replace(/\s+\((?:기본값|기본|시스템 기본 장치|시스템 기본)\)$/i, "")
    .replace(/\s+\((?:통신|커뮤니케이션)\)$/i, "")
    .trim()
    .toLowerCase();
}

function canonicalDeviceLabel(label) {
  return normalizeDeviceLabel(label)
    .normalize("NFKC")
    .replace(/[\s()[\]{}<>:;'"`.,/_\\|-]+/g, "");
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

function createDeviceSelector(label) {
  return {
    labelExact: label || "",
    labelNormalized: normalizeDeviceLabel(label),
    preferredOriginDeviceIds: {}
  };
}

function rememberSystemDefaultDevice(settings, device) {
  if (!device || device.kind !== "audiooutput" || device.deviceId !== "default" || !device.label) {
    return;
  }

  const label = cleanDeviceLabel(device.label);
  const normalized = normalizeDeviceLabel(label);
  if (!label || !normalized) {
    return;
  }

  settings.systemDefaultDeviceLabel = label;
  settings.systemDefaultDeviceLabelNormalized = normalized;
}

function iconSvg(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");

  const paths = kind === "monitor"
    ? [
      "M4 5h16v11H4z",
      "M9 20h6",
      "M12 16v4"
    ]
    : [
      "M4 9v6h4l5 4V5L8 9H4z",
      "M16 9c.8.8 1.2 1.8 1.2 3s-.4 2.2-1.2 3"
    ];

  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }

  return svg;
}

function rowIcon(kind) {
  const icon = document.createElement("div");
  icon.className = "row-icon";
  icon.append(iconSvg(kind));
  return icon;
}

function numberIcon(number, active) {
  const icon = document.createElement("div");
  icon.className = active ? "row-icon number-icon active" : "row-icon number-icon";
  icon.textContent = String(number || "?");
  return icon;
}

function displayName(display) {
  return display && (display.name || display.displayName || display.id) || "알 수 없는 모니터";
}

function displayBounds(display) {
  return display && (display.bounds || display.workArea) || null;
}

function boundsKey(bounds) {
  if (!bounds) {
    return "";
  }
  return [
    Number(bounds.left) || 0,
    Number(bounds.top) || 0,
    Number(bounds.width) || 0,
    Number(bounds.height) || 0
  ].join(",");
}

function displayBoundsKey(display) {
  return boundsKey(displayBounds(display));
}

function displayBoundsText(display) {
  const bounds = displayBounds(display);
  if (!bounds) {
    return display && display.id || "";
  }
  return `x ${bounds.left}, y ${bounds.top}, ${bounds.width} x ${bounds.height}`;
}

function displaySizeText(display) {
  const bounds = displayBounds(display);
  return bounds ? `${bounds.width} x ${bounds.height}` : "해상도 알 수 없음";
}

function displayPositionText(display) {
  const bounds = displayBounds(display);
  return bounds ? `x ${bounds.left}, y ${bounds.top}` : "좌표 알 수 없음";
}

function getDisplayViews(displays) {
  return (Array.isArray(displays) ? displays : [])
    .map((display) => ({
      display,
      bounds: displayBounds(display)
    }))
    .sort((a, b) => {
      const ab = a.bounds || {};
      const bb = b.bounds || {};
      return (Number(ab.top) || 0) - (Number(bb.top) || 0) ||
        (Number(ab.left) || 0) - (Number(bb.left) || 0) ||
        String(a.display && a.display.id || "").localeCompare(String(b.display && b.display.id || ""));
    })
    .map((view, index) => ({
      ...view,
      number: index + 1
    }));
}

function findDisplayView(displayViews, display) {
  if (!display || !Array.isArray(displayViews)) {
    return null;
  }
  return displayViews.find((view) => view.display && view.display.id === display.id) || null;
}

function displayRuleLabel(display, displayViews) {
  const view = findDisplayView(displayViews, display);
  const primary = display && display.isPrimary ? "기본 모니터 · " : "";
  const label = view ? `모니터 ${view.number}` : displayName(display);
  return `${label} · ${primary}${displaySizeText(display)} · ${displayPositionText(display)}`;
}

function createDisplaySummary(display, displayViews) {
  const view = findDisplayView(displayViews, display);
  const summary = document.createElement("span");
  summary.className = "display-summary";

  const parts = [
    {
      label: view ? `모니터 ${view.number}` : displayName(display),
      kind: "index"
    },
    display && display.isPrimary
      ? {
        label: "기본",
        kind: "primary"
      }
      : null,
    {
      label: displaySizeText(display),
      kind: "size"
    },
    {
      label: displayPositionText(display),
      kind: "position"
    }
  ].filter(Boolean);

  for (const part of parts) {
    const chip = document.createElement("span");
    chip.className = `display-chip ${part.kind}`;
    chip.textContent = part.label;
    summary.append(chip);
  }

  return summary;
}

function renderDisplaySummary(target, display, displayViews) {
  target.replaceChildren();
  target.classList.add("display-summary-holder");
  target.title = display ? displayRuleLabel(display, displayViews) : "";

  if (!display) {
    target.textContent = "-";
    return;
  }

  target.append(createDisplaySummary(display, displayViews));
}

function isCurrentMonitorSiteRegistered(settings, origin) {
  return Boolean(origin) && (settings.monitorRoutingSites || [])
    .some((site) => site && site.enabled !== false && site.originPattern === origin);
}

function normalizeMonitorSitePattern(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    return "";
  }

  if (raw.includes("*")) {
    if (!/^https:\/\//i.test(raw)) {
      throw new Error("와일드카드 사이트는 https://*.example.com 형식으로 입력해 주세요.");
    }
    return raw;
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "https:") {
    throw new Error("모니터별 자동 적용은 HTTPS 사이트만 등록할 수 있습니다.");
  }
  return parsed.origin;
}

function setSaveState(message, kind = "") {
  el.saveState.textContent = message || "";
  el.saveState.className = kind;
}

function setStatus(kind, title, detail) {
  el.statusPill.className = `pill ${kind || ""}`.trim();
  el.statusPill.textContent = title;
  el.statusDetail.textContent = detail || "";
  el.statusDetail.title = detail || "";
}

function setBusy(message) {
  setStatus("", "처리 중", message || "변경을 적용하고 있습니다.");
}

function isSkippableOutputDevice(device) {
  return !device ||
    device.kind !== "audiooutput" ||
    !device.deviceId ||
    device.deviceId === "default" ||
    device.deviceId === "communications" ||
    !device.label;
}

function addKnownDevice(settings, device) {
  rememberSystemDefaultDevice(settings, device);

  if (isSkippableOutputDevice(device)) {
    return false;
  }

  const label = cleanDeviceLabel(device.label);
  if (!label || label === "시스템 기본 장치") {
    return false;
  }

  const normalized = normalizeDeviceLabel(label);
  const canonical = canonicalDeviceLabel(label);
  const existing = (settings.knownDevices || []).find((known) =>
    known.labelNormalized === normalized ||
    canonicalDeviceLabel(known.label || known.labelNormalized) === canonical
  );
  const next = {
    label,
    labelNormalized: normalized,
    extensionDeviceId: device.deviceId || "",
    lastSeenAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, next);
    return false;
  }

  settings.knownDevices = settings.knownDevices || [];
  settings.knownDevices.push(next);
  settings.cycleDeviceLabels = settings.cycleDeviceLabels || [];
  if (!settings.cycleDeviceLabels.includes(label)) {
    settings.cycleDeviceLabels.push(label);
  }
  return true;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function saveSettings(settings, reason) {
  state = await send("MAR_SAVE_SETTINGS", {
    settings: clone(settings)
  });
  render(state);
  setSaveState(reason || "저장됨");
  return state;
}

function deviceOptions(selectedValue, includeNoRule = true) {
  const fragment = document.createDocumentFragment();
  if (includeNoRule) {
    fragment.append(new Option("규칙 없음", "__no_rule__", false, selectedValue === "__no_rule__"));
  }
  fragment.append(new Option("시스템 기본 장치", "", false, selectedValue === ""));
  for (const device of state.settings.knownDevices || []) {
    if (device.label) {
      fragment.append(new Option(device.label, device.label, false, selectedValue === device.label));
    }
  }
  return fragment;
}

function renderDevices(settings) {
  const devices = settings.knownDevices || [];
  el.deviceSummary.textContent = devices.length
    ? `${devices.length}개 장치 등록됨`
    : "등록된 출력 장치가 없습니다.";
  el.deviceList.replaceChildren();

  if (devices.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "장치 자동 스캔을 눌러 출력 장치를 가져오세요.";
    el.deviceList.append(empty);
    return;
  }

  for (const device of devices) {
    const row = document.createElement("div");
    row.className = "device-row";
    const title = document.createElement("div");
    title.className = "row-title";
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    name.textContent = device.label;
    meta.textContent = device.lastSeenAt ? `마지막 확인 ${new Date(device.lastSeenAt).toLocaleString()}` : "등록됨";
    title.append(name, meta);
    row.append(rowIcon("speaker"), title);
    el.deviceList.append(row);
  }
}

function getDisplayRule(settings, display) {
  const currentBoundsKey = displayBoundsKey(display);
  return (settings.displayRules || []).find((rule) =>
    rule &&
    rule.enabled !== false &&
    (
      rule.displayId === display.id ||
      Boolean((rule.displayBoundsKey || boundsKey(rule.displayBounds)) && currentBoundsKey &&
        (rule.displayBoundsKey || boundsKey(rule.displayBounds)) === currentBoundsKey) ||
      (!rule.displayId && rule.displayName === displayName(display))
    )
  ) || null;
}

function renderDisplayMap(displays, activeDisplay, displayViews) {
  el.displayMap.replaceChildren();

  const views = (displayViews || getDisplayViews(displays))
    .filter((view) => view.bounds);
  if (views.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "모니터 배치를 표시할 수 없습니다.";
    el.displayMap.append(empty);
    return;
  }

  const minLeft = Math.min(...views.map((view) => view.bounds.left));
  const minTop = Math.min(...views.map((view) => view.bounds.top));
  const maxRight = Math.max(...views.map((view) => view.bounds.left + view.bounds.width));
  const maxBottom = Math.max(...views.map((view) => view.bounds.top + view.bounds.height));
  const totalWidth = Math.max(1, maxRight - minLeft);
  const totalHeight = Math.max(1, maxBottom - minTop);

  const canvas = document.createElement("div");
  canvas.className = totalWidth >= totalHeight ? "display-map-canvas wide" : "display-map-canvas tall";
  canvas.style.aspectRatio = `${totalWidth} / ${totalHeight}`;

  for (const view of views) {
    const { display, bounds, number } = view;
    const tile = document.createElement("div");
    const active = activeDisplay && activeDisplay.id === display.id;
    tile.className = [
      "display-tile",
      active ? "active" : "",
      display.isPrimary ? "primary" : ""
    ].filter(Boolean).join(" ");
    tile.style.left = `${((bounds.left - minLeft) / totalWidth) * 100}%`;
    tile.style.top = `${((bounds.top - minTop) / totalHeight) * 100}%`;
    tile.style.width = `${(bounds.width / totalWidth) * 100}%`;
    tile.style.height = `${(bounds.height / totalHeight) * 100}%`;
    tile.title = `${displayName(display)} · ${displayBoundsText(display)}`;

    const numberEl = document.createElement("strong");
    const sizeEl = document.createElement("span");
    const posEl = document.createElement("small");
    numberEl.textContent = String(number);
    sizeEl.textContent = `${bounds.width} x ${bounds.height}`;
    posEl.textContent = `x ${bounds.left}, y ${bounds.top}`;
    tile.append(numberEl, sizeEl, posEl);
    canvas.append(tile);
  }

  el.displayMap.append(canvas);
}

function renderDisplayRules(settings, displays, displayViews) {
  el.displayRules.replaceChildren();

  if (!Array.isArray(displays) || displays.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "모니터 정보를 읽지 못했습니다.";
    el.displayRules.append(empty);
    return;
  }

  const views = displayViews || getDisplayViews(displays);
  for (const view of views) {
    const display = view.display;
    const rule = getDisplayRule(settings, display);
    const selected = rule && rule.enabled !== false
      ? rule.deviceSelector && rule.deviceSelector.labelExact || ""
      : "__no_rule__";

    const row = document.createElement("div");
    const isActive = state.activeDisplay && state.activeDisplay.id === display.id;
    row.className = isActive ? "display-row active" : "display-row";

    const title = document.createElement("div");
    title.className = "row-title";
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    name.className = "display-main";
    name.append(createDisplaySummary(display, views));
    meta.textContent = `${displayName(display)} · ${display.id || "id 없음"}`;
    title.append(name, meta);

    const select = document.createElement("select");
    select.append(deviceOptions(selected, true));
    select.addEventListener("change", () => updateDisplayRule(display, select.value));

    row.append(numberIcon(view.number, isActive), title, select);
    el.displayRules.append(row);
  }
}

function renderScope(settings) {
  el.monitorScopeSelect.value = settings.monitorRoutingScope === "sites" ? "sites" : "all";
  el.monitorPriorityToggle.checked = settings.monitorRoutingOverridesManual !== false;
  el.monitorSiteManager.hidden = settings.monitorRoutingScope !== "sites";

  const registered = isCurrentMonitorSiteRegistered(settings, state.activeOrigin);
  if (!state.activeOrigin) {
    el.monitorScopeState.textContent = "현재 사이트 origin을 확인할 수 없습니다.";
  } else if (settings.monitorRoutingScope === "sites") {
    el.monitorScopeState.textContent = registered
      ? `${state.activeOrigin} 등록됨`
      : `${state.activeOrigin} 미등록. 모니터 규칙이 적용되지 않습니다.`;
  } else {
    el.monitorScopeState.textContent = "모든 HTTPS 사이트에서 모니터 규칙이 적용됩니다.";
  }

  el.allowMonitorSite.disabled = !state.activeOrigin || registered;
  el.removeMonitorSite.disabled = !state.activeOrigin || !registered;
  renderMonitorSites(settings);
}

function renderMonitorSites(settings) {
  const sites = (settings.monitorRoutingSites || [])
    .filter((site) => site && site.enabled !== false && site.originPattern)
    .slice()
    .sort((a, b) => String(a.originPattern).localeCompare(String(b.originPattern)));

  el.monitorSiteList.replaceChildren();

  if (sites.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty compact-empty";
    empty.textContent = "등록된 사이트가 없습니다. 현재 사이트 추가를 누르거나 직접 입력해 주세요.";
    el.monitorSiteList.append(empty);
    return;
  }

  for (const site of sites) {
    const isCurrent = site.originPattern === state.activeOrigin;
    const row = document.createElement("div");
    row.className = isCurrent ? "site-row current" : "site-row";

    const title = document.createElement("div");
    title.className = "site-title";
    const origin = document.createElement("strong");
    const meta = document.createElement("span");
    origin.textContent = site.originPattern;
    meta.textContent = isCurrent
      ? "현재 사이트"
      : site.addedAt
        ? `추가됨 ${new Date(site.addedAt).toLocaleDateString()}`
        : "등록됨";
    title.append(origin, meta);

    const remove = document.createElement("button");
    remove.className = "icon-button danger subtle";
    remove.type = "button";
    remove.title = "등록 사이트 제거";
    remove.setAttribute("aria-label", `${site.originPattern} 제거`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 12h14"></path></svg>';
    remove.addEventListener("click", () => {
      mutate(() => removeMonitorSitePattern(site.originPattern), "등록 사이트를 제거하는 중입니다.");
    });

    row.append(title, remove);
    el.monitorSiteList.append(row);
  }
}

function scopeSummaryText(settings) {
  if (settings.autoRoutingEnabled === false) {
    return {
      text: "자동 꺼짐",
      kind: "warn"
    };
  }
  if (settings.monitorRoutingScope !== "sites") {
    return {
      text: "모든 사이트",
      kind: "ok"
    };
  }
  if (!state.activeOrigin) {
    return {
      text: "사이트 확인 불가",
      kind: "warn"
    };
  }
  if (isCurrentMonitorSiteRegistered(settings, state.activeOrigin)) {
    return {
      text: "등록됨",
      kind: "ok"
    };
  }
  return {
    text: "건드리지 않음",
    kind: "muted"
  };
}

function render(nextState) {
  if (!nextState) {
    return;
  }

  state = nextState;
  const settings = state.settings || {};
  const status = state.status || {};
  const displays = state.displays || [];
  const displayViews = getDisplayViews(displays);

  el.autoToggle.checked = settings.autoRoutingEnabled !== false;
  el.subtitle.textContent = state.activeTab && state.activeTab.title
    ? state.activeTab.title
    : "현재 활성 탭 기준";
  el.origin.textContent = text(state.activeOrigin);
  renderDisplaySummary(el.display, state.activeDisplay, displayViews);
  el.rule.textContent = text(state.selectedRule && state.selectedRule.label);
  const scopeSummary = scopeSummaryText(settings);
  el.scopeSummary.textContent = scopeSummary.text;
  el.scopeSummary.className = scopeSummary.kind;
  el.sink.textContent = text(status.sinkLabel || state.selectedRule && state.selectedRule.sinkLabel);

  renderScope(settings);
  renderDevices(settings);
  renderDisplayMap(displays, state.activeDisplay, displayViews);
  renderDisplayRules(settings, displays, displayViews);

  if (!status || !status.result) {
    setStatus("", "대기", "아직 라우팅 결과가 없습니다.");
  } else if (status.result === "ok") {
    const count = status.apply ? `${status.apply.mediaElements} media / ${status.apply.audioContexts} context` : "적용됨";
    setStatus("ok", "적용됨", `${status.sinkLabel || "선택 장치"} · ${count}`);
  } else if (status.result === "skipped") {
    setStatus("warn", "건너뜀", status.error || "현재 탭에는 적용하지 않았습니다.");
  } else if (status.result === "disabled") {
    setStatus("warn", "꺼짐", "상단 스위치를 켜면 다시 적용합니다.");
  } else {
    setStatus("error", "오류", status.error || "적용 중 문제가 발생했습니다.");
  }
}

async function refresh() {
  const nextState = await send("MAR_ENABLE_EXTENSION_DEVICE_ENUMERATION")
    .catch(() => send("MAR_GET_STATE"));
  render(nextState);
  await scanDevices({ silent: true });
}

async function mutate(action, busyMessage) {
  try {
    setBusy(busyMessage);
    const nextState = await action();
    if (nextState) {
      render(nextState);
    }
  } catch (error) {
    setStatus("error", "오류", error.message || String(error));
  }
}

async function scanDevices(options = {}) {
  try {
    await send("MAR_ENABLE_EXTENSION_DEVICE_ENUMERATION").catch(() => null);
    if (!state) {
      state = await send("MAR_GET_STATE");
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
      throw new Error("이 Chrome에서는 enumerateDevices()를 사용할 수 없습니다.");
    }

    const settings = clone(state.settings || {});
    const devices = await navigator.mediaDevices.enumerateDevices();
    let outputs = 0;
    let labeled = 0;
    let added = 0;

    for (const device of devices) {
      if (device.kind === "audiooutput") {
        outputs += 1;
        if (device.label) {
          labeled += 1;
        }
      }
      if (addKnownDevice(settings, device)) {
        added += 1;
      }
    }

    state = await send("MAR_SAVE_SETTINGS", { settings });
    render(state);
    if (!options.silent) {
      setSaveState(`스캔 완료: 출력 ${outputs}, 이름 확인 ${labeled}, 신규 ${added}`);
    }
  } catch (error) {
    if (!options.silent) {
      setStatus("error", "스캔 실패", error.message || String(error));
    }
  }
}

async function updateDisplayRule(display, selectedLabel) {
  const settings = clone(state.settings || {});
  settings.displayRules = Array.isArray(settings.displayRules) ? settings.displayRules : [];
  const currentBoundsKey = displayBoundsKey(display);
  settings.displayRules = settings.displayRules.filter((rule) => {
    const ruleBoundsKey = rule && (rule.displayBoundsKey || boundsKey(rule.displayBounds));
    return rule &&
      rule.displayId !== display.id &&
      !(ruleBoundsKey && currentBoundsKey && ruleBoundsKey === currentBoundsKey) &&
      !(!rule.displayId && rule.displayName === displayName(display));
  });

  if (selectedLabel !== "__no_rule__") {
    settings.displayRules.push({
      displayId: display.id,
      displayName: displayName(display),
      displayBoundsKey: displayBoundsKey(display),
      displayBounds: displayBounds(display),
      enabled: true,
      deviceSelector: createDeviceSelector(selectedLabel)
    });
  }

  await saveSettings(settings, "모니터 규칙 저장됨");
}

async function updateScope(scope) {
  const settings = clone(state.settings || {});
  settings.monitorRoutingScope = scope === "sites" ? "sites" : "all";
  await saveSettings(settings, "적용 범위 저장됨");
}

async function updateMonitorPriority(enabled) {
  const settings = clone(state.settings || {});
  settings.monitorRoutingOverridesManual = Boolean(enabled);
  return await saveSettings(settings, "수동 전환 우선순위 저장됨");
}

async function addMonitorSitePattern(pattern, reason) {
  const normalizedPattern = normalizeMonitorSitePattern(pattern);
  if (!normalizedPattern) {
    throw new Error("등록할 사이트를 입력해 주세요.");
  }

  const settings = clone(state.settings || {});
  settings.monitorRoutingSites = Array.isArray(settings.monitorRoutingSites) ? settings.monitorRoutingSites : [];
  const existing = settings.monitorRoutingSites.find((site) =>
    String(site.originPattern || "").toLowerCase() === normalizedPattern.toLowerCase()
  );
  const siteRule = {
    originPattern: normalizedPattern,
    enabled: true,
    addedAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, siteRule);
  } else {
    settings.monitorRoutingSites.push(siteRule);
  }

  el.monitorSiteInput.value = "";
  return await saveSettings(settings, reason || "등록 사이트 추가됨");
}

async function removeMonitorSitePattern(pattern, reason) {
  const settings = clone(state.settings || {});
  settings.monitorRoutingSites = (settings.monitorRoutingSites || [])
    .filter((site) => String(site.originPattern || "").toLowerCase() !== String(pattern || "").toLowerCase());
  return await saveSettings(settings, reason || "등록 사이트 제거됨");
}

async function addCurrentSite() {
  if (!state.activeOrigin) {
    throw new Error("현재 사이트 origin을 확인할 수 없습니다.");
  }

  return await addMonitorSitePattern(state.activeOrigin, "현재 사이트 추가됨");
}

async function removeCurrentSite() {
  if (!state.activeOrigin) {
    throw new Error("현재 사이트 origin을 확인할 수 없습니다.");
  }

  return await removeMonitorSitePattern(state.activeOrigin, "현재 사이트 삭제됨");
}

el.autoToggle.addEventListener("change", () => {
  mutate(() => send("MAR_SET_AUTO_ENABLED", { enabled: el.autoToggle.checked }), "자동 라우팅 상태를 바꾸는 중입니다.");
});

el.monitorScopeSelect.addEventListener("change", () => {
  mutate(() => updateScope(el.monitorScopeSelect.value), "적용 범위를 저장하는 중입니다.");
});

el.monitorPriorityToggle.addEventListener("change", () => {
  mutate(() => updateMonitorPriority(el.monitorPriorityToggle.checked), "수동 전환 우선순위를 저장하는 중입니다.");
});

el.allowMonitorSite.addEventListener("click", () => {
  mutate(addCurrentSite, "현재 사이트를 추가하는 중입니다.");
});

el.removeMonitorSite.addEventListener("click", () => {
  mutate(removeCurrentSite, "현재 사이트를 삭제하는 중입니다.");
});

el.addMonitorSitePattern.addEventListener("click", () => {
  mutate(() => addMonitorSitePattern(el.monitorSiteInput.value), "등록 사이트를 추가하는 중입니다.");
});

el.monitorSiteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    mutate(() => addMonitorSitePattern(el.monitorSiteInput.value), "등록 사이트를 추가하는 중입니다.");
  }
});

el.scanDevices.addEventListener("click", () => {
  scanDevices();
});

el.routeNow.addEventListener("click", () => {
  mutate(() => send("MAR_ROUTE_NOW"), "현재 탭에 다시 적용하는 중입니다.");
});

el.cycleNow.addEventListener("click", () => {
  mutate(() => send("MAR_CYCLE_OUTPUT_DEVICE"), "다음 출력 장치로 전환하는 중입니다.");
});

el.clearOverride.addEventListener("click", () => {
  mutate(() => send("MAR_CLEAR_TAB_OVERRIDE"), "수동 전환을 해제하는 중입니다.");
});

refresh().catch((error) => setStatus("error", "초기화 실패", error.message || String(error)));
