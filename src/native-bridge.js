/**
 * Native Bridge — Claude Desktop & Claude Code Connection
 *
 * Runs in the service worker. Connects the extension to Claude Desktop
 * (and through it, Claude Code CLI) via Chrome's Native Messaging API.
 */

const NATIVE_HOST_NAME = "com.anthropic.claude_browser_extension";

// ─── State ───
let nativePort = null;
let connectionStatus = "disconnected"; // disconnected | connecting | connected | error
let pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
let requestCounter = 0;
let reconnectTimer = null;

// ─── Connection Management ───

function connect() {
  if (nativePort) disconnect();
  connectionStatus = "connecting";

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((message) => {
      connectionStatus = "connected";

      // Route response to pending request
      if (message.requestId && pendingRequests.has(message.requestId)) {
        const pending = pendingRequests.get(message.requestId);
        clearTimeout(pending.timeout);
        pendingRequests.delete(message.requestId);
        pending.resolve(message);
        return;
      }

      // Broadcast unsolicited messages to all tabs with the panel open
      broadcastNativeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || "Disconnected";
      console.warn("[Claude Native Bridge] Disconnected:", error);
      nativePort = null;
      connectionStatus = "disconnected";

      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Native host disconnected"));
      }
      pendingRequests.clear();
    });

    connectionStatus = "connected";
  } catch (e) {
    console.error("[Claude Native Bridge] Connection failed:", e.message);
    connectionStatus = "error";
    nativePort = null;
  }
}

function disconnect() {
  if (nativePort) {
    try { nativePort.disconnect(); } catch (e) { /* already disconnected */ }
    nativePort = null;
  }
  connectionStatus = "disconnected";
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function ensureConnected() {
  if (connectionStatus === "connected" && nativePort) return true;
  connect();
  return connectionStatus === "connected";
}

// ─── Message Sending ───

function sendNativeMessage(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!ensureConnected()) {
      reject(new Error("Cannot connect to Claude Desktop. Is it running?"));
      return;
    }

    const requestId = `req_${++requestCounter}_${Date.now()}`;
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Native message timed out"));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout });
    nativePort.postMessage({ ...message, requestId });
  });
}

// ─── Broadcast to tabs ───

async function broadcastNativeMessage(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: "NATIVE_BRIDGE_MESSAGE",
        data: message
      }).catch(() => {});
    }
  } catch (e) { /* no tabs available */ }
}

// ─── Check if Claude Desktop is available ───

async function checkDesktopAvailable() {
  try {
    if (!ensureConnected()) return { available: false, error: "Connection failed" };
    const response = await sendNativeMessage({ type: "ping" }, 5000);
    return { available: true, response };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ─── Message Handler ───

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.type || !message.type.startsWith("NATIVE_BRIDGE_")) return false;

  const handle = async () => {
    switch (message.type) {
      case "NATIVE_BRIDGE_STATUS": {
        return {
          status: connectionStatus,
          hasPort: !!nativePort,
          pendingRequests: pendingRequests.size
        };
      }

      case "NATIVE_BRIDGE_CONNECT": {
        connect();
        return { status: connectionStatus };
      }

      case "NATIVE_BRIDGE_DISCONNECT": {
        disconnect();
        return { status: "disconnected" };
      }

      case "NATIVE_BRIDGE_CHECK": {
        return await checkDesktopAvailable();
      }

      case "NATIVE_BRIDGE_SEND": {
        return await sendNativeMessage(message.data, message.timeout || 30000);
      }

      default:
        return { error: `Unknown bridge command: ${message.type}` };
    }
  };

  handle().then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});
