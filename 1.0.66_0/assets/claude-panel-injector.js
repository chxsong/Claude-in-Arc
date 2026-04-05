/**
 * Claude Panel Injector for Arc Browser (v0.2)
 * Injects a sidebar iframe overlay for the Claude extension since Arc
 * does not support chrome.sidePanel natively.
 */
(function () {
  'use strict';

  if (window.top !== window.self) return;

  const LOG_PREFIX = '%c[Claude Panel Injector]';
  const LOG_STYLE = 'color: #bf7044; font-weight: bold; background: #fdf6f2; padding: 2px 4px; border-radius: 4px;';
  function debugLog(msg, ...args) {
    console.log(LOG_PREFIX, LOG_STYLE, msg, ...args);
  }
  // #region agent log
  function _agentProbe(hypothesisId, message, data = {}) {
    try {
      const payload = {
        sessionId: '60806f',
        runId: 'ui-detail-debug',
        hypothesisId,
        location: 'claude-panel-injector.js',
        message,
        data,
        timestamp: Date.now()
      };
      if (extOk()) {
        chrome.runtime.sendMessage({
          type: 'CLAUDE_ARC_DEBUG_PROBE',
          hypothesisId,
          message,
          data
        }).catch(() => {});
      }
    } catch (e) {}
  }
  // #endregion

  if (document.getElementById('claude-arc-panel-host')) {
    debugLog('Panel already exists. Skipping injection.');
    return;
  }

  debugLog('Initializing Panel Injector (v0.2)...');

  function extOk() {
    try { return !!chrome?.runtime?.id; } catch (e) { return false; }
  }

  const PANEL_WIDTH_DEFAULT = 420;
  const PANEL_MIN_WIDTH = 320;
  const PANEL_MAX_WIDTH = 700;
  const ANIMATION_DURATION = 250;
  const STORAGE_KEY = 'claude_arc_panel_state';

  let panelVisible = false;
  let panelWidth = PANEL_WIDTH_DEFAULT;
  let currentTabId = null;
  let squeezed = false;
  let currentZoom = 1;
  let _lastToggleTime = 0;

  function updateZoom(newZoomFactor) {
    if (currentZoom === newZoomFactor) return;
    currentZoom = newZoomFactor;
    if (hostEl) {
      hostEl.style.setProperty('--claude-zoom', String(1 / currentZoom));
      hostEl.style.setProperty('width', panelWidth + 'px', 'important');
      if (panelVisible) applyLayoutSqueeze(panelWidth / currentZoom);
    }
  }

  // ─── Shared Style for Layout Squeeze ───
  const squeezeStyle = document.createElement('style');
  squeezeStyle.id = 'claude-squeeze-style';
  document.documentElement.appendChild(squeezeStyle);

  function updateSqueezeCSS(width) {
    if (width === 0) {
      squeezeStyle.textContent = '';
      return;
    }
    squeezeStyle.textContent = `
      html[data-claude-panel-open] body {
        padding-right: ${width}px !important;
        box-sizing: border-box !important;
        max-width: 100vw !important;
        overflow-x: hidden !important;
      }
      html[data-claude-panel-open] #masthead-container,
      html[data-claude-panel-open] #page-manager {
        width: calc(100% - ${width}px) !important;
        max-width: calc(100% - ${width}px) !important;
      }
    `;
  }

  function setViewportOverride(width) {
    document.documentElement.setAttribute('data-claude-vp-width', String(width));
    document.documentElement.setAttribute('data-claude-panel-open', '');
    updateSqueezeCSS(width);
  }

  function clearViewportOverride() {
    document.documentElement.removeAttribute('data-claude-vp-width');
    document.documentElement.removeAttribute('data-claude-panel-open');
    updateSqueezeCSS(0);
  }

  const modifiedFixedElements = new WeakMap();

  const hostEl = document.createElement('div');
  hostEl.id = 'claude-arc-panel-host';
  hostEl.style.cssText = `
    all: initial !important;
    position: fixed !important; top: 0 !important; bottom: 0 !important; right: -${PANEL_MAX_WIDTH}px !important;
    width: ${PANEL_WIDTH_DEFAULT}px !important; height: auto !important; max-height: 100% !important;
    z-index: 2147483645 !important; display: none !important;
    transition: right ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
    margin: 0 !important; padding: 0 !important; box-sizing: content-box !important; border: none !important;
    zoom: var(--claude-zoom, 1) !important;
  `;

  const shadow = hostEl.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; font-family: -apple-system, sans-serif; }
    .container {
      position: relative; width: 100%; height: 100%; display: flex;
      background: #f9f9f8;
      border-left: 1px solid rgba(0,0,0,0.08);
      box-shadow: -2px 0 8px rgba(0,0,0,0.06);
    }
    @media (prefers-color-scheme: dark) {
      .container {
        background: #1a1a1a;
        border-left: 1px solid rgba(255,255,255,0.08);
        box-shadow: -2px 0 8px rgba(0,0,0,0.2);
      }
    }
    .iframe { width: 100%; height: 100%; border: none; }
  `;

  const container = document.createElement('div');
  container.className = 'container';
  const iframe = document.createElement('iframe');
  iframe.className = 'iframe';
  // Permissions Policy: embedded sidepanel needs explicit microphone/camera for Teach Claude + getUserMedia
  iframe.setAttribute(
    'allow',
    'clipboard-write; clipboard-read; microphone; camera; display-capture'
  );
  // #region agent log
  iframe.addEventListener('load', () => {
    _agentProbe('H10', 'panel_iframe_load', {
      src: iframe.src || '',
      pageHost: location.hostname || ''
    });
  });
  iframe.addEventListener('error', () => {
    _agentProbe('H10', 'panel_iframe_error', {
      src: iframe.src || '',
      pageHost: location.hostname || ''
    });
  });
  // #endregion

  container.appendChild(iframe);
  shadow.appendChild(style);
  shadow.appendChild(container);

  document.documentElement.appendChild(hostEl);

  // ─── Layout mode state ───
  let layoutMode = 'squish'; // default

  if (extOk()) {
    try {
      chrome.storage.local.get(['overlayWhitelist'], (result) => {
        const list = result.overlayWhitelist || [];
        if (list.includes(location.hostname)) {
          layoutMode = 'iframe';
        }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.overlayWhitelist) {
          const list = changes.overlayWhitelist.newValue || [];
          const oldMode = layoutMode;
          const newMode = list.includes(location.hostname) ? 'iframe' : 'squish';
          
          if (oldMode === newMode) return;
          
          if (squeezed) {
            if (location.hostname.includes('google.')) {
              layoutMode = newMode;
              location.reload();
              return;
            }
            removeLayoutSqueeze();
            layoutMode = newMode;
            applyLayoutSqueeze(panelWidth / currentZoom);
          } else {
            layoutMode = newMode;
          }
        }
      });
    } catch (e) {}
  }

  // ─── Layout squeeze ───
  function applyLayoutSqueeze(width) {
    if (!document.body) return;
    squeezed = true;

    // #region agent log
    _agentProbe('H11', 'layout_squeeze_applied', {
      width, host: location.hostname
    });
    // #endregion

    if (layoutMode === 'iframe') {
      if (window.location.hostname.includes('google.')) {
        let shell = document.getElementById('claude-google-shell');
        if (!shell) {
          document.body.style.cssText = "margin: 0 !important; padding: 0 !important; overflow: hidden !important; font-size: 0 !important; color: transparent !important;";
          document.body.innerHTML = `\n<iframe id="claude-google-shell" src="${location.href}" style="all: initial !important; width: 100vw !important; height: 100vh !important; border: none !important; margin: 0 !important; padding: 0 !important; display: block !important;"></iframe>`;
          shell = document.getElementById('claude-google-shell');
        }
        shell.style.setProperty("width", `calc(100vw - ${width}px)`, "important");
      }
      return;
    } else {
      setViewportOverride(width);
      fixFixedElements(width);
      window.dispatchEvent(new Event('resize'));
    }
  }

  function removeLayoutSqueeze() {
    if (!squeezed) return;

    if (layoutMode === 'iframe') {
      let shell = document.getElementById('claude-google-shell');
      if (shell) shell.style.setProperty("width", "100%", "important");
      squeezed = false;
      return;
    }

    clearViewportOverride();
    squeezed = false;
    restoreFixedElements();
    window.dispatchEvent(new Event('resize'));
  }

  function fixFixedElements(width) {
    if (!document.body) return;
    restoreFixedElements();
    applyFixToElements(width);
    setTimeout(() => applyFixToElements(width), 100);
  }

  function applyFixToElements(width) {
    const all = document.querySelectorAll('*');
    let count = 0;
    const EXCLUDED_IDS = new Set(['masthead-container', 'page-manager', 'claude-arc-panel-host', 'claude-squeeze-style']);
    const innerWidth = window.innerWidth;

    for (const node of all) {
      if (node === hostEl || hostEl.contains(node)) continue;
      if (node.id && EXCLUDED_IDS.has(node.id)) continue;

      const s = getComputedStyle(node);
      const pos = s.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;

      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const isFullWidth = r.width >= innerWidth * 0.95;
      const anchoredRight = s.right !== 'auto' && parseInt(s.right) < 100;
      const overlapsPanel = r.right > (innerWidth - width + 10);

      if (!isFullWidth && !anchoredRight && !overlapsPanel) continue;
      if (modifiedFixedElements.has(node)) continue;

      count++;
      const orig = {
        right: node.style.getPropertyValue('right'),
        maxWidth: node.style.getPropertyValue('max-width'),
        transition: node.style.transition
      };
      modifiedFixedElements.set(node, orig);

      node.style.transition = `${orig.transition ? orig.transition + ', ' : ''}right ${ANIMATION_DURATION}ms, max-width ${ANIMATION_DURATION}ms`;

      if (isFullWidth || s.width === '100%' || s.width === '100vw') {
        node.style.setProperty('max-width', `calc(100vw - ${width}px)`, 'important');
      } else {
        const curRight = parseInt(s.right) || 0;
        node.style.setProperty('right', (curRight + width) + 'px', 'important');
      }
    }
    if (count > 0) debugLog(`Adjusted ${count} fixed elements.`);
  }

  function restoreFixedElements() {
    for (const [node, orig] of modifiedFixedElements.entries()) {
      if (orig.right) node.style.setProperty('right', orig.right);
      else node.style.removeProperty('right');
      if (orig.maxWidth) node.style.setProperty('max-width', orig.maxWidth);
      else node.style.removeProperty('max-width');
      setTimeout(() => { try { node.style.transition = orig.transition; } catch(e){} }, ANIMATION_DURATION);
    }
    modifiedFixedElements.clear();
  }

  // ─── Panel show/hide ───
  function showPanel(tabId) {
    if (panelVisible) return;
    panelVisible = true;
    currentTabId = tabId;
    _agentProbe('H10', 'show_panel_called', {
      tabId: tabId || null,
      pageHost: location.hostname || ''
    });
    if (extOk()) iframe.src = chrome.runtime.getURL(`sidepanel.html?tabId=${tabId}&mode=injected`);
    // #region agent log
    try {
      if (extOk()) {
        chrome.runtime.sendMessage({
          type: 'CLAUDE_ARC_DEBUG_PANEL',
          data: {
            allow: iframe.getAttribute('allow') || '',
            tabId: tabId,
            pageHost: (typeof location !== 'undefined' && location.hostname) ? location.hostname : ''
          }
        }).catch(() => {});
      }
    } catch (e) {}
    // #endregion
    hostEl.style.setProperty('display', 'block', 'important');
    hostEl.offsetHeight;
    hostEl.style.setProperty('right', '0px', 'important');
    applyLayoutSqueeze(panelWidth / currentZoom);
    savePanelState();
  }

  function hidePanel() {
    if (!panelVisible) return;
    panelVisible = false;
    hostEl.style.setProperty('right', `-${panelWidth}px`, 'important');
    removeLayoutSqueeze();
    setTimeout(() => { if (!panelVisible) hostEl.style.setProperty('display', 'none', 'important'); }, ANIMATION_DURATION);
    savePanelState();
  }

  function savePanelState() {
    if (!extOk()) return;
    try {
      chrome.storage.session.set({ [STORAGE_KEY]: { tabId: currentTabId, visible: panelVisible, width: panelWidth } }).catch(()=>{});
    } catch(e) {}
  }

  // ─── Message handlers ───
  if (extOk()) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'TOGGLE_INJECTED_PANEL') {
        const now = Date.now();
        if (now - _lastToggleTime < 300) {
          sendResponse({ success: false, debounced: true, visible: panelVisible });
          return false;
        }
        _lastToggleTime = now;
        if (panelVisible) hidePanel(); else showPanel(msg.tabId);
        sendResponse({ success: true, visible: panelVisible });
        return false;
      }

      if (msg.type === 'SHOW_INJECTED_PANEL') {
        const now = Date.now();
        if (now - _lastToggleTime < 300) {
          sendResponse({ success: true, ignored: true, visible: panelVisible });
          return false;
        }
        if (!panelVisible) showPanel(msg.tabId);
        sendResponse({ success: true, visible: panelVisible });
        return false;
      }

      if (msg.type === 'HIDE_INJECTED_PANEL') {
        if (panelVisible) hidePanel();
        sendResponse({ success: true, visible: panelVisible });
        return false;
      }

      if (msg.type === 'QUERY_PANEL_STATE') {
        sendResponse({ visible: panelVisible, width: panelWidth, tabId: currentTabId });
        return false;
      }

      if (msg.type === 'CLAUDE_ARC_ZOOM_CHANGED') {
        if (msg.zoom) updateZoom(msg.zoom);
        return false;
      }
    });

    try {
      chrome.runtime.sendMessage({ type: 'CLAUDE_ARC_GET_ZOOM' }, (response) => {
        if (!chrome.runtime.lastError && response?.zoom) updateZoom(response.zoom);
      });
    } catch(e){}
  }

  // ─── Window message (from iframe cmd-e-fallback) ───
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'CLAUDE_ARC_TOGGLE_PANEL') {
      if (currentTabId) {
        if (panelVisible) hidePanel(); else showPanel(currentTabId);
      } else if (extOk()) {
        try {
          chrome.runtime.sendMessage({ type: 'CLAUDE_ARC_GET_TAB_ID' }).then(r => {
            if (r?.tabId) { currentTabId = r.tabId; if (panelVisible) hidePanel(); else showPanel(r.tabId); }
          }).catch(()=>{});
        } catch(e) {}
      }
    }
  });

  // ─── Keyboard shortcut fallback (if extension command is not captured) ───
  document.addEventListener('keydown', (e) => {
    const modifier = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
    if (modifier && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      if (currentTabId) {
        if (panelVisible) hidePanel(); else showPanel(currentTabId);
      } else if (extOk()) {
        try {
          chrome.runtime.sendMessage({ type: 'CLAUDE_ARC_GET_TAB_ID' }).then(r => {
            if (r?.tabId) { currentTabId = r.tabId; if (panelVisible) hidePanel(); else showPanel(r.tabId); }
          }).catch(() => {});
        } catch(e2) {}
      }
    }
  }, true);

  // ─── Restore state on injection ───
  if (extOk()) {
    try {
      chrome.storage.session.get(STORAGE_KEY).then(r => {
        const s = r[STORAGE_KEY];
        if (s?.visible) { panelWidth = s.width || PANEL_WIDTH_DEFAULT; showPanel(s.tabId); }
      }).catch(()=>{});
    } catch(e) {}
  }
})();
