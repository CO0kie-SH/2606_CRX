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
const BACKEND_BASE_URL_STORAGE_KEY = "settings.backendBaseUrl";
const BACKEND_TOKEN_STORAGE_KEY = "settings.backendToken";
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
const popupState = {
  urlLoggerEnabled: true,
  urlLogs: [],
  currentPageTab: null,
  backendToken: ""
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
    throw new Error(data.error || `HTTP ${response.status}: ${responseText || "请求失败。"}`);
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

          await appendRuntimeLog("ip_info_captured", {
            backendBaseUrl,
            token,
            rpcId: textResult.rpc_id || null,
            city: textResult.city || null,
            regionName: textResult.region_name || null,
            bytes: textResult.bytes
          });

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
void loadUrlLoggerState();
