const STORAGE_KEYS = {
      settings: 'lmStudioLite.settings.v1',
      messages: 'lmStudioLite.messages.v1',
      nativeResponseId: 'lmStudioLite.nativeResponseId.v1'
    };

    const DEFAULT_SETTINGS = {
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: '',
      temperature: 0.7,
      topP: 1,
      maxTokens: 500,
      systemPrompt: 'You are a concise, helpful local assistant.',
      persistChat: true,
      speechVoice: '',
      speechRate: 1,
      speechPitch: 1,
      autoSpeak: false,
      mcpEnabled: false,
      mcpContextLength: 8000,
      mcpServers: []
    };

    let settings = loadSettings();

    const els = {
      enabled: document.getElementById('mcp-enabled'),
      contextLength: document.getElementById('context-length'),
      newType: document.getElementById('new-type'),
      newLabel: document.getElementById('new-label'),
      newUrl: document.getElementById('new-url'),
      newPluginId: document.getElementById('new-plugin-id'),
      newTools: document.getElementById('new-tools'),
      newHeaders: document.getElementById('new-headers'),
      newUrlGroup: document.getElementById('new-url-group'),
      newPluginGroup: document.getElementById('new-plugin-group'),
      newHeadersGroup: document.getElementById('new-headers-group'),
      serverList: document.getElementById('server-list'),
      preview: document.getElementById('request-preview'),
      statusBadge: document.getElementById('status-badge'),
      statusDetail: document.getElementById('status-detail'),
      toast: document.getElementById('toast')
    };

    function loadSettings() {
      try {
        const loaded = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
        return { ...DEFAULT_SETTINGS, ...loaded, mcpServers: Array.isArray(loaded.mcpServers) ? loaded.mcpServers : [] };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    function saveSettings() {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    }

    function normalizeBaseUrl(url) {
      return (url || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '');
    }

    function nativeApiBaseUrl() {
      const base = normalizeBaseUrl(settings.baseUrl);
      if (/\/api\/v1$/i.test(base)) return base;
      if (/\/v1$/i.test(base)) return base.replace(/\/v1$/i, '/api/v1');
      return base + '/api/v1';
    }

    function nativeEndpoint(path) {
      return nativeApiBaseUrl() + path;
    }

    function getHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      return headers;
    }

    function showToast(message) {
      els.toast.textContent = message;
      els.toast.classList.add('show');
      setTimeout(() => els.toast.classList.remove('show'), 2800);
    }

    function setStatus(kind, text, detail) {
      els.statusBadge.className = `badge ${kind}`;
      els.statusBadge.textContent = text;
      els.statusDetail.textContent = detail;
    }

    function parseTools(value) {
      return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    }

    function parseHeaders(value) {
      const text = String(value || '').trim();
      if (!text) return {};
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Headers JSON must be an object.');
      }
      return parsed;
    }

    function getEnabledMcpServers() {
      return Array.isArray(settings.mcpServers)
        ? settings.mcpServers.filter(server => server && server.enabled !== false)
        : [];
    }

    function buildMcpIntegrations() {
      return getEnabledMcpServers().map(server => {
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
        if (server.headers && typeof server.headers === 'object' && Object.keys(server.headers).length) {
          integration.headers = server.headers;
        }

        return integration;
      }).filter(Boolean);
    }

    function buildPreviewRequest() {
      const body = {
        model: settings.model || '<select-model-in-settings>',
        input: 'Your message here',
        integrations: buildMcpIntegrations(),
        context_length: Math.max(1024, parseInt(settings.mcpContextLength, 10) || 8000),
        temperature: Number(settings.temperature) || 0.7,
        max_output_tokens: parseInt(settings.maxTokens, 10) || 500,
        store: true
      };

      const systemPrompt = (settings.systemPrompt || '').trim();
      if (systemPrompt) body.system_prompt = systemPrompt;
      return body;
    }

    function saveMcpSettings() {
      settings.mcpEnabled = els.enabled.checked;
      settings.mcpContextLength = Math.max(1024, parseInt(els.contextLength.value, 10) || 8000);
      saveSettings();
      renderAll();
      showToast('MCP settings saved.');
    }

    function syncNewTypeFields() {
      const isPlugin = els.newType.value === 'plugin';
      els.newUrlGroup.style.display = isPlugin ? 'none' : 'block';
      els.newPluginGroup.style.display = isPlugin ? 'block' : 'none';
      els.newHeadersGroup.style.display = isPlugin ? 'none' : 'block';
    }

    function addIntegration() {
      try {
        const type = els.newType.value;
        const label = els.newLabel.value.trim();
        const allowedTools = parseTools(els.newTools.value);
        let server;

        if (type === 'plugin') {
          const id = els.newPluginId.value.trim();
          if (!id) throw new Error('Plugin ID is required.');
          server = { type, label: label || id, id, allowedTools, enabled: true };
        } else {
          const serverUrl = els.newUrl.value.trim();
          if (!serverUrl) throw new Error('Server URL is required.');
          server = {
            type: 'ephemeral_mcp',
            label: label || 'remote-mcp',
            serverLabel: (label || 'remote-mcp').replace(/\s+/g, '-').toLowerCase(),
            serverUrl,
            allowedTools,
            headers: parseHeaders(els.newHeaders.value),
            enabled: true
          };
        }

        settings.mcpServers.push(server);
        saveSettings();
        clearNewForm();
        renderAll();
        showToast('MCP integration added.');
      } catch (error) {
        showToast(error.message || 'Could not add integration.');
      }
    }

    function clearNewForm() {
      els.newLabel.value = '';
      els.newUrl.value = '';
      els.newPluginId.value = '';
      els.newTools.value = '';
      els.newHeaders.value = '';
      els.newType.value = 'ephemeral_mcp';
      syncNewTypeFields();
    }

    function addHuggingFaceExample() {
      settings.mcpServers.push({
        type: 'ephemeral_mcp',
        label: 'Hugging Face',
        serverLabel: 'huggingface',
        serverUrl: 'https://huggingface.co/mcp',
        allowedTools: ['model_search'],
        headers: {},
        enabled: true
      });
      settings.mcpEnabled = true;
      saveSettings();
      renderAll();
      showToast('Hugging Face MCP example added.');
    }

    function addPlaywrightExample() {
      settings.mcpServers.push({
        type: 'plugin',
        label: 'Playwright',
        id: 'mcp/playwright',
        allowedTools: ['browser_navigate'],
        enabled: true
      });
      settings.mcpEnabled = true;
      saveSettings();
      renderAll();
      showToast('Playwright plugin example added.');
    }

    function updateServer(index, key, value) {
      const server = settings.mcpServers[index];
      if (!server) return;

      if (key === 'enabled') server.enabled = Boolean(value);
      else if (key === 'allowedTools') server.allowedTools = parseTools(value);
      else if (key === 'headers') {
        try {
          server.headers = parseHeaders(value);
        } catch (error) {
          showToast(error.message);
          return;
        }
      } else server[key] = value;

      saveSettings();
      renderPreview();
    }

    function deleteServer(index) {
      settings.mcpServers.splice(index, 1);
      saveSettings();
      renderAll();
      showToast('Integration removed.');
    }

    function duplicateServer(index) {
      const server = settings.mcpServers[index];
      if (!server) return;
      settings.mcpServers.splice(index + 1, 0, JSON.parse(JSON.stringify({ ...server, label: `${server.label || 'MCP'} Copy` })));
      saveSettings();
      renderAll();
      showToast('Integration duplicated.');
    }

    function renderServers() {
      if (!settings.mcpServers.length) {
        els.serverList.innerHTML = '<p class="hint">No MCP integrations configured yet.</p>';
        return;
      }

      els.serverList.innerHTML = '';
      settings.mcpServers.forEach((server, index) => {
        const isPlugin = server.type === 'plugin';
        const card = document.createElement('div');
        card.className = 'server-card';

        const title = server.label || server.serverLabel || server.id || 'MCP Integration';
        const target = isPlugin ? (server.id || '') : (server.serverUrl || '');
        const tools = Array.isArray(server.allowedTools) ? server.allowedTools.join(', ') : '';
        const headers = !isPlugin && server.headers && Object.keys(server.headers).length ? JSON.stringify(server.headers, null, 2) : '';

        card.innerHTML = `
          <div class="server-head">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <p class="hint">${escapeHtml(isPlugin ? 'mcp.json plugin' : 'remote / ephemeral MCP')}</p>
            </div>
            <span class="badge ${server.enabled === false ? 'off' : 'on'}">${server.enabled === false ? 'Disabled' : 'Enabled'}</span>
          </div>

          <div class="switch-row" style="margin:0;">
            <div>
              <strong>Use in chat</strong>
              <p>Include this integration when MCP is enabled.</p>
            </div>
            <input type="checkbox" ${server.enabled === false ? '' : 'checked'} data-action="enabled" />
          </div>

          <div class="two-col">
            <div class="input-group">
              <label>Label</label>
              <input value="${escapeHtml(server.label || '')}" data-field="label" />
            </div>
            <div class="input-group">
              <label>${isPlugin ? 'Plugin ID' : 'Server Label'}</label>
              <input value="${escapeHtml(isPlugin ? (server.id || '') : (server.serverLabel || ''))}" data-field="${isPlugin ? 'id' : 'serverLabel'}" />
            </div>
          </div>

          ${isPlugin ? '' : `
            <div class="input-group">
              <label>Server URL</label>
              <input value="${escapeHtml(server.serverUrl || '')}" data-field="serverUrl" />
            </div>
          `}

          <div class="input-group">
            <label>Allowed Tools</label>
            <input value="${escapeHtml(tools)}" data-field="allowedTools" />
            <p class="hint">Comma-separated. Leave blank to allow all tools.</p>
          </div>

          ${isPlugin ? '' : `
            <div class="input-group">
              <label>Headers JSON</label>
              <textarea data-field="headers">${escapeHtml(headers)}</textarea>
            </div>
          `}

          <div class="button-row" style="margin-top:0;">
            <button class="ghost-btn" type="button" data-action="duplicate">Duplicate</button>
            <button class="danger-btn" type="button" data-action="delete">Delete</button>
          </div>
        `;

        card.querySelector('[data-action="enabled"]').addEventListener('change', event => {
          updateServer(index, 'enabled', event.target.checked);
          renderAll();
        });

        card.querySelectorAll('[data-field]').forEach(input => {
          input.addEventListener('change', event => updateServer(index, event.target.dataset.field, event.target.value));
        });

        card.querySelector('[data-action="duplicate"]').addEventListener('click', () => duplicateServer(index));
        card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteServer(index));

        els.serverList.appendChild(card);
      });
    }

    function renderPreview() {
      const body = buildPreviewRequest();
      els.preview.textContent = JSON.stringify({
        url: nativeEndpoint('/chat'),
        method: 'POST',
        body
      }, null, 2);
    }

    function renderAll() {
      settings = loadSettings();
      els.enabled.checked = Boolean(settings.mcpEnabled);
      els.contextLength.value = settings.mcpContextLength || 8000;
      renderServers();
      renderPreview();
    }

    async function copyText(value, successMessage = 'Copied.') {
      const text = String(value || '');
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        showToast(successMessage);
      } catch (error) {
        showToast('Copy failed. Select the text manually.');
      }
    }

    function copyPreview() {
      copyText(els.preview.textContent, 'Copied request JSON.');
    }

    function resetNativeThread() {
      localStorage.removeItem(STORAGE_KEYS.nativeResponseId);
      showToast('MCP chat thread reset.');
    }

    async function testNativeModels() {
      setStatus('warn', 'Checking', `Testing ${nativeEndpoint('/models')}`);
      try {
        const response = await fetch(nativeEndpoint('/models'), { headers: getHeaders() });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const models = Array.isArray(payload.data) ? payload.data.length : Array.isArray(payload.models) ? payload.models.length : 0;
        setStatus('on', 'Connected', `Native REST API responded. ${models} model${models === 1 ? '' : 's'} returned.`);
      } catch (error) {
        setStatus('error', 'Failed', error.message || 'Could not reach native REST API.');
      }
    }

    async function testMcpChat() {
      saveMcpSettings();
      const integrations = buildMcpIntegrations();
      if (!settings.model) {
        showToast('Choose a model in Settings first.');
        return;
      }
      if (!integrations.length) {
        showToast('Add and enable at least one MCP integration first.');
        return;
      }

      setStatus('warn', 'Testing', 'Sending a short /api/v1/chat request with MCP integrations.');
      try {
        const response = await fetch(nativeEndpoint('/chat'), {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            model: settings.model,
            input: 'Reply with exactly: MCP ready',
            integrations,
            context_length: Math.max(1024, parseInt(settings.mcpContextLength, 10) || 8000),
            temperature: 0,
            max_output_tokens: 32,
            store: false
          })
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `HTTP ${response.status}`);
        }

        const payload = await response.json();
        const finalMessage = extractMessage(payload) || 'No message returned.';
        setStatus('on', 'MCP request sent', finalMessage.slice(0, 180));
      } catch (error) {
        setStatus('error', 'MCP failed', error.message || 'Could not complete MCP smoke test.');
      }
    }

    function extractMessage(result) {
      if (!result || !Array.isArray(result.output)) return '';
      return result.output
        .filter(item => item.type === 'message' && item.content)
        .map(item => item.content)
        .join('\n\n')
        .trim();
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    syncNewTypeFields();
    renderAll();