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

  function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(max, Math.max(min, safe));
  }

  function clampInteger(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(max, Math.max(min, safe));
  }

  function nativeTemperature(settings) {
    return clampNumber(settings.temperature ?? 0.7, 0.7, 0, 1);
  }

  function nativeMaxOutputTokens(settings) {
    return clampInteger(settings.maxTokens, 500, 1, 8192);
  }

  function nativeContextLength(settings) {
    return clampInteger(settings.mcpContextLength, 8000, 1024, 131072);
  }

  function mcpFilePath(settings) {
    return String(settings.mcpFilePath || '').trim();
  }

  function mcpFileTargetType(settings) {
    const type = String(settings.mcpFileTargetType || settings.mcpPathTargetType || '').toLowerCase().trim();
    if (type === 'file' || type === 'folder' || type === 'directory') return type === 'directory' ? 'folder' : type;
    return 'target';
  }

  function isAndroidContentUri(path) {
    return /^content:\/\//i.test(String(path || '').trim());
  }

  function mcpFilePathContext(settings) {
    const path = mcpFilePath(settings);
    const targetType = mcpFileTargetType(settings);
    const lines = [
      '[SELECTED MCP TARGET]',
      'This block defines the user-selected filesystem target for MCP tools.',
      'It is NOT asking you to find an MCP tool file, MCP server path, MCP skill file, MCP config file, package directory, or LM Studio skills directory.'
    ];
    if (path) {
      lines.push('Selected Target Type: ' + targetType);
      lines.push('Selected Target Path: ' + path);
      if (isAndroidContentUri(path)) {
        lines.push('Selected Target URI Kind: Android Storage Access Framework content URI.');
        lines.push('Desktop or remote MCP filesystem servers cannot open content:// URIs as normal file paths.');
        lines.push('Do not translate this URI into a Windows path, LM Studio plugin path, MCP server working directory, skills directory, package directory, or any other desktop path.');
        lines.push('Use app-attached Android workspace context for list/read/search/edit requests. If no workspace files are attached, ask the user to reselect the folder with /select or the MCP Browse Folder button.');
      } else {
        lines.push('When MCP filesystem/project tools need root/path/file_path arguments, use this exact path unless the user explicitly gives a different path.');
      }
    } else {
      lines.push('No selected MCP target is configured. Do not use filesystem/project MCP tools yet. Ask the user to choose any file or folder target on the MCP page, or use the browser workspace files already attached by the app.');
    }
    lines.push('[END SELECTED MCP TARGET]');
    return lines.join('\n');
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

  function messagesToInput(messages, settings) {
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
      mcpFilePathContext(settings),
      system.length ? 'System instructions:\n' + system.join('\n\n') : '',
      turns.join('\n\n'),
      'ASSISTANT:'
    ].filter(Boolean).join('\n\n');
  }

  function getResolvedModelName() {
    const loaded = window.__signalLmLoadedModels || [];
    if (loaded.length > 0) return loaded[0];
    return '';
  }

  function buildRequestBody(settings, requestMessages) {
    const path = mcpFilePath(settings);
    const resolvedModel = (settings.model === 'auto-detect' || !settings.model)
      ? getResolvedModelName()
      : settings.model;
    const body = {
      model: resolvedModel,
      input: messagesToInput(requestMessages, settings),
      integrations: buildIntegrations(settings),
      context_length: nativeContextLength(settings),
      temperature: nativeTemperature(settings),
      max_output_tokens: nativeMaxOutputTokens(settings),
      store: true
    };
    return body;
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

    if (settings.model === 'auto-detect' || !settings.model) {
      try {
        if (typeof window.loadModels === 'function') {
          await window.loadModels({ force: true });
        }
      } catch (error) {
        console.warn('Failed to refresh models in runMcpChat:', error);
      }
      const resolved = getResolvedModelName();
      if (!resolved) {
        showToast('No models are currently loaded in LM Studio. Please load a model first.');
        throw new Error('No models are currently loaded in LM Studio.');
      }
    }

    const body = buildRequestBody(settings, requestMessages);

    const response = await fetch(nativeApiBaseUrl(settings) + '/chat', {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(body)
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

  window.SignalLMMcpChatBridge = { readSettings, buildIntegrations, buildRequestBody, runMcpChat, install, nativeTemperature, nativeMaxOutputTokens, nativeContextLength, mcpFilePath, mcpFileTargetType, mcpFilePathContext };

  const timer = setInterval(install, 200);
  setTimeout(() => clearInterval(timer), 8000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
