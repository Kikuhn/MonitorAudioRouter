(() => {
  "use strict";

  const PROTOCOL_VERSION = "mar-route-toast-v7";
  const APPLY_REQUEST = `MAR_APPLY_REQUEST_${PROTOCOL_VERSION}`;
  const APPLY_RESULT = `MAR_APPLY_RESULT_${PROTOCOL_VERSION}`;
  const PROBE_REQUEST = `MAR_PROBE_REQUEST_${PROTOCOL_VERSION}`;
  const PROBE_RESULT = `MAR_PROBE_RESULT_${PROTOCOL_VERSION}`;
  const PERMISSION_REQUEST = `MAR_PERMISSION_REQUEST_${PROTOCOL_VERSION}`;
  const PERMISSION_RESULT = `MAR_PERMISSION_RESULT_${PROTOCOL_VERSION}`;
  const DISABLE_REQUEST = `MAR_DISABLE_REQUEST_${PROTOCOL_VERSION}`;
  const DISABLE_RESULT = `MAR_DISABLE_RESULT_${PROTOCOL_VERSION}`;

  if (globalThis.__monitorAudioRouterMainVersion === PROTOCOL_VERSION) {
    return;
  }
  globalThis.__monitorAudioRouterMainVersion = PROTOCOL_VERSION;

  const mediaElements = new Set();
  const audioContexts = new Set();
  let currentRoute = null;
  let routingActive = false;
  const sinkGate = globalThis.__monitorAudioRouterSinkGate || {
    allowDepth: 0,
    enforceTaggedCalls: true
  };
  sinkGate.enforceTaggedCalls = true;
  globalThis.__monitorAudioRouterSinkGate = sinkGate;

  async function withSinkGateBypass(action) {
    sinkGate.allowDepth += 1;
    try {
      return await action();
    } finally {
      sinkGate.allowDepth = Math.max(0, sinkGate.allowDepth - 1);
    }
  }

  function patchSinkGate(prototype) {
    if (!prototype || typeof prototype.setSinkId !== "function") {
      return;
    }

    const currentSetSinkId = prototype.setSinkId;
    if (currentSetSinkId.__monitorAudioRouterGateVersion === PROTOCOL_VERSION) {
      return;
    }

    function gatedSetSinkId(...args) {
      if (sinkGate.enforceTaggedCalls && sinkGate.allowDepth <= 0) {
        return Promise.resolve();
      }
      return currentSetSinkId.apply(this, args);
    }

    gatedSetSinkId.__monitorAudioRouterGateVersion = PROTOCOL_VERSION;
    gatedSetSinkId.__monitorAudioRouterOriginalSetSinkId =
      currentSetSinkId.__monitorAudioRouterOriginalSetSinkId || currentSetSinkId;
    prototype.setSinkId = gatedSetSinkId;
  }

  function patchSinkGates() {
    patchSinkGate(globalThis.HTMLMediaElement && globalThis.HTMLMediaElement.prototype);
    patchSinkGate(globalThis.AudioContext && globalThis.AudioContext.prototype);
    patchSinkGate(globalThis.webkitAudioContext && globalThis.webkitAudioContext.prototype);
  }

  function normalizeDeviceLabel(label) {
    return String(label || "")
      .replace(/\s+/g, " ")
      .replace(/^default\s*[-:]\s*/i, "")
      .replace(/^communications\s*[-:]\s*/i, "")
      .replace(/\s+\(default\)$/i, "")
      .replace(/\s+\(communications\)$/i, "")
      .trim()
      .toLowerCase();
  }

  function canonicalDeviceLabel(label) {
    return normalizeDeviceLabel(label)
      .normalize("NFKC")
      .replace(/[\s()[\]{}<>:;'"`.,/_\\|-]+/g, "");
  }

  function isDefaultSelector(selector) {
    return !selector || (!selector.labelExact && !selector.labelNormalized);
  }

  function rememberMediaElement(element) {
    if (!element || typeof element.setSinkId !== "function") {
      return element;
    }

    mediaElements.add(element);
    if (routingActive && currentRoute) {
      applySinkToMedia(element, currentRoute.deviceId).catch(() => {});
    }
    return element;
  }

  function rememberAudioContext(context) {
    if (!context || typeof context.setSinkId !== "function") {
      return context;
    }

    audioContexts.add(context);
    if (routingActive && currentRoute) {
      applySinkToContext(context, currentRoute.deviceId).catch(() => {});
    }
    return context;
  }

  function scanDocument() {
    document.querySelectorAll("audio,video").forEach(rememberMediaElement);
  }

  function patchDocumentCreateElement() {
    const originalCreateElement = Document.prototype.createElement;
    if (originalCreateElement.__monitorAudioRouterPatchVersion === PROTOCOL_VERSION) {
      return;
    }

    function patchedCreateElement(name, options) {
      const element = originalCreateElement.call(this, name, options);
      const tag = String(name || "").toLowerCase();
      if (tag === "audio" || tag === "video") {
        rememberMediaElement(element);
      }
      return element;
    }

    patchedCreateElement.__monitorAudioRouterPatched = true;
    patchedCreateElement.__monitorAudioRouterPatchVersion = PROTOCOL_VERSION;
    Document.prototype.createElement = patchedCreateElement;
  }

  function patchAudioConstructor() {
    const NativeAudio = globalThis.Audio;
    if (typeof NativeAudio !== "function" || NativeAudio.__monitorAudioRouterPatchVersion === PROTOCOL_VERSION) {
      return;
    }

    function RoutedAudio(...args) {
      return rememberMediaElement(new NativeAudio(...args));
    }

    RoutedAudio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(RoutedAudio, NativeAudio);
    RoutedAudio.__monitorAudioRouterPatched = true;
    RoutedAudio.__monitorAudioRouterPatchVersion = PROTOCOL_VERSION;
    globalThis.Audio = RoutedAudio;
  }

  function patchAudioContextConstructor(key) {
    const NativeContext = globalThis[key];
    if (typeof NativeContext !== "function" || NativeContext.__monitorAudioRouterPatchVersion === PROTOCOL_VERSION) {
      return;
    }

    function RoutedAudioContext(...args) {
      return rememberAudioContext(new NativeContext(...args));
    }

    RoutedAudioContext.prototype = NativeContext.prototype;
    Object.setPrototypeOf(RoutedAudioContext, NativeContext);
    RoutedAudioContext.__monitorAudioRouterPatched = true;
    RoutedAudioContext.__monitorAudioRouterPatchVersion = PROTOCOL_VERSION;
    globalThis[key] = RoutedAudioContext;
  }

  async function enumerateAudioOutputs() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
      throw new Error("이 페이지에서 mediaDevices.enumerateDevices()를 사용할 수 없습니다.");
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput");
  }

  function matchAudioOutputDevice(devices, selector, origin) {
    if (isDefaultSelector(selector)) {
      return {
        deviceId: "",
        label: "시스템 기본 장치",
        match: "default"
      };
    }

    const preferredId = selector.preferredOriginDeviceIds && selector.preferredOriginDeviceIds[origin];
    if (preferredId) {
      const preferred = devices.find((device) => device.deviceId === preferredId);
      if (preferred) {
        return {
          deviceId: preferred.deviceId,
          label: preferred.label || selector.labelExact,
          match: "origin-cache"
        };
      }
    }

    if (selector.labelExact) {
      const exact = devices.find((device) => device.label === selector.labelExact);
      if (exact) {
        return {
          deviceId: exact.deviceId,
          label: exact.label,
          match: "label-exact"
        };
      }
    }

    const normalized = selector.labelNormalized || normalizeDeviceLabel(selector.labelExact);
    if (normalized) {
      const normalizedMatch = devices.find((device) => normalizeDeviceLabel(device.label) === normalized);
      if (normalizedMatch) {
        return {
          deviceId: normalizedMatch.deviceId,
          label: normalizedMatch.label,
          match: "label-normalized"
        };
      }

      const containsMatch = devices.find((device) => {
        const candidate = normalizeDeviceLabel(device.label);
        return candidate && (candidate.includes(normalized) || normalized.includes(candidate));
      });
      if (containsMatch) {
        return {
          deviceId: containsMatch.deviceId,
          label: containsMatch.label,
          match: "label-contains"
        };
      }
    }

    return null;
  }

  async function applySinkToMedia(element, deviceId) {
    if (!element || typeof element.setSinkId !== "function") {
      return { skipped: true };
    }
    if (element.sinkId === deviceId) {
      return { unchanged: true };
    }
    await withSinkGateBypass(() => element.setSinkId(deviceId));
    return { applied: true };
  }

  async function applySinkToContext(context, deviceId) {
    if (!context || typeof context.setSinkId !== "function") {
      return { skipped: true };
    }
    await withSinkGateBypass(() => context.setSinkId(deviceId));
    return { applied: true };
  }

  async function safeApply(label, target, apply) {
    try {
      const result = await apply(target);
      return {
        target: label,
        ok: true,
        result
      };
    } catch (error) {
      return {
        target: label,
        ok: false,
        name: error && error.name || "Error",
        message: error && error.message || String(error)
      };
    }
  }

  function routeLabelKey(route, systemDefaultLabel = "") {
    if (!route) {
      return "";
    }
    if (route.match === "default") {
      return canonicalDeviceLabel(systemDefaultLabel || route.label);
    }
    return canonicalDeviceLabel(route.label);
  }

  function routesTargetSameOutput(previous, current, systemDefaultLabel = "") {
    if (!previous || !current) {
      return false;
    }

    const previousId = previous.deviceId || "";
    const currentId = current.deviceId || "";
    if (previousId && currentId && previousId === currentId) {
      return true;
    }

    const previousLabel = routeLabelKey(previous, systemDefaultLabel);
    const currentLabel = routeLabelKey(current, systemDefaultLabel);
    return Boolean(previousLabel && currentLabel && previousLabel === currentLabel);
  }

  function reasonLabel(reason, routeSource) {
    const labels = {
      "shortcut-cycle": "수동 전환",
      "shortcut-override-cleared": "수동 해제",
      "window-bounds": "모니터 이동",
      "window-focus": "창 포커스 변경",
      "tab-activated": "활성 탭 변경",
      "tab-updated": "탭 로드 완료",
      "display-changed": "모니터 구성 변경",
      "settings-saved": "설정 변경",
      "monitor-routing-scope": "적용 범위 변경",
      "monitor-routing-site-added": "사이트 등록",
      "monitor-routing-site-removed": "사이트 등록 해제",
      "auto-toggle": "자동 라우팅 변경",
      manual: "수동 적용",
      installed: "확장 설치",
      startup: "브라우저 시작"
    };

    if (labels[reason]) {
      return labels[reason];
    }
    if (routeSource === "display") {
      return "모니터 규칙";
    }
    if (routeSource === "shortcut") {
      return "수동 전환";
    }
    return "오디오 라우팅";
  }

  function displayDeviceLabel(label) {
    return label || "시스템 기본 장치";
  }

  function applyToastHostStyle(host) {
    host.style.cssText = [
      "position: fixed",
      "left: 50%",
      "top: 16px",
      "transform: translateX(-50%)",
      "z-index: 2147483647",
      "display: grid",
      "gap: 8px",
      "width: min(320px, calc(100vw - 32px))",
      "pointer-events: none",
      "font-family: Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    ].join(";");
  }

  function getToastHost() {
    let host = document.getElementById("monitor-audio-router-toast-host");
    if (host) {
      applyToastHostStyle(host);
      return host;
    }

    host = document.createElement("div");
    host.id = "monitor-audio-router-toast-host";
    applyToastHostStyle(host);

    const root = document.documentElement || document.body;
    if (!root) {
      return null;
    }

    root.append(host);
    return host;
  }

  function showRouteToast(details) {
    const host = getToastHost();
    if (!host) {
      return;
    }

    const toast = document.createElement("div");
    const title = document.createElement("div");
    const message = document.createElement("div");
    const meta = document.createElement("div");
    const previousLabel = displayDeviceLabel(details.previousLabel);
    const currentLabel = displayDeviceLabel(details.currentLabel);
    const cause = reasonLabel(details.reason, details.routeSource);
    const previousChanged = previousLabel && previousLabel !== currentLabel;

    toast.setAttribute("role", "status");
    toast.style.cssText = [
      "box-sizing: border-box",
      "border: 1px solid rgba(255,255,255,.12)",
      "border-radius: 12px",
      "background: rgba(15,18,23,.92)",
      "box-shadow: 0 14px 36px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.06)",
      "color: #f2f5f8",
      "padding: 10px 12px 11px",
      "opacity: 0",
      "transform: translateY(-8px)",
      "transition: opacity 120ms ease, transform 120ms ease",
      "backdrop-filter: blur(10px)"
    ].join(";");

    title.textContent = cause;
    title.style.cssText = [
      "color: #7db0ff",
      "font-size: 11px",
      "font-weight: 780",
      "line-height: 1.25",
      "margin-bottom: 5px"
    ].join(";");

    message.textContent = currentLabel;
    message.style.cssText = [
      "font-size: 13px",
      "font-weight: 760",
      "line-height: 1.28",
      "overflow: hidden",
      "text-overflow: ellipsis",
      "white-space: nowrap"
    ].join(";");

    meta.textContent = previousChanged ? `${previousLabel}에서 변경` : "출력 장치 유지";
    meta.style.cssText = [
      "margin-top: 4px",
      "color: #9aa4b2",
      "font-size: 11px",
      "line-height: 1.3",
      "overflow: hidden",
      "text-overflow: ellipsis",
      "white-space: nowrap"
    ].join(";");

    toast.append(title, message, meta);
    host.replaceChildren(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
        if (host.childElementCount === 0) {
          host.remove();
        }
      }, 180);
    }, 2600);
  }

  function maybeShowRouteToast(previousRoute, device, payload, fatal) {
    if (fatal || payload && payload.suppressToast) {
      return;
    }

    const notification = payload && payload.notification || {};
    const previousFromStatus = notification.previousSinkLabel
      ? {
        deviceId: notification.previousSinkDeviceId || "",
        label: notification.previousSinkLabel,
        match: notification.previousSinkIsDefault ? "default" : "status"
      }
      : null;
    const previous = previousRoute || previousFromStatus;
    const systemDefaultLabel = notification.systemDefaultDeviceLabel || "";

    if (!previous || routesTargetSameOutput(previous, device, systemDefaultLabel)) {
      return;
    }

    showRouteToast({
      previousLabel: previous && previous.label || "",
      currentLabel: device && device.label || "",
      reason: notification.reason || payload && payload.reason || "",
      routeSource: notification.routeSource || "",
      routeLabel: notification.routeLabel || ""
    });
  }

  async function probeAudioOutputs(payload) {
    const permissionState = {};
    if (navigator.permissions && typeof navigator.permissions.query === "function") {
      for (const name of ["microphone", "speaker-selection"]) {
        try {
          permissionState[name] = (await navigator.permissions.query({ name })).state;
        } catch (error) {
          permissionState[name] = `unsupported: ${error && error.name || "Error"}`;
        }
      }
    }

    if (payload && payload.requestMicProbe && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        if (payload.debugEnabled) {
          console.debug("[MonitorAudioRouter] microphone probe failed", error);
        }
      }
    }

    const outputs = await enumerateAudioOutputs();
    return {
      ok: true,
      origin: location.origin,
      capabilities: {
        mediaDevices: Boolean(navigator.mediaDevices),
        enumerateDevices: Boolean(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices),
        getUserMedia: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        selectAudioOutput: Boolean(navigator.mediaDevices && navigator.mediaDevices.selectAudioOutput),
        permissionState
      },
      outputs: outputs.map((device) => ({
        kind: device.kind,
        deviceId: device.deviceId,
        groupId: device.groupId,
        label: device.label || ""
      }))
    };
  }

  function removeExistingPermissionOverlay() {
    const existing = document.getElementById("monitor-audio-router-permission");
    if (existing) {
      existing.remove();
    }
  }

  async function enumerateSerializableOutputs() {
    const outputs = await enumerateAudioOutputs();
    return outputs.map((device) => ({
      kind: device.kind,
      deviceId: device.deviceId,
      groupId: device.groupId,
      label: device.label || ""
    }));
  }

  function requestOutputPermission(payload) {
    return new Promise((resolve) => {
      removeExistingPermissionOverlay();

      const root = document.createElement("div");
      root.id = "monitor-audio-router-permission";
      root.style.cssText = [
        "position: fixed",
        "z-index: 2147483647",
        "right: 24px",
        "bottom: 24px",
        "width: 340px",
        "max-width: calc(100vw - 32px)",
        "background: #15171a",
        "color: #fff",
        "border: 1px solid rgba(255,255,255,.16)",
        "border-radius: 10px",
        "box-shadow: 0 18px 50px rgba(0,0,0,.35)",
        "font-family: Segoe UI, system-ui, sans-serif",
        "padding: 16px",
        "line-height: 1.4"
      ].join(";");

      const title = document.createElement("div");
      title.textContent = "Monitor Audio Router";
      title.style.cssText = "font-size:14px;font-weight:700;margin-bottom:6px;";

      const message = document.createElement("div");
      message.textContent = "이 사이트에서 사용할 출력 장치를 선택해야 Chrome이 비기본 오디오 장치를 노출합니다. 장치가 2개라면 필요한 장치를 각각 한 번씩 선택하세요.";
      message.style.cssText = "font-size:13px;color:#d5d9e2;margin-bottom:12px;";

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "취소";
      cancel.style.cssText = "height:32px;border:1px solid rgba(255,255,255,.22);border-radius:6px;background:transparent;color:#fff;padding:0 12px;font:inherit;cursor:pointer;";

      const select = document.createElement("button");
      select.type = "button";
      select.textContent = "출력 장치 선택";
      select.style.cssText = "height:32px;border:1px solid #7db0ff;border-radius:6px;background:#2b75e8;color:#fff;padding:0 12px;font:inherit;font-weight:650;cursor:pointer;";

      cancel.addEventListener("click", () => {
        root.remove();
        resolve({
          ok: false,
          error: "사용자가 출력 장치 선택을 취소했습니다."
        });
      }, { once: true });

      select.addEventListener("click", async () => {
        try {
          if (!navigator.mediaDevices) {
            throw new Error("이 페이지에서 navigator.mediaDevices를 사용할 수 없습니다.");
          }

          let micGranted = false;
          let selected = null;
          if (typeof navigator.mediaDevices.getUserMedia === "function") {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            stream.getTracks().forEach((track) => track.stop());
            micGranted = true;
          }

          if (typeof navigator.mediaDevices.selectAudioOutput === "function") {
            selected = await navigator.mediaDevices.selectAudioOutput();
          }

          const outputs = await enumerateSerializableOutputs();
          root.remove();
          resolve({
            ok: true,
            origin: location.origin,
            micGranted,
            selectAudioOutputAvailable: typeof navigator.mediaDevices.selectAudioOutput === "function",
            selected: selected ? {
              kind: selected.kind,
              deviceId: selected.deviceId,
              groupId: selected.groupId,
              label: selected.label || ""
            } : null,
            outputs
          });
        } catch (error) {
          root.remove();
          resolve({
            ok: false,
            error: error && error.message || String(error)
          });
        }
      }, { once: true });

      actions.append(cancel, select);
      root.append(title, message, actions);
      document.documentElement.append(root);

      if (payload && payload.debugEnabled) {
        console.debug("[MonitorAudioRouter] output permission overlay shown");
      }
    });
  }

  async function applyRoute(payload) {
    scanDocument();
    routingActive = true;

    const selector = payload.deviceSelector || {};
    const origin = payload.origin || location.origin;
    const previousRoute = currentRoute;
    let device = {
      deviceId: "",
      label: "시스템 기본 장치",
      match: "default"
    };

    if (!isDefaultSelector(selector)) {
      const outputs = await enumerateAudioOutputs();
      const matched = matchAudioOutputDevice(outputs, selector, origin);
      if (!matched) {
        const labels = outputs.map((output) => output.label || "(label 없음)").join(", ");
        throw new Error(`선택한 출력 장치를 찾지 못했습니다: ${selector.labelExact || selector.labelNormalized}. 감지된 장치: ${labels || "없음"}`);
      }
      device = matched;
    }

    currentRoute = device;

    const mediaResults = await Promise.all(
      Array.from(mediaElements).map((element) => safeApply("media", element, (target) => applySinkToMedia(target, device.deviceId)))
    );
    const contextResults = await Promise.all(
      Array.from(audioContexts).map((context) => safeApply("audioContext", context, (target) => applySinkToContext(target, device.deviceId)))
    );

    const combined = mediaResults.concat(contextResults);
    const failed = combined.filter((result) => !result.ok);
    const applied = combined.filter((result) => result.ok);
    const targetCount = combined.length;
    const fatal = targetCount > 0 && applied.length === 0 && failed.length > 0;
    if (targetCount > 0) {
      maybeShowRouteToast(previousRoute, device, payload, fatal);
    }
    if (payload.debugEnabled) {
      console.debug("[MonitorAudioRouter] applyRoute", {
        device,
        mediaElements: mediaElements.size,
        audioContexts: audioContexts.size,
        failed
      });
    }

    return {
      ok: !fatal,
      device,
      apply: {
        mediaElements: mediaElements.size,
        audioContexts: audioContexts.size,
        mediaApplied: mediaResults.filter((result) => result.ok).length,
        audioContextsApplied: contextResults.filter((result) => result.ok).length,
        errors: failed.map((result) => `${result.name}: ${result.message}`)
      },
      error: fatal && failed.length ? `${failed[0].name}: ${failed[0].message}` : ""
    };
  }

  function disableRouting() {
    routingActive = false;
    currentRoute = null;
    return {
      ok: true,
      disabled: true,
      mediaElements: mediaElements.size,
      audioContexts: audioContexts.size
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== APPLY_REQUEST) {
      return;
    }

    applyRoute(event.data.payload || {})
      .then((payload) => {
        window.postMessage({
          type: APPLY_RESULT,
          requestId: event.data.requestId,
          payload
        }, "*");
      })
      .catch((error) => {
        window.postMessage({
          type: APPLY_RESULT,
          requestId: event.data.requestId,
          payload: {
            ok: false,
            error: error.message || String(error)
          }
        }, "*");
      });
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== PERMISSION_REQUEST) {
      return;
    }

    requestOutputPermission(event.data.payload || {})
      .then((payload) => {
        window.postMessage({
          type: PERMISSION_RESULT,
          requestId: event.data.requestId,
          payload
        }, "*");
      });
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== DISABLE_REQUEST) {
      return;
    }

    window.postMessage({
      type: DISABLE_RESULT,
      requestId: event.data.requestId,
      payload: disableRouting()
    }, "*");
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== PROBE_REQUEST) {
      return;
    }

    probeAudioOutputs(event.data.payload || {})
      .then((payload) => {
        window.postMessage({
          type: PROBE_RESULT,
          requestId: event.data.requestId,
          payload
        }, "*");
      })
      .catch((error) => {
        window.postMessage({
          type: PROBE_RESULT,
          requestId: event.data.requestId,
          payload: {
            ok: false,
            error: error.message || String(error)
          }
        }, "*");
      });
  });

  patchDocumentCreateElement();
  patchAudioConstructor();
  patchAudioContextConstructor("AudioContext");
  patchAudioContextConstructor("webkitAudioContext");
  patchSinkGates();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanDocument, { once: true });
  } else {
    scanDocument();
  }

  new MutationObserver(scanDocument).observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });
})();
