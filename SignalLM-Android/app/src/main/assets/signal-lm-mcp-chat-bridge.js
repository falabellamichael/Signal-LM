(function () {
  if (window.__signalLmMcpChatBridge) return;
  window.__signalLmMcpChatBridge = true;

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function normalizeBaseUrl(url) {
    return String(url || 'http://localhost:1234/v1').trim().replace(/\/+$/, '');
  }

  function nativeApiBaseUrl(settings) {
    const base = normalizeBaseUrl(settings.baseUrl);
    if (/\/api\/v1$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return base.replace(/\/v1$/i, '/api/v1');
    return base + '/api/v1';
  }

  function headers(settings) {
    const result = { 'Content-Type': 'application/json' };
    const key = String(settings.mcpAuthToken || settings.apiKey || '').trim();
    if (key) result.Authorization = 'Bearer ' + key;
    return result;
  }

  function enabledServers(settings) {
    return Array.isArray(settings.mcpServers)
      ? settings.mcpServers.filter(server => server && server.enabled !== false)
      : [];
  }

  function buildIntegrations(settings) {
    return enabledServers(settings).map(server => {
      const allowedTools = Array.isArray(server.allowedTools)
        ? server.allowedTools.map(tool => String(tool).trim()).filter(Boolean)
        : [];

      if (server.type === 'plugin') {
        if (!server.id) return null;
        return allowedTools.length
          ? { type: 'plugin', id: server.id, allowed_tools: allowedTools }
          : server.id;
      }

      const integration = {
        type: 'ephemeral_mcp',
        server_label: server.serverLabel || server.label || 'remote-mcp',
        server_url: server.serverUrl || ''
      };
      if (!integration.server_url) return null;
      if (allowedTools.length) integration.allowed_tools = allowedTools;
      if (server.headers && typeof server.headers === 'object' && Object.keys(server.headers).length) integration.headers = server.headers;
      return integration;
    }).filter(Boolean);
  }

  function textFromContent(content) {
    if (Array.isArray(content)) {
      return content.map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (part.type === 'text') return part.text || '';
        if (part.text) return part.text;
        return '[' + (part.type || 'attachment') + ']';
      }).join('\n');
    }
    return String(content || '');
  }

  function messagesToInput(messages) {
    const system = [];
    const turns = [];
    (messages || []).forEach(message => {
      const role = String(message.role || 'user').toLowerCase();
      const text = textFromContent(message.content);
      if (!text) return;
      if (role === 'system') system.push(text);
      else turns.push(role.toUpperCase() + ': ' + text);
    });
    return [
      system.length ? 'System instructions:\n' + system.join('\n\n') : '',
      turns.join('\n\n'),
      'ASSISTANT:'
    ].filter(Boolean).join('\n\n');
  }

  function extractMessage(result) {
    if (!result || typeof result !== 'object') return '';
    if (typeof result.text === 'string') return result.text;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.output_text === 'string') return result.output_text;
    if (Array.isArray(result.output)) {
      return result.output.map(item => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item.content === 'string') return item.content;
        if (Array.isArray(item.content)) return item.content.map(part => part && (part.text || part.content || '')).join('');
        if (item.type === 'message' && item.content) return String(item.content);
        return '';
      }).filter(Boolean).join('\n\n').trim();
    }
    const choice = result.choices && result.choices[0];
    return choice && (choice.message?.content || choice.delta?.content || choice.text) || '';
  }

  async function runMcpChat(requestMessages, assistantUi) {
    const settings = readSettings();
    const integrations = buildIntegrations(settings);
    if (!settings.mcpEnabled || !integrations.length) return null;

    const response = await fetch(nativeApiBaseUrl(settings) + '/chat', {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({
        model: settings.model,
        input: messagesToInput(requestMessages),
        integrations,
        context_length: Math.max(1024, parseInt(settings.mcpContextLength, 10) || 8000),
        temperature: Number(settings.temperature ?? 0.7),
        max_output_tokens: parseInt(settings.maxTokens, 10) || 500,
        store: true
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || 'LM Studio MCP chat error: HTTP ' + response.status);
    }

    const payload = await response.json();
    const text = extractMessage(payload) || '(No MCP content returned.)';
    if (assistantUi && typeof assistantUi.setContent === 'function') assistantUi.setContent(text);
    return text;
  }

  function install() {
    if (window.__signalLmMcpChatBridgeInstalled || typeof window.runServerChatCompletion !== 'function') return;
    window.__signalLmMcpChatBridgeInstalled = true;
    const previous = window.runServerChatCompletion;
    window.runServerChatCompletion = async function (requestMessages, assistantUi) {
      const mcpText = await runMcpChat(requestMessages, assistantUi);
      if (mcpText !== null) return mcpText;
      return previous.apply(this, arguments);
    };
  }

  window.SignalLMMcpChatBridge = { readSettings, buildIntegrations, runMcpChat, install };

  const timer = setInterval(install, 200);
  setTimeout(() => clearInterval(timer), 8000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
