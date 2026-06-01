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

const routeBody = functionBody("routeActiveTab");
assert.ok(
  routeBody.includes('route.source === "out-of-scope" && !override'),
  "automatic monitor routing must skip out-of-scope sites unless a manual override exists"
);

assert.ok(
  source.includes('route.source === "disabled" || route.source === "out-of-scope"'),
  "monitor movement must not override manual output on out-of-scope sites"
);

console.log("ok - worker policy keeps manual output independent from site scope");
