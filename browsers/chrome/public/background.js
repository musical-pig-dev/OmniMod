chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "omnimod-open-tab" || typeof message.url !== "string") return;
  chrome.tabs.create({ url: message.url, active: true }, (tab) => {
    const reason = chrome.runtime.lastError?.message;
    if (reason) sendResponse({ error: reason });
    else sendResponse({ id: tab?.id ?? null });
  });
  return true;
});

