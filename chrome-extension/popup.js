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
const POPUP_BUILD = "release-26.7.5A-button6-button8";
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8080/";
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const HTML_TEXT_UPLOAD_TIMEOUT_MS = 10000;
const HTML_FULL_UPLOAD_TIMEOUT_MS = 30000;
const ADDRESS_CAPTURE_TIMEOUT_MS = 20000;
const NAME_GENERATE_TIMEOUT_MS = 10000;
const NAME_METHOD_SCAN_TIMEOUT_MS = 12000;
const CHATGPT_SESSION_TIMEOUT_MS = 20000;
const CHATGPT_SESSION_SETTLE_DELAY_MS = 400;
const CHATGPT_BACKEND_API_BASE_URL = "https://chatgpt.com/";
const CHATGPT_BACKEND_API_TIMEOUT_MS = 15000;
const CHATGPT_WORKSPACE_LIST_DISPLAY_LIMIT = 80;
const NAME_METHOD_MAX_SCRIPT_COUNT = 32;
const NAME_METHOD_SNIPPET_RADIUS = 360;
const CHATGPT_SESSION_TARGET_URL = "https://chatgpt.com/api/auth/session";
const MAYIPS_TARGET_URL = "https://mayips.com/";
const MAYIPS_REQUEST_TIMEOUT_MS = 12000;
const ADDRESSGEN_API_BASE_URL = "https://addressgen.top/api/v1/";
const ADDRESSGEN_REQUEST_TIMEOUT_MS = 12000;
const ADDRESSGEN_FALLBACK_TAB_TIMEOUT_MS = 15000;
const CHATGPT_AT_FLOAT_HOST_ID = "crx-at-float-host";
const ADDRESSGEN_ADDRESS_FLOAT_HOST_ID = "crx-addressgen-address-float-host";
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

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function decodeBase64UrlJson(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  const jsonText = decodeURIComponent(
    Array.from(binary, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
  );

  return JSON.parse(jsonText);
}

function decodeChatgptAccessTokenClaims(accessToken) {
  const parts = String(accessToken || "").split(".");
  if (parts.length < 2) {
    return {
      ok: false,
      error: "access token is not a JWT"
    };
  }

  try {
    const rawClaims = decodeBase64UrlJson(parts[1]);
    const profile = rawClaims?.["https://api.openai.com/profile"] || {};
    const auth = rawClaims?.["https://api.openai.com/auth"] || {};

    return {
      ok: true,
      email: typeof profile.email === "string" ? profile.email.trim() : "",
      phone: typeof profile.phone_number === "string" ? profile.phone_number.trim() : "",
      planType: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type.trim() : "",
      accountId: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id.trim() : "",
      accountUserId: typeof auth.chatgpt_account_user_id === "string" ? auth.chatgpt_account_user_id.trim() : "",
      userId: typeof auth.chatgpt_user_id === "string"
        ? auth.chatgpt_user_id.trim()
        : (typeof auth.user_id === "string" ? auth.user_id.trim() : ""),
      clientId: typeof rawClaims.client_id === "string" ? rawClaims.client_id.trim() : "",
      issuer: typeof rawClaims.iss === "string" ? rawClaims.iss.trim() : "",
      issuedAt: rawClaims.iat ?? null,
      expiresAt: rawClaims.exp ?? null,
      scopes: Array.isArray(rawClaims.scp) ? rawClaims.scp : [],
      rawClaims
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
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

function summarizeTextContent(text, maxLength = 400) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

async function postExternalContentReport(eventName, details = {}) {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const targetUrl = new URL("api/report", backendBaseUrl).toString();
  const manifest = chrome.runtime.getManifest();
  const payload = {
    event_name: eventName,
    time: new Date().toISOString(),
    extension_version: manifest.version || "",
    logger_build: manifest.version_name || manifest.version || "",
    backend_base_url: backendBaseUrl,
    details: {
      extension_id: chrome.runtime.id,
      extension_name: manifest.name || "",
      extension_version_name: manifest.version_name || manifest.version || "",
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

async function fetchMayipsContent() {
  const response = await fetchWithTimeout(MAYIPS_TARGET_URL, {
    method: "GET",
    cache: "no-store"
  }, MAYIPS_REQUEST_TIMEOUT_MS);

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${summarizeTextContent(responseText, 120) || "请求失败。"}`);
  }

  let mayipsJson = null;
  try {
    mayipsJson = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    mayipsJson = null;
  }

  if (mayipsJson && typeof mayipsJson === "object" && !Array.isArray(mayipsJson)) {
    const title = [
      "MayIP",
      mayipsJson.country || "",
      mayipsJson.state || "",
      mayipsJson.city || ""
    ].filter(Boolean).join(" / ");

    return {
      url: MAYIPS_TARGET_URL,
      finalUrl: response.url || MAYIPS_TARGET_URL,
      title,
      text: responseText,
      html: responseText,
      canonical: "",
      contentType: response.headers.get("content-type") || "",
      json: mayipsJson
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(responseText, "text/html");
  const title = doc.title || "";
  const text = doc.body?.innerText || responseText;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";

  return {
    url: MAYIPS_TARGET_URL,
    finalUrl: response.url || MAYIPS_TARGET_URL,
    title,
    text,
    html: responseText,
    canonical,
    contentType: response.headers.get("content-type") || "",
    json: null
  };
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

  if (details.contentType) {
    lines.push(`内容类型: ${details.contentType}`);
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

  if (details.country) {
    lines.push(`国家: ${details.country}`);
  }

  if (details.jsonCountry || details.jsonState || details.jsonCity) {
    lines.push(`MayIP JSON: ${[
      details.jsonCountry || "",
      details.jsonState || "",
      details.jsonCity || ""
    ].filter(Boolean).join(" / ")}`);
  }

  if (details.stage) {
    lines.push(`阶段: ${details.stage}`);
  }

  if (details.bytes !== undefined) {
    lines.push(`字节数: ${details.bytes}`);
  }

  if (details.error) {
    lines.push(`错误: ${details.error}`);
  }

  if (details.sourceError) {
    lines.push(`来源错误: ${details.sourceError}`);
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

  if (details.personEmail) {
    lines.push(`邮箱: ${details.personEmail}`);
  }

  if (details.personBirthday) {
    lines.push(`生日: ${details.personBirthday}`);
  }

  if (details.personGender) {
    lines.push(`性别: ${details.personGender}`);
  }

  if (details.generatedCity) {
    lines.push(`生成城市: ${details.generatedCity}`);
  }

  if (details.addressState) {
    lines.push(`州/省: ${details.addressState}`);
  }

  if (details.addressAreaCode) {
    lines.push(`区域代码: ${details.addressAreaCode}`);
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

  if (details.accessToken) {
    lines.push(`AccessToken: ${details.accessToken}`);
  }

  if (details.user) {
    lines.push(`用户: ${details.user}`);
  }

  if (details.expires) {
    lines.push(`过期时间: ${details.expires}`);
  }

  if (details.planType) {
    lines.push(`计划: ${details.planType}`);
  }

  if (details.accountId) {
    lines.push(`当前空间ID: ${details.accountId}`);
  }

  if (details.workspaceCount !== undefined) {
    lines.push(`空间数量: ${details.workspaceCount}`);
  }

  if (details.workspaceDetailCount !== undefined) {
    lines.push(`空间详情数量: ${details.workspaceDetailCount}`);
  }

  if (details.workspacePreview) {
    lines.push(`空间预览: ${details.workspacePreview}`);
  }

  if (details.workspaceIds) {
    lines.push(`空间ID: ${details.workspaceIds}`);
  }

  if (details.workspaceError) {
    lines.push(`空间错误: ${details.workspaceError}`);
  }

  if (details.hasDeactivatedWorkspaceHint !== undefined) {
    lines.push(`停用提示: ${details.hasDeactivatedWorkspaceHint ? "是" : "否"}`);
  }

  if (details.parseError) {
    lines.push(`解析错误: ${details.parseError}`);
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

async function postHtmlCapture(backendBaseUrl, captureType, page, tab, token, sourceReason = "") {
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
      sourceReason: sourceReason || (captureType === "text" ? "button2_text_capture" : "button2_html_capture")
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
    country: ipInfo.country || "JP"
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
    country: ipInfo.country || "",
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
      country: result.country || ipInfo.country || "",
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

async function getOrCreateBackgroundTab(targetUrl) {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find((tab) => tab.url && tab.url.startsWith(targetUrl));

  if (existingTab) {
    await chrome.tabs.reload(existingTab.id);
    return {
      tabId: existingTab.id,
      created: false
    };
  }

  const createdTab = await chrome.tabs.create({
    url: targetUrl,
    active: false
  });

  return {
    tabId: createdTab.id,
    created: true
  };
}

async function openChatgptSessionTab(updatePhase = () => {}) {
  updatePhase("准备页面...");
  const { tabId, created } = await getOrCreateBackgroundTab(CHATGPT_SESSION_TARGET_URL);

  await appendRuntimeLog(created ? "chatgpt_session_tab_opened" : "chatgpt_session_tab_reloaded", {
    targetUrl: CHATGPT_SESSION_TARGET_URL,
    tabId
  });

  updatePhase(created ? "打开页面..." : "刷新页面...");
  const tab = await waitForPageComplete(tabId, CHATGPT_SESSION_TIMEOUT_MS);
  await new Promise((resolve) => setTimeout(resolve, CHATGPT_SESSION_SETTLE_DELAY_MS));

  await appendRuntimeLog("chatgpt_session_ready", {
    targetUrl: CHATGPT_SESSION_TARGET_URL,
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: maskSensitiveUrl(tab.url || "")
  });

  return tab;
}

function parseChatgptSessionResponse(textCandidates) {
  const normalizedCandidates = Array.from(new Set(
    (Array.isArray(textCandidates) ? textCandidates : [])
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter(Boolean)
  ));
  let lastError = "";

  for (const candidate of normalizedCandidates) {
    try {
      const sessionData = JSON.parse(candidate);
      if (!sessionData || typeof sessionData !== "object") {
        continue;
      }

      const accessToken = typeof sessionData.accessToken === "string" ? sessionData.accessToken.trim() : "";
      return {
        rawText: candidate,
        sessionData,
        accessToken,
        userEmail: typeof sessionData?.user?.email === "string" ? sessionData.user.email.trim() : "",
        expires: typeof sessionData?.expires === "string" ? sessionData.expires : ""
      };
    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  if (lastError) {
    throw new Error(`JSON 解析失败: ${lastError}`);
  }

  throw new Error("页面中未找到可解析的 JSON 文本。");
}

async function readChatgptSessionPage(tab) {
  if (tab.id === undefined || tab.id === null) {
    throw new Error("目标标签页缺少 tabId，无法读取 session。");
  }

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: () => {
      const candidates = [
        document.querySelector("pre")?.textContent || "",
        document.body?.innerText || "",
        document.documentElement?.textContent || ""
      ]
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter(Boolean);

      return {
        title: document.title || "",
        url: window.location.href,
        contentType: document.contentType || "",
        textCandidates: Array.from(new Set(candidates))
      };
    }
  });
  const page = results?.[0]?.result;

  if (!page) {
    throw new Error("未能提取 ChatGPT session 页面内容。");
  }

  return page;
}

function generateChatgptDeviceId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch (error) {
    // Ignore and fall back to a simple UUID-like value.
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const digit = char === "x" ? value : ((value & 0x3) | 0x8);
    return digit.toString(16);
  });
}

function collectWorkspaceIdsFromAny(value, out = new Set(), seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return out;
  }

  if (seen.has(value)) {
    return out;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectWorkspaceIdsFromAny(item, out, seen);
    }
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "id" && typeof child === "string" && isUuidLike(child)) {
      out.add(child);
    }
    collectWorkspaceIdsFromAny(child, out, seen);
  }

  return out;
}

function getChatgptWorkspaceItems(data) {
  const candidates = [
    data?.data?.items,
    data?.items,
    data?.data?.accounts,
    data?.accounts
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizeChatgptWorkspaceItem(item, currentAccountId) {
  const id = pickFirstString(item?.id, item?.account_id, item?.account?.id);

  return {
    id,
    name: pickFirstString(item?.name, item?.display_name, item?.title, item?.account?.name),
    type: pickFirstString(item?.structure, item?.type, item?.account?.structure, item?.account?.type),
    role: pickFirstString(item?.current_user_role, item?.role, item?.account_user_role, item?.membership?.role),
    processor: pickFirstString(item?.processor, item?.billing?.processor, item?.subscription?.processor),
    createdTime: item?.created_time ?? item?.createdAt ?? item?.created_at ?? "",
    eligibleForAutoReactivation: item?.eligible_for_auto_reactivation === true,
    isCurrent: Boolean(currentAccountId && id && id === currentAccountId)
  };
}

function extractChatgptWorkspaceInfo(data, currentAccountId = "") {
  const workspaceIds = Array.from(collectWorkspaceIdsFromAny(data));
  const workspaceItems = getChatgptWorkspaceItems(data);
  const byId = new Map();

  for (const item of workspaceItems) {
    const workspace = normalizeChatgptWorkspaceItem(item, currentAccountId);
    if (!isUuidLike(workspace.id)) {
      continue;
    }

    byId.set(workspace.id, workspace);
  }

  for (const id of workspaceIds) {
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: "",
        type: "",
        role: "",
        processor: "",
        createdTime: "",
        eligibleForAutoReactivation: false,
        isCurrent: Boolean(currentAccountId && id === currentAccountId)
      });
    }
  }

  const workspaces = Array.from(byId.values()).map((workspace, index) => ({
    ...workspace,
    index: index + 1
  }));

  return {
    workspaceIds,
    workspaces,
    workspaceCount: workspaceIds.length,
    workspaceItemCount: workspaceItems.length,
    workspaceDetailCount: workspaces.length
  };
}

function summarizeWorkspaceList(workspaces, limit = 5) {
  return workspaces
    .slice(0, limit)
    .map((workspace) => [
      workspace.isCurrent ? "当前" : "",
      workspace.name || workspace.id,
      workspace.role || "",
      workspace.type || ""
    ].filter(Boolean).join(" / "))
    .join("; ");
}

async function fetchChatgptWorkspaceAccounts(accessToken, currentAccountId = "") {
  const targetUrl = new URL("backend-api/accounts", CHATGPT_BACKEND_API_BASE_URL).toString();
  const response = await fetchWithTimeout(targetUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "OAI-Device-Id": generateChatgptDeviceId()
    }
  }, CHATGPT_BACKEND_API_TIMEOUT_MS);
  const responseText = await response.text();
  let data = null;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error(`空间接口 JSON 解析失败: ${error.message || String(error)}`);
  }

  if (!response.ok) {
    const errorMessage = typeof data?.error === "string"
      ? data.error
      : (typeof data?.detail === "string" ? data.detail : "");
    throw new Error(errorMessage || `空间接口 HTTP ${response.status}`);
  }

  const workspaceInfo = extractChatgptWorkspaceInfo(data, currentAccountId);

  return {
    targetUrl,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    textLength: responseText.length,
    hasDeactivatedWorkspaceHint: responseText.includes("deactivated_workspace"),
    ...workspaceInfo
  };
}

async function saveChatgptAccessToken(backendBaseUrl, token, accessToken, userEmail) {
  const saveTargetUrl = new URL("api/at/save", backendBaseUrl).toString();

  try {
    const saveResult = await requestJsonRpc(saveTargetUrl, "at.save", {
      token,
      time: new Date().toISOString(),
      user: userEmail,
      accessToken
    }, DEFAULT_REQUEST_TIMEOUT_MS);

    const savedTo = saveResult.saved_to || "";

    await appendRuntimeLog("chatgpt_at_saved", {
      backendBaseUrl,
      token,
      targetUrl: saveTargetUrl,
      user: userEmail,
      savedTo,
      rpcId: saveResult.rpc_id || null
    });

    return {
      targetUrl: saveTargetUrl,
      savedTo,
      rpcId: saveResult.rpc_id || null,
      error: ""
    };
  } catch (error) {
    const saveError = error.message || String(error);

    await appendRuntimeLog("chatgpt_at_save_failed", {
      backendBaseUrl,
      token,
      targetUrl: saveTargetUrl,
      user: userEmail,
      error: saveError
    });

    return {
      targetUrl: saveTargetUrl,
      savedTo: "",
      rpcId: null,
      error: saveError
    };
  }
}

async function injectChatgptAccessTokenOverlay(tab, payload) {
  if (tab.id === undefined || tab.id === null) {
    throw new Error("目标标签页缺少 tabId，无法注入浮窗。");
  }

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: (overlayPayload) => {
      const mountTarget = document.documentElement || document.body;
      if (!mountTarget) {
        throw new Error("页面没有可用的挂载节点。");
      }

      const previousHost = document.getElementById(overlayPayload.hostId);
      if (previousHost) {
        previousHost.remove();
      }

      const host = document.createElement("div");
      host.id = overlayPayload.hostId;
      host.style.cssText = [
        "all: initial !important",
        "position: fixed !important",
        "top: 24px !important",
        "right: 24px !important",
        "width: 720px !important",
        "max-width: calc(100vw - 32px) !important",
        "z-index: 2147483647 !important",
        "pointer-events: auto !important"
      ].join(";");

      const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      const escapeHtml = (value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      const workspaces = Array.isArray(overlayPayload.workspaces) ? overlayPayload.workspaces : [];
      const workspaceIds = Array.isArray(overlayPayload.workspaceIds) ? overlayPayload.workspaceIds : [];
      const workspaceCount = Number.isFinite(overlayPayload.workspaceCount)
        ? overlayPayload.workspaceCount
        : workspaceIds.length;
      const workspaceListText = [
        ["index", "current", "name", "type", "role", "processor", "workspace_id"].join("\t"),
        ...workspaces.map((workspace) => [
          workspace.index || "",
          workspace.isCurrent ? "true" : "",
          workspace.name || "",
          workspace.type || "",
          workspace.role || "",
          workspace.processor || "",
          workspace.id || ""
        ].join("\t"))
      ].join("\n");
      const denseClass = workspaces.length > overlayPayload.workspaceDisplayLimit ? " is-dense" : "";
      const workspaceRows = workspaces.map((workspace) => `
        <tr class="${workspace.isCurrent ? "is-current" : ""}">
          <td class="index">${escapeHtml(workspace.index || "")}</td>
          <td class="name">
            <div class="workspace-name">${escapeHtml(workspace.name || "-")}</div>
            ${workspace.isCurrent ? '<div class="tag">当前</div>' : ""}
          </td>
          <td>${escapeHtml(workspace.type || "-")}</td>
          <td>${escapeHtml(workspace.role || "-")}</td>
          <td>${escapeHtml(workspace.processor || "-")}</td>
          <td class="id">${escapeHtml(workspace.id || "-")}</td>
          <td class="action">
            <button class="workspace-at" type="button" data-workspace-id="${escapeHtml(workspace.id || "")}">复制AT</button>
            <div class="workspace-at-status"></div>
          </td>
        </tr>
      `).join("");
      const workspaceSection = overlayPayload.workspaceError
        ? `<div class="workspace-status is-error">空间查询失败: ${escapeHtml(overlayPayload.workspaceError)}</div>`
        : `
          <div class="workspace-summary">
            <span>空间 ${escapeHtml(workspaceCount)}</span>
            <span>详情 ${escapeHtml(workspaces.length)}</span>
            ${overlayPayload.hasDeactivatedWorkspaceHint ? '<span class="warn">含停用提示</span>' : ""}
          </div>
          <div class="workspace-list${denseClass}">
            ${workspaceRows ? `
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>名称</th>
                    <th>类型</th>
                    <th>角色</th>
                    <th>处理器</th>
                    <th>Workspace ID</th>
                    <th>目标AT</th>
                  </tr>
                </thead>
                <tbody>${workspaceRows}</tbody>
              </table>
            ` : '<div class="empty">接口返回中未提取到 workspace。</div>'}
          </div>
        `;
      root.innerHTML = `
        <style>
          :host {
            all: initial;
          }
          .card {
            box-sizing: border-box;
            position: relative;
            font-family: Arial, "Microsoft YaHei", sans-serif;
            background: #ffffff;
            color: #0f172a;
            border: 2px solid #10a37f;
            border-radius: 14px;
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
            padding: 18px 16px 16px;
            max-height: calc(100vh - 48px);
            overflow: auto;
          }
          .title {
            margin: 0 28px 12px 0;
            font-size: 15px;
            font-weight: 700;
            color: #065f46;
          }
          .meta {
            margin: 0 0 8px;
            font-size: 12px;
            line-height: 1.5;
            color: #475569;
            word-break: break-all;
          }
          .token {
            margin: 0 0 12px;
            padding: 10px 12px;
            border-radius: 10px;
            background: #f8fafc;
            border: 1px solid #dbe4ee;
            color: #0f172a;
            font-family: Consolas, "Courier New", monospace;
            font-size: 12px;
            line-height: 1.5;
            word-break: break-all;
            max-height: 82px;
            overflow: auto;
          }
          .status {
            margin: 0 0 14px;
            font-size: 12px;
            line-height: 1.5;
            color: #166534;
            word-break: break-all;
          }
          .status.is-error {
            color: #b91c1c;
          }
          .workspace-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin: 14px 0 8px;
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
          }
          .workspace-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 0 0 8px;
            color: #475569;
            font-size: 12px;
          }
          .workspace-summary span {
            display: inline-flex;
            align-items: center;
            height: 22px;
            padding: 0 8px;
            border-radius: 999px;
            background: #eef6f3;
            color: #065f46;
          }
          .workspace-summary .warn {
            background: #fef3c7;
            color: #92400e;
          }
          .workspace-status {
            margin: 0 0 12px;
            padding: 9px 10px;
            border-radius: 9px;
            background: #f8fafc;
            color: #475569;
            font-size: 12px;
            line-height: 1.5;
            word-break: break-all;
          }
          .workspace-status.is-error {
            background: #fef2f2;
            color: #b91c1c;
          }
          .workspace-list {
            max-height: 280px;
            overflow: auto;
            border: 1px solid #dbe4ee;
            border-radius: 10px;
            background: #ffffff;
          }
          .workspace-list.is-dense {
            max-height: 340px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            line-height: 1.35;
          }
          th,
          td {
            box-sizing: border-box;
            padding: 7px 8px;
            border-bottom: 1px solid #e5edf4;
            vertical-align: top;
            text-align: left;
          }
          th {
            position: sticky;
            top: 0;
            z-index: 1;
            background: #f8fafc;
            color: #475569;
            font-weight: 700;
          }
          tr.is-current td {
            background: #ecfdf5;
          }
          .index {
            width: 34px;
            color: #64748b;
            white-space: nowrap;
          }
          .name {
            min-width: 118px;
          }
          .workspace-name {
            color: #0f172a;
            font-weight: 600;
            word-break: break-word;
          }
          .tag {
            display: inline-block;
            margin-top: 4px;
            padding: 1px 6px;
            border-radius: 999px;
            background: #10a37f;
            color: #ffffff;
            font-size: 10px;
            line-height: 1.5;
          }
          .id {
            min-width: 230px;
            font-family: Consolas, "Courier New", monospace;
            word-break: break-all;
            color: #334155;
          }
          .action {
            min-width: 108px;
          }
          .workspace-at {
            height: 28px;
            padding: 0 9px;
            border-radius: 8px;
            background: #2563eb;
            color: #ffffff;
            font-size: 12px;
            white-space: nowrap;
          }
          .workspace-at:disabled {
            opacity: 0.7;
            cursor: default;
          }
          .workspace-at-status {
            margin-top: 4px;
            color: #64748b;
            font-size: 10px;
            line-height: 1.35;
            word-break: break-word;
          }
          .workspace-at-status.is-error {
            color: #b91c1c;
          }
          .empty {
            padding: 12px;
            color: #64748b;
            font-size: 12px;
          }
          .progress-panel {
            margin-top: 12px;
            padding: 10px 12px;
            border: 1px solid #dbe4ee;
            border-radius: 10px;
            background: #f8fafc;
          }
          .progress-panel.is-hidden {
            display: none;
          }
          .progress-panel.is-error .progress-fill {
            background: #dc2626;
          }
          .progress-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 12px;
            line-height: 1.4;
          }
          .progress-title {
            color: #0f172a;
            font-weight: 700;
          }
          .progress-count {
            color: #475569;
            white-space: nowrap;
          }
          .progress-track {
            height: 8px;
            border-radius: 999px;
            overflow: hidden;
            background: #e2e8f0;
          }
          .progress-fill {
            height: 100%;
            width: 0%;
            border-radius: inherit;
            background: linear-gradient(90deg, #2563eb, #10a37f);
            transition: width 180ms ease;
          }
          .progress-detail {
            margin-top: 8px;
            color: #64748b;
            font-size: 11px;
            line-height: 1.45;
            word-break: break-word;
          }
          .actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 12px;
          }
          button {
            appearance: none;
            border: 0;
            border-radius: 9px;
            height: 36px;
            padding: 0 12px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          }
          .copy {
            background: #10a37f;
            color: #ffffff;
          }
          .copy-workspaces {
            background: #2563eb;
            color: #ffffff;
          }
          .export-workspaces-at {
            background: #7c3aed;
            color: #ffffff;
          }
          .export-team-csv {
            background: #0f766e;
            color: #ffffff;
          }
          .close {
            background: #e2e8f0;
            color: #334155;
          }
          .close-icon {
            position: absolute;
            top: 10px;
            right: 10px;
            width: 26px;
            height: 26px;
            padding: 0;
            border-radius: 999px;
            background: #eef2f7;
            color: #334155;
            font-size: 16px;
            line-height: 26px;
          }
        </style>
        <div class="card">
          <button class="close-icon" type="button" title="关闭">×</button>
          <div class="title">AccessToken 已提取</div>
          <div class="meta">账号: ${escapeHtml(overlayPayload.userEmail || "-")}</div>
          <div class="token">${escapeHtml(overlayPayload.accessToken)}</div>
          <div class="status ${overlayPayload.saveError ? "is-error" : ""}">
            ${overlayPayload.savedTo
              ? `已保存: ${escapeHtml(overlayPayload.savedTo)}`
              : `保存失败: ${escapeHtml(overlayPayload.saveError || "请查看 popup 运行日志")}`}
          </div>
          <div class="workspace-title">
            <span>Workspace 列表</span>
          </div>
          ${workspaceSection}
          <div class="progress-panel is-hidden">
            <div class="progress-head">
              <div class="progress-title">批量导出进度</div>
              <div class="progress-count">0/0</div>
            </div>
            <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="progress-fill"></div>
            </div>
            <div class="progress-detail"></div>
          </div>
          <div class="actions">
            <button class="copy copy-at" type="button">复制 AT</button>
            <button class="copy-workspaces" type="button">复制空间列表</button>
            <button class="export-workspaces-at" type="button">导出空间AT</button>
            <button class="export-team-csv" type="button">导出 team.csv</button>
            <button class="close" type="button">关闭</button>
          </div>
        </div>
      `;

      const copyButton = root.querySelector(".copy-at");
      const copyWorkspacesButton = root.querySelector(".copy-workspaces");
      const exportWorkspacesAtButton = root.querySelector(".export-workspaces-at");
      const exportTeamCsvButton = root.querySelector(".export-team-csv");
      const workspaceAtButtons = root.querySelectorAll(".workspace-at");
      const closeButtons = root.querySelectorAll(".close, .close-icon");
      const progressPanel = root.querySelector(".progress-panel");
      const progressTitle = root.querySelector(".progress-title");
      const progressCount = root.querySelector(".progress-count");
      const progressTrack = root.querySelector(".progress-track");
      const progressFill = root.querySelector(".progress-fill");
      const progressDetail = root.querySelector(".progress-detail");
      const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
      const workspaceTokenCache = new Map();
      const originalWorkspaceId = String(overlayPayload.currentAccountId || "").toLowerCase();
      const knownWorkspaceIds = Array.from(new Set(
        [
          ...(Array.isArray(workspaceIds) ? workspaceIds : []),
          ...workspaces.map((workspace) => workspace?.id || "")
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      ));

      const copyText = async (value) => {
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch (error) {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.setAttribute("readonly", "readonly");
          textarea.style.cssText = "position: fixed; top: -9999px; left: -9999px;";
          document.documentElement.appendChild(textarea);
          textarea.select();
          textarea.setSelectionRange(0, textarea.value.length);
          const copied = document.execCommand("copy");
          textarea.remove();
          if (!copied) {
            throw error;
          }
          return true;
        }
      };

      const setBatchActionButtonsDisabled = (disabled) => {
        exportWorkspacesAtButton.disabled = disabled;
        exportTeamCsvButton.disabled = disabled;
        workspaceAtButtons.forEach((button) => {
          button.disabled = disabled;
        });
      };

      const setProgressState = ({
        visible = true,
        title = "批量导出进度",
        completed = 0,
        total = 0,
        detail = "",
        isError = false
      } = {}) => {
        if (!progressPanel || !progressTitle || !progressCount || !progressTrack || !progressFill || !progressDetail) {
          return;
        }

        progressPanel.classList.toggle("is-hidden", !visible);
        progressPanel.classList.toggle("is-error", Boolean(isError));
        progressTitle.textContent = title;
        progressCount.textContent = `${completed}/${total}`;
        const safeTotal = total > 0 ? total : 1;
        const percent = Math.max(0, Math.min(100, Math.round((completed / safeTotal) * 100)));
        progressFill.style.width = `${percent}%`;
        progressTrack.setAttribute("aria-valuenow", String(percent));
        progressDetail.textContent = detail || "";
      };

      copyButton?.addEventListener("click", async () => {
        const originalText = copyButton.textContent;
        copyButton.disabled = true;
        copyButton.textContent = "复制中...";

        try {
          await copyText(overlayPayload.accessToken);
          copyButton.textContent = "已复制";
        } catch (error) {
          copyButton.textContent = "复制失败";
          console.error("[AT浮窗] 复制失败:", error);
        } finally {
          window.setTimeout(() => {
            copyButton.disabled = false;
            copyButton.textContent = originalText;
          }, 1200);
        }
      });

      copyWorkspacesButton?.addEventListener("click", async () => {
        const originalText = copyWorkspacesButton.textContent;
        copyWorkspacesButton.disabled = true;
        copyWorkspacesButton.textContent = "复制中...";

        try {
          await copyText(workspaceListText);
          copyWorkspacesButton.textContent = "已复制";
        } catch (error) {
          copyWorkspacesButton.textContent = "复制失败";
          console.error("[AT浮窗] 复制空间列表失败:", error);
        } finally {
          window.setTimeout(() => {
            copyWorkspacesButton.disabled = false;
            copyWorkspacesButton.textContent = originalText;
          }, 1200);
        }
      });

      const decodeJwtClaims = (accessToken) => {
        const parts = String(accessToken || "").split(".");
        if (parts.length < 2) {
          throw new Error("access token is not a JWT");
        }

        const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
        const jsonText = decodeURIComponent(
          Array.from(atob(padded), (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
        );
        return JSON.parse(jsonText);
      };

      const generateDeviceId = () => {
        try {
          if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID();
          }
        } catch (error) {
          // Ignore and fall back to a UUID-like string.
        }

        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
          const value = Math.floor(Math.random() * 16);
          const digit = char === "x" ? value : ((value & 0x3) | 0x8);
          return digit.toString(16);
        });
      };

      const stringifyApiData = (value) => {
        if (value === undefined || value === null) {
          return "";
        }

        if (typeof value === "string") {
          return value;
        }

        try {
          return JSON.stringify(value);
        } catch (error) {
          return String(value);
        }
      };

      const fetchWorkspaceMeSnapshot = async (accessToken) => {
        const response = await fetch("/backend-api/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            "accept": "application/json",
            "authorization": `Bearer ${accessToken}`,
            "oai-device-id": generateDeviceId()
          }
        });
        const responseText = await response.text();
        let data = responseText;

        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch (error) {
          data = responseText;
        }

        return {
          statusCode: response.status,
          dataText: stringifyApiData(data),
          isDeactivatedWorkspace: stringifyApiData(data).includes("deactivated_workspace")
        };
      };

      const buildWorkspaceAtRecord = (workspace, sessionData) => {
        const accessToken = typeof sessionData?.accessToken === "string" ? sessionData.accessToken.trim() : "";
        if (!accessToken) {
          throw new Error("目标 Session 未返回 accessToken。");
        }

        const claims = decodeJwtClaims(accessToken);
        const profile = claims?.["https://api.openai.com/profile"] || {};
        const auth = claims?.["https://api.openai.com/auth"] || {};
        const accountId = typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id.trim() : "";
        const expectedId = String(workspace.id || "").toLowerCase();
        const email = typeof profile.email === "string" ? profile.email.trim() : (sessionData?.user?.email || "");
        const phone = typeof profile.phone_number === "string" ? profile.phone_number.trim() : "";
        const userId = typeof auth.chatgpt_user_id === "string"
          ? auth.chatgpt_user_id.trim()
          : (typeof auth.user_id === "string" ? auth.user_id.trim() : "");
        const accountUserId = typeof auth.chatgpt_account_user_id === "string"
          ? auth.chatgpt_account_user_id.trim()
          : "";
        const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";
        const domain = email.includes("@") ? email.split("@").pop().toLowerCase() : "";
        const iat = claims.iat ?? "";
        const exp = claims.exp ?? "";
        const jti = typeof claims.jti === "string" ? claims.jti.trim() : "";
        const isSignup = auth?.is_signup ?? claims?.is_signup ?? "";

        if (!accountId || accountId.toLowerCase() !== expectedId) {
          throw new Error(`目标工作区校验失败: ${accountId || "-"}`);
        }

        return {
          workspace_id: workspace.id,
          workspace_name: workspace.name || "",
          workspace_type: workspace.type || "",
          workspace_role: workspace.role || "",
          workspace_processor: workspace.processor || "",
          email,
          phone,
          domain,
          plan_type: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type.trim() : "",
          account_id: accountId,
          account_user_id: accountUserId,
          chatgpt_user_id: userId,
          user_id: userId,
          sub,
          iat,
          exp,
          jti,
          is_signup: isSignup,
          expires: typeof sessionData?.expires === "string" ? sessionData.expires : "",
          access_token: accessToken,
          exported_at: new Date().toISOString()
        };
      };

      const exchangeWorkspaceSession = async (workspace, options = {}) => {
        if (!workspace?.id) {
          throw new Error("缺少 workspace ID。");
        }

        if (!options.forceFetch && workspaceTokenCache.has(workspace.id)) {
          return workspaceTokenCache.get(workspace.id);
        }

        const targetPath = `/api/auth/session?exchange_workspace_token=true&workspace_id=${encodeURIComponent(workspace.id)}&reason=setCurrentAccount`;
        const response = await fetch(targetPath, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            "accept": "*/*"
          }
        });
        const responseText = await response.text();
        let sessionData = null;

        try {
          sessionData = responseText ? JSON.parse(responseText) : {};
        } catch (error) {
          throw new Error(`Session JSON 解析失败: ${error.message || String(error)}`);
        }

        if (!response.ok) {
          const errorMessage = typeof sessionData?.error === "string"
            ? sessionData.error
            : (typeof sessionData?.message === "string" ? sessionData.message : "");
          throw new Error(errorMessage || `Session HTTP ${response.status}`);
        }

        const record = buildWorkspaceAtRecord(workspace, sessionData);
        let meStatusCode = "";
        let meDataText = "";
        let meDeactivatedWorkspace = false;

        try {
          const meSnapshot = await fetchWorkspaceMeSnapshot(record.access_token);
          meStatusCode = meSnapshot.statusCode;
          meDataText = meSnapshot.dataText;
          meDeactivatedWorkspace = meSnapshot.isDeactivatedWorkspace;
        } catch (error) {
          meDataText = `ME_FETCH_ERROR: ${error.message || String(error)}`;
        }

        const enrichedRecord = {
          ...record,
          me_status_code: meStatusCode,
          me_data: meDataText,
          me_is_deactivated_workspace: meDeactivatedWorkspace
        };
        workspaceTokenCache.set(workspace.id, enrichedRecord);
        return enrichedRecord;
      };

      const restoreOriginalWorkspaceSession = async (lastWorkspaceId = "") => {
        if (!originalWorkspaceId || String(lastWorkspaceId || "").toLowerCase() === originalWorkspaceId) {
          return {
            ok: true,
            skipped: true
          };
        }

        const originalWorkspace = workspaceById.get(originalWorkspaceId) || {
          id: originalWorkspaceId,
          name: "original"
        };

        try {
          await exchangeWorkspaceSession(originalWorkspace, {
            forceFetch: true
          });
          return {
            ok: true,
            skipped: false
          };
        } catch (error) {
          console.warn("[AT浮窗] 恢复原 workspace 失败:", error);
          return {
            ok: false,
            skipped: false,
            error: error.message || String(error)
          };
        }
      };

      const setWorkspaceAtStatus = (button, text, isError = false) => {
        const status = button?.closest(".action")?.querySelector(".workspace-at-status");
        if (!status) {
          return;
        }
        status.textContent = text || "";
        status.classList.toggle("is-error", Boolean(isError));
      };

      const copyWorkspaceAt = async (button) => {
        const workspace = workspaceById.get(button?.dataset?.workspaceId || "");
        if (!workspace) {
          throw new Error("未找到 workspace。");
        }

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "获取中...";
        setWorkspaceAtStatus(button, "交换 Session...");

        try {
          const record = await exchangeWorkspaceSession(workspace);
          await copyText(record.access_token);
          button.textContent = "已复制";
          setWorkspaceAtStatus(button, "已复制，恢复中...");
          const restoreResult = await restoreOriginalWorkspaceSession(workspace.id);
          setWorkspaceAtStatus(
            button,
            restoreResult.ok ? "已校验并复制" : `已复制；恢复失败: ${restoreResult.error}`,
            !restoreResult.ok
          );
        } catch (error) {
          button.textContent = "失败";
          setWorkspaceAtStatus(button, error.message || String(error), true);
        } finally {
          window.setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
          }, 1400);
        }
      };

      const downloadTextFile = (filename, content, contentType) => {
        const blob = new Blob([content], {
          type: contentType
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.documentElement.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      };

      const downloadJson = (filename, payload) => {
        downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json");
      };

      const escapeCsvCell = (value) => {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, "\"\"")}"`;
      };

      const buildTeamCsvText = (records) => {
        const headers = [
          "access_token",
          "email",
          "phone",
          "plan_type",
          "account_id",
          "workspace_id",
          "domain",
          "user_id",
          "sub",
          "iat",
          "exp",
          "jti",
          "is_signup",
          "me_status_code",
          "me_data"
        ];
        const workspaceIdValue = knownWorkspaceIds.join(";");
        const rows = [
          headers,
          ...records
            .filter((record) => record.ok)
            .map((record) => [
              record.access_token || "",
              record.email || "",
              record.phone || "",
              record.plan_type || "",
              record.account_id || "",
              workspaceIdValue,
              record.domain || "",
              record.user_id || record.chatgpt_user_id || "",
              record.sub || "",
              record.iat || "",
              record.exp || "",
              record.jti || "",
              record.is_signup ?? "",
              record.me_status_code ?? "",
              record.me_data || ""
            ])
        ];

        return rows
          .map((row) => row.map((value) => escapeCsvCell(value)).join(","))
          .join("\n");
      };

      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

      const collectAllWorkspaceAtRecords = async (onProgress = () => {}) => {
        const records = [];
        const total = workspaces.length;

        onProgress({
          completed: 0,
          total,
          detail: total > 0 ? "准备开始批量导出..." : "没有可导出的 workspace。"
        });

        if (total === 0) {
          return {
            records,
            successCount: 0,
            restoreResult: {
              ok: true,
              skipped: true
            }
          };
        }

        let successCount = 0;
        let completed = 0;

        for (const workspace of workspaces) {
          const workspaceLabel = workspace.name || workspace.id || "workspace";
          onProgress({
            completed,
            total,
            detail: `正在处理：${workspaceLabel}`
          });

          try {
            const record = await exchangeWorkspaceSession(workspace);
            records.push({
              ok: true,
              ...record
            });
            successCount += 1;
          } catch (error) {
            records.push({
              ok: false,
              workspace_id: workspace.id || "",
              workspace_name: workspace.name || "",
              error: error.message || String(error)
            });
          }

          completed += 1;
          onProgress({
            completed,
            total,
            detail: `已完成 ${completed}/${total}，成功 ${successCount}，失败 ${completed - successCount}`
          });

          if (workspaces.length > 1 && completed < total) {
            await sleep(1000);
          }
        }

        const lastOkRecord = [...records].reverse().find((record) => record.ok);
        onProgress({
          completed: total,
          total,
          detail: "正在恢复原 workspace..."
        });
        const restoreResult = await restoreOriginalWorkspaceSession(lastOkRecord?.workspace_id || "");

        onProgress({
          completed: total,
          total,
          detail: restoreResult.ok
            ? `导出完成，成功 ${successCount}/${total}`
            : `导出完成，成功 ${successCount}/${total}；恢复失败：${restoreResult.error || "未知错误"}`,
          isError: !restoreResult.ok
        });

        return {
          records,
          successCount,
          restoreResult
        };
      };

      const exportAllWorkspaceAt = async () => {
        const originalText = exportWorkspacesAtButton.textContent;
        setBatchActionButtonsDisabled(true);
        exportWorkspacesAtButton.textContent = "导出中...";

        try {
          const { records, successCount, restoreResult } = await collectAllWorkspaceAtRecords((progress) => {
            setProgressState({
              visible: true,
              title: "导出空间AT",
              completed: progress.completed,
              total: progress.total,
              detail: progress.detail,
              isError: Boolean(progress.isError)
            });
          });
          const payload = {
            exported_at: new Date().toISOString(),
            source_email: overlayPayload.userEmail || "",
            restored_original_workspace: restoreResult.ok,
            restore_error: restoreResult.ok ? "" : (restoreResult.error || ""),
            total: records.length,
            success_count: successCount,
            failed_count: records.length - successCount,
            accounts: records
          };
          const filename = `chatgpt_workspace_at_${successCount}_${Date.now()}.json`;
          downloadJson(filename, payload);
          exportWorkspacesAtButton.textContent = `已导出 ${successCount}`;
        } catch (error) {
          exportWorkspacesAtButton.textContent = "导出失败";
          setProgressState({
            visible: true,
            title: "导出空间AT",
            completed: 0,
            total: workspaces.length,
            detail: error.message || String(error),
            isError: true
          });
          console.error("[AT浮窗] 导出空间AT失败:", error);
        } finally {
          window.setTimeout(() => {
            setBatchActionButtonsDisabled(false);
            exportWorkspacesAtButton.textContent = originalText;
          }, 1600);
        }
      };

      const exportWorkspaceTeamCsv = async () => {
        const originalText = exportTeamCsvButton.textContent;
        setBatchActionButtonsDisabled(true);
        exportTeamCsvButton.textContent = "导出中...";

        try {
          const { records, successCount } = await collectAllWorkspaceAtRecords((progress) => {
            setProgressState({
              visible: true,
              title: "导出 team.csv",
              completed: progress.completed,
              total: progress.total,
              detail: progress.detail,
              isError: Boolean(progress.isError)
            });
          });
          const csvText = buildTeamCsvText(records);
          const filename = `team_workspace_at_${successCount}_${Date.now()}.csv`;
          downloadTextFile(filename, csvText, "text/csv;charset=utf-8");
          exportTeamCsvButton.textContent = `已导出 ${successCount}`;
        } catch (error) {
          exportTeamCsvButton.textContent = "导出失败";
          setProgressState({
            visible: true,
            title: "导出 team.csv",
            completed: 0,
            total: workspaces.length,
            detail: error.message || String(error),
            isError: true
          });
          console.error("[AT浮窗] 导出 team.csv 失败:", error);
        } finally {
          window.setTimeout(() => {
            setBatchActionButtonsDisabled(false);
            exportTeamCsvButton.textContent = originalText;
          }, 1600);
        }
      };

      workspaceAtButtons.forEach((button) => {
        button.addEventListener("click", () => {
          void copyWorkspaceAt(button);
        });
      });

      exportWorkspacesAtButton?.addEventListener("click", () => {
        void exportAllWorkspaceAt();
      });

      exportTeamCsvButton?.addEventListener("click", () => {
        void exportWorkspaceTeamCsv();
      });

      closeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          host.remove();
        });
      });

      mountTarget.appendChild(host);
      const rect = host.getBoundingClientRect();

      return {
        ok: true,
        mountedTo: mountTarget.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hasShadowRoot: Boolean(host.shadowRoot)
      };
    },
    args: [{
      hostId: CHATGPT_AT_FLOAT_HOST_ID,
      accessToken: payload.accessToken,
      userEmail: payload.userEmail,
      currentAccountId: payload.currentAccountId,
      savedTo: payload.savedTo,
      saveError: payload.saveError,
      workspaces: payload.workspaces,
      workspaceIds: payload.workspaceIds,
      workspaceCount: payload.workspaceCount,
      workspaceError: payload.workspaceError,
      workspaceDisplayLimit: CHATGPT_WORKSPACE_LIST_DISPLAY_LIMIT,
      hasDeactivatedWorkspaceHint: payload.hasDeactivatedWorkspaceHint
    }]
  });

  const overlayResult = results?.[0]?.result;
  if (!overlayResult?.ok) {
    throw new Error("浮窗脚本未返回成功结果。");
  }

  await appendRuntimeLog("chatgpt_at_overlay_injected", {
    tabId: tab.id,
    windowId: tab.windowId,
    mountedTo: overlayResult.mountedTo || "",
    width: overlayResult.width || 0,
    height: overlayResult.height || 0,
    hasShadowRoot: overlayResult.hasShadowRoot === true,
    workspaceCount: Array.isArray(payload.workspaceIds) ? payload.workspaceIds.length : 0,
    workspaceDetailCount: Array.isArray(payload.workspaces) ? payload.workspaces.length : 0,
    workspaceError: payload.workspaceError || ""
  });

  return overlayResult;
}

async function captureChatgptAccessToken(updatePhase = () => {}) {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const token = popupState.backendToken || "";

  if (!token) {
    throw new Error("请先点击\"刷新后端token\"。");
  }

  await appendRuntimeLog("chatgpt_at_capture_started", {
    backendBaseUrl,
    token,
    targetUrl: CHATGPT_SESSION_TARGET_URL
  });

  try {
    const tab = await openChatgptSessionTab(updatePhase);

    updatePhase("提取 AT...");
    const page = await readChatgptSessionPage(tab);

    let rawText = page.textCandidates[0] || "";
    let sessionData = null;
    let accessToken = "";
    let userEmail = "";
    let expires = "";
    let parseError = "";
    let tokenClaims = {
      ok: false,
      error: ""
    };

    try {
      const parsed = parseChatgptSessionResponse(page.textCandidates);
      rawText = parsed.rawText;
      sessionData = parsed.sessionData;
      accessToken = parsed.accessToken;
      userEmail = parsed.userEmail;
      expires = parsed.expires;
    } catch (error) {
      parseError = error.message || String(error);
    }

    if (accessToken) {
      tokenClaims = decodeChatgptAccessTokenClaims(accessToken);
      if (tokenClaims.ok && !userEmail && tokenClaims.email) {
        userEmail = tokenClaims.email;
      }
    }

    await appendRuntimeLog("chatgpt_at_captured", {
      backendBaseUrl,
      token,
      url: maskSensitiveUrl(page.url || tab.url || CHATGPT_SESSION_TARGET_URL),
      tabId: tab.id,
      windowId: tab.windowId,
      title: page.title || tab.title || "",
      contentType: page.contentType || "",
      textCandidateCount: Array.isArray(page.textCandidates) ? page.textCandidates.length : 0,
      accessToken: accessToken ? `${accessToken.slice(0, 20)}...` : "",
      user: userEmail,
      expires,
      accountId: tokenClaims.ok ? tokenClaims.accountId : "",
      planType: tokenClaims.ok ? tokenClaims.planType : "",
      textBytes: rawText.length,
      parseError: parseError || (!tokenClaims.ok && accessToken ? tokenClaims.error : "")
    });

    if (!accessToken) {
      throw new Error(parseError || "未找到 accessToken。");
    }

    updatePhase("保存 AT...");
    const saveResult = await saveChatgptAccessToken(backendBaseUrl, token, accessToken, userEmail);

    const workspaceTargetUrl = new URL("backend-api/accounts", CHATGPT_BACKEND_API_BASE_URL).toString();
    let workspaceResult = {
      targetUrl: workspaceTargetUrl,
      workspaces: [],
      workspaceIds: [],
      workspaceCount: 0,
      workspaceDetailCount: 0,
      hasDeactivatedWorkspaceHint: false,
      error: ""
    };

    updatePhase("查询空间...");
    await appendRuntimeLog("chatgpt_workspace_fetch_started", {
      targetUrl: workspaceTargetUrl,
      user: userEmail,
      accountId: tokenClaims.ok ? tokenClaims.accountId : ""
    });

    try {
      workspaceResult = await fetchChatgptWorkspaceAccounts(
        accessToken,
        tokenClaims.ok ? tokenClaims.accountId : ""
      );

      await appendRuntimeLog("chatgpt_workspace_fetch_succeeded", {
        targetUrl: workspaceResult.targetUrl,
        user: userEmail,
        accountId: tokenClaims.ok ? tokenClaims.accountId : "",
        status: workspaceResult.status,
        contentType: workspaceResult.contentType,
        textBytes: workspaceResult.textLength,
        workspaceCount: workspaceResult.workspaceCount,
        workspaceDetailCount: workspaceResult.workspaceDetailCount,
        workspacePreview: summarizeWorkspaceList(workspaceResult.workspaces),
        workspaceIds: workspaceResult.workspaceIds.slice(0, 10).join(", "),
        hasDeactivatedWorkspaceHint: workspaceResult.hasDeactivatedWorkspaceHint
      });
    } catch (error) {
      workspaceResult.error = error.message || String(error);

      await appendRuntimeLog("chatgpt_workspace_fetch_failed", {
        targetUrl: workspaceTargetUrl,
        user: userEmail,
        accountId: tokenClaims.ok ? tokenClaims.accountId : "",
        error: workspaceResult.error
      });
    }

    updatePhase("注入浮窗...");
    const overlayResult = await injectChatgptAccessTokenOverlay(tab, {
      accessToken,
      userEmail,
      currentAccountId: tokenClaims.ok ? tokenClaims.accountId : "",
      savedTo: saveResult.savedTo,
      saveError: saveResult.error,
      workspaces: workspaceResult.workspaces,
      workspaceIds: workspaceResult.workspaceIds,
      workspaceCount: workspaceResult.workspaceCount,
      workspaceError: workspaceResult.error,
      hasDeactivatedWorkspaceHint: workspaceResult.hasDeactivatedWorkspaceHint
    });

    updatePhase("显示页面...");
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    return {
      tab,
      sessionData,
      accessToken,
      userEmail,
      expires,
      tokenClaims,
      savedTo: saveResult.savedTo,
      saveError: saveResult.error,
      workspaceResult,
      overlayResult
    };
  } catch (error) {
    await appendRuntimeLog("chatgpt_at_capture_failed", {
      backendBaseUrl,
      token,
      targetUrl: CHATGPT_SESSION_TARGET_URL,
      error: error.message || String(error)
    });
    throw error;
  }
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

async function captureMayipsContent() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const token = popupState.backendToken || "";

  if (!token) {
    throw new Error("请先点击\"刷新后端token\"。");
  }

  await appendRuntimeLog("mayips_capture_started", {
    backendBaseUrl,
    token,
    targetUrl: MAYIPS_TARGET_URL
  });

  try {
    const page = await fetchMayipsContent();
    const tab = {
      id: null,
      windowId: null,
      title: page.title || "",
      url: page.finalUrl || page.url || MAYIPS_TARGET_URL
    };
    const textBytes = new Blob([page.text || ""]).size;
    const htmlBytes = new Blob([page.html || ""]).size;

    await appendRuntimeLog("mayips_capture_fetched", {
      backendBaseUrl,
      token,
      targetUrl: page.url,
      finalUrl: page.finalUrl,
      title: page.title,
      canonical: page.canonical,
      contentType: page.contentType,
      jsonCountry: page.json?.country || "",
      jsonState: page.json?.state || "",
      jsonCity: page.json?.city || "",
      textBytes,
      htmlBytes,
      textPreview: summarizeTextContent(page.text, 240)
    });

    const textResult = await postHtmlCapture(
      backendBaseUrl,
      "text",
      page,
      tab,
      token,
      "button7_mayips_text_capture"
    );

    if (textResult.city) {
      await saveLastIpInfo({
        backendBaseUrl,
        token,
        country: textResult.country || "",
        city: textResult.city || "",
        regionName: textResult.region_name || "",
        bytes: textResult.bytes || 0,
        rpcId: textResult.rpc_id || null,
        source: "mayips",
        capturedAt: new Date().toISOString()
      });
    }

    await appendRuntimeLog("mayips_capture_sent", {
      backendBaseUrl,
      token,
      targetUrl: page.url,
      finalUrl: page.finalUrl,
      savedTo: textResult.saved_to || "",
      rpcId: textResult.rpc_id || null,
      country: textResult.country || null,
      city: textResult.city || null,
      regionName: textResult.region_name || null,
      textBytes,
      htmlBytes
    });

    if (textResult.city) {
      await appendRuntimeLog("address_extract_prompt", {
        backendBaseUrl,
        token,
        country: textResult.country || "",
        city: textResult.city || "",
        regionName: textResult.region_name || "",
        message: "MayIP 已成功返回 country 和 city。请按按钮4（提取地址）生成地址、测试卡和新姓名。"
      });
    }

    return {
      page,
      textResult
    };
  } catch (error) {
    await appendRuntimeLog("mayips_capture_failed", {
      backendBaseUrl,
      token,
      targetUrl: MAYIPS_TARGET_URL,
      error: error.message || String(error)
    });
    throw error;
  }
}

function normalizeAddressgenAreaKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function indexAddressgenAreas(areas) {
  const index = new Map();

  for (const area of areas) {
    for (const fieldName of ["area_code", "slug", "full_name"]) {
      const key = normalizeAddressgenAreaKey(area?.[fieldName]);

      if (!key || index.has(key)) {
        continue;
      }

      index.set(key, {
        area,
        fieldName
      });
    }
  }

  return index;
}

async function fetchAddressgenAreas(countryCode) {
  const targetUrl = new URL("areas", ADDRESSGEN_API_BASE_URL);
  targetUrl.searchParams.set("country_code", countryCode);
  targetUrl.searchParams.set("lang", "en");

  const data = await requestJson(targetUrl.toString(), {
    method: "GET",
    cache: "no-store"
  }, ADDRESSGEN_REQUEST_TIMEOUT_MS);

  if (data.code !== "200" || !Array.isArray(data.data)) {
    throw new Error(data.message || `AddressGen 未返回 ${countryCode} 的城市列表。`);
  }

  return {
    targetUrl: targetUrl.toString(),
    areas: data.data
  };
}

function matchAddressgenArea(ipInfo, areas) {
  const areaIndex = indexAddressgenAreas(areas);
  const city = String(ipInfo.city || "").trim();
  const regionName = String(ipInfo.regionName || ipInfo.region_name || "").trim();
  const cityKey = normalizeAddressgenAreaKey(city);
  const regionKey = normalizeAddressgenAreaKey(regionName);
  const cityMatch = cityKey ? areaIndex.get(cityKey) || null : null;
  const regionMatch = regionKey ? areaIndex.get(regionKey) || null : null;
  const selectedMatch = cityMatch || regionMatch || null;

  return {
    city,
    regionName,
    cityKey,
    regionKey,
    cityInList: Boolean(cityMatch),
    regionInList: Boolean(regionMatch),
    matchBy: cityMatch ? "city" : regionMatch ? "region_name" : "",
    area: selectedMatch?.area || null,
    fieldName: selectedMatch?.fieldName || ""
  };
}

function buildAddressgenCityCheckMessage(matchResult) {
  const cityName = matchResult.city || "未知城市";
  const firstLine = `"${cityName}"是否在列表中：${matchResult.cityInList ? "是" : "否"}`;

  if (matchResult.cityInList) {
    return `${firstLine}\n可以生成对应城市地址`;
  }

  if (matchResult.regionInList) {
    const areaCode = matchResult.area?.area_code || "";
    const areaName = matchResult.area?.full_name || matchResult.regionName || "";
    const suffix = [areaName, areaCode].filter(Boolean).join(" / ");

    return `${firstLine}\n可以生成对应城市地址\n匹配方式：区域 ${suffix}`;
  }

  return `${firstLine}\n不支持城市，只支持随机地址`;
}

function formatAddressgenAddressSummary(address) {
  if (!address || typeof address !== "object") {
    return "";
  }

  return address.full_address_local
    || address.full_address_intl
    || [
      address.street || "",
      address.city || "",
      address.state || "",
      address.zipcode || "",
      address.country || ""
    ].filter(Boolean).join(", ");
}

function formatAddressgenPersonName(addressData) {
  return [
    addressData?.firstname || "",
    addressData?.lastname || ""
  ].filter(Boolean).join(" ");
}

async function requestAddressgenAddress(countryCode, matchResult) {
  const targetUrl = new URL("address", ADDRESSGEN_API_BASE_URL);
  const areaCode = matchResult?.area?.area_code || "";

  targetUrl.searchParams.set("country_code", countryCode);
  if (areaCode) {
    targetUrl.searchParams.set("area_code", areaCode);
  }

  const data = await requestJson(targetUrl.toString(), {
    method: "GET",
    cache: "no-store"
  }, ADDRESSGEN_REQUEST_TIMEOUT_MS);

  if (data.code !== "200" || !data.data) {
    throw new Error(data.message || `AddressGen 未返回 ${countryCode} 的地址。`);
  }

  return {
    targetUrl: targetUrl.toString(),
    areaCode,
    mode: areaCode ? "area" : "random",
    data: data.data
  };
}

function buildAddressgenAddressOverlayPayload({ country, city, regionName, matchResult, message, addressResult }) {
  const addressData = addressResult.data || {};
  const address = addressData.address || {};
  const personName = formatAddressgenPersonName(addressData);
  const fullAddress = formatAddressgenAddressSummary(address);
  const matchedArea = matchResult.area || {};
  const matchLabel = matchResult.matchBy
    ? `${matchResult.matchBy} -> ${[matchedArea.full_name, matchedArea.area_code].filter(Boolean).join(" / ")}`
    : "未匹配，使用随机地址";
  const rows = [
    ["IP城市", city || "-"],
    ["IP区域", regionName || "-"],
    ["匹配", matchLabel],
    ["姓名", personName || "-"],
    ["邮箱", addressData.email || "-"],
    ["电话", addressData.phone || "-"],
    ["生日", addressData.birthday || "-"],
    ["性别", addressData.gender || "-"],
    ["国家", [address.country || "", address.country_code || country || ""].filter(Boolean).join(" / ") || "-"],
    ["州/省", address.state || "-"],
    ["城市", address.city || "-"],
    ["邮编", address.zipcode || "-"],
    ["区域代码", address.area_code || addressResult.areaCode || "-"],
    ["街道", address.street_name || address.street || "-"],
    ["门牌号", address.building_number || "-"]
  ];
  const copyText = [
    message,
    "",
    `姓名: ${personName || "-"}`,
    `邮箱: ${addressData.email || "-"}`,
    `电话: ${addressData.phone || "-"}`,
    `生日: ${addressData.birthday || "-"}`,
    `性别: ${addressData.gender || "-"}`,
    `国家: ${address.country || "-"} / ${address.country_code || country || "-"}`,
    `州/省: ${address.state || "-"}`,
    `城市: ${address.city || "-"}`,
    `邮编: ${address.zipcode || "-"}`,
    `街道: ${address.street_name || address.street || "-"}`,
    `门牌号: ${address.building_number || "-"}`,
    `完整地址: ${fullAddress || "-"}`
  ].join("\n");

  return {
    hostId: ADDRESSGEN_ADDRESS_FLOAT_HOST_ID,
    title: "AddressGen 地址已申请",
    message,
    requestUrl: addressResult.targetUrl,
    rows,
    fullAddress,
    copyText
  };
}

async function injectAddressgenAddressOverlay(tab, payload) {
  if (tab.id === undefined || tab.id === null) {
    throw new Error("当前标签页缺少 tabId，无法注入地址浮窗。");
  }

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: (overlayPayload) => {
      const mountTarget = document.documentElement || document.body;
      if (!mountTarget) {
        throw new Error("页面没有可用的挂载节点。");
      }

      const previousHost = document.getElementById(overlayPayload.hostId);
      if (previousHost) {
        previousHost.remove();
      }

      const host = document.createElement("div");
      host.id = overlayPayload.hostId;
      host.style.cssText = [
        "all: initial !important",
        "position: fixed !important",
        "top: 24px !important",
        "right: 24px !important",
        "width: 390px !important",
        "max-width: calc(100vw - 32px) !important",
        "z-index: 2147483647 !important",
        "pointer-events: auto !important"
      ].join(";");

      const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .card {
            box-sizing: border-box;
            position: relative;
            font-family: Arial, "Microsoft YaHei", sans-serif;
            background: #ffffff;
            color: #111827;
            border: 2px solid #2563eb;
            border-radius: 12px;
            box-shadow: 0 18px 44px rgba(15, 23, 42, 0.26);
            padding: 16px;
          }
          .title {
            margin: 0 30px 10px 0;
            font-size: 15px;
            line-height: 1.4;
            font-weight: 700;
            color: #1d4ed8;
          }
          .message {
            margin: 0 0 10px;
            padding: 8px 10px;
            border-radius: 8px;
            background: #eff6ff;
            color: #1e40af;
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-line;
          }
          .rows {
            display: grid;
            grid-template-columns: 86px minmax(0, 1fr);
            gap: 6px 8px;
            margin: 0 0 10px;
          }
          .label {
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
          }
          .value {
            color: #0f172a;
            font-size: 12px;
            line-height: 1.45;
            word-break: break-word;
          }
          .full {
            margin: 0 0 12px;
            padding: 9px 10px;
            border: 1px solid #dbeafe;
            border-radius: 8px;
            background: #f8fafc;
            color: #0f172a;
            font-size: 12px;
            line-height: 1.5;
            word-break: break-word;
          }
          .actions {
            display: flex;
            gap: 8px;
          }
          button {
            appearance: none;
            border: 0;
            border-radius: 8px;
            height: 34px;
            padding: 0 12px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          }
          .copy {
            flex: 1;
            background: #2563eb;
            color: #ffffff;
          }
          .close {
            background: #e5e7eb;
            color: #374151;
          }
          .close-icon {
            position: absolute;
            top: 10px;
            right: 10px;
            width: 26px;
            height: 26px;
            padding: 0;
            border-radius: 999px;
            background: #eef2ff;
            color: #334155;
            font-size: 16px;
            line-height: 26px;
          }
        </style>
        <div class="card">
          <button class="close-icon" type="button" title="关闭">×</button>
          <div class="title"></div>
          <div class="message"></div>
          <div class="rows"></div>
          <div class="full"></div>
          <div class="actions">
            <button class="copy" type="button">复制地址内容</button>
            <button class="close" type="button">关闭</button>
          </div>
        </div>
      `;

      root.querySelector(".title").textContent = overlayPayload.title || "AddressGen 地址";
      root.querySelector(".message").textContent = overlayPayload.message || "";
      root.querySelector(".full").textContent = overlayPayload.fullAddress || "";

      const rowsContainer = root.querySelector(".rows");
      for (const [label, value] of overlayPayload.rows || []) {
        const labelElement = document.createElement("div");
        labelElement.className = "label";
        labelElement.textContent = label;
        const valueElement = document.createElement("div");
        valueElement.className = "value";
        valueElement.textContent = value;
        rowsContainer.append(labelElement, valueElement);
      }

      const copyButton = root.querySelector(".copy");
      const closeButtons = root.querySelectorAll(".close, .close-icon");
      const copyText = async (value) => {
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch (error) {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.setAttribute("readonly", "readonly");
          textarea.style.cssText = "position: fixed; top: -9999px; left: -9999px;";
          document.documentElement.appendChild(textarea);
          textarea.select();
          textarea.setSelectionRange(0, textarea.value.length);
          const copied = document.execCommand("copy");
          textarea.remove();
          if (!copied) {
            throw error;
          }
          return true;
        }
      };

      copyButton?.addEventListener("click", async () => {
        const originalText = copyButton.textContent;
        copyButton.disabled = true;
        copyButton.textContent = "复制中...";

        try {
          await copyText(overlayPayload.copyText || overlayPayload.fullAddress || "");
          copyButton.textContent = "已复制";
        } catch (error) {
          copyButton.textContent = "复制失败";
          console.error("[AddressGen浮窗] 复制失败:", error);
        } finally {
          window.setTimeout(() => {
            copyButton.disabled = false;
            copyButton.textContent = originalText;
          }, 1200);
        }
      });

      closeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          host.remove();
        });
      });

      mountTarget.appendChild(host);
      const rect = host.getBoundingClientRect();

      return {
        ok: true,
        mountedTo: mountTarget.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hasShadowRoot: Boolean(host.shadowRoot)
      };
    },
    args: [payload]
  });

  const overlayResult = results?.[0]?.result;
  if (!overlayResult?.ok) {
    throw new Error("地址浮窗脚本未返回成功结果。");
  }

  await appendRuntimeLog("addressgen_address_overlay_injected", {
    tabId: tab.id,
    windowId: tab.windowId,
    mountedTo: overlayResult.mountedTo || "",
    width: overlayResult.width || 0,
    height: overlayResult.height || 0,
    hasShadowRoot: overlayResult.hasShadowRoot === true
  });

  return overlayResult;
}

async function waitForTabComplete(tabId, timeoutMs = ADDRESSGEN_FALLBACK_TAB_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);

    if (tab.status === "complete") {
      return tab;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`等待标签页加载超时（${Math.round(timeoutMs / 1000)}秒）。`);
}

async function openAddressgenFallbackTab(targetUrl) {
  const tab = await chrome.tabs.create({
    url: targetUrl,
    active: false
  });

  return await waitForTabComplete(tab.id);
}

async function activateAddressgenOverlayTab(tab) {
  if (tab?.id === undefined || tab?.id === null) {
    throw new Error("目标标签页缺少 tabId，无法激活。");
  }

  const activatedTab = await chrome.tabs.update(tab.id, {
    active: true
  });

  if (tab.windowId !== undefined && tab.windowId !== null) {
    await chrome.windows.update(tab.windowId, {
      focused: true
    });
  }

  return activatedTab || tab;
}

async function injectAddressgenOverlayWithFallback(currentTab, payload, fallbackUrl, updatePhase = () => {}) {
  try {
    updatePhase("注入浮窗...");
    const overlayResult = await injectAddressgenAddressOverlay(currentTab, payload);

    return {
      overlayResult,
      targetTab: currentTab,
      usedFallback: false,
      initialError: ""
    };
  } catch (error) {
    const initialError = error.message || String(error);
    await appendRuntimeLog("addressgen_address_overlay_failed", {
      tabId: currentTab.id,
      windowId: currentTab.windowId,
      url: maskSensitiveUrl(currentTab.url || ""),
      error: initialError
    });

    updatePhase("打开MayIP页...");
    const fallbackTab = await openAddressgenFallbackTab(fallbackUrl);

    await appendRuntimeLog("addressgen_address_overlay_fallback_opened", {
      tabId: fallbackTab.id,
      windowId: fallbackTab.windowId,
      url: maskSensitiveUrl(fallbackTab.url || fallbackUrl),
      sourceError: initialError
    });

    updatePhase("新页浮窗...");
    let overlayResult;
    try {
      overlayResult = await injectAddressgenAddressOverlay(fallbackTab, payload);
    } catch (fallbackError) {
      await appendRuntimeLog("addressgen_address_overlay_failed", {
        tabId: fallbackTab.id,
        windowId: fallbackTab.windowId,
        url: maskSensitiveUrl(fallbackTab.url || fallbackUrl),
        stage: "fallback_mayips_page",
        sourceError: initialError,
        error: fallbackError.message || String(fallbackError)
      });
      throw fallbackError;
    }

    updatePhase("显示页面...");
    const activatedTab = await activateAddressgenOverlayTab(fallbackTab);

    await appendRuntimeLog("addressgen_address_overlay_fallback_activated", {
      tabId: activatedTab.id,
      windowId: activatedTab.windowId,
      url: maskSensitiveUrl(activatedTab.url || fallbackTab.url || fallbackUrl)
    });

    return {
      overlayResult,
      targetTab: activatedTab,
      usedFallback: true,
      initialError
    };
  }
}

async function checkAddressgenCitySupportFromMayips(updatePhase = () => {}) {
  updatePhase("读取页面...");
  const currentTab = await getCurrentActiveTab();
  updatePhase("抓取IP...");
  const mayipsResult = await captureMayipsContent();
  const textResult = mayipsResult.textResult || {};
  const country = String(textResult.country || "").trim().toUpperCase();
  const city = String(textResult.city || "").trim();
  const regionName = String(textResult.region_name || "").trim();

  if (!country) {
    throw new Error("按钮7未提取到 country，无法查询 AddressGen 城市列表。");
  }

  if (!city) {
    throw new Error("按钮7未提取到 city，无法判断城市是否在列表中。");
  }

  await appendRuntimeLog("addressgen_city_check_started", {
    country,
    city,
    regionName
  });

  try {
    updatePhase("查询列表...");
    const { targetUrl, areas } = await fetchAddressgenAreas(country);
    const matchResult = matchAddressgenArea({
      city,
      regionName
    }, areas);
    const message = buildAddressgenCityCheckMessage(matchResult);

    await appendRuntimeLog("addressgen_city_check_completed", {
      targetUrl,
      country,
      city,
      regionName,
      candidateCount: areas.length,
      methodHint: matchResult.matchBy || "not_matched",
      matchedKeywords: [
        matchResult.area?.area_code || "",
        matchResult.area?.slug || "",
        matchResult.area?.full_name || ""
      ].filter(Boolean).join(" / "),
      message
    });

    updatePhase("申请地址...");
    const addressResult = await requestAddressgenAddress(country, matchResult);
    const addressData = addressResult.data || {};
    const address = addressData.address || {};
    const addressSummary = formatAddressgenAddressSummary(address);
    const addressName = formatAddressgenPersonName(addressData);

    await appendRuntimeLog("addressgen_address_generated", {
      targetUrl: addressResult.targetUrl,
      country,
      city,
      regionName,
      generatedCity: address.city || "",
      addressState: address.state || "",
      addressAreaCode: address.area_code || addressResult.areaCode || "",
      addressSummary,
      addressName,
      personEmail: addressData.email || "",
      addressPhone: addressData.phone || "",
      personBirthday: addressData.birthday || "",
      personGender: addressData.gender || "",
      addressZip: address.zipcode || "",
      methodHint: addressResult.mode,
      message
    });

    const overlayPayload = buildAddressgenAddressOverlayPayload({
      country,
      city,
      regionName,
      matchResult,
      message,
      addressResult
    });
    let overlayResult = null;
    let overlayError = "";
    let overlayTargetTab = currentTab;
    let usedOverlayFallback = false;

    try {
      const overlayState = await injectAddressgenOverlayWithFallback(
        currentTab,
        overlayPayload,
        MAYIPS_TARGET_URL,
        updatePhase
      );
      overlayResult = overlayState.overlayResult;
      overlayTargetTab = overlayState.targetTab;
      usedOverlayFallback = overlayState.usedFallback;
    } catch (error) {
      overlayError = error.message || String(error);
      await appendRuntimeLog("addressgen_address_overlay_failed", {
        tabId: overlayTargetTab?.id ?? currentTab.id,
        windowId: overlayTargetTab?.windowId ?? currentTab.windowId,
        url: maskSensitiveUrl(overlayTargetTab?.url || currentTab.url || ""),
        error: overlayError
      });
    }

    return {
      country,
      city,
      regionName,
      targetUrl,
      areas,
      matchResult,
      addressResult,
      addressSummary,
      overlayResult,
      overlayError,
      usedOverlayFallback,
      message: overlayError
        ? `${message}\n地址已申请，但浮窗注入失败：${overlayError}`
        : usedOverlayFallback
          ? `${message}\n地址已申请；当前页无法浮窗，已打开MayIP页面显示浮窗`
          : `${message}\n地址已申请并显示到当前页面浮窗`
    };
  } catch (error) {
    await appendRuntimeLog("addressgen_city_check_failed", {
      country,
      city,
      regionName,
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

      if (featureId === "8") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "抓取IP...";
          const result = await checkAddressgenCitySupportFromMayips((phase) => {
            button.textContent = phase || "处理中...";
          });
          setSaveStatus(result.message);
        } catch (error) {
          setSaveStatus(error.message || "按钮8执行失败。", true);
          if (!isRequestTimeoutError(error)) {
            console.error(error);
          }
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }

        logEvent("feature_button_clicked", {
          featureId,
          popupBuild: POPUP_BUILD
        });
        return;
      }

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
            let pageLoaded = false;
            while (attempts < 20) {
              const updatedTab = await chrome.tabs.get(tab.id);
              if (updatedTab.status === "complete") {
                tab = updatedTab;
                pageLoaded = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
              attempts++;
            }
            if (!pageLoaded) {
              throw new Error("等待 ChatGPT session 页面加载超时。");
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
            let pageLoaded = false;
            while (attempts < 20) {
              const updatedTab = await chrome.tabs.get(tab.id);
              if (updatedTab.status === "complete") {
                tab = updatedTab;
                pageLoaded = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
              attempts++;
            }
            if (!pageLoaded) {
              throw new Error("等待 ChatGPT session 页面加载超时。");
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
              country: textResult.country || "",
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
            country: textResult.country || null,
            city: textResult.city || null,
            regionName: textResult.region_name || null,
            bytes: textResult.bytes
          });

          if (textResult.city) {
            await appendRuntimeLog("address_extract_prompt", {
              backendBaseUrl,
              token,
              country: textResult.country || "",
              city: textResult.city || "",
              regionName: textResult.region_name || "",
              message: "已成功返回 city。请按按钮4（提取地址）生成地址、测试卡和新姓名。"
            });
          }

          if (textResult.city && textResult.region_name && textResult.country) {
            setSaveStatus(`IP信息已保存：${textResult.country} / ${textResult.region_name} / ${textResult.city}（${textResult.bytes} 字节）`);
          } else if (textResult.city && textResult.region_name) {
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

      if (featureId === "6") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          const result = await captureChatgptAccessToken((phase) => {
            button.textContent = phase || "提取中...";
          });
          const workspaceCount = result.workspaceResult?.workspaceCount ?? 0;
          const workspaceSuffix = result.workspaceResult?.error
            ? `；空间查询失败：${result.workspaceResult.error}`
            : `；空间 ${workspaceCount} 个`;

          if (result.savedTo) {
            setSaveStatus(`ChatGPT AT 已提取并保存：${result.savedTo}${workspaceSuffix}`, Boolean(result.workspaceResult?.error));
          } else {
            setSaveStatus(`ChatGPT AT 已提取，浮窗已显示，但保存后端失败：${result.saveError || "未知错误"}${workspaceSuffix}`, true);
          }
        } catch (error) {
          setSaveStatus(error.message || "提取网页AT失败。", true);
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

      if (featureId === "7") {
        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "抓取中...";
          const result = await captureMayipsContent();
          const country = result.textResult.country || "";
          if (result.textResult.city && result.textResult.region_name && country) {
            setSaveStatus(`MayIP信息已保存：${country} / ${result.textResult.region_name} / ${result.textResult.city}（${result.textResult.bytes} 字节）`);
          } else if (result.textResult.city && result.textResult.region_name) {
            setSaveStatus(`MayIP信息已保存：${result.textResult.region_name} / ${result.textResult.city}（${result.textResult.bytes} 字节）`);
          } else if (result.textResult.city) {
            setSaveStatus(`MayIP city 已保存：${[country, result.textResult.city].filter(Boolean).join(" / ")}（${result.textResult.bytes} 字节）`);
          } else {
            setSaveStatus(`MayIP页面已保存，但未提取到 city：${result.page.title || result.page.finalUrl || "完成"}。`, true);
          }
        } catch (error) {
          setSaveStatus(error.message || "按钮7执行失败。", true);
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
    ? `当前页面：${pageInfo.title}（${POPUP_BUILD}）`
    : `已记录当前页面信息。（${POPUP_BUILD}）`;

  logEvent("popup_opened", {
    page: "popup",
    popupBuild: POPUP_BUILD,
    currentPage: pageInfo
  });
});

bindPopupActions();
void loadBackendBaseUrl();
void loadBackendTokenState();
void loadLastIpInfoState();
void loadUrlLoggerState();
