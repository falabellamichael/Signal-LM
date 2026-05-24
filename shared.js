// Viewport Height Listener
(function () {
  function updateAppViewportHeight() {
    const viewport = window.visualViewport;
    const height = viewport && viewport.height ? viewport.height : window.innerHeight;
    if (height) document.documentElement.style.setProperty('--app-height', height + 'px');
  }
  updateAppViewportHeight();
  window.addEventListener('resize', updateAppViewportHeight, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(updateAppViewportHeight, 80); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppViewportHeight, { passive: true });
    window.visualViewport.addEventListener('scroll', updateAppViewportHeight, { passive: true });
  }
})();

// Promise-based Native Fetch CORS Bypass Proxy
(function () {
  if (window.__lmStudioLiteNativeFetchPatch) return;
  window.__lmStudioLiteNativeFetchPatch = true;
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;

  function getBridge() {
    return window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidInferenceBridge || null;
  }

  function bridgeCanRequest(url) {
    const bridge = getBridge();
    return Boolean(bridge && /^https?:\/\//i.test(String(url || '')) && (bridge.httpRequest || bridge.request || bridge.fetchJson));
  }

  function mergeHeaders(inputHeaders, initHeaders) {
    const headers = {};
    const add = source => {
      if (!source) return;
      if (typeof Headers !== 'undefined' && source instanceof Headers) {
        source.forEach((value, key) => { headers[key] = value; });
      } else if (Array.isArray(source)) {
        source.forEach(pair => { if (pair && pair.length >= 2) headers[pair[0]] = pair[1]; });
      } else if (typeof source === 'object') {
        Object.keys(source).forEach(key => { headers[key] = source[key]; });
      }
    };
    add(inputHeaders);
    add(initHeaders);
    return headers;
  }

  async function nativeFetch(input, init) {
    const options = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    const method = options.method || (input && input.method) || 'GET';
    const headers = mergeHeaders(input && input.headers, options.headers);
    let body = options.body || null;
    if (body && typeof body !== 'string') body = String(body);

    const payload = JSON.stringify({ url, method, headers, body });
    const bridge = getBridge();
    const raw = await (bridge.httpRequest
      ? bridge.httpRequest(payload)
      : bridge.request
        ? bridge.request(payload)
        : bridge.fetchJson(payload));
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') throw new Error('Native HTTP bridge returned an empty response.');
    if (parsed.error) throw new Error(parsed.error);

    const responseHeaders = new Headers(parsed.headers || {});
    if (!responseHeaders.has('content-type')) responseHeaders.set('content-type', parsed.contentType || 'application/json');
    return new Response(parsed.body || '', {
      status: parsed.status || 200,
      statusText: parsed.statusText || 'OK',
      headers: responseHeaders
    });
  }

  if (originalFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      if (bridgeCanRequest(url)) return nativeFetch(input, init);
      return originalFetch(input, init);
    };
  }
})();
