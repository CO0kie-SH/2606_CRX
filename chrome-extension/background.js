const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const LOGGER_BUILD = "url-capture-v2";

function writeLog(eventName, details = {}) {
  const logEntry = {
    time: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    loggerBuild: LOGGER_BUILD,
    eventName,
    ...details
  };

  console.groupCollapsed(`[My Extension v${EXTENSION_VERSION} ${LOGGER_BUILD}] ${eventName} ${logEntry.time}`);
  console.log("time:", logEntry.time);
  console.log("extensionVersion:", logEntry.extensionVersion);
  console.log("loggerBuild:", logEntry.loggerBuild);
  console.log("eventName:", logEntry.eventName);

  if (logEntry.currentPage) {
    console.table(logEntry.currentPage);
    console.log("currentPage:", logEntry.currentPage);
  }

  if (logEntry.navigation) {
    console.table(logEntry.navigation);
    console.log("navigation:", logEntry.navigation);
  }

  console.log("fullLog:", JSON.stringify(logEntry, null, 2));
  console.groupEnd();
}

const MAX_URL_LOGS = 100;

function getUrlLoggerStorageKey(tabId) {
  return `urlLogger.tab.${tabId}`;
}

function getLocalTime() {
  return new Date().toLocaleString();
}

async function appendNavigationLog(tabId, entry) {
  if (!tabId || tabId < 0 || !entry?.url) {
    return;
  }

  const storageKey = getUrlLoggerStorageKey(tabId);
  const result = await chrome.storage.local.get(storageKey);
  const state = {
    enabled: false,
    logs: [],
    lastUrl: "",
    ...(result[storageKey] || {})
  };

  if (!state.enabled) {
    return;
  }

  if (state.lastUrl === entry.url) {
    return;
  }

  const navigation = {
    time: getLocalTime(),
    title: "",
    ...entry
  };

  state.lastUrl = navigation.url;
  state.logs = [navigation, ...state.logs].slice(0, MAX_URL_LOGS);

  await chrome.storage.local.set({
    [storageKey]: state
  });

  writeLog("url_jump_recorded", {
    tabContext: {
      tabId
    },
    navigation
  });

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "URL_LOG_UPDATED",
      storageKey,
      navigation
    },
    () => {
      // During real navigations the old page may already be gone. That is normal.
      void chrome.runtime.lastError;
    }
  );
}

function recordNavigationAttempt(source, details) {
  appendNavigationLog(details.tabId, {
    reason: source,
    url: details.url,
    frameId: details.frameId ?? null,
    requestId: details.requestId || "",
    transitionType: details.transitionType || "",
    error: details.error || ""
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  writeLog("extension_installed", {
    reason: details.reason,
    previousVersion: details.previousVersion || null
  });
});

writeLog("background_loaded", {
  message: "Background service worker loaded with navigation capture listeners."
});

chrome.runtime.onStartup.addListener(() => {
  writeLog("browser_started");
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  recordNavigationAttempt("webNavigation.onBeforeNavigate", details);
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  recordNavigationAttempt("webNavigation.onErrorOccurred", details);
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    recordNavigationAttempt("webRequest.onBeforeRequest", details);
  },
  {
    urls: [
      "http://*/*",
      "https://*/*"
    ],
    types: ["main_frame"]
  }
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  recordNavigationAttempt("tabs.onUpdated.url", {
    tabId,
    url: changeInfo.url,
    frameId: 0
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_TAB_CONTEXT") {
    sendResponse({
      ok: true,
      tabContext: {
        tabId: sender.tab?.id || null,
        windowId: sender.tab?.windowId || null,
        incognito: Boolean(sender.tab?.incognito)
      }
    });
    return true;
  }

  if (!message || message.type !== "LOG_EVENT") {
    return false;
  }

  writeLog(message.eventName || "popup_event", {
    ...(message.payload || {}),
    sender: {
      id: sender.id || null,
      url: sender.url || null
    }
  });

  sendResponse({ ok: true });
  return true;
});
