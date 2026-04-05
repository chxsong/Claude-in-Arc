(function () {
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

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-mode', isDark ? 'dark' : 'light');
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => {
      document.documentElement.setAttribute(
        'data-mode',
        e.matches ? 'dark' : 'light'
      );
    });
})();
