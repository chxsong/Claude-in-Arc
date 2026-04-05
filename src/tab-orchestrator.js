/**
 * Tab Orchestrator — Arc Folder Cross-Tab Collaboration
 *
 * Runs in the service worker. Enables Claude to interact with
 * multiple tabs that share the same Arc folder (tab group).
 */

// ─── State ───
const groupConnections = new Map(); // groupId -> Set<port>
const tabGroupMap = new Map();      // tabId -> groupId

// ─── Group Discovery ───

async function getTabGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.groupId !== undefined && tab.groupId !== -1 ? tab.groupId : null;
  } catch (e) {
    return null;
  }
}

async function getGroupTabs(groupId) {
  if (groupId === null || groupId === -1) return [];
  try {
    return await chrome.tabs.query({ groupId });
  } catch (e) {
    return [];
  }
}

async function getGroupInfo(groupId) {
  if (groupId === null || groupId === -1) return null;
  try {
    const group = await chrome.tabGroups.get(groupId);
    return { id: group.id, title: group.title || "(unnamed)", color: group.color };
  } catch (e) {
    return null;
  }
}

// ─── Cross-Tab Messaging ───

async function broadcastToGroup(groupId, message, excludeTabId) {
  const tabs = await getGroupTabs(groupId);
  const results = [];
  for (const tab of tabs) {
    if (tab.id === excludeTabId) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      results.push({ tabId: tab.id, url: tab.url, title: tab.title, response });
    } catch (e) {
      // Tab may not have content script loaded
      results.push({ tabId: tab.id, url: tab.url, title: tab.title, error: e.message });
    }
  }
  return results;
}

// ─── Page Content Extraction ───

async function getPageContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Extract meaningful page content
        const title = document.title;
        const url = window.location.href;
        const meta = document.querySelector('meta[name="description"]')?.content || "";

        // Get visible text, limited to avoid huge payloads
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              const tag = parent.tagName;
              if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(tag)) return NodeFilter.FILTER_REJECT;
              if (parent.offsetParent === null && tag !== "BODY") return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        const textParts = [];
        let totalLength = 0;
        const MAX_LENGTH = 8000;
        while (walker.nextNode()) {
          const text = walker.currentNode.textContent.trim();
          if (text.length < 2) continue;
          if (totalLength + text.length > MAX_LENGTH) break;
          textParts.push(text);
          totalLength += text.length;
        }

        return { title, url, meta, text: textParts.join("\n") };
      }
    });
    return results[0]?.result || null;
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Tab Actions ───

async function navigateTab(tabId, url) {
  try {
    await chrome.tabs.update(tabId, { url });
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

async function executeOnTab(tabId, code) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: new Function(code)
    });
    return { result: results[0]?.result };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Message Handler ───

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.type || !message.type.startsWith("TAB_ORCH_")) return false;

  const handle = async () => {
    const senderTabId = sender.tab?.id;
    const groupId = senderTabId ? await getTabGroup(senderTabId) : null;

    switch (message.type) {
      case "TAB_ORCH_LIST_GROUP_TABS": {
        const gid = message.groupId || groupId;
        if (!gid) return { error: "Tab is not in a group/folder" };
        const [tabs, info] = await Promise.all([getGroupTabs(gid), getGroupInfo(gid)]);
        return {
          group: info,
          tabs: tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: t.active,
            isSelf: t.id === senderTabId
          }))
        };
      }

      case "TAB_ORCH_GET_PAGE_CONTENT": {
        const targetTabId = message.tabId;
        if (!targetTabId) return { error: "No tabId specified" };
        return await getPageContent(targetTabId);
      }

      case "TAB_ORCH_GET_ALL_GROUP_CONTENT": {
        const gid = message.groupId || groupId;
        if (!gid) return { error: "Tab is not in a group/folder" };
        const tabs = await getGroupTabs(gid);
        const contents = await Promise.all(
          tabs.filter(t => t.id !== senderTabId).map(async t => ({
            tabId: t.id,
            title: t.title,
            url: t.url,
            content: await getPageContent(t.id)
          }))
        );
        return { tabs: contents };
      }

      case "TAB_ORCH_BROADCAST": {
        const gid = message.groupId || groupId;
        if (!gid) return { error: "Tab is not in a group/folder" };
        return await broadcastToGroup(gid, {
          type: "TAB_ORCH_GROUP_MESSAGE",
          from: senderTabId,
          data: message.data
        }, senderTabId);
      }

      case "TAB_ORCH_NAVIGATE": {
        return await navigateTab(message.tabId, message.url);
      }

      case "TAB_ORCH_FOCUS": {
        return await focusTab(message.tabId);
      }

      case "TAB_ORCH_EXECUTE": {
        return await executeOnTab(message.tabId, message.code);
      }

      default:
        return { error: `Unknown orchestrator command: ${message.type}` };
    }
  };

  handle().then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true; // Keep channel open for async response
});

// ─── Track group membership changes ───
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.groupId !== undefined) {
    const oldGroup = tabGroupMap.get(tabId);
    tabGroupMap.set(tabId, changeInfo.groupId);
    // Notify the panel about group changes
    chrome.tabs.sendMessage(tabId, {
      type: "TAB_ORCH_GROUP_CHANGED",
      oldGroupId: oldGroup || -1,
      newGroupId: changeInfo.groupId
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabGroupMap.delete(tabId);
});
