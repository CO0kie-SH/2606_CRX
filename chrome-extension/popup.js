const messageElement = document.getElementById("message");
const manifest = chrome.runtime.getManifest();
const backendBaseUrlInput = document.getElementById("backend-base-url");
const saveBackendUrlButton = document.getElementById("save-backend-url");
const saveStatusElement = document.getElementById("save-status");
const featureButtons = Array.from(document.querySelectorAll("[data-feature]"));
const urlLoggerEnabledElement = document.getElementById("url-logger-enabled");
const urlLoggerStatusElement = document.getElementById("url-logger-status");
const urlLoggerLogsElement = document.getElementById("url-logger-logs");
const urlLoggerCopyButton = document.getElementById("url-logger-copy");
const urlLoggerExportButton = document.getElementById("url-logger-export");
const urlLoggerClearButton = document.getElementById("url-logger-clear");
const REDACTED_VALUE = "[REDACTED]";
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8080/";
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const HTML_TEXT_UPLOAD_TIMEOUT_MS = 10000;
const HTML_FULL_UPLOAD_TIMEOUT_MS = 30000;
const ADDRESS_CAPTURE_TIMEOUT_MS = 20000;
const NAME_METHOD_SCAN_TIMEOUT_MS = 12000;
const NAME_METHOD_MAX_SCRIPT_COUNT = 32;
const NAME_METHOD_SNIPPET_RADIUS = 360;
const BACKEND_BASE_URL_STORAGE_KEY = "settings.backendBaseUrl";
const BACKEND_TOKEN_STORAGE_KEY = "settings.backendToken";
const IP_CAPTURE_STORAGE_KEY = "settings.lastIpCapture";
const URL_LOGGER_SETTINGS_KEY = "urlLogger.settings";
const URL_LOGGER_LOGS_KEY = "urlLogger.global.logs";
const MAX_RUNTIME_LOGS = 300;
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
const NAME_METHOD_KEYWORDS = [
  { term: "Japanese Name Generator", weight: 12 },
  { term: "japanese-name-generator", weight: 12 },
  { term: "generatedName", weight: 10 },
  { term: "generateName", weight: 10 },
  { term: "recentNames", weight: 9 },
  { term: "nameType", weight: 8 },
  { term: "surname", weight: 8 },
  { term: "givenName", weight: 8 },
  { term: "kanji", weight: 7 },
  { term: "hiragana", weight: 7 },
  { term: "romaji", weight: 7 },
  { term: "meaning", weight: 5 },
  { term: "Math.random", weight: 5 },
  { term: ".random(", weight: 4 },
  { term: "randomMode", weight: 4 },
  { term: "aiMode", weight: 3 }
];
const popupState = {
  urlLoggerEnabled: true,
  urlLogs: [],
  currentPageTab: null,
  backendToken: "",
  lastIpInfo: null
};

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

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
}

function getCurrentPageInfo(tab) {
  if (!tab) {
    return null;
  }

  return {
    id: tab.id ?? null,
    windowId: tab.windowId ?? null,
    title: tab.title || "",
    url: maskSensitiveUrl(tab.url || ""),
    hostname: getHostname(tab.url),
    favIconUrl: tab.favIconUrl || "",
    incognito: Boolean(tab.incognito),
    status: tab.status || "",
    capturedAt: new Date().toISOString()
  };
}

function logEvent(eventName, payload) {
  chrome.runtime.sendMessage(
    {
      type: "LOG_EVENT",
      eventName,
      payload
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("Log message failed:", chrome.runtime.lastError.message);
      }
    }
  );
}

function setSaveStatus(text, isError = false) {
  saveStatusElement.textContent = text;
  saveStatusElement.style.color = isError ? "#b91c1c" : "#444";
}

function setUrlLoggerStatus(text, isError = false) {
  urlLoggerStatusElement.textContent = text;
  urlLoggerStatusElement.style.color = isError ? "#b91c1c" : "#444";
}

function getLocalLogTime() {
  return new Date().toISOString();
}

function createRequestTimeoutError(timeoutMs) {
  const error = new Error(`请求超时（${timeoutMs / 1000}秒），请确认后端服务已启动。`);
  error.name = "RequestTimeoutError";
  return error;
}

function isRequestTimeoutError(error) {
  return error?.name === "RequestTimeoutError";
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
      throw createRequestTimeoutError(timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestJson(targetUrl, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(targetUrl, options, timeoutMs);
  const responseText = await response.text();
  let data = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    data = {
      raw: responseText
    };
  }

  if (!response.ok) {
    const errorMessage = typeof data.error === "string"
      ? data.error
      : data.error?.message;
    throw new Error(errorMessage || `HTTP ${response.status}: ${responseText || "请求失败。"}`);
  }

  return data;
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

  const response = await fetchWithTimeout(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(rpcRequest)
  }, timeoutMs);

  const responseText = await response.text();
  let rpcResponse;

  try {
    rpcResponse = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error("JSON-RPC 响应解析失败：" + responseText);
  }

  if (!response.ok) {
    throw new Error(rpcResponse.error?.message || `HTTP ${response.status}: ${responseText || "请求失败。"}`);
  }

  if (rpcResponse.id !== rpcId) {
    throw new Error(`JSON-RPC ID 不匹配：期望 ${rpcId}，收到 ${rpcResponse.id}`);
  }

  if (rpcResponse.error) {
    throw new Error(rpcResponse.error.message || "JSON-RPC 错误");
  }

  return rpcResponse.result || {};
}

function normalizeBackendBaseUrl(rawValue) {
  const value = String(rawValue || "").trim() || DEFAULT_BACKEND_BASE_URL;

  try {
    const url = new URL(value);
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch (error) {
    throw new Error("地址格式不正确，请输入完整的 http:// 或 https:// URL。");
  }
}

async function ensureDefaultBackendBaseUrl() {
  const result = await chrome.storage.local.get(BACKEND_BASE_URL_STORAGE_KEY);
  const storedValue = result[BACKEND_BASE_URL_STORAGE_KEY];

  if (storedValue) {
    return storedValue;
  }

  await chrome.storage.local.set({
    [BACKEND_BASE_URL_STORAGE_KEY]: DEFAULT_BACKEND_BASE_URL
  });

  logEvent("backend_base_url_initialized", {
    value: DEFAULT_BACKEND_BASE_URL
  });

  return DEFAULT_BACKEND_BASE_URL;
}

async function loadBackendBaseUrl() {
  try {
    const currentValue = await ensureDefaultBackendBaseUrl();
    backendBaseUrlInput.value = currentValue;
    setSaveStatus("已加载前后端交互地址。");
  } catch (error) {
    backendBaseUrlInput.value = DEFAULT_BACKEND_BASE_URL;
    setSaveStatus("读取地址失败，已回退默认值。", true);
    console.error(error);
  }
}

async function loadBackendTokenState() {
  try {
    const result = await chrome.storage.local.get(BACKEND_TOKEN_STORAGE_KEY);
    popupState.backendToken = String(result[BACKEND_TOKEN_STORAGE_KEY] || "");
  } catch (error) {
    popupState.backendToken = "";
    console.error(error);
  }
}

async function loadLastIpInfoState() {
  try {
    const result = await chrome.storage.local.get(IP_CAPTURE_STORAGE_KEY);
    popupState.lastIpInfo = result[IP_CAPTURE_STORAGE_KEY] || null;
  } catch (error) {
    popupState.lastIpInfo = null;
    console.error(error);
  }
}

async function saveLastIpInfo(info) {
  popupState.lastIpInfo = info;
  await chrome.storage.local.set({
    [IP_CAPTURE_STORAGE_KEY]: info
  });
}

async function saveBackendBaseUrl() {
  const originalText = saveBackendUrlButton.textContent;

  try {
    saveBackendUrlButton.disabled = true;
    saveBackendUrlButton.textContent = "保存中...";

    const normalizedUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
    await chrome.storage.local.set({
      [BACKEND_BASE_URL_STORAGE_KEY]: normalizedUrl
    });

    backendBaseUrlInput.value = normalizedUrl;
    setSaveStatus("保存成功。");
    logEvent("backend_base_url_saved", {
      value: normalizedUrl
    });
  } catch (error) {
    setSaveStatus(error.message || "保存失败。", true);
    console.error(error);
  } finally {
    saveBackendUrlButton.disabled = false;
    saveBackendUrlButton.textContent = originalText;
  }
}

function formatLogEntry(entry, index) {
  const total = popupState.urlLogs.length;

  if (!isUrlNavigationLog(entry)) {
    return formatRuntimeLogEntry(entry, index, total);
  }

  const lines = [
    `#${total - index} ${entry.time || ""}`,
    `来源: ${entry.reason || "-"}`,
    `窗口: ${entry.windowId ?? "-"} / 标签: ${entry.tabId ?? "-"}`,
    `URL: ${entry.url || "-"}`
  ];

  if (entry.title) {
    lines.splice(3, 0, `标题: ${entry.title}`);
  }

  if (entry.error) {
    lines.push(`错误: ${entry.error}`);
  }

  if (entry.transitionType) {
    lines.push(`类型: ${entry.transitionType}`);
  }

  return lines.join("\n");
}

function isUrlNavigationLog(entry) {
  return Boolean(entry?.url || entry?.reason);
}

function formatRuntimeLogEntry(entry, index, total) {
  const details = entry.details || {};
  const lines = [
    `#${total - index} ${entry.time || ""}`,
    `类型: ${entry.eventType || entry.type || "runtime_event"}`
  ];

  if (details.backendBaseUrl) {
    lines.push(`后端: ${details.backendBaseUrl}`);
  }

  if (details.targetUrl) {
    lines.push(`接口: ${details.targetUrl}`);
  }

  if (details.token) {
    lines.push(`token: ${details.token}`);
  }

  if (details.tabCount !== undefined) {
    lines.push(`标签页数量: ${details.tabCount}`);
  }

  if (details.savedTo) {
    lines.push(`保存位置: ${details.savedTo}`);
  }

  if (details.windowId !== undefined) {
    lines.push(`窗口ID: ${details.windowId}`);
  }

  if (details.tabId !== undefined) {
    lines.push(`标签页ID: ${details.tabId}`);
  }

  if (details.url) {
    lines.push(`URL: ${details.url}`);
  }

  if (details.hostname) {
    lines.push(`域名: ${details.hostname}`);
  }

  if (details.title) {
    lines.push(`标题: ${details.title}`);
  }

  if (details.status) {
    lines.push(`状态: ${details.status}`);
  }

  if (details.active !== undefined) {
    lines.push(`活动: ${details.active}`);
  }

  if (details.incognito !== undefined) {
    lines.push(`隐私: ${details.incognito}`);
  }

  if (details.textBytes !== undefined) {
    lines.push(`文本字节: ${details.textBytes}`);
  }

  if (details.htmlBytes !== undefined) {
    lines.push(`HTML字节: ${details.htmlBytes}`);
  }

  if (details.rpcId !== undefined) {
    lines.push(`RPC ID: ${details.rpcId}`);
  }

  if (details.city) {
    lines.push(`城市: ${details.city}`);
  }

  if (details.regionName) {
    lines.push(`区域: ${details.regionName}`);
  }

  if (details.bytes !== undefined) {
    lines.push(`字节数: ${details.bytes}`);
  }

  if (details.error) {
    lines.push(`错误: ${details.error}`);
  }

  if (details.message) {
    lines.push(`提示: ${details.message}`);
  }

  if (details.addressSummary) {
    lines.push(`地址: ${details.addressSummary}`);
  }

  if (details.addressName) {
    lines.push(`姓名: ${details.addressName}`);
  }

  if (details.kanaName) {
    lines.push(`片假名姓名: ${details.kanaName}`);
  }

  if (details.kanjiFamily) {
    lines.push(`kanjiFamily: ${details.kanjiFamily}`);
  }

  if (details.kanjiGiven) {
    lines.push(`kanjiGiven: ${details.kanjiGiven}`);
  }

  if (details.kanaFamily) {
    lines.push(`kanaFamily: ${details.kanaFamily}`);
  }

  if (details.kanaGiven) {
    lines.push(`kanaGiven: ${details.kanaGiven}`);
  }

  if (details.addressPhone) {
    lines.push(`电话: ${details.addressPhone}`);
  }

  if (details.addressZip) {
    lines.push(`邮编: ${details.addressZip}`);
  }

  if (details.cardNumber) {
    lines.push(`卡号: ${details.cardNumber}`);
  }

  if (details.cardExpiry) {
    lines.push(`有效期: ${details.cardExpiry}`);
  }

  if (details.cardCvv) {
    lines.push(`CVV: ${details.cardCvv}`);
  }

  if (details.cardLuhnValid !== undefined) {
    lines.push(`Luhn: ${details.cardLuhnValid ? "PASS" : "FAIL"}`);
  }

  if (details.scannedScriptCount !== undefined) {
    lines.push(`扫描脚本数: ${details.scannedScriptCount}`);
  }

  if (details.candidateCount !== undefined) {
    lines.push(`候选数量: ${details.candidateCount}`);
  }

  if (details.methodScriptUrl) {
    lines.push(`候选脚本: ${details.methodScriptUrl}`);
  }

  if (details.methodSourceKind) {
    lines.push(`来源类型: ${details.methodSourceKind}`);
  }

  if (details.methodScore !== undefined) {
    lines.push(`匹配分数: ${details.methodScore}`);
  }

  if (details.matchedKeywords) {
    lines.push(`命中关键词: ${details.matchedKeywords}`);
  }

  if (details.methodCandidates) {
    lines.push(`候选列表: ${details.methodCandidates}`);
  }

  if (details.methodHint) {
    lines.push(`方法判断: ${details.methodHint}`);
  }

  if (details.methodSnippet) {
    lines.push(`代码片段: ${details.methodSnippet}`);
  }

  if (details.methodProbeTarget) {
    lines.push(`运行探针按钮: ${details.methodProbeTarget}`);
  }

  if (details.methodProbeRandomCalls !== undefined) {
    lines.push(`随机调用次数: ${details.methodProbeRandomCalls}`);
  }

  if (details.methodProbeStack) {
    lines.push(`随机调用栈: ${details.methodProbeStack}`);
  }

  if (details.methodProbeOutput) {
    lines.push(`生成后文本: ${details.methodProbeOutput}`);
  }

  return lines.join("\n");
}

function renderUrlLogger() {
  urlLoggerEnabledElement.checked = popupState.urlLoggerEnabled;
  setUrlLoggerStatus(
    popupState.urlLoggerEnabled
      ? `运行日志记录中，当前共 ${popupState.urlLogs.length} 条`
      : "URL 运行记录已关闭，主动操作日志仍会记录"
  );

  urlLoggerLogsElement.textContent = popupState.urlLogs.length
    ? popupState.urlLogs.map(formatLogEntry).join("\n\n")
    : "当前还没有运行日志。";
}

async function loadUrlLoggerState() {
  try {
    const result = await chrome.storage.local.get([URL_LOGGER_SETTINGS_KEY, URL_LOGGER_LOGS_KEY]);
    popupState.urlLoggerEnabled = (result[URL_LOGGER_SETTINGS_KEY] || {}).enabled ?? true;
    popupState.urlLogs = Array.isArray(result[URL_LOGGER_LOGS_KEY]) ? result[URL_LOGGER_LOGS_KEY] : [];
    renderUrlLogger();
  } catch (error) {
    setUrlLoggerStatus("读取记录状态失败。", true);
    console.error(error);
  }
}

function buildUrlLogsText() {
  if (!popupState.urlLogs.length) {
    return "当前没有可复制的运行日志。";
  }

  return popupState.urlLogs.map(formatLogEntry).join("\n\n");
}

async function copyUrlLogs() {
  try {
    await navigator.clipboard.writeText(buildUrlLogsText());
    setUrlLoggerStatus(`已复制 ${popupState.urlLogs.length} 条记录。`);
  } catch (error) {
    setUrlLoggerStatus("复制失败，请检查剪贴板权限。", true);
    console.error(error);
  }
}

function exportUrlLogs() {
  const payload = {
    exportedAt: new Date().toISOString(),
    logCount: popupState.urlLogs.length,
    logs: popupState.urlLogs
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = downloadUrl;
  anchor.download = `runtime-log-${Date.now()}.json`;
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);

  setUrlLoggerStatus(`已导出 ${popupState.urlLogs.length} 条记录。`);
}

async function appendRuntimeLog(eventType, details = {}) {
  const entry = {
    time: getLocalLogTime(),
    kind: "runtime",
    eventType,
    details
  };
  const result = await chrome.storage.local.get(URL_LOGGER_LOGS_KEY);
  const logs = Array.isArray(result[URL_LOGGER_LOGS_KEY]) ? result[URL_LOGGER_LOGS_KEY] : [];
  const nextLogs = [entry, ...logs].slice(0, MAX_RUNTIME_LOGS);

  await chrome.storage.local.set({
    [URL_LOGGER_LOGS_KEY]: nextLogs
  });

  popupState.urlLogs = nextLogs;
  renderUrlLogger();
}

async function setUrlLoggerEnabled(enabled) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "SET_URL_LOGGER_ENABLED",
        enabled
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error("设置记录状态失败。"));
          return;
        }

        resolve(response);
      }
    );
  });
}

async function clearUrlLogs() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "CLEAR_URL_LOGS"
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error("清空记录失败。"));
          return;
        }

        resolve(response);
      }
    );
  });
}

async function getBackendToken(backendBaseUrl) {
  const targetUrl = new URL("api/get_crc_token", backendBaseUrl).toString();
  const data = await requestJsonRpc(targetUrl, "token.generate", {});

  if (!data.ok || !data.token) {
    throw new Error(data.error || "获取后端 token 失败。");
  }

  return {
    token: String(data.token),
    targetUrl
  };
}

async function collectAllTabInfo() {
  const tabs = await chrome.tabs.query({});

  return tabs.map((tab) => {
    const safeUrl = maskSensitiveUrl(tab.url || "");

    return {
      id: tab.id ?? null,
      windowId: tab.windowId ?? null,
      title: tab.title || "",
      url: safeUrl,
      hostname: getHostname(safeUrl),
      active: Boolean(tab.active),
      incognito: Boolean(tab.incognito),
      status: tab.status || ""
    };
  });
}

async function createBackendToken(backendBaseUrl, token, tabs) {
  const targetUrl = new URL("api/token/create", backendBaseUrl).toString();
  const params = {
    token,
    time: new Date().toISOString(),
    extension_version: manifest.version || "",
    extension_version_name: manifest.version_name || manifest.version || "",
    tabs
  };

  const data = await requestJsonRpc(targetUrl, "token.create", params);

  if (!data.ok) {
    throw new Error(data.error || "创建后端 token 失败。");
  }

  return {
    ...data,
    targetUrl
  };
}

async function refreshBackendToken() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);

  await appendRuntimeLog("token_refresh_started", {
    backendBaseUrl
  });

  try {
    const tokenResult = await getBackendToken(backendBaseUrl);

    await appendRuntimeLog("token_requested", {
      backendBaseUrl,
      targetUrl: tokenResult.targetUrl,
      token: tokenResult.token
    });

    const tabs = await collectAllTabInfo();

    await appendRuntimeLog("tabs_snapshot_collected", {
      backendBaseUrl,
      token: tokenResult.token,
      tabCount: tabs.length
    });

    let createResult;

    try {
      createResult = await createBackendToken(backendBaseUrl, tokenResult.token, tabs);
    } catch (error) {
      await appendRuntimeLog("token_create_failed", {
        backendBaseUrl,
        token: tokenResult.token,
        tabCount: tabs.length,
        error: error.message || String(error)
      });
      error.runtimeLogged = true;
      throw error;
    }

    await appendRuntimeLog("token_create_succeeded", {
      backendBaseUrl,
      targetUrl: createResult.targetUrl,
      token: tokenResult.token,
      tabCount: tabs.length,
      savedTo: createResult.saved_to || ""
    });

    popupState.backendToken = tokenResult.token;
    await chrome.storage.local.set({
      [BACKEND_TOKEN_STORAGE_KEY]: tokenResult.token
    });

    return {
      ...createResult,
      token: tokenResult.token,
      tabCount: tabs.length
    };
  } catch (error) {
    if (!error.runtimeLogged) {
      await appendRuntimeLog("token_refresh_failed", {
        backendBaseUrl,
        error: error.message || String(error)
      });
    }
    throw error;
  }
}

async function getCurrentActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const tab = tabs[0] || popupState.currentPageTab;

  if (!tab?.id) {
    throw new Error("没有找到当前活动标签页。");
  }

  return tab;
}

async function extractPageContentFromTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: "EXTRACT_PAGE_CONTENT"
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok || !response.page) {
          reject(new Error("页面内容提取失败。"));
          return;
        }

        resolve(response.page);
      }
    );
  });
}

async function extractPageContentByScripting(tab) {
  if (tab.id === undefined || tab.id === null) {
    throw new Error("目标标签页缺少 tabId，无法提取。");
  }

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: () => ({
      title: document.title || "",
      url: window.location.href,
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : ""
    })
  });
  const page = results?.[0]?.result;

  if (!page) {
    throw new Error("scripting 未返回页面内容。");
  }

  return page;
}

async function extractPageContentByFetch(tab) {
  const rawUrl = tab.url || "";

  if (!rawUrl) {
    throw new Error("目标标签页没有 URL。");
  }

  const response = await fetchWithTimeout(rawUrl, {
    method: "GET"
  });
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  return {
    title: doc.title || tab.title || "",
    url: rawUrl,
    text: doc.body?.innerText || "",
    html
  };
}

async function postHtmlCapture(backendBaseUrl, captureType, page, tab, token) {
  const targetPath = captureType === "text" ? "api/html/text" : "api/html/all";
  const targetUrl = new URL(targetPath, backendBaseUrl).toString();
  const contentField = captureType === "text" ? "text" : "html";
  const timeoutMs = captureType === "text" ? HTML_TEXT_UPLOAD_TIMEOUT_MS : HTML_FULL_UPLOAD_TIMEOUT_MS;
  const method = captureType === "text" ? "html.captureText" : "html.captureAll";

  const params = {
    token: token || popupState.backendToken || "",
    time: new Date().toISOString(),
    extension_version: manifest.version || "",
    extension_version_name: manifest.version_name || manifest.version || "",
    page: {
      title: page.title || tab.title || "",
      url: maskSensitiveUrl(page.url || tab.url || ""),
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      sourceReason: captureType === "text" ? "button2_text_capture" : "button2_html_capture"
    },
    [contentField]: page[contentField] || ""
  };

  const result = await requestJsonRpc(targetUrl, method, params, timeoutMs);

  if (!result.ok) {
    throw new Error(result.error || `发送 ${targetPath} 失败。`);
  }

  return {
    ...result,
    targetUrl
  };
}

function summarizeAddress(address) {
  if (!address || typeof address !== "object") {
    return "";
  }

  if (address.country === "US") {
    return [
      address.street || "",
      address.city || "",
      address.state || "",
      address.zip || ""
    ].filter(Boolean).join(", ");
  }

  return [
    address.address_en || address.address || address.address_cn || "",
    address.city || "",
    address.state || "",
    address.zip || ""
  ].filter(Boolean).join(", ");
}

function formatCardNumber(number) {
  const digits = String(number || "").replace(/\D+/g, "");

  if (digits.length !== 16) {
    return String(number || "");
  }

  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)} ${digits.slice(12, 16)}`;
}

async function requestAddressFromCity(backendBaseUrl, token, ipInfo) {
  const targetUrl = new URL("api/address/from-city", backendBaseUrl).toString();
  const params = {
    token,
    time: new Date().toISOString(),
    extension_version: manifest.version || "",
    extension_version_name: manifest.version_name || manifest.version || "",
    source: "button4_address_capture",
    city: ipInfo.city || "",
    region_name: ipInfo.regionName || ipInfo.region_name || "",
    country: "JP"
  };

  const result = await requestJsonRpc(targetUrl, "address.fromCity", params, ADDRESS_CAPTURE_TIMEOUT_MS);

  if (!result.ok) {
    throw new Error(result.error || "提取地址信息失败。");
  }

  return {
    ...result,
    targetUrl
  };
}

async function captureAddressInfo() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const token = popupState.backendToken || "";

  if (!token) {
    throw new Error("请先点击\"刷新后端token\"。");
  }

  const ipInfo = popupState.lastIpInfo || {};
  if (!ipInfo.city && !ipInfo.regionName && !ipInfo.region_name) {
    throw new Error("请先点击\"抓取IP信息\"，成功返回 city 后再提取地址。");
  }

  await appendRuntimeLog("address_capture_started", {
    backendBaseUrl,
    token,
    city: ipInfo.city || "",
    regionName: ipInfo.regionName || ipInfo.region_name || ""
  });

  try {
    const result = await requestAddressFromCity(backendBaseUrl, token, ipInfo);
    const addressSummary = summarizeAddress(result.address);

    await appendRuntimeLog("address_capture_succeeded", {
      backendBaseUrl,
      token,
      targetUrl: result.targetUrl,
      city: result.source_city || ipInfo.city || "",
      regionName: result.source_region_name || ipInfo.regionName || ipInfo.region_name || "",
      addressSummary,
      addressName: result.name?.kanjiFull || result.address?.full_name || "",
      kanji: result.name?.kanji || "",
      hiragana: result.name?.hiragana || "",
      romaji: result.name?.romaji || "",
      meaning: result.name?.meaning || "",
      nameType: result.name?.nameType || "",
      gender: result.name?.gender || "",
      effectiveGender: result.name?.effectiveGender || "",
      kanaName: result.name?.kanaFull || "",
      kanjiFamily: result.name?.kanjiFamily || "",
      kanjiGiven: result.name?.kanjiGiven || "",
      kanaFamily: result.name?.kanaFamily || "",
      kanaGiven: result.name?.kanaGiven || "",
      addressPhone: result.address?.phone || "",
      addressZip: result.address?.zip || "",
      cardNumber: formatCardNumber(result.card?.number || ""),
      cardExpiry: result.card?.expiry || "",
      cardCvv: result.card?.cvv || "",
      cardLuhnValid: result.card?.luhn_valid,
      savedTo: result.saved_to || ""
    });

    return {
      ...result,
      addressSummary,
      cardSummary: formatCardNumber(result.card?.number || ""),
      nameSummary: summarizeGeneratedName(result.name) || result.name?.kanaFull || ""
    };
  } catch (error) {
    await appendRuntimeLog("address_capture_failed", {
      backendBaseUrl,
      token,
      city: ipInfo.city || "",
      regionName: ipInfo.regionName || ipInfo.region_name || "",
      error: error.message || String(error)
    });
    throw error;
  }
}

function summarizeGeneratedName(name) {
  if (!name) {
    return "";
  }

  const kanji = name.kanji || name.kanjiFull || "";
  const romaji = name.romaji || name.romajiFull || "";
  const hiragana = name.hiragana || name.hiraganaFull || name.kanaFull || "";

  return [kanji, hiragana, romaji].filter(Boolean).join(" / ");
}

async function requestGeneratedName(backendBaseUrl, token) {
  const targetUrl = new URL("api/name/generate", backendBaseUrl).toString();
  const params = {
    token,
    time: new Date().toISOString(),
    extension_version: manifest.version || "",
    extension_version_name: manifest.version_name || manifest.version || "",
    source: "button4_name_generate",
    name_type: "fullName",
    gender: "unisex",
    count: 1
  };

  const result = await requestJsonRpc(targetUrl, "name.generate", params, NAME_GENERATE_TIMEOUT_MS);

  if (!result.ok) {
    throw new Error(result.error || "生成名字失败。");
  }

  return {
    ...result,
    targetUrl
  };
}

async function generateNameInfo() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const token = popupState.backendToken || "";

  if (!token) {
    throw new Error("请先点击\"刷新后端token\"。");
  }

  await appendRuntimeLog("name_generate_started", {
    backendBaseUrl,
    token,
    nameType: "fullName",
    gender: "unisex"
  });

  try {
    const result = await requestGeneratedName(backendBaseUrl, token);
    const name = result.name || {};
    const nameSummary = summarizeGeneratedName(name);

    await appendRuntimeLog("name_generate_succeeded", {
      backendBaseUrl,
      token,
      targetUrl: result.targetUrl,
      kanji: name.kanji || "",
      hiragana: name.hiragana || "",
      romaji: name.romaji || "",
      meaning: name.meaning || "",
      nameType: name.nameType || "",
      gender: name.gender || "",
      effectiveGender: name.effectiveGender || "",
      kanjiFamily: name.kanjiFamily || "",
      kanjiGiven: name.kanjiGiven || "",
      hiraganaFamily: name.hiraganaFamily || "",
      hiraganaGiven: name.hiraganaGiven || "",
      romajiFamily: name.romajiFamily || "",
      romajiGiven: name.romajiGiven || "",
      savedTo: result.saved_to || ""
    });

    return {
      ...result,
      nameSummary
    };
  } catch (error) {
    await appendRuntimeLog("name_generate_failed", {
      backendBaseUrl,
      token,
      error: error.message || String(error)
    });
    throw error;
  }
}

function countKeywordOccurrences(haystack, needle) {
  if (!haystack || !needle) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }

    count++;
    index = found + needle.length;
  }

  return count;
}

function buildMethodSnippet(text, index) {
  if (!text || index < 0) {
    return "";
  }

  const start = Math.max(0, index - NAME_METHOD_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + NAME_METHOD_SNIPPET_RADIUS);

  return text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function scanTextForNameMethod(sourceUrl, sourceKind, text) {
  const rawText = String(text || "");
  const lowerText = rawText.toLowerCase();
  let score = 0;
  let bestIndex = -1;
  let bestWeight = 0;
  const matched = [];

  for (const item of NAME_METHOD_KEYWORDS) {
    const lowerTerm = item.term.toLowerCase();
    const count = countKeywordOccurrences(lowerText, lowerTerm);

    if (!count) {
      continue;
    }

    matched.push(`${item.term}x${count}`);
    score += item.weight * Math.min(count, 8);

    const index = lowerText.indexOf(lowerTerm);
    if (item.weight > bestWeight || bestIndex === -1) {
      bestIndex = index;
      bestWeight = item.weight;
    }
  }

  if (!score) {
    return null;
  }

  if (sourceKind === "inline") {
    score = Math.max(1, Math.floor(score * 0.2));
  }

  return {
    sourceUrl,
    sourceKind,
    score,
    matchedKeywords: matched,
    bytes: new Blob([rawText]).size,
    snippet: buildMethodSnippet(rawText, bestIndex)
  };
}

function isLikelyScriptUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.pathname.endsWith(".js") || parsed.pathname.includes("/_next/static/chunks/");
  } catch (error) {
    return false;
  }
}

function shouldSkipScriptUrl(url) {
  const value = String(url || "").toLowerCase();
  return (
    value.includes("googletagmanager.com") ||
    value.includes("google-analytics.com") ||
    value.includes("clarity.ms") ||
    value.includes("cloudflareinsights.com") ||
    value.includes("beacon.min.js") ||
    value.includes("/sentry-") ||
    value.includes("/polyfills-") ||
    value.includes("/webpack-") ||
    value.includes("/main-app-")
  );
}

async function collectPageScriptAssets(tab) {
  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: () => {
      const toAbsoluteUrl = (value) => {
        if (!value) {
          return "";
        }

        try {
          return new URL(value, window.location.href).toString();
        } catch (error) {
          return "";
        }
      };
      const toChunkUrl = (value) => {
        if (!value) {
          return "";
        }

        if (value.startsWith("/_next/")) {
          return toAbsoluteUrl(value);
        }

        if (value.startsWith("_next/")) {
          return toAbsoluteUrl(`/${value}`);
        }

        if (value.startsWith("static/chunks/")) {
          return toAbsoluteUrl(`/_next/${value}`);
        }

        return toAbsoluteUrl(value);
      };

      const scriptUrls = Array.from(document.scripts)
        .map((script) => toAbsoluteUrl(script.src))
        .filter(Boolean);
      const preloadUrls = Array.from(document.querySelectorAll("link[rel='preload'][as='script'], link[rel='modulepreload'], link[href*='/_next/static/chunks/']"))
        .map((link) => toAbsoluteUrl(link.href))
        .filter(Boolean);
      const inlineScriptTexts = Array.from(document.scripts)
        .filter((script) => !script.src && script.textContent)
        .map((script) => script.textContent);
      const inlineScripts = inlineScriptTexts
        .map((text, index) => ({
          sourceUrl: `inline-script-${index + 1}`,
          text: text.slice(0, 250000)
        }));
      const inlineChunkUrls = inlineScriptTexts
        .flatMap((text) => Array.from(text.matchAll(/(?:\/?_next\/)?static\/chunks\/[^"'\\\]\s]+?\.js/g), (match) => toChunkUrl(match[0])))
        .filter(Boolean);
      const nextData = document.getElementById("__NEXT_DATA__");

      if (nextData?.textContent) {
        inlineScripts.push({
          sourceUrl: "__NEXT_DATA__",
          text: nextData.textContent.slice(0, 250000)
        });
      }

      return {
        title: document.title || "",
        url: window.location.href,
        scriptUrls: Array.from(new Set([...scriptUrls, ...preloadUrls, ...inlineChunkUrls])),
        inlineScripts
      };
    }
  });

  const payload = results?.[0]?.result;
  if (!payload) {
    throw new Error("没有读取到页面脚本信息。");
  }

  return payload;
}

async function fetchScriptText(scriptUrl) {
  const response = await fetchWithTimeout(scriptUrl, {
    method: "GET",
    cache: "no-store"
  }, NAME_METHOD_SCAN_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
}

async function runNameMethodRuntimeProbe(tab) {
  const runProbe = async () => {
    const now = () => new Date().toISOString();
    const pickOutputText = (text) => {
      const value = String(text || "");
      const markers = [
        "生成的名字",
        "漢字",
        "ひらがな",
        "Romaji",
        "Kanji",
        "Hiragana",
        "Generated Name"
      ];
      const positions = markers
        .map((marker) => value.indexOf(marker))
        .filter((index) => index >= 0);

      if (!positions.length) {
        return value.slice(0, 900);
      }

      const start = Math.max(0, Math.min(...positions) - 80);
      return value.slice(start, start + 1200);
    };

    window.__codexNameMethodProbe = window.__codexNameMethodProbe || {
      installedAt: now(),
      randomCalls: []
    };

    if (!window.__codexNameMethodProbeInstalled) {
      const originalRandom = Math.random.bind(Math);
      window.__codexNameMethodProbeOriginalRandom = originalRandom;
      Math.random = function patchedRandom(...args) {
        const value = originalRandom(...args);
        try {
          window.__codexNameMethodProbe.randomCalls.push({
            time: now(),
            value,
            stack: String(new Error().stack || "").split("\n").slice(0, 10).join(" | ")
          });
        } catch (error) {
          // Keep the target page behavior intact even if recording fails.
        }

        return value;
      };
      window.__codexNameMethodProbeInstalled = true;
    }

    const controls = Array.from(document.querySelectorAll("button, [role='button']"));
    const target = controls.find((element) => /生成名字|Generate Name/i.test(element.innerText || element.textContent || ""));
    const beforeText = document.body ? document.body.innerText : "";

    if (target) {
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    const afterText = document.body ? document.body.innerText : "";
    const randomCalls = window.__codexNameMethodProbe.randomCalls.slice(-12);
    const result = {
      ok: Boolean(target),
      targetText: target ? (target.innerText || target.textContent || "").trim().slice(0, 80) : "",
      randomCallCount: randomCalls.length,
      randomStack: randomCalls.length ? randomCalls[randomCalls.length - 1].stack : "",
      outputText: pickOutputText(afterText !== beforeText ? afterText : afterText),
      capturedAt: now()
    };

    try {
      window.localStorage.setItem("codex.nameMethodProbe", JSON.stringify(result));
    } catch (error) {
      // localStorage can be unavailable; returning the result is enough.
    }

    return result;
  };

  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      world: "MAIN",
      func: runProbe
    });
    return results?.[0]?.result || null;
  } catch (error) {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      func: runProbe
    });
    return {
      ...(results?.[0]?.result || {}),
      fallbackWorld: true
    };
  }
}

function buildMethodHint(candidate) {
  if (!candidate) {
    return "未定位到明显的本地生成逻辑。";
  }

  const matched = candidate.matchedKeywords.join(", ");
  if (matched.includes("Math.random") || matched.includes(".random(")) {
    return "命中名字字段和随机函数，生成名字大概率在该 JS chunk 内本地完成。";
  }

  if (matched.includes("generateName") || matched.includes("generatedName")) {
    return "命中生成按钮/结果字段，优先查看该 JS chunk 中相邻的函数和数组。";
  }

  return "命中名字生成器文案和字段，可能是组件入口或翻译数据；后续可扩展关键词和触发按钮规则研究其它 JS 方法。";
}

async function inspectNameGenerationMethod() {
  const tab = await getCurrentActiveTab();

  await appendRuntimeLog("name_method_scan_started", {
    url: maskSensitiveUrl(tab.url || ""),
    tabId: tab.id,
    windowId: tab.windowId,
    message: "开始扫描当前页脚本，查找生成名字或其它可扩展前端方法。"
  });

  try {
    const assets = await collectPageScriptAssets(tab);
    const runtimeProbe = await runNameMethodRuntimeProbe(tab);
    const inlineCandidates = assets.inlineScripts
      .map((item) => scanTextForNameMethod(item.sourceUrl, "inline", item.text))
      .filter(Boolean);
    const scriptUrls = assets.scriptUrls
      .filter(isLikelyScriptUrl)
      .filter((url) => !shouldSkipScriptUrl(url))
      .slice(0, NAME_METHOD_MAX_SCRIPT_COUNT);

    const fetchedResults = await Promise.all(scriptUrls.map(async (scriptUrl) => {
      try {
        const text = await fetchScriptText(scriptUrl);
        return scanTextForNameMethod(scriptUrl, "external-js", text);
      } catch (error) {
        return {
          sourceUrl: scriptUrl,
          sourceKind: "external-js",
          score: 0,
          matchedKeywords: [],
          bytes: 0,
          snippet: "",
          error: error.message || String(error)
        };
      }
    }));
    const candidates = [...inlineCandidates, ...fetchedResults.filter((item) => item && item.score > 0)]
      .sort((left, right) => right.score - left.score);
    const top = candidates[0] || null;
    const candidateSummary = candidates
      .slice(0, 4)
      .map((item, index) => `${index + 1}. ${item.score} ${item.sourceUrl}`)
      .join(" | ");

    await appendRuntimeLog("name_method_scan_completed", {
      url: maskSensitiveUrl(assets.url || tab.url || ""),
      title: assets.title || tab.title || "",
      tabId: tab.id,
      windowId: tab.windowId,
      scannedScriptCount: scriptUrls.length + assets.inlineScripts.length,
      candidateCount: candidates.length,
      methodScriptUrl: top?.sourceUrl || "",
      methodSourceKind: top?.sourceKind || "",
      methodScore: top?.score ?? 0,
      matchedKeywords: top?.matchedKeywords?.join(", ") || "",
      methodCandidates: candidateSummary,
      methodHint: buildMethodHint(top),
      methodSnippet: top?.snippet || "",
      methodProbeTarget: runtimeProbe?.targetText || "",
      methodProbeRandomCalls: runtimeProbe?.randomCallCount ?? 0,
      methodProbeStack: runtimeProbe?.randomStack || "",
      methodProbeOutput: runtimeProbe?.outputText || ""
    });

    return {
      top,
      candidateCount: candidates.length,
      scannedScriptCount: scriptUrls.length + assets.inlineScripts.length,
      candidateSummary,
      runtimeProbe
    };
  } catch (error) {
    await appendRuntimeLog("name_method_scan_failed", {
      url: maskSensitiveUrl(tab.url || ""),
      tabId: tab.id,
      windowId: tab.windowId,
      error: error.message || String(error)
    });
    throw error;
  }
}

async function findOrOpenTargetPage(targetUrl) {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(targetUrl));

  if (existingTab) {
    await appendRuntimeLog("target_page_found", {
      targetUrl,
      tabId: existingTab.id,
      windowId: existingTab.windowId
    });
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
    return existingTab;
  }

  await appendRuntimeLog("target_page_opening", {
    targetUrl
  });

  const newTab = await chrome.tabs.create({
    url: targetUrl,
    active: true
  });

  await appendRuntimeLog("target_page_opened", {
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

async function inspectCurrentPage() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const token = popupState.backendToken || "";

  if (!token) {
    throw new Error("请先点击\"刷新后端token\"。");
  }

  const targetUrl = "https://ipinfo.dkly.net/";

  await appendRuntimeLog("page_inspect_started", {
    backendBaseUrl,
    targetUrl
  });

  try {
    const tab = await findOrOpenTargetPage(targetUrl);

    await appendRuntimeLog("page_waiting_complete", {
      backendBaseUrl,
      targetUrl,
      tabId: tab.id,
      windowId: tab.windowId
    });

    const completedTab = await waitForPageComplete(tab.id);

    await appendRuntimeLog("page_load_completed", {
      backendBaseUrl,
      targetUrl,
      tabId: completedTab.id,
      status: completedTab.status
    });

    const pageInfo = {
      windowId: completedTab.windowId ?? null,
      tabId: completedTab.id ?? null,
      title: completedTab.title || "",
      url: maskSensitiveUrl(completedTab.url || ""),
      hostname: getHostname(completedTab.url || ""),
      status: completedTab.status || "",
      active: completedTab.active ?? false,
      incognito: completedTab.incognito ?? false
    };

    await appendRuntimeLog("page_inspect_completed", {
      backendBaseUrl,
      ...pageInfo
    });

    let page;

    try {
      page = await extractPageContentByScripting(completedTab);
    } catch (error) {
      await appendRuntimeLog("page_extract_scripting_failed", {
        backendBaseUrl,
        url: maskSensitiveUrl(completedTab.url || ""),
        error: error.message || String(error)
      });

      try {
        page = await extractPageContentFromTab(completedTab.id);
      } catch (contentScriptError) {
        await appendRuntimeLog("page_extract_content_script_failed", {
          backendBaseUrl,
          url: maskSensitiveUrl(completedTab.url || ""),
          error: contentScriptError.message || String(contentScriptError)
        });
        page = await extractPageContentByFetch(completedTab);
      }
    }

    await appendRuntimeLog("page_content_extracted", {
      backendBaseUrl,
      token,
      url: maskSensitiveUrl(page.url || completedTab.url || ""),
      textBytes: new Blob([page.text || ""]).size,
      htmlBytes: new Blob([page.html || ""]).size
    });

    const textResult = await postHtmlCapture(backendBaseUrl, "text", page, completedTab, token);
    const htmlResult = await postHtmlCapture(backendBaseUrl, "all", page, completedTab, token);

    await appendRuntimeLog("page_content_sent", {
      backendBaseUrl,
      token,
      url: maskSensitiveUrl(page.url || completedTab.url || ""),
      textBytes: textResult.bytes,
      htmlBytes: htmlResult.bytes,
      savedTo: `${textResult.saved_to || ""} | ${htmlResult.saved_to || ""}`
    });

    return {
      tab: completedTab,
      pageInfo,
      page,
      textResult,
      htmlResult
    };
  } catch (error) {
    await appendRuntimeLog("page_inspect_failed", {
      backendBaseUrl,
      targetUrl,
      error: error.message || String(error)
    });
    throw error;
  }
}

async function captureCurrentPage() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const tab = await getCurrentActiveTab();
  const token = popupState.backendToken || "";

  if (!token) {
    throw new Error("请先点击\"刷新后端token\"。");
  }

  await appendRuntimeLog("html_capture_started", {
    backendBaseUrl,
    token,
    url: maskSensitiveUrl(tab.url || ""),
    tabId: tab.id,
    windowId: tab.windowId
  });

  try {
    let page;

    try {
      page = await extractPageContentByScripting(tab);
    } catch (error) {
      await appendRuntimeLog("html_capture_scripting_failed", {
        backendBaseUrl,
        url: maskSensitiveUrl(tab.url || ""),
        error: error.message || String(error)
      });

      try {
        page = await extractPageContentFromTab(tab.id);
      } catch (contentScriptError) {
        await appendRuntimeLog("html_capture_content_script_failed", {
          backendBaseUrl,
          url: maskSensitiveUrl(tab.url || ""),
          error: contentScriptError.message || String(contentScriptError)
        });
        page = await extractPageContentByFetch(tab);
      }
    }

    await appendRuntimeLog("html_capture_extracted", {
      backendBaseUrl,
      token,
      url: maskSensitiveUrl(page.url || tab.url || ""),
      textBytes: new Blob([page.text || ""]).size,
      htmlBytes: new Blob([page.html || ""]).size
    });

    const textResult = await postHtmlCapture(backendBaseUrl, "text", page, tab, token);
    const htmlResult = await postHtmlCapture(backendBaseUrl, "all", page, tab, token);

    await appendRuntimeLog("html_capture_sent", {
      backendBaseUrl,
      token,
      url: maskSensitiveUrl(page.url || tab.url || ""),
      textBytes: textResult.bytes,
      htmlBytes: htmlResult.bytes,
      savedTo: `${textResult.saved_to || ""} | ${htmlResult.saved_to || ""}`
    });

    return {
      tab,
      page,
      textResult,
      htmlResult
    };
  } catch (error) {
    await appendRuntimeLog("html_capture_failed", {
      backendBaseUrl,
      token,
      url: tab.url || "",
      error: error.message || String(error)
    });
    throw error;
  }
}

function bindPopupActions() {
  saveBackendUrlButton.addEventListener("click", () => {
    void saveBackendBaseUrl();
  });

  featureButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const featureId = button.dataset.feature || "";

      if (featureId === "1") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "刷新中...";
          const result = await refreshBackendToken();
          setSaveStatus(`后端token刷新成功：${result.token}，已记录 ${result.tabCount} 个标签页。`);
        } catch (error) {
          setSaveStatus(error.message || "刷新后端token失败。", true);
          if (!isRequestTimeoutError(error)) {
            console.error(error);
          }
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }

        logEvent("feature_button_clicked", {
          featureId
        });
        return;
      }

      if (featureId === "2") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "提取中...";
          const result = await captureCurrentPage();
          setSaveStatus(`页面内容已发送：${maskSensitiveUrl(result.page.url || result.tab.url || "")}`);
        } catch (error) {
          setSaveStatus(error.message || "页面内容提取失败。", true);
          if (!isRequestTimeoutError(error)) {
            console.error(error);
          }
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }

        logEvent("feature_button_clicked", {
          featureId
        });
        return;
      }

      if (featureId === "3") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "抓取中...";

          const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
          const token = popupState.backendToken || "";

          if (!token) {
            throw new Error("请先点击\"刷新后端token\"。");
          }

          const targetUrl = "https://ipinfo.dkly.net/";
          const tabs = await chrome.tabs.query({});
          let tab = tabs.find(t => t.url && t.url.startsWith(targetUrl));

          if (tab) {
            button.textContent = "刷新页面...";
            await chrome.tabs.reload(tab.id);
            await new Promise((resolve) => setTimeout(resolve, 2000));

            button.textContent = "等待加载...";
            let attempts = 0;
            while (attempts < 20) {
              const updatedTab = await chrome.tabs.get(tab.id);
              if (updatedTab.status === "complete") {
                tab = updatedTab;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
              attempts++;
            }
          } else {
            button.textContent = "打开页面...";
            tab = await chrome.tabs.create({
              url: targetUrl,
              active: false
            });

            button.textContent = "等待页面...";
            await new Promise((resolve) => setTimeout(resolve, 3000));

            let attempts = 0;
            while (attempts < 20) {
              const updatedTab = await chrome.tabs.get(tab.id);
              if (updatedTab.status === "complete") {
                tab = updatedTab;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
              attempts++;
            }
          }

          button.textContent = "提取中...";

          const page = await extractPageContentByScripting(tab);

          button.textContent = "上传中...";

          const textResult = await postHtmlCapture(backendBaseUrl, "text", page, tab, token);

          if (textResult.city) {
            await saveLastIpInfo({
              backendBaseUrl,
              token,
              city: textResult.city || "",
              regionName: textResult.region_name || "",
              bytes: textResult.bytes || 0,
              rpcId: textResult.rpc_id || null,
              capturedAt: new Date().toISOString()
            });
          }

          await appendRuntimeLog("ip_info_captured", {
            backendBaseUrl,
            token,
            rpcId: textResult.rpc_id || null,
            city: textResult.city || null,
            regionName: textResult.region_name || null,
            bytes: textResult.bytes
          });

          if (textResult.city) {
            await appendRuntimeLog("address_extract_prompt", {
              backendBaseUrl,
              token,
              city: textResult.city || "",
              regionName: textResult.region_name || "",
              message: "已成功返回 city。请按按钮4（提取地址）生成地址、测试卡和新姓名。"
            });
          }

          if (textResult.city && textResult.region_name) {
            setSaveStatus(`IP信息已保存：${textResult.region_name} / ${textResult.city}（${textResult.bytes} 字节）`);
          } else {
            setSaveStatus(`IP信息已保存：${textResult.bytes} 字节`);
          }
        } catch (error) {
          setSaveStatus(error.message || "抓取失败。", true);
          if (!isRequestTimeoutError(error)) {
            console.error(error);
          }
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }

        logEvent("feature_button_clicked", {
          featureId
        });
        return;
      }

      if (featureId === "4") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "提取中...";
          const result = await captureAddressInfo();
          setSaveStatus(`地址、姓名和卡已提取：${result.nameSummary || "姓名已保存"}；卡号 ${result.cardSummary || "已保存到日志"}`);
        } catch (error) {
          setSaveStatus(error.message || "地址信息提取失败。", true);
          if (!isRequestTimeoutError(error)) {
            console.error(error);
          }
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }

        logEvent("feature_button_clicked", {
          featureId
        });
        return;
      }

      if (featureId === "5") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "探测中...";
          const result = await inspectNameGenerationMethod();

          if (result.top?.sourceUrl) {
            setSaveStatus(`探针已定位候选：${result.top.sourceUrl}，分数 ${result.top.score}，候选 ${result.candidateCount} 个。`);
          } else {
            setSaveStatus(`探针已扫描 ${result.scannedScriptCount} 个脚本，暂未命中明显方法。`, true);
          }
        } catch (error) {
          setSaveStatus(error.message || "JS探针执行失败。", true);
          if (!isRequestTimeoutError(error)) {
            console.error(error);
          }
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }

        logEvent("feature_button_clicked", {
          featureId
        });
        return;
      }

      setSaveStatus(`已点击功能${featureId}，后续可在 popup.js 中补充逻辑。`);
      logEvent("feature_button_clicked", {
        featureId
      });
    });
  });

  urlLoggerEnabledElement.addEventListener("change", async () => {
    try {
      await setUrlLoggerEnabled(urlLoggerEnabledElement.checked);
      popupState.urlLoggerEnabled = urlLoggerEnabledElement.checked;
      renderUrlLogger();
    } catch (error) {
      urlLoggerEnabledElement.checked = popupState.urlLoggerEnabled;
      setUrlLoggerStatus(error.message || "切换记录状态失败。", true);
      console.error(error);
    }
  });

  urlLoggerCopyButton.addEventListener("click", () => {
    void copyUrlLogs();
  });

  urlLoggerExportButton.addEventListener("click", () => {
    exportUrlLogs();
  });

  urlLoggerClearButton.addEventListener("click", async () => {
    try {
      await clearUrlLogs();
      popupState.urlLogs = [];
      renderUrlLogger();
    } catch (error) {
      setUrlLoggerStatus(error.message || "清空记录失败。", true);
      console.error(error);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[URL_LOGGER_SETTINGS_KEY]) {
      popupState.urlLoggerEnabled = changes[URL_LOGGER_SETTINGS_KEY].newValue?.enabled ?? true;
    }

    if (changes[URL_LOGGER_LOGS_KEY]) {
      popupState.urlLogs = Array.isArray(changes[URL_LOGGER_LOGS_KEY].newValue)
        ? changes[URL_LOGGER_LOGS_KEY].newValue
        : [];
    }

    if (changes[URL_LOGGER_SETTINGS_KEY] || changes[URL_LOGGER_LOGS_KEY]) {
      renderUrlLogger();
    }
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (chrome.runtime.lastError) {
    const errorMessage = chrome.runtime.lastError.message;

    messageElement.textContent = "读取当前页面信息失败。";
    logEvent("popup_opened", {
      page: "popup",
      error: errorMessage
    });
    return;
  }

  const pageInfo = getCurrentPageInfo(tabs[0]);
  popupState.currentPageTab = tabs[0] || null;

  messageElement.textContent = pageInfo?.title
    ? `当前页面：${pageInfo.title}`
    : "已记录当前页面信息。";

  logEvent("popup_opened", {
    page: "popup",
    currentPage: pageInfo
  });
});

bindPopupActions();
void loadBackendBaseUrl();
void loadBackendTokenState();
void loadLastIpInfoState();
void loadUrlLoggerState();
