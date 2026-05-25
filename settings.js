const STORAGE_KEYS = {
      settings: 'lmStudioLite.settings.v1',
      messages: 'lmStudioLite.messages.v1'
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
      theme: 'system',
      runtimeMode: 'server',
      hybridStrategy: 'fallback',
      hybridFallbackMs: 12000,
      androidBackend: 'vulkan',
      androidGpuLayers: 99,
      androidThreads: 4,
      androidContextLength: 4096,
      androidBatchSize: 512,
      androidUseMmap: true,
      androidUseMlock: false,
      contextHelperEnabled: true,
      contextHelperMode: 'smart',
      contextHelperMaxSnippets: 16,
      contextHelperMaxChars: 70000
    };

    let settings = loadSettings();

    const els = {
      baseUrl: document.getElementById('base-url'),
      apiKey: document.getElementById('api-key'),
      defaultModel: document.getElementById('default-model'),
      temperature: document.getElementById('temperature'),
      topP: document.getElementById('top-p'),
      maxTokens: document.getElementById('max-tokens'),
      systemPrompt: document.getElementById('system-prompt'),
      persistChat: document.getElementById('persist-chat'),
      statusPill: document.getElementById('status-pill'),
      statusText: document.getElementById('status-text'),
      statusDetail: document.getElementById('status-detail'),
      modelList: document.getElementById('model-list'),
      toast: document.getElementById('toast'),
      themeSelect: document.getElementById('theme-select'),
      contextHelperEnabled: document.getElementById('context-helper-enabled'),
      contextHelperMode: document.getElementById('context-helper-mode'),
      contextHelperMaxSnippets: document.getElementById('context-helper-max-snippets'),
      contextHelperMaxChars: document.getElementById('context-helper-max-chars'),
      runtimeMode: document.getElementById('runtime-mode'),
      hybridStrategy: document.getElementById('hybrid-strategy'),
      hybridFallbackMs: document.getElementById('hybrid-fallback-ms'),
      androidThreads: document.getElementById('android-threads'),
      androidGpuLayers: document.getElementById('android-gpu-layers'),
      androidContextLength: document.getElementById('android-context-length'),
      androidBatchSize: document.getElementById('android-batch-size')
    };

    function loadSettings() {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}') };
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

    function endpoint(path) {
      return normalizeBaseUrl(settings.baseUrl) + path;
    }

    function getAuthHeaders() {
      return settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {};
    }

    function showToast(message) {
      els.toast.textContent = message;
      els.toast.classList.add('show');
      setTimeout(() => els.toast.classList.remove('show'), 2800);
    }

    function setStatus(type, text, detail) {
      els.statusPill.classList.remove('connected', 'error', 'checking');
      els.statusPill.classList.add(type);
      els.statusText.textContent = text;
      els.statusDetail.textContent = detail;
    }

    function fillForm() {
      if (els.themeSelect) els.themeSelect.value = settings.theme || DEFAULT_SETTINGS.theme;
      els.baseUrl.value = settings.baseUrl;
      els.apiKey.value = settings.apiKey || '';
      els.runtimeMode.value = settings.runtimeMode || DEFAULT_SETTINGS.runtimeMode;
      els.hybridStrategy.value = settings.hybridStrategy || DEFAULT_SETTINGS.hybridStrategy;
      els.hybridFallbackMs.value = settings.hybridFallbackMs || DEFAULT_SETTINGS.hybridFallbackMs;
      els.androidThreads.value = settings.androidThreads || DEFAULT_SETTINGS.androidThreads;
      els.androidGpuLayers.value = settings.androidGpuLayers ?? DEFAULT_SETTINGS.androidGpuLayers;
      els.androidContextLength.value = settings.androidContextLength || DEFAULT_SETTINGS.androidContextLength;
      els.androidBatchSize.value = settings.androidBatchSize || DEFAULT_SETTINGS.androidBatchSize;
      if (els.contextHelperEnabled) els.contextHelperEnabled.checked = settings.contextHelperEnabled !== false;
      if (els.contextHelperMode) els.contextHelperMode.value = settings.contextHelperMode || DEFAULT_SETTINGS.contextHelperMode;
      if (els.contextHelperMaxSnippets) els.contextHelperMaxSnippets.value = settings.contextHelperMaxSnippets || DEFAULT_SETTINGS.contextHelperMaxSnippets;
      if (els.contextHelperMaxChars) els.contextHelperMaxChars.value = settings.contextHelperMaxChars || DEFAULT_SETTINGS.contextHelperMaxChars;
      els.defaultModel.value = settings.model || '';
      els.temperature.value = settings.temperature;
      els.topP.value = settings.topP;
      els.maxTokens.value = settings.maxTokens;
      els.systemPrompt.value = settings.systemPrompt || '';
      els.persistChat.checked = Boolean(settings.persistChat);
    }

    function saveConnection() {
      settings.baseUrl = normalizeBaseUrl(els.baseUrl.value);
      settings.apiKey = els.apiKey.value.trim();
      saveSettings();
      showToast('Connection settings saved.');
    }


    function saveAppearance() {
      settings.theme = els.themeSelect?.value || DEFAULT_SETTINGS.theme;
      saveSettings();
      if (window.LmStudioLiteTheme) window.LmStudioLiteTheme.setTheme(settings.theme);
      showToast('Appearance saved.');
    }

    function getNativeInferenceBridge() {
      return window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidInferenceBridge || null;
    }

    function asPromise(value) {
      return value && typeof value.then === 'function' ? value : Promise.resolve(value);
    }

    function parseMaybeJson(value) {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed || !/^[{[]/.test(trimmed)) return value;
      try { return JSON.parse(trimmed); } catch { return value; }
    }

    function saveRuntimeSettings() {
      settings.runtimeMode = els.runtimeMode.value;
      settings.hybridStrategy = els.hybridStrategy.value;
      settings.hybridFallbackMs = Math.max(1000, parseInt(els.hybridFallbackMs.value, 10) || DEFAULT_SETTINGS.hybridFallbackMs);
      settings.androidBackend = 'vulkan';
      settings.androidThreads = Math.max(1, parseInt(els.androidThreads.value, 10) || DEFAULT_SETTINGS.androidThreads);
      settings.androidGpuLayers = Math.max(0, parseInt(els.androidGpuLayers.value, 10) || DEFAULT_SETTINGS.androidGpuLayers);
      settings.androidContextLength = Math.max(1024, parseInt(els.androidContextLength.value, 10) || DEFAULT_SETTINGS.androidContextLength);
      settings.androidBatchSize = Math.max(32, parseInt(els.androidBatchSize.value, 10) || DEFAULT_SETTINGS.androidBatchSize);
      saveSettings();
      fillForm();
      showToast('Runtime settings saved.');
    }

    async function testNativeRuntime() {
      saveRuntimeSettings();
      setStatus('checking', 'Checking', 'Testing Android native Vulkan runtime bridge.');
      els.modelList.innerHTML = '';
      const bridge = getNativeInferenceBridge();
      if (!bridge) {
        setStatus('error', 'No bridge', 'The app wrapper has not exposed window.lmStudioLiteNative, NativeInferenceBridge, or AndroidInferenceBridge.');
        renderModels([]);
        return;
      }
      try {
        const status = bridge.getHardwareStatus ? parseMaybeJson(await asPromise(bridge.getHardwareStatus())) : {};
        const payload = bridge.listModels ? await asPromise(bridge.listModels()) : bridge.getModels ? await asPromise(bridge.getModels()) : [];
        const parsed = parseMaybeJson(payload);
        const models = Array.isArray(parsed)
          ? parsed.map(model => typeof model === 'string' ? model : (model.id || model.name)).filter(Boolean)
          : Array.isArray(parsed?.data)
            ? parsed.data.map(model => model.id || model.name).filter(Boolean)
            : Array.isArray(parsed?.models)
              ? parsed.models.map(model => model.id || model.name).filter(Boolean)
              : [];
        const detail = `Native bridge ready${status?.gpu ? ` · GPU: ${status.gpu}` : ''}${status?.ram ? ` · RAM: ${status.ram}` : ''}. ${models.length} model${models.length === 1 ? '' : 's'} returned.`;
        setStatus('connected', 'Android Runtime', detail);
        renderModels(models);
        if (!settings.model && models[0]) {
          settings.model = models[0];
          saveSettings();
          fillForm();
        }
      } catch (error) {
        console.error(error);
        setStatus('error', 'Runtime error', error.message || 'Could not use Android native runtime.');
        renderModels([]);
      }
    }

    function saveHelperSettings() {
      settings.contextHelperEnabled = els.contextHelperEnabled ? els.contextHelperEnabled.checked : DEFAULT_SETTINGS.contextHelperEnabled;
      settings.contextHelperMode = els.contextHelperMode?.value || DEFAULT_SETTINGS.contextHelperMode;
      settings.contextHelperMaxSnippets = Math.max(4, Math.min(40, parseInt(els.contextHelperMaxSnippets?.value, 10) || DEFAULT_SETTINGS.contextHelperMaxSnippets));
      settings.contextHelperMaxChars = Math.max(12000, Math.min(150000, parseInt(els.contextHelperMaxChars?.value, 10) || DEFAULT_SETTINGS.contextHelperMaxChars));
      saveSettings();
      fillForm();
      showToast('Silent helper settings saved.');
    }

    function saveDefaults() {
      settings.model = els.defaultModel.value.trim();
      settings.temperature = clamp(Number(els.temperature.value), 0, 2, DEFAULT_SETTINGS.temperature);
      settings.topP = clamp(Number(els.topP.value), 0, 1, DEFAULT_SETTINGS.topP);
      settings.maxTokens = Math.max(1, parseInt(els.maxTokens.value, 10) || DEFAULT_SETTINGS.maxTokens);
      settings.systemPrompt = els.systemPrompt.value;
      settings.persistChat = els.persistChat.checked;
      saveSettings();

      if (!settings.persistChat) localStorage.removeItem(STORAGE_KEYS.messages);

      fillForm();
      showToast('Default settings saved.');
    }

    function clamp(value, min, max, fallback) {
      if (Number.isNaN(value)) return fallback;
      return Math.min(max, Math.max(min, value));
    }

    async function testConnection() {
      saveConnection();
      const mode = settings.runtimeMode || DEFAULT_SETTINGS.runtimeMode;
      if (mode === 'android-vulkan') {
        await testNativeRuntime();
        return;
      }
      setStatus('checking', 'Checking', mode === 'hybrid' ? `Testing PC server plus Android bridge` : `Testing ${normalizeBaseUrl(settings.baseUrl)}/models`);
      els.modelList.innerHTML = '';

      try {
        const response = await fetch(endpoint('/models'), {
          method: 'GET',
          headers: getAuthHeaders()
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const models = Array.isArray(payload.data)
          ? payload.data.map(model => model.id).filter(Boolean)
          : Array.isArray(payload.models)
            ? payload.models.map(model => model.id || model.name).filter(Boolean)
            : [];

        if (mode === 'hybrid') {
          const bridge = getNativeInferenceBridge();
          const phoneText = bridge ? 'Android bridge detected for phone support.' : 'Android bridge not detected; PC server only until the app exposes it.';
          setStatus('connected', 'Hybrid', `${models.length} PC model${models.length === 1 ? '' : 's'} returned. ${phoneText}`);
        } else {
          setStatus('connected', 'Connected', `${models.length} model${models.length === 1 ? '' : 's'} returned by LM Studio.`);
        }
        renderModels(models);

        if (!settings.model && models[0]) {
          settings.model = models[0];
          saveSettings();
          fillForm();
        }
      } catch (error) {
        console.error(error);
        setStatus('error', 'Offline', `Could not reach the server. ${error.message || ''}`.trim());
        renderModels([]);
      }
    }

    function renderModels(models) {
      if (!models.length) {
        els.modelList.innerHTML = '<p class="hint">No models loaded yet, or the selected runtime is unavailable.</p>';
        return;
      }

      els.modelList.innerHTML = '';
      models.forEach(model => {
        const row = document.createElement('div');
        row.className = 'model-option';

        const name = document.createElement('strong');
        name.textContent = model;

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.textContent = settings.model === model ? 'Selected' : 'Use';
        useBtn.disabled = settings.model === model;
        useBtn.addEventListener('click', () => {
          settings.model = model;
          saveSettings();
          fillForm();
          renderModels(models);
          showToast('Default model updated.');
        });

        row.appendChild(name);
        row.appendChild(useBtn);
        els.modelList.appendChild(row);
      });
    }

    function restoreDefaults() {
      settings = { ...DEFAULT_SETTINGS };
      saveSettings();
      fillForm();
      renderModels([]);
      setStatus('checking', 'Not tested', 'Defaults restored. Run a connection test when ready.');
      showToast('Defaults restored.');
    }

    function clearSavedChat() {
      localStorage.removeItem(STORAGE_KEYS.messages);
      showToast('Saved chat cleared.');
    }

    fillForm();