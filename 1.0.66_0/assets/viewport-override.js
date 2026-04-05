/**
 * Viewport Override Script — runs in the MAIN world
 * Intercepts innerWidth/clientWidth/visualViewport/matchMedia to account
 * for the Claude panel width, so page JS sees a narrower viewport.
 */
(function () {
  'use strict';

  var K = '__claude_vp__';
  if (window[K]) return;

  window[K] = { reduction: 0 };

  function findDesc(obj, prop) {
    var cur = obj;
    while (cur) {
      try {
        var d = Object.getOwnPropertyDescriptor(cur, prop);
        if (d) return { desc: d, owner: cur };
      } catch (e) {}
      cur = Object.getPrototypeOf(cur);
    }
    return null;
  }

  var iwInfo = findDesc(window, 'innerWidth');
  var cwInfo = findDesc(document.documentElement, 'clientWidth');
  var vvInfo = window.visualViewport ? findDesc(window.visualViewport, 'width') : null;
  var mmInfo = findDesc(window, 'matchMedia');

  var origIWGate = iwInfo && iwInfo.desc.get ? iwInfo.desc.get : null;
  var origIWDesc = iwInfo ? iwInfo.desc : null;
  var origIWOwner = iwInfo ? iwInfo.owner : null;
  var origCWGate = cwInfo && cwInfo.desc.get ? cwInfo.desc.get : null;
  var origVVGate = vvInfo && vvInfo.desc.get ? vvInfo.desc.get : null;
  var origMMValue = mmInfo && mmInfo.desc.value ? mmInfo.desc.value : null;

  function install(reduction) {
    if (window[K].reduction === reduction) return;
    window[K].reduction = reduction;

    if (origIWGate) {
      Object.defineProperty(window, 'innerWidth', {
        get: function () { return origIWGate.call(window) - window[K].reduction; },
        configurable: true, enumerable: true,
      });
    }

    if (origCWGate) {
      Object.defineProperty(document.documentElement, 'clientWidth', {
        get: function () { return origCWGate.call(document.documentElement) - window[K].reduction; },
        configurable: true, enumerable: true,
      });
      if (document.body) {
        Object.defineProperty(document.body, 'clientWidth', {
          get: function () { return origCWGate.call(document.body) - window[K].reduction; },
          configurable: true, enumerable: true,
        });
      }
    }

    if (origVVGate && window.visualViewport) {
      Object.defineProperty(window.visualViewport, 'width', {
        get: function () { return origVVGate.call(window.visualViewport) - window[K].reduction; },
        configurable: true, enumerable: true,
      });
    }

    if (origMMValue) {
      window.matchMedia = function(query) {
        var adjustedQuery = query.replace(/(min-width|max-width):\s*(\d+)px/g, function(_match, type, val) {
          var newVal = parseInt(val) + window[K].reduction;
          return type + ': ' + newVal + 'px';
        });
        return origMMValue.call(window, adjustedQuery);
      };
    }

    window.dispatchEvent(new Event('resize'));
    [100, 300, 700].forEach(function(ms) {
      setTimeout(function() { window.dispatchEvent(new Event('resize')); }, ms);
    });
  }

  function remove() {
    if (window[K].reduction === 0) return;
    window[K].reduction = 0;

    if (origIWDesc) {
      if (origIWOwner !== window) { try { delete window.innerWidth; } catch (e) {} }
      else { Object.defineProperty(window, 'innerWidth', origIWDesc); }
    }
    if (origMMValue) window.matchMedia = origMMValue;
    try { delete document.documentElement.clientWidth; } catch (e) {}

    window.dispatchEvent(new Event('resize'));
  }

  function handleAttr() {
    var val = document.documentElement.getAttribute('data-claude-vp-width');
    if (val && parseInt(val) > 0) install(parseInt(val));
    else remove();
  }

  var observer = new MutationObserver(handleAttr);
  if (document.documentElement) {
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-claude-vp-width'] });
    handleAttr();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-claude-vp-width'] });
      handleAttr();
    });
  }
})();
