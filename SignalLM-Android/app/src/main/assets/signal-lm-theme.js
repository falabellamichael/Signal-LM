(function () {
  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function normalizePreference(preference) {
    return preference || readSettings().theme || 'system';
  }

  function resolveTheme(preference) {
    const pref = normalizePreference(preference);
    if (pref === 'dark' || pref === 'midnight' || pref === 'classic-dark') return 'dark';
    if (pref === 'light') return 'light';
    return media && media.matches ? 'dark' : 'light';
  }

  function resolveVariant(preference, resolved) {
    const pref = normalizePreference(preference);
    if (resolved !== 'dark') return '';
    if (pref === 'classic-dark') return 'classic-dark';
    return 'midnight';
  }

  function applyTheme(preference) {
    const settings = readSettings();
    const pref = normalizePreference(preference || settings.theme);
    const resolved = resolveTheme(pref);
    const variant = resolveVariant(pref, resolved);
    document.documentElement.dataset.themePreference = pref;
    document.documentElement.dataset.theme = resolved;
    if (variant) document.documentElement.dataset.themeVariant = variant;
    else delete document.documentElement.dataset.themeVariant;
    document.documentElement.style.colorScheme = resolved;
    document.documentElement.style.backgroundColor = resolved === 'dark' ? '#090a0d' : '';
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = pref; });
    document.querySelectorAll('[data-theme-label]').forEach(label => {
      label.textContent = resolved === 'dark' ? (variant === 'classic-dark' ? 'Classic Dark' : 'Midnight') : 'Light';
    });
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = resolved === 'dark' ? (variant === 'classic-dark' ? '#0f0f11' : '#090a0d') : '#f5f3ef';
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
