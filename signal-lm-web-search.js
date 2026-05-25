(function () {
  if (window.SignalLMWebSearch) return;

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const MAX_RESULTS = 6;
  const REQUEST_HEADERS = {
    Accept: 'text/html,application/json,text/plain,*/*',
    'User-Agent': 'Mozilla/5.0 Signal-LM Android WebView Search Helper'
  };

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
      .replace(/^\s*search\s+(?:for\s+)?/i, '')
      .replace(/\b(search the web|web search|look up|browse)\b:?/ig, '')
      .replace(/\b(?:on|using|with|via)\s+duckduckgo\b/ig, '')
      .replace(/\bduckduckgo\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function explicitSearchRequested(text) {
    return /^\s*\/(web|search|ddg|browser)\s+/i.test(String(text || ''));
  }

  function autoSearchRequested(text) {
    return /^\s*search\b/i.test(String(text || '')) || /\b(search the web|web search|look up|browse|duckduckgo|latest|current|currently|today|recent|news|price|release date|version|schedule|weather|stock|who is the current|what is the current)\b/i.test(String(text || ''));
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

  function htmlUrl(query) {
    return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);  
  }

  function getNativeBridge() {
    return window.SignalLMNativeBridge || window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidInferenceBridge || null;
  }

  async function nativeGet(url, headers = REQUEST_HEADERS) {
    const bridge = getNativeBridge();
    if (!bridge || !(bridge.httpRequest || bridge.request || bridge.fetchJson)) throw new Error('Native HTTP bridge unavailable.');
    const payload = JSON.stringify({ url, method: 'GET', headers, body: null });
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

  async function getText(url, headers) {
    try { return await nativeGet(url, headers); }
    catch (nativeError) {
      try { return await browserGet(url); }
      catch (browserError) {
        const error = new Error(browserError.message || nativeError.message || 'Search fetch failed.');
        error.nativeError = nativeError;
        error.browserError = browserError;
        throw error;
      }
    }
  }

  function compact(value, max = 420) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
  }

  function decodeHtml(value) {
    const text = String(value || '');
    if (!text) return '';
    try {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
      return textarea.value;
    } catch {
      return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");
    }
  }

  function stripTags(value) {
    return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  }

  function normalizeResultUrl(url) {
    let value = decodeHtml(String(url || '')).trim();
    if (!value) return '';
    if (value.startsWith('//')) value = 'https:' + value;
    if (value.startsWith('/')) value = 'https://duckduckgo.com' + value;
    try {
      const parsed = new URL(value);
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
      return parsed.href;
    } catch {
      return value;
    }
  }

  function pushUnique(results, item) {
    if (!item || !item.title) return;
    const url = item.url || '';
    const title = compact(item.title, 120);
    if (results.some(existing => (url && existing.url === url) || existing.title === title)) return;
    results.push({ title, snippet: compact(item.snippet || '', 420), url });
  }

  function parseDuckDuckGoInstant(payload, query) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const results = [];

    if (data.AbstractText) {
      pushUnique(results, { title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || resultUrl(query) });
    }

    function collect(items) {
      (items || []).forEach(item => {
        if (results.length >= MAX_RESULTS) return;
        if (Array.isArray(item.Topics)) return collect(item.Topics);
        if (!item.Text && !item.FirstURL) return;
        pushUnique(results, { title: item.Text || item.FirstURL, snippet: item.Text || '', url: item.FirstURL || resultUrl(query) });
      });
    }

    collect(data.RelatedTopics || []);
    if (!results.length && data.Answer) pushUnique(results, { title: query, snippet: data.Answer, url: resultUrl(query) });
    return { query, source: 'DuckDuckGo instant answer', url: resultUrl(query), results: results.slice(0, MAX_RESULTS) };
  }

  function parseDuckDuckGoHtmlWithDom(html, query) {
    if (typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const results = [];
    doc.querySelectorAll('.result, .web-result').forEach(block => {
      if (results.length >= MAX_RESULTS) return;
      const titleEl = block.querySelector('.result__a, a.result__url, h2 a, a[href]');
      const snippetEl = block.querySelector('.result__snippet, .result__body, .result__extras__url, .snippet');
      const title = compact(titleEl ? titleEl.textContent : '', 120);
      const snippet = compact(snippetEl ? snippetEl.textContent : '', 420);
      const url = normalizeResultUrl(titleEl ? titleEl.getAttribute('href') : '');
      if (title) pushUnique(results, { title, snippet, url: url || resultUrl(query) });
    });
    return results;
  }

  function parseDuckDuckGoHtmlWithRegex(html, query) {
    const source = String(html || '');
    const results = [];
    const blocks = source.split(/<div[^>]+class=["'][^"']*result[^"']*["'][^>]*>/i).slice(1);
    for (const block of blocks) {
      if (results.length >= MAX_RESULTS) break;
      const linkMatch = block.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const snippetMatch = block.match(/<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) || block.match(/<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const title = compact(stripTags(linkMatch[2]), 120);
      const snippet = compact(stripTags(snippetMatch ? snippetMatch[1] : ''), 420);
      const url = normalizeResultUrl(linkMatch[1]);
      if (title) pushUnique(results, { title, snippet, url: url || resultUrl(query) });
    }
    return results;
  }

  function parseDuckDuckGoHtml(payload, query) {
    const domResults = parseDuckDuckGoHtmlWithDom(payload, query);
    const results = domResults.length ? domResults : parseDuckDuckGoHtmlWithRegex(payload, query);
    return { query, source: 'DuckDuckGo HTML search', url: resultUrl(query), results: results.slice(0, MAX_RESULTS) };
  }

  async function search(query) {
    const clean = cleanQuery(query);
    if (!clean) throw new Error('Search query is empty.');

    let instant = null;
    let instantError = null;
    try {
      const text = await getText(apiUrl(clean), { Accept: 'application/json,*/*' });
      instant = parseDuckDuckGoInstant(text, clean);
      if (instant.results.length) return instant;
    } catch (error) {
      instantError = error;
    }

    try {
      const html = await getText(htmlUrl(clean), REQUEST_HEADERS);
      const parsed = parseDuckDuckGoHtml(html, clean);
      if (parsed.results.length) return parsed;
      return {
        query: clean,
        source: 'DuckDuckGo search',
        url: resultUrl(clean),
        results: instant && instant.results.length ? instant.results : [],
        error: instantError ? (instantError.message || String(instantError)) : 'No result snippets returned.'
      };
    } catch (error) {
      return {
        query: clean,
        source: 'DuckDuckGo search fallback',
        url: resultUrl(clean),
        results: instant && instant.results.length ? instant.results : [],
        error: error.message || instantError?.message || String(error)
      };
    }
  }

  function formatForPrompt(payload) {
    if (!payload) return '';
    const lines = [
      '[BUILT-IN WEB SEARCH RESULTS]',
      'The app already performed this web search. Use the listed results directly. Do not claim that browser tools or web search are unavailable.',
      'Provider: ' + payload.source,
      'Query: ' + payload.query,
      'Search URL: ' + payload.url
    ];
    if (payload.error) lines.push('Fetch note: ' + payload.error);
    if (!payload.results.length) {
      lines.push('No usable snippets were returned. State that this search returned no snippets instead of saying you cannot browse.');
    } else {
      lines.push('Results:');
      payload.results.forEach((item, index) => {
        lines.push((index + 1) + '. ' + item.title);
        if (item.snippet) lines.push('   Snippet: ' + item.snippet);
        if (item.url) lines.push('   URL: ' + item.url);
      });
    }
    lines.push('[END BUILT-IN WEB SEARCH RESULTS]');
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

  function addLocalMessage(text) {
    if (typeof window.addMessage === 'function') {
      const msg = window.addMessage('ai', text);
      return msg;
    }
    console.log(text);
    return null;
  }

  async function performSearch(query) {
    const status = addLocalMessage('Searching DuckDuckGo for: ' + cleanQuery(query));
    const payload = await search(query);
    const formatted = formatForPrompt(payload);
    if (status && typeof status.setContent === 'function') status.setContent(formatted);
    else addLocalMessage(formatted);
    return payload;
  }

  function installChatPatch() {
    if (window.__signalLmWebSearchChatPatch || typeof window.collectWorkspaceContextForPrompt !== 'function') return;
    window.__signalLmWebSearchChatPatch = true;
    const previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      const existing = await previous.apply(this, arguments);
      let webContext = '';
      try { webContext = await buildContextForText(userText); }
      catch (error) { webContext = '[BUILT-IN WEB SEARCH RESULTS]\nSearch failed: ' + (error.message || error) + '\n[END BUILT-IN WEB SEARCH RESULTS]'; }
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
      <div class="switch-row"><div><strong>DuckDuckGo/browser search</strong><p>No key required. Chat attaches compact search results when you ask for current or web information.</p></div><input id="web-search-enabled" type="checkbox" ${settings.webSearchEnabled === false ? '' : 'checked'} /></div>
      <div class="switch-row"><div><strong>Auto-detect web requests</strong><p>Prompts with words like search, latest, current, today, news, look up, or DuckDuckGo trigger search. Slash command: /web search query.</p></div><input id="web-search-auto" type="checkbox" ${settings.webSearchAuto === false ? '' : 'checked'} /></div>
      <div class="input-group"><label for="web-search-test-query">Test Query</label><input id="web-search-test-query" value="latest LM Studio release" /><p class="hint">Manual Chat command: /web search query.</p></div>
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

  const api = { search, performSearch, formatForPrompt, buildContextForText, shouldSearch, cleanQuery, openSearch, readSettings, saveWebSettings, installChatPatch, installMcpPanel };
  window.SignalLMWebSearch = api;
  window.LmStudioLiteWebSearch = api;

  const timer = setInterval(installWhenReady, 200);
  setTimeout(() => clearInterval(timer), 15000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady);
  else installWhenReady();
})();
