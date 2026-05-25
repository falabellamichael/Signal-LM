(function () {
  if (window.SignalLMMcpAuth) return;

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const DEFAULT_BASE_URL = 'http://localhost:1234/v1';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function normalizeBaseUrl(url) {
    return String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  }

  function apiBaseUrl() {
    return normalizeBaseUrl(readSettings().baseUrl);
  }

  function nativeApiBaseUrl() {
    const base = apiBaseUrl();
    if (/\/api\/v1$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return base.replace(/\/v1$/i, '/api/v1');
    return base + '/api/v1';
  }

  function token() {
    const settings = readSettings();
    return String(settings.mcpAuthToken || settings.apiKey || '').trim();
  }

  function setToken(value) {
    const settings = readSettings();
    settings.apiKey = String(value || '').trim();
    settings.mcpAuthToken = settings.apiKey;
    writeSettings(settings);
    return settings.apiKey;
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const currentToken = token();
    if (currentToken) headers.Authorization = 'Bearer ' + currentToken;
    return headers;
  }

  function jsonHeaders(extra) {
    return authHeaders(Object.assign({ 'Content-Type': 'application/json' }, extra || {}));
  }

  function bridgeAuthPayload(extra) {
    const currentToken = token();
    return Object.assign({
      auth: currentToken ? { type: 'bearer', token: currentToken } : null,
      headers: authHeaders()
    }, extra || {});
  }

  function endpoint(path) {
    return apiBaseUrl() + path;
  }

  function nativeEndpoint(path) {
    return nativeApiBaseUrl() + path;
  }

  async function responseText(response) {
    try { return await response.text(); }
    catch { return ''; }
  }

  function explainFailure(error, response) {
    if (response) {
      if (response.status === 401) return '401 Unauthorized: token missing, expired, or not accepted by the server.';
      if (response.status === 403) return '403 Forbidden: token reached the server but is not allowed to use this endpoint.';
      if (response.status === 404) return '404 Not Found: the base URL or endpoint path is wrong.';
      if (response.status >= 500) return 'HTTP ' + response.status + ': server error from LM Studio/MCP.';
      return 'HTTP ' + response.status + ': request reached the server but did not succeed.';
    }
    const message = String(error && error.message || error || 'Request failed');
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      return 'Network/CORS failure: check LAN address, WebView cleartext access, and server CORS preflight for Authorization.';
    }
    if (/aborted/i.test(message)) return 'Request timed out or was cancelled.';
    return message;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options || {});
    if (!response.ok) {
      const text = await responseText(response);
      const error = new Error(text || explainFailure(null, response));
      error.response = response;
      error.status = response.status;
      throw error;
    }
    return await response.json();
  }

  async function testModels() {
    const url = endpoint('/models');
    const response = await fetch(url, { method: 'GET', headers: authHeaders() });
    const text = await response.clone().text().catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    const models = Array.isArray(payload && payload.data)
      ? payload.data.length
      : Array.isArray(payload && payload.models)
        ? payload.models.length
        : 0;
    return {
      ok: response.ok,
      status: response.status,
      url,
      models,
      detail: response.ok ? 'Authenticated model request succeeded.' : (text || explainFailure(null, response))
    };
  }

  async function testMcpChat(model) {
    const url = nativeEndpoint('/chat');
    const body = {
      model: model || readSettings().model || '',
      input: 'Reply with exactly: MCP auth ready',
      integrations: [],
      temperature: 0,
      max_output_tokens: 24,
      store: false
    };
    const response = await fetch(url, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
    const text = await response.clone().text().catch(() => '');
    return {
      ok: response.ok,
      status: response.status,
      url,
      detail: response.ok ? 'Authenticated MCP chat endpoint reached.' : (text || explainFailure(null, response))
    };
  }

  window.SignalLMMcpAuth = {
    readSettings,
    writeSettings,
    normalizeBaseUrl,
    apiBaseUrl,
    nativeApiBaseUrl,
    endpoint,
    nativeEndpoint,
    token,
    setToken,
    authHeaders,
    jsonHeaders,
    bridgeAuthPayload,
    explainFailure,
    fetchJson,
    testModels,
    testMcpChat
  };
})();
