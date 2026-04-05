/**
 * Arc SidePanel Shim
 * Polyfills chrome.sidePanel for Arc Browser where the API is unavailable.
 * Must be imported BEFORE the official service worker bundle so that all
 * references to chrome.sidePanel resolve to our polyfill.
 */

/** When true: write verbose diagnostics to chrome.storage.local (`claude_arc_debug_ring`). Ship with false. */
const ARC_SHIM_DEBUG = false;

// #region optional diagnostics (WebSocket / debugger / tabGroups)
const _SHIM_RING_KEY = 'claude_arc_debug_ring';
const _SHIM_RING_MAX = 200;
async function _shimRingAppend(payload) {
  if (!ARC_SHIM_DEBUG) return;
  try {
    const r = await chrome.storage.local.get(_SHIM_RING_KEY);
    const arr = Array.isArray(r[_SHIM_RING_KEY]) ? r[_SHIM_RING_KEY] : [];
    arr.push(payload);
    while (arr.length > _SHIM_RING_MAX) arr.shift();
    await chrome.storage.local.set({ [_SHIM_RING_KEY]: arr });
  } catch (e) {}
}
function _shimLog(hid, msg, data = {}) {
  if (!ARC_SHIM_DEBUG) return;
  const payload = {
    hypothesisId: hid,
    location: 'arc-sidepanel-shim.js',
    message: msg,
    data: { ...data, swTs: Date.now() },
    timestamp: Date.now(),
    runId: 'arc-shim-debug'
  };
  _shimRingAppend(payload).catch(() => {});
}

{
  const OrigWS = self.WebSocket;
  self.WebSocket = function PatchedWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    const isBridge = typeof url === 'string' && url.includes('bridge.claudeusercontent.com');
    if (!isBridge) return ws;

    _shimLog('H3', 'bridge_ws_created', { url: url.replace(/\/[^/]{20,}$/, '/[TOKEN]') });

    const origSend = ws.send.bind(ws);
    self._arcBridgeWS = ws;
    self._arcBridgeSend = origSend;

    ws.send = function(data) {
      try {
        const parsed = JSON.parse(data);
        const sendLog = { type: parsed.type, client_type: parsed.client_type };
        if (parsed.type === 'connect' && parsed.device_id) {
          sendLog.local_device_id = parsed.device_id.slice(0, 12);
        }
        if (parsed.type === 'tool_result') {
          sendLog.tool_use_id = parsed.tool_use_id;
          sendLog.hasError = !!parsed.error;
          if (self._arcToolCallTracker) self._arcToolCallTracker.onToolResult();
        }
        _shimLog('H3', 'bridge_ws_send', sendLog);
      } catch (e) {
        _shimLog('H3', 'bridge_ws_send_raw', { len: data?.length });
      }
      return origSend(data);
    };

    ws.addEventListener('open', () => { _shimLog('H3', 'bridge_ws_open', {}); });
    ws.addEventListener('message', (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        const logData = { type: parsed.type };
        if (parsed.type === 'tool_call') {
          logData.tool = parsed.tool;
          logData.tool_use_id = parsed.tool_use_id;
          logData.target_device_id_prefix = parsed.target_device_id ? parsed.target_device_id.slice(0, 12) : '[none]';
          if (self._arcToolCallTracker) self._arcToolCallTracker.onToolCall(parsed.tool, parsed.tool_use_id);

          if (self._arcBridgeInterceptor?.canHandle(parsed.tool)) {
            logData.intercepted = true;
            _shimLog('INTERCEPT', 'dispatching_tool_call', {
              tool: parsed.tool, tool_use_id: parsed.tool_use_id
            });
            self._arcBridgeInterceptor.handleBridgeToolCall(parsed, origSend)
              .then(() => {
                _shimLog('INTERCEPT', 'tool_call_completed', {
                  tool: parsed.tool, tool_use_id: parsed.tool_use_id
                });
                if (self._arcToolCallTracker) self._arcToolCallTracker.onToolResult();
              })
              .catch(e => {
                _shimLog('INTERCEPT', 'tool_call_error', {
                  tool: parsed.tool, tool_use_id: parsed.tool_use_id, error: String(e)
                });
              });
          }
        }
        _shimLog('H3', 'bridge_ws_message', logData);
      } catch (e) {}
    });
    ws.addEventListener('close', (evt) => {
      _shimLog('H3', 'bridge_ws_close', { code: evt.code, reason: evt.reason, wasClean: evt.wasClean });
    });
    ws.addEventListener('error', () => { _shimLog('H3', 'bridge_ws_error', {}); });

    return ws;
  };
  self.WebSocket.prototype = OrigWS.prototype;
  self.WebSocket.CONNECTING = OrigWS.CONNECTING;
  self.WebSocket.OPEN = OrigWS.OPEN;
  self.WebSocket.CLOSING = OrigWS.CLOSING;
  self.WebSocket.CLOSED = OrigWS.CLOSED;
  _shimLog('H3', 'websocket_wrap_ok', {});
}

{
  const dbg = chrome.debugger;
  if (dbg) {
    const origAttach = dbg.attach.bind(dbg);
    const origDetach = dbg.detach.bind(dbg);
    const origSend = dbg.sendCommand.bind(dbg);

    dbg.attach = function(target, version, cb) {
      _shimLog('H4', 'debugger_attach_called', { target, version });
      if (cb) {
        return origAttach(target, version, (...args) => {
          const err = chrome.runtime.lastError?.message || null;
          _shimLog('H4', 'debugger_attach_cb', { target, error: err });
          cb(...args);
        });
      }
      const p = origAttach(target, version);
      if (p && typeof p.then === 'function') {
        return p.then(r => {
          _shimLog('H4', 'debugger_attach_ok', { target });
          return r;
        }).catch(e => {
          _shimLog('H4', 'debugger_attach_fail', { target, error: String(e) });
          throw e;
        });
      }
      return p;
    };

    dbg.detach = function(target, cb) {
      _shimLog('H4', 'debugger_detach_called', { target });
      if (cb) {
        return origDetach(target, (...args) => {
          _shimLog('H4', 'debugger_detach_cb', { target, error: chrome.runtime.lastError?.message || null });
          cb(...args);
        });
      }
      const p = origDetach(target);
      if (p && typeof p.then === 'function') {
        return p.then(r => { _shimLog('H4', 'debugger_detach_ok', { target }); return r; })
               .catch(e => { _shimLog('H4', 'debugger_detach_fail', { target, error: String(e) }); throw e; });
      }
      return p;
    };

    dbg.sendCommand = function(target, method, params, cb) {
      _shimLog('H4', 'debugger_sendCommand', { target, method });
      if (cb) {
        return origSend(target, method, params, (...args) => {
          _shimLog('H4', 'debugger_sendCommand_cb', { target, method, error: chrome.runtime.lastError?.message || null });
          cb(...args);
        });
      }
      const p = origSend(target, method, params);
      if (p && typeof p.then === 'function') {
        return p.then(r => { _shimLog('H4', 'debugger_cmd_ok', { target, method }); return r; })
               .catch(e => { _shimLog('H4', 'debugger_cmd_fail', { target, method, error: String(e) }); throw e; });
      }
      return p;
    };

    _shimLog('H4', 'debugger_wrap_ok', {});
  } else {
    _shimLog('H4', 'debugger_api_missing', {});
  }
}

{
  if (!chrome.tabGroups) {
    chrome.tabGroups = {
      Color: { GREY: "grey", BLUE: "blue", RED: "red", YELLOW: "yellow", GREEN: "green", PINK: "pink", PURPLE: "purple", CYAN: "cyan", ORANGE: "orange" },
      TAB_GROUP_ID_NONE: -1,
      get: async () => ({}),
      update: async () => ({}),
      query: async () => ([]),
      move: async () => ({})
    };
  }
  if (!chrome.tabs.group) chrome.tabs.group = async () => -1;
  if (!chrome.tabs.ungroup) chrome.tabs.ungroup = async () => {};

  if (chrome.tabGroups && chrome.tabGroups.get && chrome.tabGroups.get.toString().includes('native code')) {
    const origGet = chrome.tabGroups.get.bind(chrome.tabGroups);
    const origUpdate = chrome.tabGroups.update.bind(chrome.tabGroups);
    chrome.tabGroups.get = function(groupId) {
      _shimLog('H5', 'tabGroups_get_called', { groupId });
      return origGet(groupId).then(r => {
        _shimLog('H5', 'tabGroups_get_ok', { groupId });
        return r;
      }).catch(e => {
        _shimLog('H5', 'tabGroups_get_fail', { groupId, error: String(e) });
        throw e;
      });
    };
    chrome.tabGroups.update = function(groupId, props) {
      _shimLog('H5', 'tabGroups_update_called', { groupId, props });
      return origUpdate(groupId, props).then(r => {
        _shimLog('H5', 'tabGroups_update_ok', { groupId });
        return r;
      }).catch(e => {
        _shimLog('H5', 'tabGroups_update_fail', { groupId, error: String(e) });
        throw e;
      });
    };
    _shimLog('H5', 'tabGroups_wrap_ok', {});
  } else {
    _shimLog('H5', 'tabGroups_api_missing', {});
  }
}

{
  chrome.storage.local.get('bridgeDeviceId').then(r => {
    _shimLog('H7', 'stored_bridgeDeviceId', {
      prefix: r.bridgeDeviceId ? r.bridgeDeviceId.slice(0, 12) : '[none]'
    });
  }).catch(() => {});
}

{
  const origQuery = chrome.tabs.query.bind(chrome.tabs);
  const origGet = chrome.tabs.get.bind(chrome.tabs);
  const origStorageGet = chrome.storage.local.get.bind(chrome.storage.local);
  let _toolCallPending = null;

  chrome.tabs.query = function(queryInfo) {
    if (_toolCallPending) {
      _shimLog('H8', 'tabs_query_during_tool', { queryInfo: JSON.stringify(queryInfo)?.slice(0, 100), tool: _toolCallPending });
    }
    return origQuery(queryInfo);
  };
  chrome.tabs.get = function(tabId) {
    if (_toolCallPending) {
      _shimLog('H8', 'tabs_get_during_tool', { tabId, tool: _toolCallPending });
    }
    return origGet(tabId);
  };

  chrome.storage.local.get = function(keys) {
    if (_toolCallPending) {
      const keyStr = typeof keys === 'string' ? keys : Array.isArray(keys) ? keys.join(',') : JSON.stringify(keys)?.slice(0, 80);
      if (!keyStr.includes('claude_arc_debug_ring')) {
        _shimLog('H9', 'storage_get_during_tool', { keys: keyStr, tool: _toolCallPending });
      }
    }
    return origStorageGet(keys);
  };

  self._arcToolCallTracker = {
    onToolCall(tool, toolUseId) {
      _toolCallPending = tool;
      setTimeout(() => {
        if (_toolCallPending === tool) {
          _shimLog('H7', 'tool_call_stalled_5s', { tool, toolUseId });
          // Force recovery
          _toolCallPending = null;
        }
      }, 5000);
    },
    onToolResult() { _toolCallPending = null; }
  };
  _shimLog('H7_H8', 'tabs_and_tracker_wrap_ok', {});
}
// #endregion

// #region agent log
_shimLog('H15', 'polyfill_decision', {
  nativeSidePanelExists: !!chrome.sidePanel,
  nativeOpenType: typeof chrome.sidePanel?.open
});
// #endregion
// Disable native openPanelOnActionClick so the browser doesn't swallow icon clicks
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}
const _needsPolyfill = true;

if (_needsPolyfill) {
  const _options = {};
  const _behavior = { openPanelOnActionClick: false };

  // Register action click unconditionally so the toolbar icon always works
  chrome.action?.onClicked.addListener(async (tab) => {
    _shimLog('H12', 'action_clicked', { tabId: tab?.id || null, url: tab?.url || '' });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_INJECTED_PANEL',
        tabId: tab.id
      });
      _shimLog('H12', 'action_toggle_sent', { tabId: tab.id });
    } catch (e) {
      _shimLog('H12', 'action_toggle_fail', { tabId: tab.id, error: String(e) });
    }
  });
  _shimLog('H12', 'action_listener_registered_unconditional', {});

  chrome.sidePanel = {
    async open(opts) {
      const tabId = opts?.tabId;
      _shimLog('H12', 'sidePanel_open_called', { tabId: tabId || null });
      if (!tabId) return;
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_INJECTED_PANEL',
          tabId
        });
        _shimLog('H12', 'sidePanel_open_dispatched', { tabId });
      } catch (e) {
        _shimLog('H12', 'sidePanel_open_send_fail', { tabId, error: String(e) });
        // Content script not ready
      }
    },

    async close(opts) {
      const tabId = opts?.tabId;
      if (!tabId) return;
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'HIDE_INJECTED_PANEL',
          tabId
        });
      } catch (e) {}
    },

    async setOptions(opts) {
      Object.assign(_options, opts);
    },

    async getOptions(_query) {
      return { ..._options };
    },

    async setPanelBehavior(behavior) {
      Object.assign(_behavior, behavior);
      _shimLog('H12', 'setPanelBehavior_called', { behavior });
    },

    async getPanelBehavior() {
      return { ..._behavior };
    },

    onStateChanged: {
      addListener() {},
      removeListener() {},
      hasListener() { return false; }
    }
  };

  console.log('[Arc SidePanel Shim] Polyfill installed');
}
