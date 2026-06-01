(function attachRuleEngine(root) {
  "use strict";

  const DEFAULT_DEVICE_SELECTOR = {
    labelExact: "",
    labelNormalized: "",
    preferredOriginDeviceIds: {}
  };
  const MONITOR_ROUTING_SCOPE_ALL = "all";
  const MONITOR_ROUTING_SCOPE_SITES = "sites";

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

  function createDeviceSelector(device) {
    const label = typeof device === "string" ? device : device && device.label;
    return {
      labelExact: label || "",
      labelNormalized: normalizeDeviceLabel(label),
      preferredOriginDeviceIds: {}
    };
  }

  function isDefaultSelector(selector) {
    return !selector || (!selector.labelExact && !selector.labelNormalized);
  }

  function isRoutableUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function getOrigin(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin;
    } catch (_) {
      return "";
    }
  }

  function contentSettingsPatternFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return "";
      }
      return `${parsed.protocol}//${parsed.host}/*`;
    } catch (_) {
      return "";
    }
  }

  function getDisplayBounds(display) {
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
    return boundsKey(getDisplayBounds(display));
  }

  function displayLabel(display) {
    if (!display) {
      return "알 수 없는 모니터";
    }
    return display.name || display.displayName || display.id || "알 수 없는 모니터";
  }

  function getWindowCenter(windowInfo) {
    const left = Number(windowInfo && windowInfo.left);
    const top = Number(windowInfo && windowInfo.top);
    const width = Number(windowInfo && windowInfo.width);
    const height = Number(windowInfo && windowInfo.height);

    if ([left, top, width, height].some((value) => Number.isNaN(value))) {
      return null;
    }

    return {
      x: left + width / 2,
      y: top + height / 2
    };
  }

  function containsPoint(bounds, point) {
    if (!bounds || !point) {
      return false;
    }
    return point.x >= bounds.left &&
      point.x < bounds.left + bounds.width &&
      point.y >= bounds.top &&
      point.y < bounds.top + bounds.height;
  }

  function distanceToRect(bounds, point) {
    if (!bounds || !point) {
      return Number.POSITIVE_INFINITY;
    }
    const dx = point.x < bounds.left ? bounds.left - point.x :
      point.x > bounds.left + bounds.width ? point.x - (bounds.left + bounds.width) : 0;
    const dy = point.y < bounds.top ? bounds.top - point.y :
      point.y > bounds.top + bounds.height ? point.y - (bounds.top + bounds.height) : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function determineDisplayForWindow(windowInfo, displays) {
    const point = getWindowCenter(windowInfo);
    const displayList = Array.isArray(displays) ? displays : [];

    if (!point || displayList.length === 0) {
      return null;
    }

    const direct = displayList.find((display) => containsPoint(getDisplayBounds(display), point));
    if (direct) {
      return direct;
    }

    return displayList
      .slice()
      .sort((a, b) => distanceToRect(getDisplayBounds(a), point) - distanceToRect(getDisplayBounds(b), point))[0] || null;
  }

  function wildcardToRegExp(pattern) {
    const escaped = String(pattern || "")
      .trim()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  function originMatchesPattern(origin, pattern) {
    if (!origin || !pattern) {
      return false;
    }

    if (origin.toLowerCase() === String(pattern).toLowerCase()) {
      return true;
    }

    try {
      return wildcardToRegExp(pattern).test(origin);
    } catch (_) {
      return false;
    }
  }

  function findDisplayRule(settings, display) {
    if (!display || !settings || !Array.isArray(settings.displayRules)) {
      return null;
    }

    return settings.displayRules.find((rule) =>
      rule &&
      rule.enabled !== false &&
      (
        rule.displayId === display.id ||
        Boolean((rule.displayBoundsKey || boundsKey(rule.displayBounds)) && displayBoundsKey(display) &&
          (rule.displayBoundsKey || boundsKey(rule.displayBounds)) === displayBoundsKey(display)) ||
        (!rule.displayId && rule.displayName === displayLabel(display))
      )
    ) || null;
  }

  function getMonitorRoutingScope(settings) {
    return settings && settings.monitorRoutingScope === MONITOR_ROUTING_SCOPE_SITES
      ? MONITOR_ROUTING_SCOPE_SITES
      : MONITOR_ROUTING_SCOPE_ALL;
  }

  function getMonitorRoutingSites(settings) {
    return Array.isArray(settings && settings.monitorRoutingSites)
      ? settings.monitorRoutingSites
      : [];
  }

  function isMonitorRoutingAllowed(settings, origin) {
    if (getMonitorRoutingScope(settings) === MONITOR_ROUTING_SCOPE_ALL) {
      return true;
    }

    return getMonitorRoutingSites(settings).some((rule) =>
      rule &&
      rule.enabled !== false &&
      originMatchesPattern(origin, rule.originPattern)
    );
  }

  function selectRule(settings, display, origin) {
    if (settings && settings.autoRoutingEnabled === false) {
      return {
        source: "disabled",
        rule: null,
        deviceSelector: DEFAULT_DEVICE_SELECTOR
      };
    }

    if (!isMonitorRoutingAllowed(settings, origin)) {
      return {
        source: "out-of-scope",
        rule: null,
        deviceSelector: DEFAULT_DEVICE_SELECTOR
      };
    }

    const displayRule = findDisplayRule(settings, display);
    if (displayRule) {
      return {
        source: "display",
        rule: displayRule,
        deviceSelector: displayRule.deviceSelector || DEFAULT_DEVICE_SELECTOR
      };
    }

    return {
      source: "default",
      rule: null,
      deviceSelector: DEFAULT_DEVICE_SELECTOR
    };
  }

  function getCycleDeviceLabels(settings, current = {}) {
    const knownDevices = settings && Array.isArray(settings.knownDevices) ? settings.knownDevices : [];
    const knownDefaultDevice = knownDevices.find((device) =>
      device &&
      device.extensionDeviceId === "default" &&
      device.label
    );
    const defaultNormalized = settings && (
      settings.systemDefaultDeviceLabelNormalized ||
      normalizeDeviceLabel(settings.systemDefaultDeviceLabel) ||
      normalizeDeviceLabel(knownDefaultDevice && knownDefaultDevice.label)
    ) || "";
    const defaultCanonical = canonicalDeviceLabel(defaultNormalized || settings && settings.systemDefaultDeviceLabel || knownDefaultDevice && knownDefaultDevice.label);
    const knownLabels = knownDevices
      .map((device) => device && device.label)
      .filter((label) => {
        if (!label) {
          return false;
        }
        return !(defaultCanonical && canonicalDeviceLabel(label) === defaultCanonical);
      });
    const knownKeys = new Set(knownLabels.map(canonicalDeviceLabel).filter(Boolean));
    const configuredLabels = (settings && Array.isArray(settings.cycleDeviceLabels) ? settings.cycleDeviceLabels : [])
      .filter((label) => label === "" || knownKeys.has(canonicalDeviceLabel(label)));
    const deviceLabels = configuredLabels.length > 0
      ? configuredLabels.filter((label) => label !== "")
      : knownLabels;
    const currentIsDefault = Boolean(current && current.isDefault);
    const currentNormalized = current && (
      current.labelNormalized ||
      normalizeDeviceLabel(current.label)
    ) || "";
    const currentCanonical = canonicalDeviceLabel(currentNormalized || current && current.label);
    const skipDefaultAlias = currentIsDefault ||
      Boolean(currentCanonical && defaultCanonical && currentCanonical === defaultCanonical);
    const labels = ["", ...deviceLabels];
    const seen = new Set();
    const result = [];

    for (const label of labels) {
      const isDefaultAlias = label === "";
      const canonical = isDefaultAlias ? "" : canonicalDeviceLabel(label);

      if (isDefaultAlias && skipDefaultAlias) {
        continue;
      }
      if (!isDefaultAlias) {
        if (!canonical) {
          continue;
        }
        if (currentCanonical && canonical === currentCanonical) {
          continue;
        }
        if (defaultCanonical && canonical === defaultCanonical) {
          continue;
        }
      }

      const key = isDefaultAlias ? "__default__" : canonical;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(label);
    }

    return result;
  }

  function matchAudioOutputDevice(devices, selector, origin) {
    const outputDevices = (Array.isArray(devices) ? devices : [])
      .filter((device) => device && device.kind === "audiooutput");

    if (isDefaultSelector(selector)) {
      return {
        deviceId: "",
        label: "시스템 기본 장치",
        match: "default"
      };
    }

    const preferredId = selector.preferredOriginDeviceIds && selector.preferredOriginDeviceIds[origin];
    if (preferredId) {
      const preferred = outputDevices.find((device) => device.deviceId === preferredId);
      if (preferred) {
        return {
          deviceId: preferred.deviceId,
          label: preferred.label || selector.labelExact,
          match: "origin-cache"
        };
      }
    }

    const exactLabel = selector.labelExact || "";
    if (exactLabel) {
      const exact = outputDevices.find((device) => device.label === exactLabel);
      if (exact) {
        return {
          deviceId: exact.deviceId,
          label: exact.label,
          match: "label-exact"
        };
      }
    }

    const normalized = selector.labelNormalized || normalizeDeviceLabel(exactLabel);
    if (normalized) {
      const normalizedMatch = outputDevices.find((device) => normalizeDeviceLabel(device.label) === normalized);
      if (normalizedMatch) {
        return {
          deviceId: normalizedMatch.deviceId,
          label: normalizedMatch.label,
          match: "label-normalized"
        };
      }

      const containsMatch = outputDevices.find((device) => {
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

  const api = {
    DEFAULT_DEVICE_SELECTOR,
    MONITOR_ROUTING_SCOPE_ALL,
    MONITOR_ROUTING_SCOPE_SITES,
    normalizeDeviceLabel,
    canonicalDeviceLabel,
    createDeviceSelector,
    isDefaultSelector,
    isRoutableUrl,
    getOrigin,
    contentSettingsPatternFromUrl,
    displayLabel,
    displayBoundsKey,
    getWindowCenter,
    determineDisplayForWindow,
    originMatchesPattern,
    findDisplayRule,
    getMonitorRoutingScope,
    getMonitorRoutingSites,
    isMonitorRoutingAllowed,
    selectRule,
    getCycleDeviceLabels,
    matchAudioOutputDevice
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.MonitorAudioRouterRules = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
