/**
 * Claude Panel Injector for Arc Browser
 */
(function () {
  "use strict";
  
  if (window.top !== window.self) return;

  const LOG_PREFIX = "%c[Claude Panel Injector]";
  const LOG_STYLE = "color: #bf7044; font-weight: bold; background: #fdf6f2; padding: 2px 4px; border-radius: 4px;";
  function debugLog(msg, ...args) {
    console.log(LOG_PREFIX, LOG_STYLE, msg, ...args);
  }

  if (document.getElementById("claude-arc-panel-host")) {
    debugLog("Panel already exists. Skipping injection.");
    return;
  }

  debugLog("Initializing Panel Injector (v4.1)...");

  function extOk() {
    try { return !!chrome?.runtime?.id; } catch (e) { return false; }
  }

  const PANEL_WIDTH_DEFAULT = 420;
  const PANEL_MIN_WIDTH = 320;
  const PANEL_MAX_WIDTH = 700;
  const ANIMATION_DURATION = 250;
  const STORAGE_KEY = "claude_arc_panel_state";
  const MIN_PAGE_WIDTH = 500;

  let panelVisible = false;
  let panelWidth = PANEL_WIDTH_DEFAULT;
  let currentTabId = null;
  let squeezed = false;
  let currentZoom = 1;

  function updateZoom(newZoomFactor) {
    if (currentZoom === newZoomFactor) return;
    currentZoom = newZoomFactor;
    if (hostEl) {
      hostEl.style.setProperty("--claude-zoom", String(1 / currentZoom));
      hostEl.style.setProperty("width", panelWidth + "px", "important");
      if (panelVisible) applyLayoutSqueeze(panelWidth / currentZoom);
    }
  }

  // ─── Shared Style for Layout Squeeze ───
  const squeezeStyle = document.createElement("style");
  squeezeStyle.id = "claude-squeeze-style";
  document.documentElement.appendChild(squeezeStyle);

  function updateSqueezeCSS(width) {
    if (width === 0) {
      squeezeStyle.textContent = "";
      return;
    }

    squeezeStyle.textContent = `
      html[data-claude-panel-open] body {
        padding-right: ${width}px !important;
        box-sizing: border-box !important;
        max-width: 100vw !important;
      }

      /* YouTube */
      html[data-claude-panel-open] #masthead-container,
      html[data-claude-panel-open] #page-manager {
        width: calc(100% - ${width}px) !important;
        max-width: calc(100% - ${width}px) !important;
      }

      /* Google Search */
      html[data-claude-panel-open] #searchform,
      html[data-claude-panel-open] #rcnt,
      html[data-claude-panel-open] #appbar,
      html[data-claude-panel-open] #hdtb-tls,
      html[data-claude-panel-open] #top_nav,
      html[data-claude-panel-open] .sfbg {
        max-width: calc(100% - ${width}px) !important;
      }
    `;
  }

  function setViewportOverride(width) {
    debugLog(`Setting viewport override attribute: ${width}`);
    document.documentElement.setAttribute("data-claude-vp-width", String(width));
    document.documentElement.setAttribute("data-claude-panel-open", "");
    updateSqueezeCSS(width);
  }

  function clearViewportOverride() {
    debugLog("Clearing viewport override attribute.");
    document.documentElement.removeAttribute("data-claude-vp-width");
    document.documentElement.removeAttribute("data-claude-panel-open");
    updateSqueezeCSS(0);
  }

  const modifiedFixedElements = new WeakMap();

  const hostEl = document.createElement("div");
  hostEl.id = "claude-arc-panel-host";
  hostEl.style.cssText = `
    all: initial !important;
    position: fixed !important; top: 0 !important; bottom: 0 !important; right: -${PANEL_MAX_WIDTH}px !important;
    width: ${PANEL_WIDTH_DEFAULT}px !important; height: auto !important; max-height: 100% !important;
    z-index: 2147483645 !important; display: none !important;
    transition: right ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
    margin: 0 !important; padding: 0 !important; box-sizing: content-box !important; border: none !important;
    zoom: var(--claude-zoom, 1) !important;
  `;

  const shadow = hostEl.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; font-family: -apple-system, sans-serif; }
    .container { position: relative; width: 100%; height: 100%; display: flex; background: #f9f9f8; border-left: 1px solid rgba(0,0,0,0.08); box-shadow: -2px 0 8px rgba(0,0,0,0.06); }
    .handle { position: absolute; left: -3px; top: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 10; }
    .iframe { width: 100%; height: 100%; border: none; }
  `;

  const container = document.createElement("div");
  container.className = "container";
  const handle = document.createElement("div");
  handle.className = "handle";
  const iframe = document.createElement("iframe");
  iframe.className = "iframe";
  iframe.setAttribute("allow", "clipboard-write; clipboard-read");

  container.appendChild(handle);
  container.appendChild(iframe);
  shadow.appendChild(style);
  shadow.appendChild(container);

  document.documentElement.appendChild(hostEl);

  let isResizing = false;
  handle.onmousedown = (e) => { e.preventDefault(); isResizing = true; };
  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const cssWidth = window.innerWidth - e.clientX;
    const physicalWidth = cssWidth * currentZoom;
    if (physicalWidth >= PANEL_MIN_WIDTH && physicalWidth <= PANEL_MAX_WIDTH) {
      panelWidth = physicalWidth;
      hostEl.style.setProperty("width", panelWidth + "px", "important");
      if (panelVisible) applyLayoutSqueeze(panelWidth / currentZoom);
    }
  });
  document.addEventListener("mouseup", () => { if (isResizing) { isResizing = false; savePanelState(); } });

  function applyLayoutSqueeze(width) {
    if (!document.body) return;
    debugLog(`Applying layout squeeze: ${width}px`);
    squeezed = true;
    setViewportOverride(width);
    fixFixedElements(width);
    window.dispatchEvent(new Event("resize"));
  }

  function removeLayoutSqueeze() {
    if (!squeezed) return;
    debugLog("Removing layout squeeze.");
    clearViewportOverride();
    squeezed = false;
    restoreFixedElements();
    window.dispatchEvent(new Event("resize"));
  }

  function fixFixedElements(width) {
    if (!document.body) return;
    restoreFixedElements();
    
    // Some elements take a fraction of a second to render (like Google header bars)
    // We adjust them immediately, and queue a second pass.
    applyFixToElements(width);
    setTimeout(() => applyFixToElements(width), 100);
  }

  function applyFixToElements(width) {
    const all = document.querySelectorAll("*");
    let count = 0;
    const EXCLUDED_IDS = new Set(["masthead-container", "page-manager", "claude-arc-panel-host", "claude-squeeze-style"]);
    const innerWidth = window.innerWidth;

    for (const node of all) {
      if (node === hostEl || hostEl.contains(node)) continue;
      if (node.id && EXCLUDED_IDS.has(node.id)) continue;
      
      const s = getComputedStyle(node);
      const pos = s.position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // Skip hidden

      // Criteria for elements that need adjustment:
      // 1. Spans the entire screen (or close to it)
      const isFullWidth = r.width >= innerWidth * 0.95;
      // 2. Explicitly anchored to the right side of the screen
      const anchoredRight = s.right !== "auto" && parseInt(s.right) < 100;
      // 3. Just naturally overlapping into our panel's designated space
      const overlapsPanel = r.right > (innerWidth - width + 10);

      if (!isFullWidth && !anchoredRight && !overlapsPanel) continue;
      if (modifiedFixedElements.has(node)) continue; // Already fixed in this cycle

      count++;
      const orig = { 
        right: node.style.getPropertyValue("right"), 
        maxWidth: node.style.getPropertyValue("max-width"), 
        transition: node.style.transition 
      };
      modifiedFixedElements.set(node, orig);
      
      node.style.transition = `${orig.transition ? orig.transition + ', ' : ''}right ${ANIMATION_DURATION}ms, max-width ${ANIMATION_DURATION}ms`;
      
      if (isFullWidth || s.width === "100%" || s.width === "100vw") {
        // Shrink the element so it doesn't bleed into the panel
        node.style.setProperty("max-width", `calc(100vw - ${width}px)`, "important");
      } else {
        // Shift the element left
        const curRight = parseInt(s.right) || 0;
        node.style.setProperty("right", (curRight + width) + "px", "important");
      }
    }
    if (count > 0) debugLog(`Adjusted ${count} fixed elements.`);
  }

  function restoreFixedElements() {
    for (const [node, orig] of modifiedFixedElements.entries()) {
      if (orig.right) {
        node.style.setProperty("right", orig.right);
      } else {
        node.style.removeProperty("right");
      }
      
      if (orig.maxWidth) {
        node.style.setProperty("max-width", orig.maxWidth);
      } else {
        node.style.removeProperty("max-width");
      }
      
      setTimeout(() => { try { node.style.transition = orig.transition; } catch(e){} }, ANIMATION_DURATION);
    }
    modifiedFixedElements.clear();
  }

  if (extOk()) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "TOGGLE_INJECTED_PANEL") {
        if (panelVisible) hidePanel(); else showPanel(msg.tabId);
        sendResponse({ success: true, visible: panelVisible });
        return false; // synchronous
      } else if (msg.type === "CLAUDE_ARC_ZOOM_CHANGED") {
        if (msg.zoom) updateZoom(msg.zoom);
        return false; // synchronous
      }
    });

    // Fetch initial zoom
    try {
      chrome.runtime.sendMessage({ type: "CLAUDE_ARC_GET_ZOOM" }, (response) => {
        if (!chrome.runtime.lastError && response && response.zoom) {
          updateZoom(response.zoom);
        }
      });
    } catch(e) { debugLog("Initial zoom fetch failed:", e.message); }
  }

  function showPanel(tabId) {
    if (panelVisible) return;
    panelVisible = true;
    currentTabId = tabId;
    if (extOk()) iframe.src = chrome.runtime.getURL(`sidepanel.html?tabId=${tabId}&mode=injected`);
    hostEl.style.setProperty("display", "block", "important");
    hostEl.offsetHeight; // Force layout reflow
    hostEl.style.setProperty("right", "0px", "important");
    applyLayoutSqueeze(panelWidth / currentZoom);
    savePanelState();
  }

  function hidePanel() {
    if (!panelVisible) return;
    panelVisible = false;
    hostEl.style.setProperty("right", `-${panelWidth}px`, "important");
    removeLayoutSqueeze();
    setTimeout(() => { if (!panelVisible) hostEl.style.setProperty("display", "none", "important"); }, ANIMATION_DURATION);
    savePanelState();
  }

  function savePanelState() {
    if (!extOk()) return;
    try {
      chrome.storage.session.set({ [STORAGE_KEY]: { tabId: currentTabId, visible: panelVisible, width: panelWidth } })
        .catch(e => console.warn("[Claude-Arc] Storage write failed:", e.message));
    } catch(e) { console.warn("[Claude-Arc] Storage access failed:", e.message); }
  }

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "CLAUDE_ARC_TOGGLE_PANEL") {
      if (currentTabId) {
        if (panelVisible) hidePanel();
        else showPanel(currentTabId);
      } else if (extOk()) {
        try {
          chrome.runtime.sendMessage({ type: "CLAUDE_ARC_GET_TAB_ID" }).then(r => {
            if (r && r.tabId) { currentTabId = r.tabId; if (panelVisible) hidePanel(); else showPanel(r.tabId); }
          }).catch(e => debugLog("Tab ID fetch failed:", e.message));
        } catch(e) { debugLog("Runtime message failed:", e.message); }
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    const modifier = navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
    if (modifier && e.key.toLowerCase() === "e") {
      e.preventDefault();
      if (currentTabId) { if (panelVisible) hidePanel(); else showPanel(currentTabId); }
      else if (extOk()) {
        try {
          chrome.runtime.sendMessage({ type: "CLAUDE_ARC_GET_TAB_ID" }).then(r => {
            if (r && r.tabId) { currentTabId = r.tabId; if (panelVisible) hidePanel(); else showPanel(r.tabId); }
          }).catch(e => debugLog("Tab ID fetch failed:", e.message));
        } catch(e) { debugLog("Runtime message failed:", e.message); }
      }
    }
  }, true);

  if (extOk()) {
    try {
      chrome.storage.session.get(STORAGE_KEY).then(r => {
        const s = r[STORAGE_KEY];
        if (s?.visible) { panelWidth = s.width || PANEL_WIDTH_DEFAULT; showPanel(s.tabId); }
      }).catch(e => debugLog("Session restore failed:", e.message));
    } catch(e) { debugLog("Storage access failed:", e.message); }
  }
})();
