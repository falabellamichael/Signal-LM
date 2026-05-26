(function () {
  if (window.SignalLMMcpFilePath) return;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var MCP_PATH_MARKER = '[MCP FILESYSTEM PATH]';
  var FETCH_PATCH_FLAG = '__signalLmMcpFilePathFetchPatch';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
    try { window.dispatchEvent(new Event('settingsChanged')); } catch (error) {}
  }

  function cleanPath(path) {
    return String(path || '').trim().replace(/^["']|["']$/g, '').trim();
  }

  function pathLooksAbsolute(path) {
    var value = cleanPath(path);
    return Boolean(
      /^([a-zA-Z]:[\\/])/.test(value) ||
      /^\\\\[^\\/]+[\\/][^\\/]+/.test(value) ||
      /^\//.test(value) ||
      /^content:\/\//i.test(value) ||
      /^file:\/\//i.test(value)
    );
  }

  function saveMcpFilePath(path) {
    var settings = readSettings();
    settings.mcpFilePath = cleanPath(path);
    writeSettings(settings);
    return settings;
  }

  function getMcpFilePath(settings) {
    var source = settings || readSettings();
    return cleanPath(source.mcpFilePath);
  }

  function mcpEnabled(settings) {
    var source = settings || readSettings();
    return Boolean(source.mcpEnabled);
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 2800);
  }

  function formatMcpFilePathContext() {
    var settings = readSettings();
    if (!mcpEnabled(settings)) return '';
    var path = getMcpFilePath(settings);
    var lines = [
      MCP_PATH_MARKER,
      'MCP is enabled. Browser workspace/folder access and MCP server filesystem access are separate.',
      'The configured MCP File Path is the only project root that filesystem/project MCP tools should inspect.'
    ];

    if (path) {
      lines.push('Configured MCP File Path: ' + path);
      lines.push('For every filesystem/project MCP tool call, pass this exact path as the root, cwd, directory, dir, path, or project path parameter when that parameter exists.');
      lines.push('Do not let MCP tools default to their own working directory, package directory, server directory, or LM Studio skills directory.');
      lines.push('Ignore tool results from paths outside the configured MCP File Path unless the user explicitly asks about MCP tool internals.');
      lines.push('Wrong-target examples to avoid: .lmstudio/skills, MCP server source folders, node_modules, package install folders, and tool configuration folders.');
    } else {
      lines.push('No MCP File Path is configured. Do not use filesystem/project MCP tools yet. Ask the user to set MCP File Path on the MCP page, or use the browser workspace files already attached by the app.');
    }

    lines.push('[END MCP FILESYSTEM PATH]');
    return lines.join('\n');
  }

  function formatMcpFilePathSystemPrompt() {
    var context = formatMcpFilePathContext();
    if (!context) return '';
    return [
      context,
      'Routing rule: MCP filesystem/project tools must target the configured MCP File Path, not the MCP tool server itself. If a tool response shows unrelated skill/tool files, treat that as a wrong root and retry with the configured MCP File Path.'
    ].join('\n');
  }

  function installChatContextPatch() {
    if (window.__signalLmMcpFilePathContextPatch || typeof window.collectWorkspaceContextForPrompt !== 'function') return;
    window.__signalLmMcpFilePathContextPatch = true;
    var previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      var existing = await previous.apply(this, arguments);
      var mcpPathContext = formatMcpFilePathContext(userText);
      return [existing, mcpPathContext].filter(Boolean).join('\n\n');
    };
  }

  function requestUrl(resource) {
    if (typeof resource === 'string') return resource;
    if (resource && typeof resource.url === 'string') return resource.url;
    try { return String(resource || ''); } catch (error) { return ''; }
  }

  function isNativeMcpChatRequest(resource, init, body) {
    var url = requestUrl(resource);
    if (!/\/api\/v1\/chat(?:[?#].*)?$/i.test(url)) return false;
    if (body && Array.isArray(body.integrations)) return true;
    return mcpEnabled();
  }

  function mergeSystemPrompt(existing, addition) {
    var current = String(existing || '').trim();
    var next = String(addition || '').trim();
    if (!next) return current;
    if (current.indexOf(MCP_PATH_MARKER) !== -1) return current;
    return [current, next].filter(Boolean).join('\n\n');
  }

  function injectIntoStringInput(value) {
    var text = String(value || '');
    var context = formatMcpFilePathContext();
    if (!context || text.indexOf(MCP_PATH_MARKER) !== -1) return text;
    return [context, text].filter(Boolean).join('\n\n');
  }

  function injectMcpFilePathIntoBody(body) {
    if (!body || typeof body !== 'object' || !mcpEnabled()) return body;

    var next = Array.isArray(body) ? body.slice() : Object.assign({}, body);
    var systemPrompt = formatMcpFilePathSystemPrompt();

    if (typeof next.input === 'string') {
      next.input = injectIntoStringInput(next.input);
    } else if (Array.isArray(next.input)) {
      var inserted = false;
      next.input = next.input.map(function (part) {
        if (!inserted && part && part.type === 'text' && typeof part.text === 'string' && part.text.indexOf(MCP_PATH_MARKER) === -1) {
          inserted = true;
          return Object.assign({}, part, { text: injectIntoStringInput(part.text) });
        }
        return part;
      });
      if (!inserted) next.input.unshift({ type: 'text', text: formatMcpFilePathContext() });
    }

    if (Array.isArray(next.messages)) {
      var hasMarker = next.messages.some(function (message) {
        return String(message && message.content || '').indexOf(MCP_PATH_MARKER) !== -1;
      });
      if (!hasMarker && systemPrompt) {
        next.messages = [{ role: 'system', content: systemPrompt }].concat(next.messages);
      }
    }

    next.system_prompt = mergeSystemPrompt(next.system_prompt, systemPrompt);
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

  function installNativeMcpFetchPatch() {
    if (window[FETCH_PATCH_FLAG] || typeof window.fetch !== 'function') return;
    window[FETCH_PATCH_FLAG] = true;
    var originalFetch = window.fetch.bind(window);

    window.fetch = function patchedSignalLmFetch(resource, init) {
      try {
        var rawBody = init && init.body;
        if (typeof rawBody === 'string' && rawBody.trim().charAt(0) === '{') {
          var parsed = JSON.parse(rawBody);
          if (isNativeMcpChatRequest(resource, init, parsed)) {
            var injected = injectMcpFilePathIntoBody(parsed);
            return originalFetch(resource, cloneFetchInit(init, injected));
          }
        }
      } catch (error) {
        // Leave the original request untouched if parsing or injection fails.
      }
      return originalFetch(resource, init);
    };
  }

  function isMcpPage() {
    return /(^|\/)mcp\.html$/i.test(location.pathname)
      || location.hash === '#mcp'
      || Boolean(document.querySelector('#view-mcp.active'))
      || Boolean(document.querySelector('a.nav-link.active[href="#mcp"], a.nav-link.active[href="mcp.html"]'));
  }

  function getMcpFirstColumn() {
    var view = document.getElementById('view-mcp') || document;
    return view.querySelector('.grid > div') || view.querySelector('.grid');
  }

  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  function pickNativePath(data) {
    if (!data || typeof data !== 'object') return cleanPath(data);
    return cleanPath(data.path || data.rootPath || data.absolutePath || data.filePath || data.folderPath || data.uri || data.name);
  }

  function saveInputPath(input, successMessage) {
    var value = cleanPath(input.value);
    saveMcpFilePath(value);
    enhanceRequestPreview();
    if (!value) showToast('MCP file path cleared.');
    else if (!pathLooksAbsolute(value)) showToast('Saved, but MCP tools usually need a full absolute path.');
    else showToast(successMessage || 'MCP file path saved.');
  }

  function installMcpPathPanel() {
    if (window.__signalLmMcpFilePathPanel || !isMcpPage()) return;
    var firstColumn = getMcpFirstColumn();
    if (!firstColumn) return;
    window.__signalLmMcpFilePathPanel = true;

    var settings = readSettings();
    var card = make('section', 'card');
    card.appendChild(make('h2', '', 'MCP File Path'));

    var group = make('div', 'input-group');
    var label = make('label', '', 'Filesystem Path For MCP Tools');
    label.setAttribute('for', 'mcp-file-path');
    var input = document.createElement('input');
    input.id = 'mcp-file-path';
    input.value = getMcpFilePath(settings);
    input.placeholder = '/storage/emulated/0/Download/Signal-LM or C:/Users/you/Signal-LM';
    group.appendChild(label);
    group.appendChild(input);
    group.appendChild(make('p', 'hint', 'This is the real path MCP filesystem/project tools should use as their root. Browser workspace files are separate. If a browser picker only returns a filename, paste the full absolute path manually.'));
    card.appendChild(group);

    var row = make('div', 'button-row');
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.id = 'save-mcp-file-path';
    saveBtn.textContent = 'Save Path';

    var browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'ghost-btn';
    browseBtn.textContent = 'Browse File';
    browseBtn.addEventListener('click', function () {
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.path) {
          input.value = String(file.path).replace(/[\/\\][^\/\\]+$/, '');
          saveInputPath(input, 'MCP folder path updated.');
        } else {
          showToast('Browser file picker cannot expose the real MCP path. Paste the absolute path manually.');
        }
      };
      fileInput.click();
    });

    var browseDirBtn = document.createElement('button');
    browseDirBtn.type = 'button';
    browseDirBtn.className = 'ghost-btn';
    browseDirBtn.textContent = 'Browse Folder';
    browseDirBtn.addEventListener('click', async function () {
      var bridge = window.lmStudioLiteNative || window.NativeFileBridge || window.SignalLMNativeBridge;
      if (bridge && typeof bridge.selectFolder === 'function') {
        try {
          var result = bridge.selectFolder();
          if (result && typeof result.then === 'function') result = await result;
          var data = typeof result === 'string' ? JSON.parse(result) : result;
          var selectedPath = pickNativePath(data);
          if (selectedPath) {
            input.value = selectedPath;
            saveInputPath(input, 'MCP folder path updated.');
          } else {
            showToast('Native folder picker did not return a usable path.');
          }
        } catch (error) {
          showToast('Native folder picker failed or cancelled.');
        }
      } else {
        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.webkitdirectory = true;
        fileInput.onchange = function (e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          if (file.path) {
            input.value = String(file.path).replace(/[\/\\][^\/\\]+$/, '');
            saveInputPath(input, 'MCP folder path updated.');
          } else {
            showToast('Browser folder picker only exposes relative names. Paste the absolute MCP File Path manually.');
          }
        };
        fileInput.click();
      }
    });

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.id = 'clear-mcp-file-path';
    clearBtn.className = 'ghost-btn';
    clearBtn.textContent = 'Clear';

    row.appendChild(saveBtn);
    row.appendChild(browseBtn);
    row.appendChild(browseDirBtn);
    row.appendChild(clearBtn);
    card.appendChild(row);

    var controlCard = firstColumn.querySelector('.card');
    if (controlCard && controlCard.nextSibling) firstColumn.insertBefore(card, controlCard.nextSibling);
    else firstColumn.insertBefore(card, firstColumn.firstChild || null);

    saveBtn.addEventListener('click', function () { saveInputPath(input, 'MCP file path saved.'); });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      saveInputPath(input, 'MCP file path cleared.');
    });
    input.addEventListener('change', function () {
      saveMcpFilePath(input.value);
      enhanceRequestPreview();
    });
  }

  var previewUpdating = false;

  function enhanceRequestPreview() {
    var preview = document.getElementById('request-preview');
    if (!preview || previewUpdating) return;
    var raw = String(preview.textContent || '').trim();
    if (!raw || raw.charAt(0) !== '{') return;

    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.body || typeof parsed.body !== 'object') return;
      var nextBody = injectMcpFilePathIntoBody(parsed.body);
      parsed.body = nextBody;
      var next = JSON.stringify(parsed, null, 2);
      if (next !== raw) {
        previewUpdating = true;
        preview.textContent = next;
        previewUpdating = false;
      }
    } catch (error) {
      previewUpdating = false;
    }
  }

  function observePreview() {
    var preview = document.getElementById('request-preview');
    if (!preview || preview.__signalLmMcpFilePathObserver) return;
    preview.__signalLmMcpFilePathObserver = true;
    var observer = new MutationObserver(function () { enhanceRequestPreview(); });
    observer.observe(preview, { childList: true, characterData: true, subtree: true });
    setTimeout(enhanceRequestPreview, 0);
  }

  function installWhenReady() {
    installNativeMcpFetchPatch();
    installChatContextPatch();
    installMcpPathPanel();
    observePreview();
  }

  window.SignalLMMcpFilePath = {
    readSettings: readSettings,
    saveMcpFilePath: saveMcpFilePath,
    getMcpFilePath: getMcpFilePath,
    formatMcpFilePathContext: formatMcpFilePathContext,
    formatMcpFilePathSystemPrompt: formatMcpFilePathSystemPrompt,
    injectMcpFilePathIntoBody: injectMcpFilePathIntoBody,
    installChatContextPatch: installChatContextPatch,
    installMcpPathPanel: installMcpPathPanel,
    installNativeMcpFetchPatch: installNativeMcpFetchPatch,
    enhanceRequestPreview: enhanceRequestPreview
  };

  var timer = setInterval(installWhenReady, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  window.addEventListener('hashchange', installWhenReady);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady);
  else installWhenReady();
})();
