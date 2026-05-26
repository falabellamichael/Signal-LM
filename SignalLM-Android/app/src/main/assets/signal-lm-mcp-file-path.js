(function () {
  if (window.SignalLMMcpFilePath) return;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var NATIVE_RESPONSE_KEY = 'lmStudioLite.nativeResponseId.v1';
  var MCP_PATH_MARKER = '[SELECTED MCP TARGET]';
  var LEGACY_MCP_PATH_MARKER = '[MCP FILESYSTEM PATH]';
  var LEGACY_MCP_TARGET_MARKER = '[MCP FILESYSTEM TARGET]';
  var FETCH_PATCH_FLAG = '__signalLmMcpFilePathFetchPatch';
  var nativeModelsCache = { url: '', at: 0, models: [] };

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

  function isAndroidContentUri(path) {
    return /^content:\/\//i.test(cleanPath(path));
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

  function getMcpFilePath(settings) {
    var source = settings || readSettings();
    return cleanPath(source.mcpFilePath);
  }

  function getMcpTargetType(settings) {
    var source = settings || readSettings();
    var explicit = cleanTargetType(source.mcpFileTargetType || source.mcpPathTargetType);
    if (explicit !== 'target') return explicit;
    return inferTargetType(getMcpFilePath(source));
  }

  function targetSignature(settings) {
    var source = settings || readSettings();
    return getMcpTargetType(source) + '|' + getMcpFilePath(source);
  }

  function resetNativeMcpThread() {
    try { localStorage.removeItem(NATIVE_RESPONSE_KEY); } catch (error) {}
  }

  function saveMcpFilePath(path, targetType) {
    var settings = readSettings();
    var previousSignature = targetSignature(settings);
    settings.mcpFilePath = cleanPath(path);
    settings.mcpFileTargetType = cleanTargetType(targetType || settings.mcpFileTargetType || inferTargetType(path));
    var nextSignature = targetSignature(settings);
    if (nextSignature !== previousSignature) {
      resetNativeMcpThread();
      settings.mcpFileTargetRevision = Date.now();
      settings.mcpFileTargetThreadSignature = nextSignature;
    }
    writeSettings(settings);
    return settings;
  }

  function syncThreadToCurrentTarget() {
    var settings = readSettings();
    if (!mcpEnabled(settings)) return;
    var signature = targetSignature(settings);
    if (signature && settings.mcpFileTargetThreadSignature !== signature) {
      resetNativeMcpThread();
      settings.mcpFileTargetThreadSignature = signature;
      settings.mcpFileTargetRevision = settings.mcpFileTargetRevision || Date.now();
      writeSettings(settings);
    }
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
    var absolute = pathLooksAbsolute(path);
    var targetLabel = targetType === 'file' ? 'file' : targetType === 'folder' ? 'folder' : 'file or folder';
    var lines = [
      MCP_PATH_MARKER,
      'This block defines the user-selected filesystem target for MCP tools.',
      'It is NOT asking you to find an MCP tool file, MCP server path, MCP skill file, MCP config file, package directory, or LM Studio skills directory.',
      'Use the selected target below as the tool target. Ignore MCP tool implementation folders unless the user explicitly asks about tool internals.',
      'The selected target may be one file or one folder.'
    ];

    if (path) {
      lines.push('Selected Target Type: ' + targetLabel);
      lines.push('Selected Target Path: ' + path);
      lines.push('Selected Target Path Form: ' + (absolute ? 'absolute or URI-like' : 'browser-visible or relative label'));
      if (isAndroidContentUri(path)) {
        lines.push('Selected Target URI Kind: Android Storage Access Framework content URI.');
        lines.push('Desktop or remote MCP filesystem servers cannot open content:// URIs as normal file paths.');
        lines.push('Do not translate this URI into a Windows path, LM Studio plugin path, MCP server working directory, skills directory, package directory, or any other desktop path.');
        lines.push('Use the app-attached Android workspace manifest and file contents for list/read/search/edit requests. If no workspace files are attached, ask the user to reselect the folder with /select or the MCP Browse Folder button.');
      }
      lines.push('Target Revision: ' + (settings.mcpFileTargetRevision || 'current'));
      lines.push('This selected target supersedes any earlier path remembered in the MCP chat thread. The app resets the native MCP thread when the target changes.');
      if (!absolute) {
        lines.push('If an MCP filesystem tool cannot resolve this browser-visible/relative target, do not fall back to the MCP server directory. Ask for or use a native/absolute path, or use browser workspace context if it is attached.');
      }
      if (targetType === 'file') {
        lines.push('Target Parent Folder: ' + (parts.parent || '<same directory as selected target if relative>'));
        lines.push('Target Filename: ' + (parts.name || '<selected file>'));
        lines.push('For file read/edit/search tools, pass the exact Selected Target Path when a file/path parameter exists.');
        lines.push('If a tool separates root/cwd/directory from file/path, use Target Parent Folder for root/cwd/directory and Target Filename for the file/path parameter.');
        lines.push('Do not replace the selected file target with an MCP tool file or with the MCP server working directory.');
      } else if (targetType === 'folder') {
        if (isAndroidContentUri(path)) {
          lines.push('For directory/project/search/list tools, use the attached Android workspace context from this app. Do not call desktop MCP filesystem tools with the content:// URI.');
        } else {
          lines.push('For directory/project/search/list tools, pass the exact Selected Target Path as root/cwd/directory/path.');
        }
        lines.push('For file-specific tools, operate only inside this selected folder unless the user chooses a different selected target.');
      } else {
        lines.push('Treat the selected path as the active target. If the tool accepts files, pass it exactly. If it requires a directory root and the selected path is a file, use the parent folder and filename separately.');
      }
      lines.push('If a tool response shows unrelated MCP tool files, skill definitions, node_modules, package files, or paths outside the selected target, treat that as the wrong target and retry using the Selected Target Path.');
    } else {
      lines.push('No selected MCP target is configured. Do not use filesystem/project MCP tools yet. Ask the user to choose any file or folder target on the MCP page, or use the browser workspace files already attached by the app.');
    }

    lines.push('[END SELECTED MCP TARGET]');
    return lines.join('\n');
  }

  function formatMcpFilePathSystemPrompt() {
    var context = formatMcpFilePathContext();
    if (!context) return '';
    return [
      context,
      'Routing rule: MCP filesystem/project tools must target the selected file/folder path above. Do not search for MCP tool files, MCP server files, skill files, or config files. If the model is tempted to inspect the MCP tool environment, stop and use the Selected Target Path instead.'
    ].join('\n');
  }

  function hasMcpMarker(value) {
    var text = String(value || '');
    return text.indexOf(MCP_PATH_MARKER) !== -1 || text.indexOf(LEGACY_MCP_PATH_MARKER) !== -1 || text.indexOf(LEGACY_MCP_TARGET_MARKER) !== -1;
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

  function nativeModelsUrlFromChatUrl(resource) {
    var url = requestUrl(resource);
    return url.replace(/\/chat([?#].*)?$/i, '/models$1');
  }

  function parseNativeModels(payload) {
    var list = [];
    if (Array.isArray(payload)) list = payload;
    else if (Array.isArray(payload && payload.data)) list = payload.data;
    else if (Array.isArray(payload && payload.models)) list = payload.models;

    return list.map(function (model) {
      if (typeof model === 'string') return model;
      if (!model || typeof model !== 'object') return '';
      return model.id || model.model || model.name || model.identifier || model.path || '';
    }).map(function (id) {
      return String(id || '').trim();
    }).filter(Boolean);
  }

  function modelCompareKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/^[^/]+\//, '')
      .replace(/:[0-9]+$/, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function selectReplacementModel(currentModel, models) {
    var current = String(currentModel || '').trim();
    if (!models.length) return '';
    if (current && models.indexOf(current) !== -1) return current;

    var currentKey = modelCompareKey(current);
    if (currentKey) {
      var fuzzy = models.find(function (model) {
        var key = modelCompareKey(model);
        return key && (key === currentKey || key.indexOf(currentKey) !== -1 || currentKey.indexOf(key) !== -1);
      });
      if (fuzzy) return fuzzy;
    }

    return models[0];
  }

  function updateSelectedModel(model) {
    var value = String(model || '').trim();
    if (!value) return;
    var settings = readSettings();
    if (settings.model === value) return;
    settings.model = value;
    writeSettings(settings);

    var display = document.getElementById('model-display');
    if (display) display.textContent = value;

    var select = document.getElementById('model-select');
    if (select) {
      var exists = Array.from(select.options || []).some(function (option) { return option.value === value; });
      if (!exists) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
      select.value = value;
    }
  }

  async function fetchNativeModels(originalFetch, resource, init, force) {
    var url = nativeModelsUrlFromChatUrl(resource);
    var now = Date.now();
    if (!force && nativeModelsCache.url === url && nativeModelsCache.models.length && now - nativeModelsCache.at < 30000) {
      return nativeModelsCache.models.slice();
    }

    var headers = new Headers(init && init.headers ? init.headers : {});
    headers.delete('Content-Type');
    var response = await originalFetch(url, { method: 'GET', headers: headers });
    if (!response.ok) return [];
    var payload = await response.json().catch(function () { return null; });
    var models = parseNativeModels(payload);
    nativeModelsCache = { url: url, at: Date.now(), models: models.slice() };
    return models;
  }

  async function resolveNativeMcpModel(originalFetch, resource, init, body, force) {
    var current = body && body.model ? body.model : readSettings().model;
    var models = await fetchNativeModels(originalFetch, resource, init, force);
    var selected = selectReplacementModel(current, models);
    if (selected && selected !== current) {
      updateSelectedModel(selected);
      resetNativeMcpThread();
      showToast('MCP model changed to downloaded model: ' + selected);
    }
    return selected;
  }

  async function responseLooksLikeModelNotFound(response) {
    if (!response || response.ok) return false;
    if (response.status !== 400 && response.status !== 404 && response.status !== 422) return false;
    var text = await response.clone().text().catch(function () { return ''; });
    return /model_not_found|invalid model identifier|valid downloaded model|model .*not.*found|downloaded model/i.test(text);
  }

  async function sendNativeMcpChat(originalFetch, resource, init, parsed) {
    syncThreadToCurrentTarget();
    var injected = injectMcpFilePathIntoBody(parsed);

    if (!injected.model) {
      var initialModel = await resolveNativeMcpModel(originalFetch, resource, init, injected, false);
      if (initialModel) injected.model = initialModel;
    }

    var firstResponse = await originalFetch(resource, cloneFetchInit(init, injected));
    if (!(await responseLooksLikeModelNotFound(firstResponse))) return firstResponse;

    var replacement = await resolveNativeMcpModel(originalFetch, resource, init, injected, true);
    if (!replacement || replacement === injected.model) return firstResponse;

    injected.model = replacement;
    delete injected.response_id;
    resetNativeMcpThread();
    showToast('Retrying MCP with downloaded model: ' + replacement);
    return originalFetch(resource, cloneFetchInit(init, injected));
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
            return sendNativeMcpChat(originalFetch, resource, init, parsed);
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

  function pickNativePath(data, targetType) {
    if (!data || typeof data !== 'object') return cleanPath(data);
    var type = cleanTargetType(targetType);
    if (type === 'folder') {
      return cleanPath(data.folderPath || data.rootPath || data.directoryPath || data.treeUri || data.uri || data.path || data.absolutePath || data.name);
    }
    if (Array.isArray(data.files) && data.files[0]) return pickNativePath(data.files[0], targetType);
    return cleanPath(data.path || data.filePath || data.absolutePath || data.uri || data.rootPath || data.folderPath || data.name);
  }

  function updateTargetDetail(input, detail) {
    if (!detail) return;
    var value = cleanPath(input.value);
    var settings = readSettings();
    var targetType = getMcpTargetType(settings);
    if (!value) {
      detail.textContent = 'No MCP target selected. Choose any file or folder, then MCP tools will aim at that selected target.';
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
    if (!value) showToast('MCP target cleared.');
    else if (!pathLooksAbsolute(value)) showToast('MCP target saved. If the MCP server cannot resolve it, use the native picker or paste the full absolute path.');
    else showToast(successMessage || 'MCP target saved. MCP thread reset for the new target.');
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

  function callNativePicker(bridge, pickerName) {
    if (pickerName === 'triggerSelectFolder') {
      return new Promise(function (resolve, reject) {
        window.__selectFolderResolve = resolve;
        window.__selectFolderReject = reject;
        bridge.triggerSelectFolder();
      });
    }
    return callMaybeAsync(function () { return bridge[pickerName](); });
  }

  function loadNativeWorkspaceFromPickerData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.files)) return;
    var api = window.SignalLMChatCommands;
    if (api && typeof api.loadNativeWorkspace === 'function') {
      Promise.resolve(api.loadNativeWorkspace(data)).catch(function () {
        try { window.dispatchEvent(new CustomEvent('workspaceSelected', { detail: data })); } catch (error) { try { window.dispatchEvent(new Event('workspaceSelected')); } catch (ignored) {} }
      });
      return;
    }
    try { window.dispatchEvent(new CustomEvent('workspaceSelected', { detail: data })); } catch (error) { try { window.dispatchEvent(new Event('workspaceSelected')); } catch (ignored) {} }
  }

  function installMcpPathPanel() {
    if (window.__signalLmMcpFilePathPanel || !isMcpPage()) return;
    var firstColumn = getMcpFirstColumn();
    if (!firstColumn) return;
    window.__signalLmMcpFilePathPanel = true;

    var settings = readSettings();
    var card = make('section', 'card');
    card.appendChild(make('h2', '', 'MCP Selected Target'));

    var group = make('div', 'input-group');
    var label = make('label', '', 'Target File Or Folder For MCP Tools');
    label.setAttribute('for', 'mcp-file-path');
    var input = document.createElement('input');
    input.id = 'mcp-file-path';
    input.value = getMcpFilePath(settings);
    input.placeholder = '/storage/emulated/0/Download/file.js or C:/Users/you/project-folder';
    group.appendChild(label);
    group.appendChild(input);
    group.appendChild(make('p', 'hint', 'Choose any file or folder as the active MCP target. This is the target MCP tools should operate on, not a path to an MCP tool file. File targets are passed as files; folder targets are passed as roots/directories.'));
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
          var selectedPath = pickNativePath(data, 'file');
          if (selectedPath) {
            input.value = selectedPath;
            saveInputPath(input, 'file', 'MCP file target updated. MCP thread reset.', targetDetail);
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
        saveInputPath(input, 'file', 'MCP file target updated. MCP thread reset.', targetDetail);
      };
      fileInput.click();
    });

    var browseDirBtn = document.createElement('button');
    browseDirBtn.type = 'button';
    browseDirBtn.className = 'ghost-btn';
    browseDirBtn.textContent = 'Browse Folder';
    browseDirBtn.addEventListener('click', async function () {
      var bridge = window.lmStudioLiteNative || window.NativeFileBridge || window.SignalLMNativeBridge;
      var pickerName = findNativePicker(bridge, ['selectFolder', 'pickFolder', 'openFolder', 'chooseFolder', 'selectDirectory', 'triggerSelectFolder']);
      if (pickerName) {
        try {
          var result = await callNativePicker(bridge, pickerName);
          var data = typeof result === 'string' ? JSON.parse(result) : result;
          var selectedPath = pickNativePath(data, 'folder');
          if (selectedPath) {
            input.value = selectedPath;
            saveInputPath(input, 'folder', 'MCP folder target updated. MCP thread reset.', targetDetail);
            loadNativeWorkspaceFromPickerData(data);
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
          } else if (file.webkitRelativePath && file.webkitRelativePath.indexOf('/') !== -1) {
            input.value = file.webkitRelativePath.split('/')[0];
          } else {
            showToast('Folder picker returned a file without its folder path. Use the native folder picker or paste the folder path.');
            return;
          }
          saveInputPath(input, 'folder', 'MCP folder target updated. MCP thread reset.', targetDetail);
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
    saveBtn.addEventListener('click', function () { saveInputPath(input, inferTargetType(input.value), 'MCP target saved. MCP thread reset.', targetDetail); });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      saveInputPath(input, 'target', 'MCP target cleared.', targetDetail);
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
    syncThreadToCurrentTarget();
    installChatContextPatch();
    installMcpPathPanel();
    observePreview();
  }

  window.SignalLMMcpFilePath = {
    readSettings: readSettings,
    saveMcpFilePath: saveMcpFilePath,
    getMcpFilePath: getMcpFilePath,
    getMcpTargetType: getMcpTargetType,
    resetNativeMcpThread: resetNativeMcpThread,
    syncThreadToCurrentTarget: syncThreadToCurrentTarget,
    formatMcpFilePathContext: formatMcpFilePathContext,
    formatMcpFilePathSystemPrompt: formatMcpFilePathSystemPrompt,
    injectMcpFilePathIntoBody: injectMcpFilePathIntoBody,
    isAndroidContentUri: isAndroidContentUri,
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
