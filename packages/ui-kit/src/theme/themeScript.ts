const STORAGE_KEY = 'opsninja.theme';

export const themeScript: string = `(function(){
  'use strict';
  var key = '${STORAGE_KEY}';
  var stored;
  try { stored = localStorage.getItem(key); } catch (_e) {}
  var valid = ['light', 'dark'];
  var choice = valid.indexOf(stored) !== -1 ? stored : 'system';
  var resolved;
  if (choice === 'system') {
    try {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_e) {
      resolved = 'light';
    }
  } else {
    resolved = choice;
  }
  try {
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (_e) {}
})();`;
