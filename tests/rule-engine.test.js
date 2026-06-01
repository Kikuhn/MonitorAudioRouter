"use strict";

const assert = require("assert");
const rules = require("../shared/rule-engine.js");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("normalizes Windows default output labels", () => {
  assert.strictEqual(
    rules.normalizeDeviceLabel("Default - DELL U2720Q (NVIDIA High Definition Audio)"),
    "dell u2720q (nvidia high definition audio)"
  );
});

test("normalizes communications output labels", () => {
  assert.strictEqual(
    rules.normalizeDeviceLabel("Communications - Headphones (Realtek USB Audio)"),
    "headphones (realtek usb audio)"
  );
});

test("normalizes localized Windows default output labels", () => {
  assert.strictEqual(
    rules.normalizeDeviceLabel("기본값 - 듀얼 모니터(NVIDIA High Definition Audio)"),
    "듀얼 모니터(nvidia high definition audio)"
  );
  assert.strictEqual(
    rules.normalizeDeviceLabel("스피커 (Realtek USB Audio) (기본값)"),
    "스피커 (realtek usb audio)"
  );
});

test("detects the display containing the window center", () => {
  const displays = [
    { id: "left", bounds: { left: -1920, top: 0, width: 1920, height: 1080 } },
    { id: "main", bounds: { left: 0, top: 0, width: 2560, height: 1440 } }
  ];
  const win = { left: -1600, top: 100, width: 800, height: 600 };
  assert.strictEqual(rules.determineDisplayForWindow(win, displays).id, "left");
});

test("falls back to nearest display if center is outside all bounds", () => {
  const displays = [
    { id: "a", bounds: { left: 0, top: 0, width: 100, height: 100 } },
    { id: "b", bounds: { left: 300, top: 0, width: 100, height: 100 } }
  ];
  const win = { left: 250, top: 0, width: 20, height: 20 };
  assert.strictEqual(rules.determineDisplayForWindow(win, displays).id, "b");
});

test("display rule ignores legacy site fallback data", () => {
  const settings = {
    autoRoutingEnabled: true,
    displayRules: [
      {
        displayId: "speaker-monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Monitor Speaker")
      }
    ],
    siteRules: [
      {
        originPattern: "https://www.youtube.com",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Headphones")
      }
    ]
  };
  const selected = rules.selectRule(settings, { id: "speaker-monitor" }, "https://www.youtube.com");
  assert.strictEqual(selected.source, "display");
  assert.strictEqual(selected.deviceSelector.labelExact, "Monitor Speaker");
});

test("monitor routing can be limited to registered sites", () => {
  const settings = {
    autoRoutingEnabled: true,
    monitorRoutingScope: "sites",
    monitorRoutingSites: [
      {
        originPattern: "https://www.youtube.com",
        enabled: true
      }
    ],
    displayRules: [
      {
        displayId: "speaker-monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Monitor Speaker")
      }
    ],
    siteRules: []
  };

  const allowed = rules.selectRule(settings, { id: "speaker-monitor" }, "https://www.youtube.com");
  const blocked = rules.selectRule(settings, { id: "speaker-monitor" }, "https://example.com");

  assert.strictEqual(allowed.source, "display");
  assert.strictEqual(blocked.source, "out-of-scope");
});

test("registered-sites scope with an empty list blocks every origin", () => {
  const settings = {
    autoRoutingEnabled: true,
    monitorRoutingScope: "sites",
    monitorRoutingSites: [],
    displayRules: [
      {
        displayId: "speaker-monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Monitor Speaker")
      }
    ]
  };

  const selected = rules.selectRule(settings, { id: "speaker-monitor" }, "https://www.youtube.com");

  assert.strictEqual(selected.source, "out-of-scope");
});

test("registered-sites scope blocks site fallback rules outside the registered list", () => {
  const settings = {
    autoRoutingEnabled: true,
    monitorRoutingScope: "sites",
    monitorRoutingSites: [
      {
        originPattern: "https://chzzk.naver.com",
        enabled: true
      }
    ],
    displayRules: [
      {
        displayId: "speaker-monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Monitor Speaker")
      }
    ],
    siteRules: [
      {
        originPattern: "https://www.youtube.com",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Old YouTube Rule")
      }
    ]
  };

  const selected = rules.selectRule(settings, { id: "speaker-monitor" }, "https://www.youtube.com");

  assert.strictEqual(selected.source, "out-of-scope");
});

test("monitor routing all-site scope keeps display rules global", () => {
  const settings = {
    autoRoutingEnabled: true,
    monitorRoutingScope: "all",
    monitorRoutingSites: [],
    displayRules: [
      {
        displayId: "speaker-monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Monitor Speaker")
      }
    ],
    siteRules: []
  };

  const selected = rules.selectRule(settings, { id: "speaker-monitor" }, "https://example.com");

  assert.strictEqual(selected.source, "display");
});

test("display rule uses display id before duplicated monitor names", () => {
  const settings = {
    autoRoutingEnabled: true,
    displayRules: [
      {
        displayId: "left-display",
        displayName: "Generic PnP Monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Dual Monitor")
      }
    ],
    siteRules: []
  };

  const selected = rules.selectRule(settings, {
    id: "main-display",
    name: "Generic PnP Monitor"
  }, "https://www.youtube.com");

  assert.strictEqual(selected.source, "default");
});

test("display rule survives changed display id by matching monitor geometry", () => {
  const settings = {
    autoRoutingEnabled: true,
    displayRules: [
      {
        displayId: "old-left-display",
        displayName: "Generic PnP Monitor",
        displayBoundsKey: "-1920,0,1920,1080",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Dual Monitor")
      }
    ],
    siteRules: []
  };

  const selected = rules.selectRule(settings, {
    id: "new-left-display",
    name: "Generic PnP Monitor",
    bounds: { left: -1920, top: 0, width: 1920, height: 1080 }
  }, "https://www.youtube.com");

  assert.strictEqual(selected.source, "display");
  assert.strictEqual(selected.deviceSelector.labelExact, "Dual Monitor");
});

test("legacy display rule without id may still fall back to display name", () => {
  const settings = {
    autoRoutingEnabled: true,
    displayRules: [
      {
        displayName: "Generic PnP Monitor",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Dual Monitor")
      }
    ],
    siteRules: []
  };

  const selected = rules.selectRule(settings, {
    id: "main-display",
    name: "Generic PnP Monitor"
  }, "https://www.youtube.com");

  assert.strictEqual(selected.source, "display");
});

test("legacy site fallback rules are ignored when no display rule exists", () => {
  const settings = {
    autoRoutingEnabled: true,
    displayRules: [],
    siteRules: [
      {
        originPattern: "https://*.youtube.com",
        enabled: true,
        deviceSelector: rules.createDeviceSelector("Headphones")
      }
    ]
  };
  const selected = rules.selectRule(settings, { id: "main" }, "https://music.youtube.com");
  assert.strictEqual(selected.source, "default");
});

test("matches output by origin cache before label", () => {
  const selector = {
    labelExact: "Monitor Speaker",
    labelNormalized: rules.normalizeDeviceLabel("Monitor Speaker"),
    preferredOriginDeviceIds: {
      "https://www.youtube.com": "origin-specific-id"
    }
  };
  const device = rules.matchAudioOutputDevice([
    { kind: "audiooutput", deviceId: "wrong", label: "Monitor Speaker" },
    { kind: "audiooutput", deviceId: "origin-specific-id", label: "Renamed Monitor Speaker" }
  ], selector, "https://www.youtube.com");
  assert.strictEqual(device.deviceId, "origin-specific-id");
  assert.strictEqual(device.match, "origin-cache");
});

test("matches output by contained normalized label", () => {
  const selector = rules.createDeviceSelector("DELL U2720Q");
  const device = rules.matchAudioOutputDevice([
    { kind: "audiooutput", deviceId: "monitor", label: "DELL U2720Q (NVIDIA High Definition Audio)" }
  ], selector, "https://www.youtube.com");
  assert.strictEqual(device.deviceId, "monitor");
  assert.strictEqual(device.match, "label-contains");
});

test("cycle labels exclude the current default output and its concrete device", () => {
  const labels = rules.getCycleDeviceLabels({
    knownDevices: [
      { label: "Dual Monitor (NVIDIA High Definition Audio)" },
      { label: "Headphones (Realtek USB Audio)" }
    ],
    cycleDeviceLabels: [],
    systemDefaultDeviceLabel: "Dual Monitor (NVIDIA High Definition Audio)",
    systemDefaultDeviceLabelNormalized: rules.normalizeDeviceLabel("Dual Monitor (NVIDIA High Definition Audio)")
  }, {
    isDefault: true
  });

  assert.deepStrictEqual(labels, ["Headphones (Realtek USB Audio)"]);
});

test("cycle labels do not include a concrete device already represented by system default", () => {
  const labels = rules.getCycleDeviceLabels({
    knownDevices: [
      { label: "Dual Monitor (NVIDIA High Definition Audio)" },
      { label: "Headphones (Realtek USB Audio)" }
    ],
    cycleDeviceLabels: [],
    systemDefaultDeviceLabel: "Dual Monitor (NVIDIA High Definition Audio)",
    systemDefaultDeviceLabelNormalized: rules.normalizeDeviceLabel("Dual Monitor (NVIDIA High Definition Audio)")
  }, {
    label: "Headphones (Realtek USB Audio)"
  });

  assert.deepStrictEqual(labels, [""]);
});

test("cycle labels skip the default alias when the current device is the system default device", () => {
  const labels = rules.getCycleDeviceLabels({
    knownDevices: [
      { label: "Dual Monitor (NVIDIA High Definition Audio)" },
      { label: "Headphones (Realtek USB Audio)" }
    ],
    cycleDeviceLabels: [],
    systemDefaultDeviceLabel: "Dual Monitor (NVIDIA High Definition Audio)",
    systemDefaultDeviceLabelNormalized: rules.normalizeDeviceLabel("Dual Monitor (NVIDIA High Definition Audio)")
  }, {
    label: "Dual Monitor (NVIDIA High Definition Audio)"
  });

  assert.deepStrictEqual(labels, ["Headphones (Realtek USB Audio)"]);
});

test("cycle labels collapse punctuation variants of the same output", () => {
  const labels = rules.getCycleDeviceLabels({
    knownDevices: [
      { label: "Dual Monitor(NVIDIA High Definition Audio)" },
      { label: "Dual Monitor (NVIDIA High Definition Audio)" },
      { label: "Headphones (Realtek USB Audio)" }
    ],
    cycleDeviceLabels: []
  });

  assert.deepStrictEqual(labels, ["", "Dual Monitor(NVIDIA High Definition Audio)", "Headphones (Realtek USB Audio)"]);
});

test("cycle labels can infer system default from an older default device cache", () => {
  const labels = rules.getCycleDeviceLabels({
    knownDevices: [
      { label: "Dual Monitor(NVIDIA High Definition Audio)", extensionDeviceId: "default" },
      { label: "Dual Monitor (NVIDIA High Definition Audio)" },
      { label: "Headphones (Realtek USB Audio)" }
    ],
    cycleDeviceLabels: []
  });

  assert.deepStrictEqual(labels, ["", "Headphones (Realtek USB Audio)"]);
});

test("cycle labels remove localized concrete default device from configured labels", () => {
  const labels = rules.getCycleDeviceLabels({
    knownDevices: [
      { label: "듀얼 모니터(NVIDIA High Definition Audio)" },
      { label: "스피커 (Realtek USB Audio)" }
    ],
    cycleDeviceLabels: [
      "듀얼 모니터(NVIDIA High Definition Audio)",
      "스피커 (Realtek USB Audio)"
    ],
    systemDefaultDeviceLabel: "기본값 - 듀얼 모니터(NVIDIA High Definition Audio)",
    systemDefaultDeviceLabelNormalized: rules.normalizeDeviceLabel("기본값 - 듀얼 모니터(NVIDIA High Definition Audio)")
  });

  assert.deepStrictEqual(labels, ["", "스피커 (Realtek USB Audio)"]);
});
