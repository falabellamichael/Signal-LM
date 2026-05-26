(function () {
  if (window.SignalLMMcpFilePath) return;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var MCP_PATH_MARKER = '[MCP FILESYSTEM TARGET]';
  var LEGACY_MCP_PATH_MARKER = '[MCP FILESYSTEM PATH]';
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

  function normalizeSlash(path) {
    return cleanPath(path).replace(/\\/g, '/');
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

  function saveMcpFilePath(path, targetType) {
    var settings = readSettings();
    settings.mcpFilePath = cleanPath(path);
    settings.mcpFileTargetType = cleanTargetType(targetType || settings.mcpFileTargetType || inferTargetType(path));
    writeSettings(settings);
    return settings;
  }

  function getMcpFilePath(settings) {
    var source = settings || readSettings();
    return cleanPath(source.mcpFilePath);
  }

  function cleanTargetType(value) {
    var type = String(value || '').toLowerCase().trim();
    if (type === 'file' || type === 'folder' || type === 'directory') return type === 'directory' ? 'folder' : type;
    return 'target';
  }

  function inferTargetType(path) {
    var value = cleanPath(path);
    if (!value) return 'target';
    if (/[\\/]$/.test(value)) return 'folder';
    var last = value.split(/[\\/]/).pop() || '';
    if (/\.[a-z0-9]{1,12}$/i.test(last)) return 'file';
    return 'target';
  }

  function getMcpTargetType(settings) {
    var source = settings || readSettings();
    var explicit = cleanTargetType(source.mcpFileTargetType || source.mcpPathTargetType);
    if (explicit !== 'target') return explicit;
    return inferTargetType(getMcpFilePath(source));
  }

  function splitTargetPath(path) {
    var raw = cleanPath(path);
    var normalized = normalizeSlash(raw).replace(/\/+$/, '');
    var index = normalized.lastIndexOf('/');
    var parent = index > 0 ? normalized.slice(0, index) : index === 0 ? '/' : '';
    var name = index >= 0 ? normalized.slice(index + 1) : normalized;
    return { raw: raw, normalized: normalized || raw, parent: parent, name: name };
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
    var targetType = getMcpTargetType(settings);
    var parts = splitTargetPath(path);
    var targetLabel = targetType === 'file' ? 'file' : targetType === 'folder' ? 'folder' : 'file or folder';
    var lines = [
      MCP_PATH_MARKER,
      'MCP is enabled. Browser workspace/folder access and MCP server filesystem access are separate.',
      'The configured MCP File Path is the user-selected filesystem target. It may be a single file or an entire folder.'
    ];

    if (path) {
      lines.push('Configured MCP Target Type: ' + targetLabel);
      lines.push('Configured MCP Target Path: ' + path);
      if (targetType === 'file') {
        lines.push('Target Parent Folder: ' + (parts.parent || '<same directory as MCP server if relative>'));
        lines.push('Target Filename: ' + (parts.name || '<selected file>'));
        lines.push('For file read/edit/search tools, pass the exact Configured MCP Target Path when a file/path parameter exists.');
        lines.push('If a tool separates root/cwd/directory from file/path, use Target Parent Folder for root/cwd/directory and Target Filename for the file/path parameter.');
        lines.push('Do not replace the selected file target with the parent folder unless the tool API requires separate root and filename arguments.');
      } else if (targetType === 'folder') {
        lines.push('For directory/project/search/list tools, pass the exact Configured MCP Target Path as root/cwd/directory/path.');
        lines.push('For file-specific tools, operate only inside this selected folder unless the user chooses a different MCP File Path.');
      } else {
        lines.push('Treat the configured path as the active target. If the tool can accept files, pass it exactly. If it requires a directory root and the path is a file, use the parent folder and the filename separately.');
      }
      lines.push('Do not let MCP tools default to their own working directory, package directory, server directory, LM Studio skills directory, or previous target.');
      lines.push('If a tool response shows unrelated skill/tool files or a path outside the selected target, treat that as the wrong target and retry using the configured MCP File Path.');
    } else {
      lines.push('No MCP File Path target is configured. Do not use filesystem/project MCP tools yet. Ask the user to choose a file/folder target on the MCP page, or use the browser workspace files already attached by the app.');
    }

    lines.push('[END MCP FILESYSTEM TARGET]');
    return lines.join('\n');
  }

  function formatMcpFilePathSystemPrompt() {
    var context = formatMcpFilePathContext();
    if (!context) return '';
    return [
      context,
      'Routing rule: MCP filesystem/project tools must target the configured MCP File Path selected by the user. The target can be either a file or a folder. Never inspect the MCP tool server itself unless the user explicitly asks for tool internals.'
    ].join('\n');
  }

  function hasMcpMarker(value) {
    var text = String(value || '');
    return text.indexOf(MCP_PATH_MARKER) !== -1 || text.indexOf(LEGACY_MCP_PATH_MARKER) !== -1;
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
    if (hasMcpMarker(current)) return current;
    return [current, next].filter(Boolean).join('\n\n');
  }

  function injectIntoStringInput(value) {
    var text = String(value || '');
    var context = formatMcpFilePathContext();
    if (!context || hasMcpMarker(text)) return text;
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
        if (!inserted && part && part.type === 'text' && typeof part.text === 'string' && !hasMcpMarker(part.text)) {
          inserted = true;
          return Object.assign({}, part, { text: injectIntoStringInput(part.text) });
        }
        return part;
      });
      if (!inserted) next.input.unshift({ type: 'text', text: formatMcpFilePathContext() });
    }

    if (Array.isArray(next.messages)) {
      var hasMarker = next.messages.some(function (message) {
        return hasMcpMarker(message && message.content);
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
    if (Array.isArray(data.files) && data.files[0]) return pickNativePath(data.files[0]);
    return cleanPath(data.path || data.rootPath || data.absolutePath || data.filePath || data.folderPath || data.uri || data.name);
  }

  function updateTargetDetail(input, detail) {
    if (!detail) return;
    var value = cleanPath(input.value);
    var settings = readSettings();
    var targetType = getMcpTargetType(settings);
    if (!value) {
      detail.textContent = 'No MCP target selected. Choose any file or folder, then MCP tools will aim at that target.';
      return;
    }
    var label = targetType === 'file' ? 'File target' : targetType === 'folder' ? 'Folder target' : 'Target';
    detail.textContent = label + ': ' + value;
  }

  function saveInputPath(input, targetType, successMessage, detail) {
    var value = cleanPath(input.value);
    saveMcpFilePath(value, targetType);
    enhanceRequestPreview();
    updateTargetDetail(input, detail);
    if (!value) showToast('MCP file path cleared.');
    else if (!pathLooksAbsolute(value)) showToast('MCP target saved. If the MCP server cannot resolve it, paste the full absolute path.');
    else showToast(successMessage || 'MCP target saved.');
  }

  function findNativePicker(bridge, names) {
    if (!bridge) return null;
    for (var i = 0; i < names.length; i++) {
      if (typeof bridge[names[i]] === 'function') return names[i];
    }
    return null;
  }

  function callMaybeAsync(fn) {
    var result = fn();
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  function installMcpPathPanel() {
    if (window.__signalLmMcpFilePathPanel || !isMcpPage()) return;
    var firstColumn = getMcpFirstColumn();
    if (!firstColumn) return;
    window.__signalLmMcpFilePathPanel = true;

    var settings = readSettings();
    var card = make('section', 'card');
    card.appendChild(make('h2', '', 'MCP File Path / Target'));

    var group = make('div', 'input-group');
    var label = make('label', '', 'Target File Or Folder For MCP Tools');
    label.setAttribute('for', 'mcp-file-path');
    var input = document.createElement('input');
    input.id = 'mcp-file-path';
    input.value = getMcpFilePath(settings);
    input.placeholder = '/storage/emulated/0/Download/file.js or C:/Users/you/project-folder';
    group.appendChild(label);
    group.appendChild(input);
    group.appendChild(make('p', 'hint', 'Choose any file or folder as the active MCP target. File targets are passed as files; folder targets are passed as roots/directories. Browser pickers may only expose names, while the Android/native bridge can return real paths.'));
    var targetDetail = make('p', 'hint');
    targetDetail.id = 'mcp-file-target-detail';
    group.appendChild(targetDetail);
    card.appendChild(group);

    var row = make('div', 'button-row');
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.id = 'save-mcp-file-path';
    saveBtn.textContent = 'Save Target';

    var browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'ghost-btn';
    browseBtn.textContent = 'Browse File';
    browseBtn.addEventListener('click', async function () {
      var bridge = window.lmStudioLiteNative || window.NativeFileBridge || window.SignalLMNativeBridge;
      var pickerName = findNativePicker(bridge, ['selectFile', 'pickFile', 'openFile', 'chooseFile']);
      if (pickerName) {
        try {
          var result = await callMaybeAsync(function () { return bridge[pickerName](); });
          var data = typeof result === 'string' ? JSON.parse(result) : result;
          var selectedPath = pickNativePath(data);
          if (selectedPath) {
            input.value = selectedPath;
            saveInputPath(input, 'file', 'MCP file target updated.', targetDetail);
          } else {
            showToast('Native file picker did not return a usable path.');
          }
          return;
        } catch (error) {
          showToast('Native file picker failed or cancelled.');
          return;
        }
      }

      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        input.value = cleanPath(file.path || file.webkitRelativePath || file.name);
        saveInputPath(input, 'file', 'MCP file target updated.', targetDetail);
      };
      fileInput.click();
    });

    var browseDirBtn = document.createElement('button');
    browseDirBtn.type = 'button';
    browseDirBtn.className = 'ghost-btn';
    browseDirBtn.textContent = 'Browse Folder';
    browseDirBtn.addEventListener('click', async function () {
      var bridge = window.lmStudioLiteNative || window.NativeFileBridge || window.SignalLMNativeBridge;
      var pickerName = findNativePicker(bridge, ['selectFolder', 'pickFolder', 'openFolder', 'chooseFolder', 'selectDirectory']);
      if (pickerName) {
        try {
          var result = await callMaybeAsync(function () { return bridge[pickerName](); });
          var data = typeof result === 'string' ? JSON.parse(result) : result;
          var selectedPath = pickNativePath(data);
          if (selectedPath) {
            input.value = selectedPath;
            saveInputPath(input, 'folder', 'MCP folder target updated.', targetDetail);
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
          } else {
            input.value = file.webkitRelativePath ? file.webkitRelativePath.split('/')[0] : file.name;
          }
          saveInputPath(input, 'folder', 'MCP folder target updated.', targetDetail);
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

    updateTargetDetail(input, targetDetail);
    saveBtn.addEventListener('click', function () { saveInputPath(input, inferTargetType(input.value), 'MCP target saved.', targetDetail); });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      saveInputPath(input, 'target', 'MCP file path cleared.', targetDetail);
    });
    input.addEventListener('change', function () {
      saveMcpFilePath(input.value, inferTargetType(input.value));
      enhanceRequestPreview();
      updateTargetDetail(input, targetDetail);
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
    getMcpTargetType: getMcpTargetType,
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
