const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const EXTENSION_VERSION_NAME = chrome.runtime.getManifest().version_name || EXTENSION_VERSION;
const LOGGER_BUILD = "url-capture-v16";
const REDACTED_VALUE = "[REDACTED]";
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8080/";
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const HTML_TEXT_UPLOAD_TIMEOUT_MS = 10000;
const HTML_FULL_UPLOAD_TIMEOUT_MS = 30000;
const BACKEND_BASE_URL_STORAGE_KEY = "settings.backendBaseUrl";
const URL_LOGGER_SETTINGS_KEY = "urlLogger.settings";
const URL_LOGGER_LOGS_KEY = "urlLogger.global.logs";
const URL_LOGGER_STATE_KEY = "urlLogger.global.state";
const MAX_URL_LOGS = 300;
const SENSITIVE_PARAM_NAMES = new Set([
  "access_token",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "id_token",
  "password",
  "refresh_token",
  "secret",
  "session",
  "sessionid",
  "sid",
  "state",
  "token"
]);

function shouldRedactParam(name) {
  return SENSITIVE_PARAM_NAMES.has(String(name || "").toLowerCase());
}

function redactParams(params) {
  let changed = false;

  for (const [name] of params.entries()) {
    if (!shouldRedactParam(name)) {
      continue;
    }

    params.set(name, REDACTED_VALUE);
    changed = true;
  }

  return changed;
}

function redactHash(hash) {
  if (!hash || !hash.includes("?")) {
    return { hash, changed: false };
  }

  const questionIndex = hash.indexOf("?");
  const hashPath = hash.slice(0, questionIndex + 1);
  const hashQuery = hash.slice(questionIndex + 1);
  const hashParams = new URLSearchParams(hashQuery);
  const changed = redactParams(hashParams);

  return {
    hash: changed ? `${hashPath}${hashParams.toString()}` : hash,
    changed
  };
}

function maskSensitiveUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl);
    const queryChanged = redactParams(url.searchParams);
    const redactedHash = redactHash(url.hash);

    if (redactedHash.changed) {
      url.hash = redactedHash.hash;
    }

    return queryChanged || redactedHash.changed ? url.toString() : rawUrl;
  } catch (error) {
    return rawUrl;
  }
}

function writeLog(eventName, details = {}) {
  const logEntry = {
    time: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    extensionVersionName: EXTENSION_VERSION_NAME,
    loggerBuild: LOGGER_BUILD,
    eventName,
    ...details
  };

  console.groupCollapsed(`[My Extension v${EXTENSION_VERSION_NAME} ${LOGGER_BUILD}] ${eventName} ${logEntry.time}`);
  console.log("time:", logEntry.time);
  console.log("extensionVersion:", logEntry.extensionVersion);
  console.log("extensionVersionName:", logEntry.extensionVersionName);
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

function getLocalTime() {
  return new Date().toLocaleString();
}

async function fetchWithTimeout(targetUrl, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(targetUrl, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getBackendBaseUrl() {
  const result = await chrome.storage.local.get(BACKEND_BASE_URL_STORAGE_KEY);
  const value = String(result[BACKEND_BASE_URL_STORAGE_KEY] || DEFAULT_BACKEND_BASE_URL).trim() || DEFAULT_BACKEND_BASE_URL;

  try {
    const url = new URL(value);
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch (error) {
    return DEFAULT_BACKEND_BASE_URL;
  }
}

async function postExtensionEventReport(eventName, details = {}) {
  const backendBaseUrl = await getBackendBaseUrl();
  const targetUrl = new URL("api/report", backendBaseUrl).toString();
  const manifest = chrome.runtime.getManifest();
  const payload = {
    event_name: eventName,
    time: new Date().toISOString(),
    extension_version: EXTENSION_VERSION,
    logger_build: LOGGER_BUILD,
    backend_base_url: backendBaseUrl,
    details: {
      extension_id: chrome.runtime.id,
      extension_name: manifest.name || "",
      extension_version_name: EXTENSION_VERSION_NAME,
      ...details
    }
  };

  const response = await fetchWithTimeout(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }

  return {
    ok: true,
    targetUrl
  };
}

async function postExtensionLoadReport(trigger, reason) {
  try {
    const result = await postExtensionEventReport("extension_loaded", {
      trigger,
      reason
    });

    writeLog("extension_load_report_sent", {
      trigger,
      reason,
      targetUrl: result.targetUrl
    });
    return result;
  } catch (error) {
    writeLog("extension_load_report_failed", {
      trigger,
      reason,
      error: String(error)
    });
    return {
      ok: false,
      error: String(error)
    };
  }
}

async function postNavigationReport(navigation, entry) {
  try {
    const result = await postExtensionEventReport("url_jump_recorded", {
      tabContext: {
        tabId: entry.tabId ?? null,
        windowId: entry.windowId ?? null
      },
      navigation
    });

    writeLog("url_jump_report_sent", {
      targetUrl: result.targetUrl,
      navigation
    });
  } catch (error) {
    writeLog("url_jump_report_failed", {
      error: String(error),
      navigation
    });
  }
}

async function ensureDefaultSettings() {
  const result = await chrome.storage.local.get([
    BACKEND_BASE_URL_STORAGE_KEY,
    URL_LOGGER_SETTINGS_KEY,
    URL_LOGGER_LOGS_KEY,
    URL_LOGGER_STATE_KEY
  ]);
  const patch = {};

  if (!result[BACKEND_BASE_URL_STORAGE_KEY]) {
    patch[BACKEND_BASE_URL_STORAGE_KEY] = DEFAULT_BACKEND_BASE_URL;
  }

  if (!result[URL_LOGGER_SETTINGS_KEY]) {
    patch[URL_LOGGER_SETTINGS_KEY] = {
      enabled: true
    };
  }

  if (!Array.isArray(result[URL_LOGGER_LOGS_KEY])) {
    patch[URL_LOGGER_LOGS_KEY] = [];
  }

  if (!result[URL_LOGGER_STATE_KEY]) {
    patch[URL_LOGGER_STATE_KEY] = {
      lastByTab: {}
    };
  }

  if (!Object.keys(patch).length) {
    return;
  }

  await chrome.storage.local.set(patch);

  writeLog("default_settings_initialized", {
    backendBaseUrl: patch[BACKEND_BASE_URL_STORAGE_KEY] || result[BACKEND_BASE_URL_STORAGE_KEY] || DEFAULT_BACKEND_BASE_URL,
    urlLoggerEnabled: (patch[URL_LOGGER_SETTINGS_KEY] || result[URL_LOGGER_SETTINGS_KEY] || {}).enabled ?? true
  });
}

async function getUrlLoggerSettings() {
  const result = await chrome.storage.local.get(URL_LOGGER_SETTINGS_KEY);
  return {
    enabled: true,
    ...(result[URL_LOGGER_SETTINGS_KEY] || {})
  };
}

async function appendNavigationLog(entry) {
  if (!entry?.url) {
    return;
  }

  const settings = await getUrlLoggerSettings();

  if (!settings.enabled) {
    return;
  }

  const safeUrl = maskSensitiveUrl(entry.url);
  const result = await chrome.storage.local.get([URL_LOGGER_LOGS_KEY, URL_LOGGER_STATE_KEY]);
  const logs = Array.isArray(result[URL_LOGGER_LOGS_KEY]) ? result[URL_LOGGER_LOGS_KEY] : [];
  const state = {
    lastByTab: {},
    ...(result[URL_LOGGER_STATE_KEY] || {})
  };
  const tabKey = String(entry.tabId ?? "unknown");
  const signature = [
    entry.reason || "",
    safeUrl,
    entry.error || "",
    entry.transitionType || ""
  ].join("|");

  if (state.lastByTab[tabKey] === signature && entry.reason !== "recording_enabled") {
    return;
  }

  const navigation = {
    time: getLocalTime(),
    title: "",
    ...entry,
    url: safeUrl
  };

  state.lastByTab[tabKey] = signature;

  await chrome.storage.local.set({
    [URL_LOGGER_LOGS_KEY]: [navigation, ...logs].slice(0, MAX_URL_LOGS),
    [URL_LOGGER_STATE_KEY]: state
  });

  writeLog("url_jump_recorded", {
    tabContext: {
      tabId: entry.tabId ?? null,
      windowId: entry.windowId ?? null
    },
    navigation
  });

  chrome.runtime.sendMessage({ type: "URL_LOG_UPDATED" }, () => {
    void chrome.runtime.lastError;
  });

  void postNavigationReport(navigation, entry);
}

function recordNavigationAttempt(source, details) {
  void appendNavigationLog({
    reason: source,
    url: details.url,
    title: details.title || "",
    tabId: details.tabId ?? null,
    windowId: details.windowId ?? null,
    frameId: details.frameId ?? null,
    requestId: details.requestId || "",
    transitionType: details.transitionType || "",
    error: details.error || ""
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  void ensureDefaultSettings().then(() => postExtensionLoadReport("onInstalled", details.reason || "unknown"));
  writeLog("extension_installed", {
    reason: details.reason,
    previousVersion: details.previousVersion || null
  });
});

writeLog("background_loaded", {
  message: "Background service worker loaded with navigation capture listeners."
});
void ensureDefaultSettings();

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaultSettings().then(() => postExtensionLoadReport("onStartup", "browser_started"));
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return;
  }

  recordNavigationAttempt("tabs.onUpdated.url", {
    tabId,
    windowId: tab?.windowId ?? null,
    url: changeInfo.url,
    title: tab?.title || "",
    frameId: 0
  });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);

    if (!tab?.url) {
      return;
    }

    recordNavigationAttempt("tabs.onActivated", {
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      url: tab.url,
      title: tab.title || "",
      frameId: 0
    });
  } catch (error) {
    writeLog("tabs_on_activated_failed", {
      error: String(error)
    });
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  try {
    const tabs = await chrome.tabs.query({
      active: true,
      windowId
    });
    const tab = tabs[0];

    if (!tab?.url) {
      return;
    }

    recordNavigationAttempt("windows.onFocusChanged", {
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      url: tab.url,
      title: tab.title || "",
      frameId: 0
    });
  } catch (error) {
    writeLog("windows_on_focus_changed_failed", {
      error: String(error)
    });
  }
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

  if (message?.type === "SET_URL_LOGGER_ENABLED") {
    chrome.storage.local.set({
      [URL_LOGGER_SETTINGS_KEY]: {
        enabled: Boolean(message.enabled)
      }
    }).then(() => {
      writeLog("url_logger_setting_changed", {
        enabled: Boolean(message.enabled)
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "CLEAR_URL_LOGS") {
    chrome.storage.local.set({
      [URL_LOGGER_LOGS_KEY]: [],
      [URL_LOGGER_STATE_KEY]: {
        lastByTab: {}
      }
    }).then(() => {
      writeLog("url_logs_cleared");
      chrome.runtime.sendMessage({ type: "URL_LOG_UPDATED" }, () => {
        void chrome.runtime.lastError;
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "CONTENT_URL_EVENT") {
    recordNavigationAttempt(message.payload?.reason || "content.url_event", {
      tabId: sender.tab?.id ?? null,
      windowId: sender.tab?.windowId ?? null,
      url: message.payload?.url || sender.tab?.url || "",
      title: message.payload?.title || sender.tab?.title || "",
      frameId: sender.frameId ?? 0
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "SEND_EXTENSION_LOAD_REPORT") {
    postExtensionLoadReport(
      String(message.trigger || "popup_manual"),
      String(message.reason || "manual_test")
    ).then((result) => {
      sendResponse(result);
    });
    return true;
  }

  if (message?.type === "START_IP_CAPTURE") {
    sendResponse({ ok: true, message: "任务已启动" });

    handleIpCapture(
      String(message.backendBaseUrl || DEFAULT_BACKEND_BASE_URL),
      String(message.token || "")
    ).catch((error) => {
      writeLog("ip_capture_error", {
        error: error.message || String(error)
      });
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

const ipCaptureState = {
  currentTabId: null,
  notificationId: null
};

async function findOrOpenTargetPage(targetUrl) {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(targetUrl));

  if (existingTab) {
    writeLog("target_page_found", {
      targetUrl,
      tabId: existingTab.id,
      windowId: existingTab.windowId
    });
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
    return existingTab;
  }

  writeLog("target_page_opening", { targetUrl });

  const newTab = await chrome.tabs.create({
    url: targetUrl,
    active: false
  });

  writeLog("target_page_opened", {
    targetUrl,
    tabId: newTab.id,
    windowId: newTab.windowId
  });

  return newTab;
}

async function waitForPageComplete(tabId, timeoutMs = 30000) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        reject(new Error("等待页面加载超时"));
        return;
      }

      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          clearInterval(checkInterval);
          resolve(tab);
        }
      } catch (error) {
        clearInterval(checkInterval);
        reject(error);
      }
    }, 500);
  });
}

async function extractPageContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title || "",
      url: window.location.href,
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : ""
    })
  });

  const page = results?.[0]?.result;
  if (!page) {
    throw new Error("页面内容提取失败");
  }

  return page;
}

function generateJsonRpcId() {
  return Date.now() * 1000000 + Math.floor(Math.random() * 1000000);
}

async function requestJsonRpc(targetUrl, method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const rpcId = generateJsonRpcId();
  const rpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
    id: rpcId
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcRequest),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let rpcResponse;

    try {
      rpcResponse = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error("JSON-RPC 响应解析失败");
    }

    if (!response.ok) {
      throw new Error(rpcResponse.error?.message || `HTTP ${response.status}`);
    }

    if (rpcResponse.id !== rpcId) {
      throw new Error("JSON-RPC ID 不匹配");
    }

    if (rpcResponse.error) {
      throw new Error(rpcResponse.error.message || "JSON-RPC 错误");
    }

    return rpcResponse.result || {};
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs / 1000}秒）`);
    }
    throw error;
  }
}

async function postHtmlCaptureJsonRpc(backendBaseUrl, captureType, page, tab, token) {
  const targetPath = captureType === "text" ? "api/html/text" : "api/html/all";
  const targetUrl = new URL(targetPath, backendBaseUrl).toString();
  const contentField = captureType === "text" ? "text" : "html";
  const timeoutMs = captureType === "text" ? HTML_TEXT_UPLOAD_TIMEOUT_MS : HTML_FULL_UPLOAD_TIMEOUT_MS;
  const method = captureType === "text" ? "html.captureText" : "html.captureAll";

  const params = {
    token,
    time: new Date().toISOString(),
    extension_version: EXTENSION_VERSION,
    extension_version_name: EXTENSION_VERSION_NAME,
    page: {
      title: page.title || tab.title || "",
      url: maskSensitiveUrl(page.url || tab.url || ""),
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      sourceReason: "button3_background_capture"
    },
    [contentField]: page[contentField] || ""
  };

  return await requestJsonRpc(targetUrl, method, params, timeoutMs);
}

function showNotification(id, title, message, iconUrl = "icon.png") {
  return chrome.notifications.create(id, {
    type: "basic",
    iconUrl,
    title,
    message
  });
}

async function handleIpCapture(backendBaseUrl, token) {
  const targetUrl = "https://ipinfo.dkly.net/";
  const notificationId = `ip-capture-${Date.now()}`;

  ipCaptureState.notificationId = notificationId;

  try {
    await showNotification(notificationId, "抓取IP信息", "正在打开目标页面...");

    const tab = await findOrOpenTargetPage(targetUrl);
    ipCaptureState.currentTabId = tab.id;

    await showNotification(notificationId, "抓取IP信息", "等待页面加载完成...");

    const completedTab = await waitForPageComplete(tab.id);

    writeLog("ip_capture_page_loaded", {
      tabId: completedTab.id,
      url: completedTab.url
    });

    await showNotification(notificationId, "抓取IP信息", "正在提取页面内容...");

    const page = await extractPageContent(completedTab.id);

    writeLog("ip_capture_content_extracted", {
      tabId: completedTab.id,
      textBytes: new Blob([page.text || ""]).size,
      htmlBytes: new Blob([page.html || ""]).size
    });

    await showNotification(notificationId, "抓取IP信息", "正在上传到后端...");

    const textResult = await postHtmlCaptureJsonRpc(backendBaseUrl, "text", page, completedTab, token);
    const htmlResult = await postHtmlCaptureJsonRpc(backendBaseUrl, "all", page, completedTab, token);

    writeLog("ip_capture_completed", {
      tabId: completedTab.id,
      textBytes: textResult.bytes,
      htmlBytes: htmlResult.bytes
    });

    await showNotification(notificationId, "抓取完成", "IP信息已成功保存，点击查看页面");

    return {
      ok: true,
      tabId: completedTab.id,
      textBytes: textResult.bytes,
      htmlBytes: htmlResult.bytes
    };
  } catch (error) {
    writeLog("ip_capture_failed", {
      error: error.message || String(error)
    });

    await showNotification(notificationId, "抓取失败", error.message || "未知错误");

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === ipCaptureState.notificationId && ipCaptureState.currentTabId) {
    chrome.tabs.update(ipCaptureState.currentTabId, { active: true }).then(() => {
      chrome.tabs.get(ipCaptureState.currentTabId).then((tab) => {
        chrome.windows.update(tab.windowId, { focused: true });
      });
    }).catch(() => {
      // Tab might be closed
    });
  }

  chrome.notifications.clear(notificationId);
});
