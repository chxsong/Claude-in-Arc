// Zoom management listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLAUDE_ARC_GET_ZOOM") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.getZoom(sender.tab.id, (zoom) => {
        if (chrome.runtime.lastError) {
          sendResponse({ zoom: 1 });
        } else {
          sendResponse({ zoom: zoom });
        }
      });
      return true; // Keep channel open for async response
    } else {
      sendResponse({ zoom: 1 });
    }
  } else if (message.type === "CLAUDE_ARC_GET_TAB_ID") {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
  }
});

// Broadcast zoom changes to tabs
chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  chrome.tabs.sendMessage(zoomChangeInfo.tabId, {
    type: "CLAUDE_ARC_ZOOM_CHANGED",
    zoom: zoomChangeInfo.newZoomFactor
  }).catch(e => { /* tab may not have content script */ });
});

// Handle Extension Icon Click
if (chrome.action) {
  chrome.action.onClicked.addListener((tab) => {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_INJECTED_PANEL", tabId: tab.id }).catch(e => { /* tab may not have content script */ });
    }
  });
}

// Handle Global Extension Command (Cmd+E fallback from Chrome shortcut)
if (chrome.commands) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "toggle-side-panel" || command === "_execute_action") {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_INJECTED_PANEL", tabId: tab.id }).catch(e => { /* tab may not have content script */ });
      } else {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_INJECTED_PANEL", tabId: tabs[0].id }).catch(e => { /* tab may not have content script */ });
        });
      }
    }
  });
}
