(function () {
  if (window.LmStudioLiteTheme) {
    try { window.LmStudioLiteTheme.applyTheme && window.LmStudioLiteTheme.applyTheme(); } catch {}
    return;
  }

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function resolveTheme(preference) {
    const pref = preference || readSettings().theme || 'system';
    if (pref === 'dark' || pref === 'light') return pref;
    return media && media.matches ? 'dark' : 'light';
  }

  function applyTheme(preference) {
    const settings = readSettings();
    const pref = preference || settings.theme || 'system';
    const resolved = resolveTheme(pref);
    document.documentElement.dataset.themePreference = pref;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = pref; });
    document.querySelectorAll('[data-theme-label]').forEach(label => { label.textContent = resolved === 'dark' ? 'Dark' : 'Light'; });
    return resolved;
  }

  function setTheme(preference) {
    const settings = readSettings();
    settings.theme = preference || 'system';
    writeSettings(settings);
    applyTheme(settings.theme);
  }

  function toggleTheme() {
    const current = applyTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  window.LmStudioLiteTheme = { readSettings, writeSettings, resolveTheme, applyTheme, setTheme, toggleTheme };
  applyTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyTheme());
  else applyTheme();
  if (media && media.addEventListener) media.addEventListener('change', () => applyTheme());
  window.addEventListener('storage', event => { if (event.key === SETTINGS_KEY) applyTheme(); });
})();
