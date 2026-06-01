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

  if (globalThis.__monitorAudioRouterIsolatedVersion === PROTOCOL_VERSION) {
    return;
  }
  globalThis.__monitorAudioRouterIsolatedVersion = PROTOCOL_VERSION;

  const pending = new Map();
  const RESPONSE_TIMEOUT_MS = 5000;
  const PERMISSION_RESPONSE_TIMEOUT_MS = 120000;

  function makeRequestId() {
    return `mar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    if (event.data.type !== APPLY_RESULT &&
      event.data.type !== PROBE_RESULT &&
      event.data.type !== PERMISSION_RESULT &&
      event.data.type !== DISABLE_RESULT) {
      return;
    }

    const request = pending.get(event.data.requestId);
    if (!request) {
      return;
    }

    clearTimeout(request.timeout);
    pending.delete(event.data.requestId);
    request.resolve(event.data.payload);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message ||
      (message.type !== "MAR_APPLY_ROUTE" &&
        message.type !== "MAR_PROBE_AUDIO_OUTPUTS" &&
        message.type !== "MAR_REQUEST_OUTPUT_PERMISSION" &&
        message.type !== "MAR_DISABLE_ROUTE")) {
      return false;
    }

    const requestId = makeRequestId();
    const isPermissionRequest = message.type === "MAR_REQUEST_OUTPUT_PERMISSION";
    const timeout = setTimeout(() => {
      const request = pending.get(requestId);
      if (!request) {
        return;
      }
      pending.delete(requestId);
      request.resolve({
        ok: false,
        error: "페이지 MAIN world 스크립트 응답 시간이 초과되었습니다."
      });
    }, isPermissionRequest ? PERMISSION_RESPONSE_TIMEOUT_MS : RESPONSE_TIMEOUT_MS);

    pending.set(requestId, {
      timeout,
      resolve: sendResponse
    });

    window.postMessage({
      type: message.type === "MAR_APPLY_ROUTE"
        ? APPLY_REQUEST
        : message.type === "MAR_PROBE_AUDIO_OUTPUTS"
          ? PROBE_REQUEST
          : message.type === "MAR_REQUEST_OUTPUT_PERMISSION"
            ? PERMISSION_REQUEST
            : DISABLE_REQUEST,
      requestId,
      payload: message.payload
    }, "*");

    return true;
  });
})();
