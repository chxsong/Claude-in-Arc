document.addEventListener('keydown', (e) => {
  const modifier = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
  if (modifier && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    window.parent.postMessage({ type: 'CLAUDE_ARC_TOGGLE_PANEL' }, '*');
  }
}, true);
