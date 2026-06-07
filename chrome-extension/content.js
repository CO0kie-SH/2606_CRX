(async () => {
  const PANEL_ID = "my-extension-url-logger";
  const MAX_LOGS = 100;
  const EXTENSION_VERSION = chrome.runtime.getManifest().version;
  const CONTENT_BUILD = "url-panel-v2";

  if (document.getElementById(PANEL_ID)) {
    return;
  }

  let tabContext = await getTabContext();
  let storageKey = tabContext?.tabId ? `urlLogger.tab.${tabContext.tabId}` : "urlLogger.tab.unknown";
  let state = await loadState();
  let currentUrl = window.location.href;

  const panel = createPanel();
  const shadow = panel.shadowRoot;
  const toggle = shadow.querySelector("#url-logger-toggle");
  const status = shadow.querySelector("#url-logger-status");
  const logsElement = shadow.querySelector("#url-logger-logs");
  const clearButton = shadow.querySelector("#url-logger-clear");

  document.documentElement.appendChild(panel);
  render();

  if (state.enabled) {
    recordUrl("page_loaded");
  }

  toggle.addEventListener("change", async () => {
    state.enabled = toggle.checked;

    if (state.enabled) {
      await recordUrl("recording_enabled");
    } else {
      await saveState();
      sendExtensionLog("url_recording_disabled", { currentUrl });
    }

    render();
  });

  clearButton.addEventListener("click", async () => {
    state.logs = [];
    state.lastUrl = currentUrl;
    await saveState();
    render();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "URL_LOG_UPDATED") {
      return false;
    }

    if (message.storageKey !== storageKey) {
      return false;
    }

    chrome.storage.local.get(storageKey).then((result) => {
      state = {
        enabled: state.enabled,
        logs: [],
        lastUrl: "",
        ...(result[storageKey] || {})
      };
      render();
    });

    return false;
  });

  window.addEventListener("popstate", () => scheduleUrlCheck("popstate"));
  window.addEventListener("hashchange", () => scheduleUrlCheck("hashchange"));
  window.setInterval(() => scheduleUrlCheck("url_changed"), 500);

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  async function getTabContext() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_TAB_CONTEXT" }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          resolve(null);
          return;
        }

        resolve(response.tabContext);
      });
    });
  }

  async function loadState() {
    const result = await chrome.storage.local.get(storageKey);

    return {
      enabled: false,
      logs: [],
      lastUrl: "",
      ...(result[storageKey] || {})
    };
  }

  async function saveState() {
    await chrome.storage.local.set({
      [storageKey]: {
        enabled: state.enabled,
        logs: state.logs,
        lastUrl: state.lastUrl
      }
    });
  }

  function createPanel() {
    const host = document.createElement("div");
    host.id = PANEL_ID;
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          color-scheme: light;
          font-family: Arial, "Microsoft YaHei", sans-serif;
        }

        .panel {
          width: 340px;
          max-width: calc(100vw - 36px);
          height: 260px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid #d6dbe1;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.2);
        }

        .header {
          height: 48px;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-bottom: 1px solid #edf0f3;
          background: #f8fafc;
        }

        .title {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .name {
          color: #111827;
          font-size: 13px;
          font-weight: 700;
          line-height: 16px;
        }

        .status {
          color: #64748b;
          font-size: 12px;
          line-height: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .switch {
          flex: 0 0 auto;
          position: relative;
          width: 44px;
          height: 24px;
          display: inline-block;
        }

        .switch input {
          width: 0;
          height: 0;
          opacity: 0;
        }

        .slider {
          position: absolute;
          inset: 0;
          cursor: pointer;
          border-radius: 999px;
          background: #cbd5e1;
          transition: background 0.16s ease;
        }

        .slider::before {
          content: "";
          position: absolute;
          left: 3px;
          top: 3px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
          transition: transform 0.16s ease;
        }

        input:checked + .slider {
          background: #2563eb;
        }

        input:checked + .slider::before {
          transform: translateX(20px);
        }

        .logs {
          flex: 1 1 auto;
          min-height: 0;
          margin: 0;
          padding: 10px 12px;
          overflow: auto;
          background: #0f172a;
          color: #dbeafe;
          font-family: Consolas, "Courier New", monospace;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .footer {
          height: 38px;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 12px;
          border-top: 1px solid #edf0f3;
          background: #ffffff;
        }

        .hint {
          min-width: 0;
          color: #64748b;
          font-size: 12px;
          line-height: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        button {
          flex: 0 0 auto;
          height: 24px;
          padding: 0 8px;
          border: 1px solid #d6dbe1;
          border-radius: 6px;
          background: #ffffff;
          color: #334155;
          cursor: pointer;
          font: 12px Arial, "Microsoft YaHei", sans-serif;
        }

        button:hover {
          background: #f1f5f9;
        }
      </style>
      <section class="panel" role="region" aria-label="URL 跳转记录器">
        <div class="header">
          <div class="title">
            <div class="name">URL 跳转记录</div>
            <div class="status" id="url-logger-status">未开启</div>
          </div>
          <label class="switch" title="开启或关闭 URL 跳转记录">
            <input id="url-logger-toggle" type="checkbox" aria-label="开启或关闭 URL 跳转记录">
            <span class="slider"></span>
          </label>
        </div>
        <pre class="logs" id="url-logger-logs"></pre>
        <div class="footer">
          <span class="hint">记录当前标签页的完整 URL</span>
          <span class="hint">v${EXTENSION_VERSION}</span>
          <button id="url-logger-clear" type="button">清空</button>
        </div>
      </section>
    `;

    return host;
  }

  async function recordUrl(reason) {
    currentUrl = window.location.href;

    if (!state.enabled) {
      return;
    }

    if (state.lastUrl === currentUrl && reason !== "recording_enabled") {
      return;
    }

    const entry = {
      time: new Date().toLocaleString(),
      reason,
      title: document.title || "",
      url: currentUrl
    };

    state.lastUrl = currentUrl;
    state.logs = [entry, ...state.logs].slice(0, MAX_LOGS);
    await saveState();
    render();

    sendExtensionLog("url_jump_recorded", {
      logger: {
        extensionVersion: EXTENSION_VERSION,
        contentBuild: CONTENT_BUILD
      },
      tabContext,
      navigation: entry
    });
  }

  function render() {
    toggle.checked = state.enabled;
    status.textContent = state.enabled ? `记录中，共 ${state.logs.length} 条` : "未开启";

    logsElement.textContent = state.logs.length
      ? state.logs.map(formatLogEntry).join("\n\n")
      : "打开开关后，将在这里显示 URL 跳转记录。";
  }

  function formatLogEntry(entry, index) {
    const lines = [
      `#${state.logs.length - index} ${entry.time}`,
      `来源: ${entry.reason}`,
      `URL: ${entry.url}`
    ];

    if (entry.title) {
      lines.splice(2, 0, `标题: ${entry.title}`);
    }

    if (entry.error) {
      lines.push(`错误: ${entry.error}`);
    }

    if (entry.transitionType) {
      lines.push(`类型: ${entry.transitionType}`);
    }

    return lines.join("\n");
  }

  function scheduleUrlCheck(reason) {
    window.setTimeout(() => {
      if (window.location.href !== currentUrl) {
        recordUrl(reason);
      }
    }, 0);
  }

  function wrapHistoryMethod(methodName) {
    const original = window.history[methodName];

    try {
      window.history[methodName] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleUrlCheck(methodName);
        return result;
      };
    } catch (error) {
      console.warn(`URL logger cannot wrap history.${methodName}:`, error);
    }
  }

  function sendExtensionLog(eventName, payload) {
    chrome.runtime.sendMessage(
      {
        type: "LOG_EVENT",
        eventName,
        payload
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn("URL logger message failed:", chrome.runtime.lastError.message);
        }
      }
    );
  }
})();
