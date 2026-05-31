(function () {
  if (window.__signalLmHybridMcpRouterFix) return;
  window.__signalLmHybridMcpRouterFix = true;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var ROUTER_FETCH_FLAG = '__signalLmHybridMcpRouterFetchPatch';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function getBridge() {
    return window.SignalLMNativeBridge || window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidBridge || window.AndroidInferenceBridge || null;
  }

  function selectedMcpPath() {
    var helper = window.SignalLMMcpFilePath;
    if (helper && typeof helper.getMcpFilePath === 'function') return String(helper.getMcpFilePath() || '').trim();
    return String(readSettings().mcpFilePath || '').trim();
  }

  function normalizeBaseUrl(url) {
    return String(url || 'http://localhost:1234/v1').trim().replace(/\/+$/, '');
  }

  function chatCompletionsUrl(settings) {
    var base = normalizeBaseUrl(settings.baseUrl);
    if (/\/v1$/i.test(base)) return base + '/chat/completions';
    if (/\/api\/v1$/i.test(base)) return base.replace(/\/api\/v1$/i, '/v1/chat/completions');
    return base + '/v1/chat/completions';
  }

  function requestUrl(resource) {
    if (typeof resource === 'string') return resource;
    if (resource && typeof resource.url === 'string') return resource.url;
    try { return String(resource || ''); } catch (error) { return ''; }
  }

  function parseBody(init) {
    var raw = init && init.body;
    if (typeof raw !== 'string' || raw.trim().charAt(0) !== '{') return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  function isNativeMcpChatRequest(resource, body) {
    var url = requestUrl(resource).split('?')[0].replace(/\/+$/, '');
    return Boolean(body && Array.isArray(body.integrations) && /\/api\/v1\/chat$/i.test(url));
  }

  function inputText(body) {
    var input = body && body.input;
    if (typeof input === 'string') return input;
    if (Array.isArray(input)) return input.map(function (part) { return part && (part.text || part.content || ''); }).join('\n');
    return '';
  }

  function isDraftOnlyPrompt(text) {
    return /^\s*create\s+draft\s+only\s+for\s+/i.test(String(text || ''));
  }

  function isApplyPrompt(text) {
    var value = String(text || '').toLowerCase();
    return value.indexOf('apply these reviewed staged edits') !== -1
      || value.indexOf('use the mcp write_file tool directly') !== -1
      || value.indexOf('target file_path:') !== -1
      || value.indexOf('allowed write destination:') !== -1;
  }

  function namesMcpTool(text) {
    return /\b(write_file|read_file|list_files|create_directory|create_folder|delete_file|move_file|rename_file|edit_file)\b/i.test(String(text || ''));
  }

  function asksForFilesystemTool(text) {
    var value = String(text || '').toLowerCase();
    var hasPathContext = Boolean(selectedMcpPath()) || /\b(mcp|selected path|target path|file_path|folder|directory|workspace|drive|d:\/|c:\/|[a-z]:\\)/i.test(value);
    if (!hasPathContext) return false;
    var hasFsNoun = /\b(file|files|folder|folders|directory|directories|path|workspace|drive|project)\b/i.test(value);
    var hasFsVerb = /\b(apply|save|write|create|make|read|open|list|show|search|find|scan|inspect|summarize|analyze|edit|replace|delete|remove|rename|move|copy)\b/i.test(value);
    return hasFsNoun && hasFsVerb;
  }

  function shouldKeepMcpForPcAccess(text) {
    if (isApplyPrompt(text)) return true;
    if (namesMcpTool(text)) return true;
    if (isDraftOnlyPrompt(text)) return false;
    return asksForFilesystemTool(text);
  }

  function extractCompletionText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.content === 'string') return payload.content;
    if (typeof payload.output_text === 'string') return payload.output_text;
    var choice = payload.choices && payload.choices[0];
    var content = choice && (choice.message && choice.message.content || choice.delta && choice.delta.content || choice.text);
    if (Array.isArray(content)) return content.map(function (part) { return part && (part.text || part.content || ''); }).join('');
    if (typeof content === 'string') return content;
    if (Array.isArray(payload.output)) {
      return payload.output.map(function (item) {
        if (typeof item === 'string') return item;
        if (item && typeof item.content === 'string') return item.content;
        if (item && Array.isArray(item.content)) return item.content.map(function (part) { return part && (part.text || part.content || ''); }).join('');
        return '';
      }).join('\n').trim();
    }
    return '';
  }

  function messagesFromMcpInput(body) {
    var system = String(body.system_prompt || '').trim();
    var input = inputText(body);
    var messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: input });
    return messages;
  }

  function nativePayload(body, settings) {
    var messages = messagesFromMcpInput(body);
    return {
      model: body.model || settings.model || 'auto-detect',
      messages: messages,
      prompt: messages.map(function (message) { return String(message.role || 'user').toUpperCase() + ': ' + String(message.content || ''); }).join('\n\n') + '\n\nASSISTANT:',
      temperature: Number(body.temperature || settings.temperature || 0.7),
      top_p: Number(settings.topP || 1),
      max_tokens: Number(body.max_output_tokens || settings.maxTokens || 500),
      stream: false,
      runtime: {
        backend: settings.androidBackend || 'vulkan',
        gpu_layers: Math.max(0, parseInt(settings.androidGpuLayers, 10) || 0),
        threads: Math.max(1, parseInt(settings.androidThreads, 10) || 4),
        context_length: Math.max(1024, parseInt(settings.androidContextLength, 10) || 4096),
        batch_size: Math.max(32, parseInt(settings.androidBatchSize, 10) || 512),
        use_mmap: settings.androidUseMmap !== false,
        use_mlock: Boolean(settings.androidUseMlock)
      },
      mode: 'hybrid-mcp-bypass'
    };
  }

  async function callNative(body, settings) {
    var bridge = getBridge();
    if (!bridge || !(bridge.chatCompletion || bridge.generate)) throw new Error('Android native inference bridge unavailable.');
    var payload = nativePayload(body, settings);
    var raw = bridge.chatCompletion ? await bridge.chatCompletion(JSON.stringify(payload)) : await bridge.generate(JSON.stringify(payload));
    var parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (error) { return raw; }
    }
    return extractCompletionText(parsed) || '(No content returned.)';
  }

  async function callPc(originalFetch, body, settings) {
    var requestBody = {
      model: body.model || settings.model || 'auto-detect',
      messages: messagesFromMcpInput(body),
      temperature: Number(body.temperature || settings.temperature || 0.7),
      top_p: Number(settings.topP || 1),
      max_tokens: Number(body.max_output_tokens || settings.maxTokens || 500),
      stream: false
    };
    var headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = 'Bearer ' + settings.apiKey;
    var response = await originalFetch(chatCompletionsUrl(settings), { method: 'POST', headers: headers, body: JSON.stringify(requestBody) });
    if (!response.ok) throw new Error(await response.text().catch(function () { return 'PC server request failed.'; }));
    var payload = await response.json();
    return extractCompletionText(payload) || '(No content returned.)';
  }

  function withTimeout(promise, ms, onTimeout) {
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (onTimeout) onTimeout();
        reject(new Error('Hybrid route timed out.'));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { clearTimeout(timer); });
  }

  async function runHybridPlainChat(originalFetch, body) {
    var settings = readSettings();
    var strategy = settings.hybridStrategy || 'off';
    var timeoutMs = Math.max(1000, parseInt(settings.hybridFallbackMs, 10) || 12000);

    if ((settings.runtimeMode || 'server') !== 'hybrid' || strategy === 'off') {
      return await callPc(originalFetch, body, settings);
    }

    if (strategy === 'race') {
      var pc = callPc(originalFetch, body, settings).then(function (text) { return { source: 'PC server', text: text }; });
      var phone = callNative(body, settings).then(function (text) { return { source: 'Android phone', text: text }; });
      var errors = [];
      return await new Promise(function (resolve, reject) {
        [pc, phone].forEach(function (promise) {
          promise.then(resolve).catch(function (error) { errors.push(error); if (errors.length === 2) reject(errors[0] || error); });
        });
      }).then(function (result) { return result.text; });
    }

    try {
      return await withTimeout(callPc(originalFetch, body, settings), timeoutMs);
    } catch (error) {
      return await callNative(body, settings);
    }
  }

  function responseForText(text) {
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: String(text || '(No content returned.)') }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  function installFetchRouter() {
    if (window[ROUTER_FETCH_FLAG] || typeof window.fetch !== 'function') return false;
    window[ROUTER_FETCH_FLAG] = true;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function signalLmHybridMcpRouterFetch(resource, init) {
      var body = parseBody(init);
      if (isNativeMcpChatRequest(resource, body)) {
        var text = inputText(body);
        if (!shouldKeepMcpForPcAccess(text)) {
          return runHybridPlainChat(originalFetch, body).then(responseForText).catch(function (error) {
            return responseForText('Error from hybrid/plain-chat route: ' + (error && error.message || error));
          });
        }
      }
      return originalFetch(resource, init);
    };
    return true;
  }

  function install() {
    installFetchRouter();
  }

  window.SignalLMPcFileAccessFix = window.SignalLMHybridMcpRouterFix = {
    install: install,
    shouldKeepMcpForPcAccess: shouldKeepMcpForPcAccess,
    selectedMcpPath: selectedMcpPath
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();