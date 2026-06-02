(function () {
  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const THEME_OPTIONS = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Midnight'],
    ['classic-dark', 'Classic Dark'],
    ['matrix', 'Matrix']
  ];

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function normalizePreference(preference) {
    const pref = preference || readSettings().theme || 'system';
    return pref === 'midnight' ? 'dark' : pref;
  }

  function resolveTheme(preference) {
    const pref = normalizePreference(preference);
    if (pref === 'dark' || pref === 'classic-dark' || pref === 'matrix') return 'dark';
    if (pref === 'light') return 'light';
    return media && media.matches ? 'dark' : 'light';
  }

  function resolveVariant(preference, resolved) {
    const pref = normalizePreference(preference);
    if (resolved !== 'dark') return '';
    if (pref === 'classic-dark') return 'classic-dark';
    if (pref === 'matrix') return 'matrix';
    return 'midnight';
  }

  function getThemeLabel(resolved, variant) {
    if (resolved !== 'dark') return 'Light';
    if (variant === 'classic-dark') return 'Classic Dark';
    if (variant === 'matrix') return 'Matrix';
    return 'Midnight';
  }

  function getThemeColor(resolved, variant) {
    if (resolved !== 'dark') return '#f5f3ef';
    if (variant === 'classic-dark') return '#0f0f11';
    if (variant === 'matrix') return '#001106';
    return '#090a0d';
  }

  function ensureThemeOptions() {
    document.querySelectorAll('[data-theme-select]').forEach(select => {
      const current = select.value || normalizePreference();
      select.innerHTML = '';
      THEME_OPTIONS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
      select.value = current === 'midnight' ? 'dark' : current;
    });
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
    const themeColor = getThemeColor(resolved, variant);
    document.documentElement.style.colorScheme = resolved === 'dark' ? 'dark' : 'light';
    document.documentElement.style.backgroundColor = resolved === 'dark' ? themeColor : '';
    ensureThemeOptions();
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = pref; });
    document.querySelectorAll('[data-theme-label]').forEach(label => {
      label.textContent = getThemeLabel(resolved, variant);
    });
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = themeColor;
    return resolved;
  }

  function setTheme(preference) {
    const settings = readSettings();
    settings.theme = normalizePreference(preference || 'system');
    writeSettings(settings);
    applyTheme(settings.theme);
  }

  function toggleTheme() {
    const current = applyTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  window.LmStudioLiteTheme = { readSettings, writeSettings, resolveTheme, resolveVariant, applyTheme, setTheme, toggleTheme };
  applyTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyTheme());
  else applyTheme();
  if (media && media.addEventListener) media.addEventListener('change', () => applyTheme());
  window.addEventListener('storage', event => { if (event.key === SETTINGS_KEY) applyTheme(); });
})();
