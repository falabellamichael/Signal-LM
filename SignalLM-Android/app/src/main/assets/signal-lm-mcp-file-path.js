(function () {
  if (window.SignalLMMcpFilePath) return;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function saveMcpFilePath(path) {
    var settings = readSettings();
    settings.mcpFilePath = String(path || '').trim();
    writeSettings(settings);
    return settings;
  }

  function getMcpFilePath(settings) {
    var source = settings || readSettings();
    return String(source.mcpFilePath || '').trim();
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
      '[MCP FILESYSTEM PATH]',
      'MCP is enabled. Browser folder/workspace access is separate from MCP server filesystem access.'
    ];
    if (path) {
      lines.push('Filesystem path for MCP tools: ' + path);
      lines.push('When using MCP filesystem or project tools, pass this exact path/root/path parameter unless the user gives a different path in the message.');
    } else {
      lines.push('No MCP filesystem path is configured. Folder/workspace context can still work without MCP, but MCP filesystem tools need an explicit local path. Ask the user to set MCP File Path on the MCP page before using filesystem MCP tools.');
    }
    lines.push('[END MCP FILESYSTEM PATH]');
    return lines.join('\n');
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

  function isMcpPage() {
    return /(^|\/)mcp\.html$/i.test(location.pathname) || Boolean(document.querySelector('a.nav-link.active[href="mcp.html"]'));
  }

  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  function installMcpPathPanel() {
    if (window.__signalLmMcpFilePathPanel || !isMcpPage()) return;
    var firstColumn = document.querySelector('.grid > div') || document.querySelector('.grid');
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
    group.appendChild(make('p', 'hint', 'Folders work without MCP through the app workspace picker. MCP servers run separately, so filesystem MCP tools need a real local path they can use as root/path.'));
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
        if (file) {
          input.value = file.path || file.name;
          saveMcpFilePath(input.value);
          enhanceRequestPreview();
          showToast('File path updated.');
        }
      };
      fileInput.click();
    });

    var browseDirBtn = document.createElement('button');
    browseDirBtn.type = 'button';
    browseDirBtn.className = 'ghost-btn';
    browseDirBtn.textContent = 'Browse Folder';
    browseDirBtn.addEventListener('click', function () {
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.webkitdirectory = true;
      fileInput.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) {
          var pathStr = file.path ? file.path.replace(/[\/\\][^\/\\]+$/, '') : (file.webkitRelativePath ? file.webkitRelativePath.split('/')[0] : file.name);
          input.value = pathStr;
          saveMcpFilePath(input.value);
          enhanceRequestPreview();
          showToast('Folder path updated.');
        }
      };
      fileInput.click();
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

    function save() {
      saveMcpFilePath(input.value);
      enhanceRequestPreview();
      showToast(input.value.trim() ? 'MCP file path saved.' : 'MCP file path cleared.');
    }

    saveBtn.addEventListener('click', save);
    clearBtn.addEventListener('click', function () {
      input.value = '';
      save();
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
      var settings = readSettings();
      var path = getMcpFilePath(settings);
      var marker = '[MCP FILESYSTEM PATH]';
      var pathValue = path || '<set MCP File Path before using filesystem MCP tools>';

      if (typeof parsed.body.input === 'string' && parsed.body.input.indexOf(marker) === -1) {
        parsed.body.input = (formatMcpFilePathContext() + '\n\n' + parsed.body.input).trim();
      }

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
    installChatContextPatch();
    installMcpPathPanel();
    observePreview();
  }

  window.SignalLMMcpFilePath = {
    readSettings: readSettings,
    saveMcpFilePath: saveMcpFilePath,
    getMcpFilePath: getMcpFilePath,
    formatMcpFilePathContext: formatMcpFilePathContext,
    installChatContextPatch: installChatContextPatch,
    installMcpPathPanel: installMcpPathPanel,
    enhanceRequestPreview: enhanceRequestPreview
  };

  var timer = setInterval(installWhenReady, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady);
  else installWhenReady();
})();
