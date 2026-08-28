/**
 * Arc Adapter — Desktop-triggered browser operations
 * Listens for commands arriving via native messaging (relayed through
 * the official service worker's native messaging port) and translates
 * them into chrome.tabs / chrome.windows API calls.
 *
 * Commands are also exposed to internal extension messaging so the
 * side panel UI or other components can invoke them.
 */

const ARC_ADAPTER_VERSION = '0.2.0';

const CAPABILITIES = {
  tabs: typeof chrome.tabs?.create === 'function',
  windows: typeof chrome.windows?.create === 'function',
  tabGroups: typeof chrome.tabs?.group === 'function',
  scripting: typeof chrome.scripting?.executeScript === 'function',
  screenshots: typeof chrome.tabs?.captureVisibleTab === 'function',
  debugger: typeof chrome.debugger?.attach === 'function'
};

async function handleCommand(command) {
  const { action, params = {} } = command;

  switch (action) {
    case 'open_tab': {
      if (!CAPABILITIES.tabs) return { error: 'tabs API unavailable' };
      const tab = await chrome.tabs.create({
        url: params.url || 'about:blank',
        active: params.active !== false,
        windowId: params.windowId
      });
      return { success: true, tabId: tab.id, windowId: tab.windowId };
    }

    case 'navigate': {
      if (!CAPABILITIES.tabs) return { error: 'tabs API unavailable' };
      const tab = await chrome.tabs.update(params.tabId, { url: params.url });
      return { success: true, tabId: tab.id };
    }

    case 'focus_tab': {
      if (!CAPABILITIES.tabs) return { error: 'tabs API unavailable' };
      await chrome.tabs.update(params.tabId, { active: true });
      if (params.windowId) {
        await chrome.windows.update(params.windowId, { focused: true });
      }
      return { success: true };
    }

    case 'close_tab': {
      if (!CAPABILITIES.tabs) return { error: 'tabs API unavailable' };
      await chrome.tabs.remove(params.tabId);
      return { success: true };
    }

    case 'list_tabs': {
      if (!CAPABILITIES.tabs) return { error: 'tabs API unavailable' };
      const queryOpts = {};
      if (params.windowId) queryOpts.windowId = params.windowId;
      if (params.active !== undefined) queryOpts.active = params.active;
      if (params.url) queryOpts.url = params.url;
      const tabs = await chrome.tabs.query(queryOpts);
      return {
        success: true,
        tabs: tabs.map(t => ({
          id: t.id,
          windowId: t.windowId,
          url: t.url,
          title: t.title,
          active: t.active,
          index: t.index,
          groupId: t.groupId
        }))
      };
    }

    case 'create_window': {
      if (!CAPABILITIES.windows) return { error: 'windows API unavailable' };
      const win = await chrome.windows.create({
        url: params.url,
        type: params.type || 'normal',
        focused: params.focused !== false,
        width: params.width,
        height: params.height
      });
      return { success: true, windowId: win.id, tabs: win.tabs?.map(t => t.id) };
    }

    case 'take_screenshot': {
      if (!CAPABILITIES.screenshots) return { error: 'screenshot API unavailable' };
      const dataUrl = await chrome.tabs.captureVisibleTab(
        params.windowId || null,
        { format: params.format || 'png', quality: params.quality }
      );
      return { success: true, dataUrl };
    }

    case 'execute_script': {
      if (!CAPABILITIES.scripting) return { error: 'scripting API unavailable' };
      if (!params.tabId || !params.code) return { error: 'tabId and code required' };
      const results = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        func: new Function(params.code),
        world: params.world || 'ISOLATED'
      });
      return { success: true, results: results.map(r => r.result) };
    }

    case 'get_capabilities': {
      return { success: true, capabilities: CAPABILITIES, version: ARC_ADAPTER_VERSION };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'CLAUDE_ARC_COMMAND') return;

  handleCommand(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ error: e.message }));
  return true;
});

chrome.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  if (!sender.url?.startsWith('https://claude.ai')) return;
  if (msg.type !== 'CLAUDE_ARC_COMMAND') return;

  handleCommand(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ error: e.message }));
  return true;
});

console.log(`[Arc Adapter] v${ARC_ADAPTER_VERSION} loaded. Capabilities:`,
  Object.entries(CAPABILITIES).filter(([,v]) => v).map(([k]) => k).join(', '));
