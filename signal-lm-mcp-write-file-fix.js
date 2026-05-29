(function () {
  if (window.__signalLmMcpWriteFileFix) return;
  window.__signalLmMcpWriteFileFix = true;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var FETCH_PATCH_FLAG = '__signalLmMcpWriteFileFetchPatch';
  var MARKER = '[MCP WRITE_FILE SCHEMA GUARD]';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function mcpEnabled() {
    return Boolean(readSettings().mcpEnabled);
  }

  function selectedTargetPath() {
    var helper = window.SignalLMMcpFilePath;
    if (helper && typeof helper.getMcpFilePath === 'function') return String(helper.getMcpFilePath() || '').trim();
    return String(readSettings().mcpFilePath || '').trim();
  }

  function requestUrl(resource) {
    if (typeof resource === 'string') return resource;
    if (resource && typeof resource.url === 'string') return resource.url;
    try { return String(resource || ''); } catch (error) { return ''; }
  }

  function isNativeMcpChatRequest(resource, body) {
    if (!mcpEnabled()) return false;
    var url = requestUrl(resource);
    if (/\/api\/v1\/chat(?:[?#].*)?$/i.test(url)) return true;
    return Boolean(body && Array.isArray(body.integrations));
  }

  function hasGuard(value) {
    return String(value || '').indexOf(MARKER) !== -1;
  }

  function guardText() {
    var selected = selectedTargetPath();
    var lines = [
      MARKER,
      'Use the filesystem write tool with its exact schema. For write_file calls, pass only file_path and content.',
      'Correct write_file call shape: write_file({ file_path: "FULL_TARGET_PATH/filename.ext", content: "complete file content" })',
      'Do not include format, language, encoding, mime_type, overwrite, create, root, cwd, path, filename, or any extra argument unless the tool schema explicitly lists it.',
      'Path priority: first use a path explicitly specified in the user request; otherwise use the selected target path; only use any default or remembered server path when no selected target exists.',
      'Never use unrelated paths from previous chat turns, recycle-bin files, MCP server folders, package folders, or old search results as the write target.'
    ];
    if (selected) {
      lines.push('Current selected MCP/workspace target path: ' + selected);
      lines.push('When creating a relative staged file such as sudoku.html or SudokuGame/sudoku.html, write it under the selected target path above. Example: selected target D:/ plus SudokuGame/sudoku.html becomes D:/SudokuGame/sudoku.html.');
      lines.push('Do not switch to C:/ or any other drive while a selected target path is available, unless the current user request explicitly names that other absolute path.');
    }
    lines.push('If a write_file call fails because of argument parsing, retry once with exactly file_path and content and no other keys.');
    lines.push('[END MCP WRITE_FILE SCHEMA GUARD]');
    return lines.join('\n');
  }

  function mergeText(existing, addition) {
    var current = String(existing || '').trim();
    if (hasGuard(current)) return current;
    return [current, addition].filter(Boolean).join('\n\n');
  }

  function injectIntoInput(input, addition) {
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

  function injectGuard(body) {
    if (!body || typeof body !== 'object') return body;
    var addition = guardText();
    var next = Array.isArray(body) ? body.slice() : Object.assign({}, body);

    next.system_prompt = mergeText(next.system_prompt, addition);

    if (Array.isArray(next.messages)) {
      var hasSystemGuard = next.messages.some(function (message) { return hasGuard(message && message.content); });
      if (!hasSystemGuard) next.messages = [{ role: 'system', content: addition }].concat(next.messages);
    }

    if (typeof next.input !== 'undefined') next.input = injectIntoInput(next.input, addition);

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
    if (window[FETCH_PATCH_FLAG] || typeof window.fetch !== 'function') return false;
    window[FETCH_PATCH_FLAG] = true;
    var originalFetch = window.fetch.bind(window);

    window.fetch = function patchedSignalLmMcpWriteFileFetch(resource, init) {
      try {
        var rawBody = init && init.body;
        if (typeof rawBody === 'string' && rawBody.trim().charAt(0) === '{') {
          var parsed = JSON.parse(rawBody);
          if (isNativeMcpChatRequest(resource, parsed)) {
            var injected = injectGuard(parsed);
            return originalFetch(resource, cloneFetchInit(init, injected));
          }
        }
      } catch (error) {
        // Fall through to original request if parsing or guard injection fails.
      }
      return originalFetch(resource, init);
    };
    return true;
  }

  function installWorkspaceContextPatch() {
    if (window.__signalLmMcpWriteFileContextPatch || typeof window.collectWorkspaceContextForPrompt !== 'function') return false;
    window.__signalLmMcpWriteFileContextPatch = true;
    var previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      var existing = await previous.apply(this, arguments);
      if (!mcpEnabled()) return existing;
      return mergeText(existing, guardText());
    };
    return true;
  }

  function install() {
    installFetchPatch();
    installWorkspaceContextPatch();
  }

  window.SignalLMMcpWriteFileFix = {
    install: install,
    guardText: guardText,
    injectGuard: injectGuard
  };

  var timer = setInterval(install, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();