const messageElement = document.getElementById("message");
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
const BACKEND_BASE_URL_STORAGE_KEY = "settings.backendBaseUrl";
const URL_LOGGER_SETTINGS_KEY = "urlLogger.settings";
const URL_LOGGER_LOGS_KEY = "urlLogger.global.logs";
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
  urlLogs: []
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

function renderUrlLogger() {
  urlLoggerEnabledElement.checked = popupState.urlLoggerEnabled;
  setUrlLoggerStatus(
    popupState.urlLoggerEnabled
      ? `记录中，当前共 ${popupState.urlLogs.length} 条`
      : "记录已关闭"
  );

  urlLoggerLogsElement.textContent = popupState.urlLogs.length
    ? popupState.urlLogs.map(formatLogEntry).join("\n\n")
    : "当前还没有跳转记录。";
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
    return "当前没有可复制的网页跳转记录。";
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
  anchor.download = `url-jump-log-${Date.now()}.json`;
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);

  setUrlLoggerStatus(`已导出 ${popupState.urlLogs.length} 条记录。`);
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

async function sendManualLogReport() {
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
  const targetUrl = new URL("api/report", backendBaseUrl).toString();
  const manifest = chrome.runtime.getManifest();
  const payload = {
    event_name: "extension_loaded",
    time: new Date().toISOString(),
    extension_version: manifest.version || "",
    logger_build: "url-capture-v3",
    backend_base_url: backendBaseUrl,
    details: {
      trigger: "popup_feature_1",
      reason: "manual_test",
      extension_id: chrome.runtime.id,
      extension_name: manifest.name || ""
    }
  };
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText || "发送测试日志失败。"}`);
  }

  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    data = {
      raw: responseText
    };
  }

  if (data.ok === false) {
    throw new Error(data.error || "服务端返回失败。");
  }

  return {
    ...data,
    targetUrl
  };
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
          button.textContent = "发送中...";
          const result = await sendManualLogReport();
          setSaveStatus(`功能1发送成功：${result.targetUrl}`);
        } catch (error) {
          setSaveStatus(error.message || "功能1发送失败。", true);
          console.error(error);
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
void loadUrlLoggerState();
