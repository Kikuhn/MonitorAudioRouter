"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main-world.js"), "utf8");
const protocol = "mar-route-toast-v7";

function createHarness() {
  const messageListeners = [];
  const createdMedia = [];

  class FakeMediaElement {
    constructor() {
      this.sinkId = "";
      this.calls = [];
    }

    async setSinkId(deviceId) {
      this.calls.push(deviceId);
      this.sinkId = deviceId;
      return { applied: true };
    }
  }

  class FakeDocument {}

  FakeDocument.prototype.createElement = function createElement(name) {
    const tag = String(name || "").toLowerCase();
    if (tag === "audio" || tag === "video") {
      const media = new FakeMediaElement();
      createdMedia.push(media);
      return media;
    }
    return {
      style: {},
      setAttribute() {},
      append() {},
      replaceChildren() {},
      remove() {}
    };
  };

  const oldCreateElement = FakeDocument.prototype.createElement;
  function oldMonitorRouterPatch(name, options) {
    const element = oldCreateElement.call(this, name, options);
    if (String(name || "").toLowerCase() === "audio") {
      element.setSinkId("old-left-monitor").catch(() => {});
    }
    return element;
  }
  oldMonitorRouterPatch.__monitorAudioRouterPatched = true;
  FakeDocument.prototype.createElement = oldMonitorRouterPatch;

  const document = new FakeDocument();
  const root = {
    append() {},
    appendChild() {},
    remove() {}
  };
  document.readyState = "complete";
  document.documentElement = root;
  document.body = root;
  document.getElementById = () => null;
  document.querySelectorAll = () => createdMedia;

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    Date,
    String,
    Number,
    Boolean,
    URL,
    Object,
    JSON,
    Array,
    RegExp,
    Error,
    document,
    Document: FakeDocument,
    HTMLMediaElement: FakeMediaElement,
    MutationObserver: class {
      observe() {}
    },
    navigator: {
      mediaDevices: {
        async enumerateDevices() {
          return [
            {
              kind: "audiooutput",
              deviceId: "monitor-device",
              groupId: "group-1",
              label: "Monitor Speaker"
            }
          ];
        }
      }
    },
    requestAnimationFrame(callback) {
      callback();
    }
  };
  context.globalThis = context;
  context.window = context;
  context.addEventListener = (type, listener) => {
    if (type === "message") {
      messageListeners.push(listener);
    }
  };
  context.postMessage = function postMessage(data) {
    const event = {
      source: this,
      data
    };
    for (const listener of [...messageListeners]) {
      listener(event);
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: "main-world.js"
  });

  function request(type, payload = {}) {
    const requestId = `test-${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      const expectedType = type.replace("_REQUEST_", "_RESULT_");
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${expectedType}`));
      }, 1000);
      context.addEventListener("message", (event) => {
        if (event.data &&
          event.data.type === expectedType &&
          event.data.requestId === requestId) {
          clearTimeout(timer);
          resolve(event.data.payload);
        }
      });
      context.__testMessage = {
        type,
        requestId,
        payload
      };
      vm.runInContext("window.postMessage(globalThis.__testMessage, '*')", context);
    });
  }

  return {
    context,
    document,
    createdMedia,
    request
  };
}

async function run() {
  const harness = createHarness();

  const first = harness.document.createElement("audio");
  await Promise.resolve();
  assert.strictEqual(first.sinkId, "", "old untagged setSinkId calls must be blocked");

  const apply = await harness.request(`MAR_APPLY_REQUEST_${protocol}`, {
    origin: "https://www.youtube.com",
    deviceSelector: {
      labelExact: "Monitor Speaker",
      labelNormalized: "monitor speaker",
      preferredOriginDeviceIds: {}
    },
    notification: {
      routeSource: "display"
    }
  });
  assert.strictEqual(apply.ok, true);
  assert.strictEqual(first.sinkId, "monitor-device", "current version routed calls must pass the gate");

  harness.context.navigator.mediaDevices.enumerateDevices = async () => [
    {
      kind: "audiooutput",
      deviceId: "other-device",
      groupId: "group-2",
      label: "Other Speaker"
    }
  ];
  const fallback = await harness.request(`MAR_APPLY_REQUEST_${protocol}`, {
    origin: "https://www.youtube.com",
    deviceSelector: {
      labelExact: "Missing Speaker",
      labelNormalized: "missing speaker",
      preferredOriginDeviceIds: {
        "https://www.youtube.com": "stale-device"
      }
    },
    notification: {
      routeSource: "display"
    }
  });
  assert.strictEqual(fallback.ok, true);
  assert.strictEqual(fallback.device.match, "missing-default");
  assert.strictEqual(fallback.device.stalePreferredId, "stale-device");
  assert.strictEqual(first.sinkId, "", "missing specific devices should fall back to the system default sink");

  const disabled = await harness.request(`MAR_DISABLE_REQUEST_${protocol}`, {});
  assert.strictEqual(disabled.ok, true);

  const second = harness.document.createElement("audio");
  await Promise.resolve();
  assert.strictEqual(second.sinkId, "", "after disable, old patches must not reapply a stale route");

  console.log("ok - main-world sink gate blocks stale extension routing");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
