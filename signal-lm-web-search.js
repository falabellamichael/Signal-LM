(function () {
  if (window.SignalLMWebSearch) return;

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const MAX_RESULTS = 6;

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function saveWebSettings(next) {
    const settings = readSettings();
    Object.assign(settings, next || {});
    writeSettings(settings);
    return settings;
  }

  function enabled() {
    return readSettings().webSearchEnabled !== false;
  }

  function autoEnabled() {
    return readSettings().webSearchAuto !== false;
  }

  function cleanQuery(text) {
    return String(text || '')
      .replace(/^\s*\/(web|search|ddg|browser)\s+/i, '')
      .replace(/\b(search|look up|duckduckgo|browse|web search)\b:?/ig, '')
      .trim();
  }

  function explicitSearchRequested(text) {
    return /^\s*\/(web|search|ddg|browser)\s+/i.test(String(text || ''));
  }

  function autoSearchRequested(text) {
    return /\b(search the web|web search|look up|browse|duckduckgo|latest|current|currently|today|recent|news|price|release date|version|schedule|weather|stock|who is the current|what is the current)\b/i.test(String(text || ''));
  }

  function shouldSearch(text) {
    if (!enabled()) return false;
    return explicitSearchRequested(text) || (autoEnabled() && autoSearchRequested(text));
  }

  function resultUrl(query) {
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
  }

  function apiUrl(query) {
    return 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
  }

  function getNativeBridge() {
    return window.SignalLMNativeBridge || window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidInferenceBridge || null;
  }

  async function nativeGet(url) {
    const bridge = getNativeBridge();
    if (!bridge || !(bridge.httpRequest || bridge.request || bridge.fetchJson)) throw new Error('Native HTTP bridge unavailable.');
    const payload = JSON.stringify({ url, method: 'GET', headers: {}, body: null });
    const raw = await (bridge.httpRequest ? bridge.httpRequest(payload) : bridge.request ? bridge.request(payload) : bridge.fetchJson(payload));
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || parsed.error) throw new Error(parsed && parsed.error ? parsed.error : 'Native HTTP request failed.');
    if ((parsed.status || 200) < 200 || (parsed.status || 200) >= 300) throw new Error('HTTP ' + parsed.status);
    return parsed.body || '';
  }

  async function browserGet(url) {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.text();
  }

  async function getText(url) {
    try { return await nativeGet(url); }
    catch { return await browserGet(url); }
  }

  function compact(value, max = 420) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
  }

  function parseDuckDuckGo(payload, query) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const results = [];

    if (data.AbstractText) {
      results.push({ title: data.Heading || query, snippet: compact(data.AbstractText), url: data.AbstractURL || resultUrl(query) });
    }

    function collect(items) {
      (items || []).forEach(item => {
        if (results.length >= MAX_RESULTS) return;
        if (Array.isArray(item.Topics)) return collect(item.Topics);
        if (!item.Text && !item.FirstURL) return;
        results.push({ title: compact(item.Text || item.FirstURL, 90), snippet: compact(item.Text || ''), url: item.FirstURL || resultUrl(query) });
      });
    }

    collect(data.RelatedTopics || []);
    if (!results.length && data.Answer) results.push({ title: query, snippet: compact(data.Answer), url: resultUrl(query) });
    return { query, source: 'DuckDuckGo', url: resultUrl(query), results: results.slice(0, MAX_RESULTS) };
  }

  async function search(query) {
    const clean = cleanQuery(query);
    if (!clean) throw new Error('Search query is empty.');
    try {
      const text = await getText(apiUrl(clean));
      const parsed = parseDuckDuckGo(text, clean);
      return parsed.results.length ? parsed : { query: clean, source: 'DuckDuckGo', url: resultUrl(clean), results: [] };
    } catch (error) {
      return { query: clean, source: 'DuckDuckGo browser fallback', url: resultUrl(clean), results: [], error: error.message || String(error) };
    }
  }

  function formatForPrompt(payload) {
    if (!payload) return '';
    const lines = ['[BUILT-IN WEB SEARCH]', 'Provider: ' + payload.source, 'Query: ' + payload.query, 'Search URL: ' + payload.url];
    if (payload.error) lines.push('Fetch note: ' + payload.error);
    if (!payload.results.length) lines.push('No instant-answer snippets were returned. Use the search URL as the browser fallback reference.');
    else {
      lines.push('Results:');
      payload.results.forEach((item, index) => {
        lines.push((index + 1) + '. ' + item.title);
        if (item.snippet) lines.push('   ' + item.snippet);
        if (item.url) lines.push('   ' + item.url);
      });
    }
    lines.push('[END BUILT-IN WEB SEARCH]');
    return lines.join('\n');
  }

  async function buildContextForText(text) {
    if (!shouldSearch(text)) return '';
    return formatForPrompt(await search(cleanQuery(text)));
  }

  function openSearch(text) {
    const url = resultUrl(cleanQuery(text) || text || '');
    window.open(url, '_blank', 'noopener,noreferrer');
    return url;
  }

  function installChatPatch() {
    if (window.__signalLmWebSearchChatPatch || typeof window.collectWorkspaceContextForPrompt !== 'function') return;
    window.__signalLmWebSearchChatPatch = true;
    const previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      const existing = await previous.apply(this, arguments);
      let webContext = '';
      try { webContext = await buildContextForText(userText); }
      catch (error) { webContext = '[BUILT-IN WEB SEARCH]\nSearch failed: ' + (error.message || error) + '\n[END BUILT-IN WEB SEARCH]'; }
      return [existing, webContext].filter(Boolean).join('\n\n');
    };
  }

  function isMcpPage() {
    return /(^|\/)mcp\.html$/i.test(location.pathname) || Boolean(document.querySelector('a.nav-link.active[href="mcp.html"]'));
  }

  function installMcpPanel() {
    if (window.__signalLmWebSearchMcpPanel || !isMcpPage()) return;
    const grid = document.querySelector('.grid');
    if (!grid) return;
    window.__signalLmWebSearchMcpPanel = true;

    const settings = readSettings();
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
      <h2>Built-in Web Search</h2>
      <div class="switch-row"><div><strong>DuckDuckGo/browser search</strong><p>No key required. Chat can attach compact web search context when you ask for current or web information.</p></div><input id="web-search-enabled" type="checkbox" ${settings.webSearchEnabled === false ? '' : 'checked'} /></div>
      <div class="switch-row"><div><strong>Auto-detect web requests</strong><p>Prompts with words like latest, current, today, news, look up, or search the web trigger search. Slash commands always work.</p></div><input id="web-search-auto" type="checkbox" ${settings.webSearchAuto === false ? '' : 'checked'} /></div>
      <div class="input-group"><label for="web-search-test-query">Test Query</label><input id="web-search-test-query" value="latest LM Studio release" /><p class="hint">Manual Chat commands: /web query, /search query, /ddg query.</p></div>
      <div class="button-row"><button class="ghost-btn" type="button" id="web-search-test-btn">Test Search</button><button class="ghost-btn" type="button" id="web-search-open-btn">Open Browser Search</button></div>
      <pre class="preview" id="web-search-preview" style="display:none;"></pre>
    `;

    const firstColumn = grid.firstElementChild || grid;
    firstColumn.insertBefore(card, firstColumn.children[1] || null);

    const enabledInput = card.querySelector('#web-search-enabled');
    const autoInput = card.querySelector('#web-search-auto');
    const queryInput = card.querySelector('#web-search-test-query');
    const preview = card.querySelector('#web-search-preview');

    enabledInput.addEventListener('change', () => saveWebSettings({ webSearchEnabled: enabledInput.checked }));
    autoInput.addEventListener('change', () => saveWebSettings({ webSearchAuto: autoInput.checked }));
    card.querySelector('#web-search-test-btn').addEventListener('click', async () => {
      preview.style.display = 'block';
      preview.textContent = 'Searching...';
      try { preview.textContent = formatForPrompt(await search(queryInput.value)); }
      catch (error) { preview.textContent = error.message || String(error); }
    });
    card.querySelector('#web-search-open-btn').addEventListener('click', () => openSearch(queryInput.value));
  }

  function installWhenReady() {
    installChatPatch();
    installMcpPanel();
  }

  window.SignalLMWebSearch = { search, formatForPrompt, buildContextForText, shouldSearch, cleanQuery, openSearch, readSettings, saveWebSettings, installChatPatch, installMcpPanel };

  const timer = setInterval(installWhenReady, 200);
  setTimeout(() => clearInterval(timer), 6000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady);
  else installWhenReady();
})();
