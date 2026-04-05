/**
 * Arc Zoom Handler — manages zoom level queries and tab ID lookup
 * for the panel injector content script.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CLAUDE_ARC_GET_ZOOM') {
    if (sender.tab?.id) {
      chrome.tabs.getZoom(sender.tab.id, (zoom) => {
        sendResponse({ zoom: chrome.runtime.lastError ? 1 : zoom });
      });
      return true;
    }
    sendResponse({ zoom: 1 });
    return false;
  }

  if (message.type === 'CLAUDE_ARC_GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return false;
  }
});

chrome.tabs.onZoomChange.addListener((info) => {
  chrome.tabs.sendMessage(info.tabId, {
    type: 'CLAUDE_ARC_ZOOM_CHANGED',
    zoom: info.newZoomFactor
  }).catch(() => {});
});
