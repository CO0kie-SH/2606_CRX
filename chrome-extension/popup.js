const messageElement = document.getElementById("message");

messageElement.textContent = "正在读取当前页面信息...";

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
    url: tab.url || "",
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
