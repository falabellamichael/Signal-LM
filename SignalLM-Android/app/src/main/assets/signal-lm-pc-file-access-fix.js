(function () {
  if (window.__signalLmPcFileAccessFix) return;
  window.__signalLmPcFileAccessFix = true;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var MARKER = '[PC FILE ACCESS ROUTING GUARD]';
  var FETCH_FLAG = '__signalLmPcFileAccessFetchPatch';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function writeSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings || {}));
    try { window.dispatchEvent(new Event('settingsChanged')); } catch (error) {}
  }

  function clean(value) { return String(value || '').trim().replace(/^['"]|['"]$/g, '').trim(); }
  function normalizeSlash(value) { return clean(value).replace(/\\/g, '/'); }

  function isWindowsPath(path) {
    return /^[a-zA-Z]:[\\/]/.test(clean(path)) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(clean(path));
  }

  function isPcAbsolutePath(path) {
    var value = clean(path);
    return isWindowsPath(value) || /^file:\/\/[a-zA-Z]:/i.test(value) || /^\/[A-Za-z0-9_. -]+(?:\/[A-Za-z0-9_. -]+)+/.test(value);
  }

  function isAndroidContentUri(path) {
    return /^content:\/\//i.test(clean(path));
  }

  function selectedTarget() {
    var helper = window.SignalLMMcpFilePath;
    if (helper && typeof helper.getMcpFilePath === 'function') return clean(helper.getMcpFilePath());
    return clean(readSettings().mcpFilePath);
  }

  function selectedType() {
    var helper = window.SignalLMMcpFilePath;
    if (helper && typeof helper.getMcpTargetType === 'function') return clean(helper.getMcpTargetType());
    var settings = readSettings();
    return clean(settings.mcpFileTargetType || settings.mcpPathTargetType || 'target');
  }

  function looksLikeMobileRuntime() {
    return /Android|Mobile|wv\)/i.test(navigator.userAgent || '') || Boolean(window.SignalLMNativeBridge || window.AndroidBridge || window.lmStudioLiteNative);
  }

  function pcRoutingGuardText() {
    var target = selectedTarget();
    if (!target || !isPcAbsolutePath(target) || isAndroidContentUri(target)) return '';
    var type = selectedType() || 'target';
    return [
      MARKER,
      'The selected MCP target is a PC/desktop filesystem path, even if this UI is currently running from an Android wrapper or mobile browser.',
      'Selected PC target type: ' + type,
      'Selected PC target path: ' + target,
      'Route filesystem MCP tools to that selected PC path. Do not convert it to Android storage, content://, /storage/emulated/0, Downloads, app assets, cache, or the MCP server package directory.',
      'Android is only the controller UI in this mode. The PC-side MCP/filesystem process owns and resolves this path.',
      'Path priority remains: current user explicitly named path first, selected PC target second, fallback/default path only if no selected target exists.',
      'For a relative staged file such as sudoku.html, combine it with the selected PC folder. Example: selected D:/ plus sudoku.html becomes D:/sudoku.html.',
      'For a nested relative staged file such as Game/sudoku.html, combine it with the selected PC folder. Example: selected D:/Projects plus Game/sudoku.html becomes D:/Projects/Game/sudoku.html.',
      'Never use C:/, recycle-bin paths, old remembered paths, node_modules, package folders, or LM Studio tool folders while this selected PC target is available unless the current user explicitly names that other absolute path.',
      '[END PC FILE ACCESS ROUTING GUARD]'
    ].join('\n');
  }

  function hasGuard(value) {
    return String(value || '').indexOf(MARKER) !== -1;
  }

  function mergeText(existing, addition) {
    var current = String(existing || '').trim();
    var next = String(addition || '').trim();
    if (!next || hasGuard(current)) return current;
    return [current, next].filter(Boolean).join('\n\n');
  }

  function injectInput(input, addition) {
    if (!addition) return input;
    if (typeof input === 'string') return mergeText(input, addition);
    if (Array.isArray(input)) {
      var next = input.map(function (part) { return part && typeof part === 'object' ? Object.assign({}, part) : part; });
      for (var i = 0; i < next.length; i++) {
        if (next[i] && next[i].type === 'text' && typeof next[i].text === 'string') {
          next[i].text = mergeText(next[i].text, addition);
          return next;
        }
      }
      next.unshift({ type: 'text', text: addition });
      return next;
    }
    return input;
  }

  function mcpEnabled() {
    return Boolean(readSettings().mcpEnabled);
  }

  function requestUrl(resource) {
    if (typeof resource === 'string') return resource;
    if (resource && typeof resource.url === 'string') return resource.url;
    try { return String(resource || ''); } catch (error) { return ''; }
  }

  function isNativeMcpRequest(resource, body) {
    if (!mcpEnabled()) return false;
    var url = requestUrl(resource);
    return /\/api\/v1\/chat(?:[?#].*)?$/i.test(url) || Boolean(body && Array.isArray(body.integrations));
  }

  function injectGuard(body) {
    var guard = pcRoutingGuardText();
    if (!guard || !body || typeof body !== 'object') return body;
    var next = Array.isArray(body) ? body.slice() : Object.assign({}, body);
    next.system_prompt = mergeText(next.system_prompt, guard);
    if (typeof next.input !== 'undefined') next.input = injectInput(next.input, guard);
    if (Array.isArray(next.messages)) {
      var found = next.messages.some(function (message) { return hasGuard(message && message.content); });
      if (!found) next.messages = [{ role: 'system', content: guard }].concat(next.messages);
    }
    return next;
  }

  function cloneFetchInit(init, body) {
    var next = Object.assign({}, init || {});
    next.body = JSON.stringify(body);
    var headers = new Headers(next.headers || {});
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    next.headers = headers;
    return next;
  }

  function installFetchPatch() {
    if (window[FETCH_FLAG] || typeof window.fetch !== 'function') return false;
    window[FETCH_FLAG] = true;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function signalLmPcFileAccessFetch(resource, init) {
      try {
        var raw = init && init.body;
        if (typeof raw === 'string' && raw.trim().charAt(0) === '{') {
          var parsed = JSON.parse(raw);
          if (isNativeMcpRequest(resource, parsed)) {
            return originalFetch(resource, cloneFetchInit(init, injectGuard(parsed)));
          }
        }
      } catch (error) {}
      return originalFetch(resource, init);
    };
    return true;
  }

  function installWorkspaceContextPatch() {
    if (window.__signalLmPcFileAccessContextPatch || typeof window.collectWorkspaceContextForPrompt !== 'function') return false;
    window.__signalLmPcFileAccessContextPatch = true;
    var previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      var existing = await previous.apply(this, arguments);
      var guard = pcRoutingGuardText();
      return guard ? [existing, guard].filter(Boolean).join('\n\n') : existing;
    };
    return true;
  }

  function hardenPcTargetSettings() {
    var settings = readSettings();
    var target = clean(settings.mcpFilePath);
    if (!target || !isPcAbsolutePath(target) || isAndroidContentUri(target)) return false;
    var changed = false;
    if (!settings.mcpEnabled) { settings.mcpEnabled = true; changed = true; }
    if (!settings.mcpFileTargetType || settings.mcpFileTargetType === 'target') {
      var normalized = normalizeSlash(target);
      var last = normalized.replace(/\/+$/, '').split('/').pop() || '';
      settings.mcpFileTargetType = /\.[a-z0-9]{1,12}$/i.test(last) ? 'file' : 'folder';
      changed = true;
    }
    if (looksLikeMobileRuntime()) {
      settings.mcpRemotePcTarget = true;
      changed = true;
    }
    if (changed) writeSettings(settings);
    return changed;
  }

  function installMcpPanelHint() {
    var input = document.getElementById('mcp-file-path');
    if (!input || input.__signalLmPcFileHint) return false;
    input.__signalLmPcFileHint = true;
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Android wrapper note: paste or save a Windows/PC path like D:/Project here to access PC files through MCP. Browse buttons may select phone files; pasted PC paths stay remote PC targets.';
    var group = input.closest('.input-group') || input.parentNode;
    if (group) group.appendChild(hint);
    input.addEventListener('change', hardenPcTargetSettings);
    input.addEventListener('blur', hardenPcTargetSettings);
    return true;
  }

  function install() {
    installFetchPatch();
    installWorkspaceContextPatch();
    hardenPcTargetSettings();
    installMcpPanelHint();
  }

  window.SignalLMPcFileAccessFix = {
    install: install,
    pcRoutingGuardText: pcRoutingGuardText,
    isPcAbsolutePath: isPcAbsolutePath
  };

  var timer = setInterval(install, 250);
  setTimeout(function () { clearInterval(timer); }, 12000);
  window.addEventListener('hashchange', install);
  window.addEventListener('settingsChanged', install);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();