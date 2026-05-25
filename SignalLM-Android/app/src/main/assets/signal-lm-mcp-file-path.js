(function () {
  if (window.SignalLMMcpFilePath) return;

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  }

  function saveMcpFilePath(path) {
    const settings = readSettings();
    settings.mcpFilePath = String(path || '').trim();
    writeSettings(settings);
    return settings;
  }

  function getMcpFilePath(settings = readSettings()) {
    return String(settings.mcpFilePath || '').trim();
  }

  function mcpEnabled(settings = readSettings()) {
    return Boolean(settings.mcpEnabled);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function formatMcpFilePathContext() {
    const settings = readSettings();
    if (!mcpEnabled(settings)) return '';
    const path = getMcpFilePath(settings);
    const lines = [
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
    const previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      const existing = await previous.apply(this, arguments);
      const mcpPathContext = formatMcpFilePathContext(userText);
      return [existing, mcpPathContext].filter(Boolean).join('\n\n');
    };
  }

  function isMcpPage() {
    return /(^|\/)mcp\.html$/i.test(location.pathname) || Boolean(document.querySelector('a.nav-link.active[href="mcp.html"]'));
  }

  function installMcpPathPanel() {
    if (window.__signalLmMcpFilePathPanel || !isMcpPage()) return;
    const firstColumn = document.querySelector('.grid > div') || document.querySelector('.grid');
    if (!firstColumn) return;
    window.__signalLmMcpFilePathPanel = true;

    const settings = readSettings();
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
      <h2>MCP File Path</h2>
      <div class="input-group">
        <label for="mcp-file-path">Filesystem Path For MCP Tools</label>
        <input id="mcp-file-path" value="${escapeHtml(getMcpFilePath(settings))}" placeholder="/storage/emulated/0/Download/Signal-LM or C:\\Users\\you\\Signal-LM" />
        <p class="hint">Folders work without MCP through the app workspace picker. MCP servers run separately, so filesystem MCP tools need a real local path they can use as root/path.</p>
      </div>
      <div class="button-row">
        <button type="button" id="save-mcp-file-path">Save MCP File Path</button>
        <button class="ghost-btn" type="button" id="clear-mcp-file-path">Clear</button>
      </div>
    `;

    const controlCard = firstColumn.querySelector('.card');
    if (controlCard && controlCard.nextSibling) firstColumn.insertBefore(card, controlCard.nextSibling);
    else firstColumn.insertBefore(card, firstColumn.firstChild || null);

    const input = card.querySelector('#mcp-file-path');
    const save = () => {
      saveMcpFilePath(input.value);
      enhanceRequestPreview();
      showToast(input.value.trim() ? 'MCP file path saved.' : 'MCP file path cleared.');
    };

    card.querySelector('#save-mcp-file-path').addEventListener('click', save);
    card.querySelector('#clear-mcp-file-path').addEventListener('click', () => {
      input.value = '';
      save();
    });
    input.addEventListener('change', () => {
      saveMcpFilePath(input.value);
      enhanceRequestPreview();
    });
  }

  let previewUpdating = false;

  function enhanceRequestPreview() {
    const preview = document.getElementById('request-preview');
    if (!preview || previewUpdating) return;
    const raw = String(preview.textContent || '').trim();
    if (!raw || raw[0] !== '{') return;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.body || typeof parsed.body !== 'object') return;
      const settings = readSettings();
      const path = getMcpFilePath(settings);
      const marker = '[MCP FILESYSTEM PATH]';
      const pathValue = path || '<set MCP File Path before using filesystem MCP tools>';

      parsed.body.mcp_file_path = pathValue;
      if (typeof parsed.body.input === 'string' && !parsed.body.input.includes(marker)) {
        parsed.body.input = `${formatMcpFilePathContext()}\n\n${parsed.body.input}`.trim();
      }

      previewUpdating = true;
      preview.textContent = JSON.stringify(parsed, null, 2);
      previewUpdating = false;
    } catch {
      previewUpdating = false;
    }
  }

  function observePreview() {
    const preview = document.getElementById('request-preview');
    if (!preview || preview.__signalLmMcpFilePathObserver) return;
    preview.__signalLmMcpFilePathObserver = true;
    const observer = new MutationObserver(() => enhanceRequestPreview());
    observer.observe(preview, { childList: true, characterData: true, subtree: true });
    setTimeout(enhanceRequestPreview, 0);
  }

  function installWhenReady() {
    installChatContextPatch();
    installMcpPathPanel();
    observePreview();
  }

  window.SignalLMMcpFilePath = {
    readSettings,
    saveMcpFilePath,
    getMcpFilePath,
    formatMcpFilePathContext,
    installChatContextPatch,
    installMcpPathPanel,
    enhanceRequestPreview
  };

  const timer = setInterval(installWhenReady, 200);
  setTimeout(() => clearInterval(timer), 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady);
  else installWhenReady();
})();
