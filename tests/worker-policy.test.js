"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "worker.js"), "utf8");

function functionBody(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const cycleBody = functionBody("cycleActiveTabOutput");
assert.ok(
  !cycleBody.includes("isActiveOriginInScope") && !cycleBody.includes("setOutOfScopeStatus"),
  "manual shortcut/popup cycling must bypass registered-site scope"
);
assert.ok(
  cycleBody.includes("await setManualOverride(activeTab.id"),
  "manual shortcut/popup cycling must persist the override beyond service worker suspension"
);

const routeBody = functionBody("routeActiveTab");
assert.ok(
  routeBody.includes('route.source === "out-of-scope" && !override'),
  "automatic monitor routing must skip out-of-scope sites unless a manual override exists"
);
assert.ok(
  routeBody.includes("let override = await getManualOverride(activeTab.id)"),
  "automatic routing must restore persisted manual overrides before selecting the effective route"
);
assert.ok(
  routeBody.includes("await deleteManualOverride(activeTab.id)"),
  "monitor movement priority must clear persisted manual overrides when it intentionally takes over"
);

const clearBody = functionBody("clearActiveTabOverride");
assert.ok(
  clearBody.includes("await deleteManualOverride(context.activeTab.id)"),
  "clearing manual output must remove the persisted override"
);

assert.ok(
  source.includes('const MANUAL_OVERRIDES_KEY = "monitorAudioRouterManualOverrides"'),
  "manual overrides must have a dedicated session storage key"
);
assert.ok(
  source.includes("return chrome.storage.session || chrome.storage.local"),
  "manual overrides should survive service worker suspension through session storage"
);

assert.ok(
  source.includes('route.source === "disabled" || route.source === "out-of-scope"'),
  "monitor movement must not override manual output on out-of-scope sites"
);

console.log("ok - worker policy keeps manual output independent from site scope");
