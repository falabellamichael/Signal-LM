(function(){
  function hasAnyMethod(bridge, names) {
    if (!bridge) return false;
    return names.some(function (name) { return typeof bridge[name] === 'function'; });
  }

  function isInferenceBridge(bridge) {
    return hasAnyMethod(bridge, ['chatCompletion', 'generate']);
  }

  function isFileBridge(bridge) {
    return hasAnyMethod(bridge, ['selectFolder', 'triggerSelectFolder', 'readFile', 'triggerReadFile', 'writeFile', 'triggerWriteFile']);
  }

  var bridge=window.SignalLMNativeBridge||window.lmStudioLiteNative||window.NativeFileBridge||window.NativeInferenceBridge||window.AndroidBridge||window.AndroidFileBridge||window.AndroidWorkspaceBridge||window.AndroidInferenceBridge||null;
  if(!bridge)return;
  if(!window.lmStudioLiteNative)window.lmStudioLiteNative=bridge;
  if(!window.NativeFileBridge&&isFileBridge(bridge))window.NativeFileBridge=bridge;
  if(!window.NativeInferenceBridge&&isInferenceBridge(bridge))window.NativeInferenceBridge=bridge;
  if(!window.AndroidBridge)window.AndroidBridge=bridge;
})();

(function () {
  if (window.__signalLmThemeLoader) return;
  window.__signalLmThemeLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-theme.js';
  script.defer = false;
  script.onerror = function () { console.warn('Signal-LM theme helper was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpDarkCssLoader) return;
  window.__signalLmMcpDarkCssLoader = true;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'signal-lm-mcp-dark.css?v=2';
  link.onerror = function () { console.warn('Signal-LM MCP dark stylesheet was not found.'); };
  document.head.appendChild(link);
})();

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

(function () {
  if (window.__lmStudioLiteNativeFetchPatch) return;
  window.__lmStudioLiteNativeFetchPatch = true;
  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  const LM_STUDIO_CHAT_FORBIDDEN_KEYS = new Set([
    'response_id',
    'previous_response_id',
    'conversation',
    'conversation_id',
    'thread_id',
    'session_id'
  ]);

  function getBridge() {
    return window.SignalLMNativeBridge || window.lmStudioLiteNative || window.NativeFileBridge || window.AndroidBridge || window.AndroidFileBridge || window.AndroidWorkspaceBridge || null;
  }

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function nativeHttpBridgeEnabled() {
    const settings = readSettings();
    const mode = settings.runtimeMode || 'server';
    const hybridStrategy = settings.hybridStrategy || 'off';
    return mode === 'hybrid' && hybridStrategy !== 'off';
  }

  function bridgeCanRequest(url) {
    const bridge = getBridge();
    return Boolean(nativeHttpBridgeEnabled() && bridge && /^https?:\/\//i.test(String(url || '')) && (bridge.httpRequest || bridge.request || bridge.fetchJson));
  }

  function isLmStudioChatRequest(url) {
    const clean = String(url || '').split('?')[0].replace(/\/+$/, '');
    return /\/(?:v1\/chat\/completions|api\/v1\/chat)$/i.test(clean);
  }

  function sanitizeLmStudioRequestBody(url, body) {
    if (!isLmStudioChatRequest(url) || typeof body !== 'string') return body;
    const trimmed = body.trim();
    if (!trimmed || trimmed[0] !== '{') return body;

    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;

      let changed = false;
      LM_STUDIO_CHAT_FORBIDDEN_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          delete parsed[key];
          changed = true;
        }
      });

      return changed ? JSON.stringify(parsed) : body;
    } catch {
      return body;
    }
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
    body = sanitizeLmStudioRequestBody(url, body);

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
      let nextInit = init;
      if (nextInit && typeof nextInit.body === 'string' && isLmStudioChatRequest(url)) {
        const cleanBody = sanitizeLmStudioRequestBody(url, nextInit.body);
        if (cleanBody !== nextInit.body) nextInit = { ...nextInit, body: cleanBody };
      }
      if (bridgeCanRequest(url)) return nativeFetch(input, nextInit);
      return originalFetch(input, nextInit);
    };
  }
})();

(function () {
  if (window.__signalLmRuntimePatchLoader) return;
  window.__signalLmRuntimePatchLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-runtime-fix.js';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM runtime restore patch was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmModelLoaderFixLoader) return;
  window.__signalLmModelLoaderFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-model-loader-fix.js?v=3';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM model loader fix was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmWebSearchLoader) return;
  window.__signalLmWebSearchLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-web-search.js?v=4';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM web search helper was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpPipelineLoader) return;
  window.__signalLmMcpPipelineLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-mcp-pipeline.js?v=2';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM MCP pipeline helper was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpFilePathLoader) return;
  window.__signalLmMcpFilePathLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-mcp-file-path.js?v=10';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM MCP file path helper was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmJsonEditEnforcerLoader) return;
  window.__signalLmJsonEditEnforcerLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-json-edit-enforcer.js?v=write-create-1';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM JSON edit enforcer was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmWriteCommandFixLoader) return;
  window.__signalLmWriteCommandFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-write-command-fix.js?v=2';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM write command fix was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpWriteFileFixLoader) return;
  window.__signalLmMcpWriteFileFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-mcp-write-file-fix.js?v=2';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM MCP write_file schema guard was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpApplyFixLoader) return;
  window.__signalLmMcpApplyFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-mcp-apply-fix.js?v=1';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM MCP staged apply helper was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmChatbotSafetyFixLoader) return;
  window.__signalLmChatbotSafetyFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-chatbot-safety-fix.js?v=1';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM chatbot safety guard was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmPcFileAccessFixLoader) return;
  window.__signalLmPcFileAccessFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-pc-file-access-fix.js?v=1';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM PC file access guard was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpChatBridgeLoader) return;
  window.__signalLmMcpChatBridgeLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-mcp-chat-bridge.js?v=content-uri-1';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM MCP chat bridge was not found.'); };
  document.head.appendChild(script);
})();