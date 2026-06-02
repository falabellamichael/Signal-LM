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
  script.src = 'signal-lm-theme.js?v=2';
  script.defer = false;
  script.onerror = function () { console.warn('Signal-LM theme helper was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpDarkCssLoader) return;
  window.__signalLmMcpDarkCssLoader = true;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'signal-lm-mcp-dark.css?v=5';
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

  function createAbortError() {
    try {
      return new DOMException('The request was stopped.', 'AbortError');
    } catch {
      const error = new Error('The request was stopped.');
      error.name = 'AbortError';
      return error;
    }
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw createAbortError();
  }

  function nativeRequestId() {
    return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function cancelBridgeRequest(bridge, requestId) {
    try {
      if (bridge && typeof bridge.cancelHttpRequest === 'function') bridge.cancelHttpRequest(requestId);
      else if (bridge && typeof bridge.cancelGeneration === 'function') bridge.cancelGeneration();
    } catch {}
  }

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
    return mode === 'server' || mode === 'hybrid';
  }

  function bridgeCanRequest(url) {
    const bridge = getBridge();
    return Boolean(nativeHttpBridgeEnabled() && bridge && /^https?:\/\//i.test(String(url || '')) && (bridge.httpRequest || bridge.request || bridge.fetchJson));
  }

  function isLmStudioChatRequest(url) {
    const clean = String(url || '').split('?')[0].replace(/\/+$/, '');
    return /\/(?:v\d+\/chat\/completions|api\/v\d+\/chat(?:\/completions)?)$/i.test(clean);
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

  function callTriggerHttpRequest(bridge, payload, signal) {
    const requestId = payload.requestId || nativeRequestId();
    payload.requestId = requestId;
    payload._requestId = requestId;

    return new Promise((resolve, reject) => {
      let settled = false;
      let abortHandler = null;
      const resolveName = '__httpResolve_' + requestId;
      const rejectName = '__httpReject_' + requestId;

      const cleanup = () => {
        delete window[resolveName];
        delete window[rejectName];
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      abortHandler = () => {
        cancelBridgeRequest(bridge, requestId);
        finish(reject, createAbortError());
      };

      if (signal && signal.aborted) {
        abortHandler();
        return;
      }

      window[resolveName] = result => finish(resolve, result);
      window[rejectName] = message => finish(reject, new Error(message || 'Native HTTP bridge failed.'));
      if (signal) signal.addEventListener('abort', abortHandler, { once: true });

      try {
        bridge.triggerHttpRequest(JSON.stringify(payload), requestId);
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function callBridgeHttpMethod(bridge, payload, signal) {
    throwIfAborted(signal);
    const requestId = payload.requestId;
    let abortHandler = null;
    const request = Promise.resolve().then(() => {
      const json = JSON.stringify(payload);
      if (bridge.httpRequest) return bridge.httpRequest(json);
      if (bridge.request) return bridge.request(json);
      return bridge.fetchJson(json);
    });

    if (!signal) return await request;

    const abort = new Promise((_, reject) => {
      abortHandler = () => {
        cancelBridgeRequest(bridge, requestId);
        reject(createAbortError());
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    });

    try {
      return await Promise.race([request, abort]);
    } finally {
      if (abortHandler) signal.removeEventListener('abort', abortHandler);
    }
  }

  async function callNativeHttpBridge(bridge, payload, signal) {
    throwIfAborted(signal);
    if (bridge && typeof bridge.triggerHttpRequest === 'function') {
      return await callTriggerHttpRequest(bridge, payload, signal);
    }
    return await callBridgeHttpMethod(bridge, payload, signal);
  }

  async function nativeFetch(input, init) {
    const options = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    const method = options.method || (input && input.method) || 'GET';
    const headers = mergeHeaders(input && input.headers, options.headers);
    const signal = options.signal || (input && input.signal) || null;
    let body = options.body || null;
    if (body && typeof body !== 'string') body = String(body);
    body = sanitizeLmStudioRequestBody(url, body);

    const requestId = nativeRequestId();
    const payload = { url, method, headers, body, requestId, _requestId: requestId };
    const bridge = getBridge();
    const raw = await callNativeHttpBridge(bridge, payload, signal);
    throwIfAborted(signal);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') throw new Error('Native HTTP bridge returned an empty response.');
    if (parsed.error) {
      if (/aborted|cancelled|canceled|stopped/i.test(parsed.error)) throw createAbortError();
      throw new Error(parsed.error);
    }

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
  script.src = 'signal-lm-json-edit-enforcer.js?v=write-create-2';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM JSON edit enforcer was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmWriteCommandFixLoader) return;
  window.__signalLmWriteCommandFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-write-command-fix.js?v=3';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM write command fix was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmMcpWriteFileFixLoader) return;
  window.__signalLmMcpWriteFileFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-mcp-write-file-fix.js?v=3';
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
  script.src = 'signal-lm-chatbot-safety-fix.js?v=2';
  script.defer = true;
  script.onerror = function () { console.warn('Signal-LM chatbot safety guard was not found.'); };
  document.head.appendChild(script);
})();

(function () {
  if (window.__signalLmPcFileAccessFixLoader) return;
  window.__signalLmPcFileAccessFixLoader = true;
  var script = document.createElement('script');
  script.src = 'signal-lm-pc-file-access-fix.js?v=2';
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
