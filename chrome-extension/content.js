(() => {
  let currentUrl = window.location.href;

  function scheduleUrlCheck(reason) {
    window.setTimeout(() => {
      if (window.location.href !== currentUrl) {
        recordUrl(reason, true);
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

  function recordUrl(reason, onlyWhenChanged = false) {
    const nextUrl = window.location.href;

    if (onlyWhenChanged && nextUrl === currentUrl) {
      return;
    }

    currentUrl = nextUrl;

    chrome.runtime.sendMessage(
      {
        type: "CONTENT_URL_EVENT",
        payload: {
          reason,
          title: document.title || "",
          url: nextUrl
        }
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  window.addEventListener("popstate", () => scheduleUrlCheck("popstate"));
  window.addEventListener("hashchange", () => scheduleUrlCheck("hashchange"));
  window.setInterval(() => scheduleUrlCheck("url_changed"), 500);

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EXTRACT_PAGE_CONTENT") {
      return false;
    }

    sendResponse({
      ok: true,
      page: {
        title: document.title || "",
        url: window.location.href,
        text: document.body?.innerText || "",
        html: document.documentElement?.outerHTML || ""
      }
    });
    return true;
  });

  recordUrl("page_loaded");
})();
