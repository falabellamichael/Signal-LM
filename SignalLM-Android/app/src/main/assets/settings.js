(function() {
const STORAGE_KEYS = {
      settings: 'lmStudioLite.settings.v1',
      messages: 'lmStudioLite.messages.v1'
    };

    const DEFAULT_SETTINGS = {
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: 'auto-detect',
      defaultModel: '',
      temperature: 0.7,
      topP: 1,
      maxTokens: 500,
      systemPrompt: 'You are a concise, helpful local assistant.',
      persistChat: true,
      theme: 'system',
      runtimeMode: 'server',
      hybridStrategy: 'off',
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
      maxTokens: document.getElementById('settings-max-tokens'),
      systemPrompt: document.getElementById('settings-system-prompt'),
      persistChat: document.getElementById('persist-chat'),
      statusPill: document.getElementById('settings-status-pill'),
      statusText: document.getElementById('settings-status-text'),
      statusDetail: document.getElementById('settings-status-detail'),
      modelList: document.getElementById('model-list'),
      toast: document.getElementById('toast'),
      themeSelect: document.getElementById('theme-select'),
      contextHelperEnabled: document.getElementById('context-helper-enabled'),
      contextHelperMode: document.getElementById('context-helper-mode'),
      contextHelperMaxSnippets: document.getElementById('context-helper-max-snippets'),
      contextHelperMaxChars: document.getElementById('context-helper-max-chars'),
      runtimeMode: document.getElementById('settings-runtime-mode'),
      hybridStrategy: document.getElementById('settings-hybrid-strategy'),
      hybridFallbackMs: document.getElementById('settings-hybrid-fallback-ms'),
      androidThreads: document.getElementById('settings-android-threads'),
      androidGpuLayers: document.getElementById('settings-android-gpu-layers'),
      androidContextLength: document.getElementById('settings-android-context-length'),
      androidBatchSize: document.getElementById('settings-android-batch-size')
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
      window.dispatchEvent(new Event('settingsChanged'));
    }

    function normalizeBaseUrl(url) {
      return (url || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '');
    }

    function endpoint(path) {
      return normalizeBaseUrl(settings.baseUrl) + path;
    }

    function nativeApiBaseUrl() {
      const base = normalizeBaseUrl(settings.baseUrl);
      if (/\/api\/v1$/i.test(base)) return base;
      if (/\/v1$/i.test(base)) return base.replace(/\/v1$/i, '/api/v1');
      return base + '/api/v1';
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
      els.defaultModel.value = settings.defaultModel || '';
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

    function getHybridStrategy() {
      return settings.hybridStrategy || DEFAULT_SETTINGS.hybridStrategy;
    }

    function hybridPhoneSupportEnabled() {
      return (settings.runtimeMode || DEFAULT_SETTINGS.runtimeMode) === 'hybrid' && getHybridStrategy() !== 'off';
    }

    function isNativeInferenceBridge(bridge) {
      return Boolean(bridge && (typeof bridge.chatCompletion === 'function' || typeof bridge.generate === 'function'));
    }

    function getNativeInferenceBridge() {
      return [
        window.NativeInferenceBridge,
        window.AndroidInferenceBridge,
        window.SignalLMInferenceBridge,
        window.SignalLMNativeBridge,
        window.lmStudioLiteNative
      ].find(isNativeInferenceBridge) || null;
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
      if (!hybridPhoneSupportEnabled() && settings.runtimeMode !== 'android-vulkan') {
        setStatus('checking', 'Phone off', 'Phone boost is off. LM Studio server requests stay on the configured PC server.');
        renderModels([]);
        return;
      }
      setStatus('checking', 'Checking', 'Testing Android native Vulkan runtime bridge.');
      els.modelList.innerHTML = '';
      const bridge = getNativeInferenceBridge();
      if (!bridge) {
        setStatus('error', 'No bridge', 'The app wrapper has not exposed a native inference bridge with chatCompletion(payload) or generate(payload).');
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
      settings.defaultModel = els.defaultModel.value.trim();
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
      setStatus('checking', 'Checking PC', `Testing ${nativeApiBaseUrl()}/models from Connection`);
      els.modelList.innerHTML = '';

      try {
        let response;
        let payload;
        const headers = getAuthHeaders();

        const nativeUrl = nativeApiBaseUrl() + '/models';
        response = await fetch(nativeUrl, { method: 'GET', headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = await response.json();

      const models = Array.isArray(payload.data)
        ? payload.data.map(model => typeof model === 'string' ? model : (model.id || model.key || model.name || model.model)).filter(Boolean)
        : Array.isArray(payload.models)
          ? payload.models.map(model => typeof model === 'string' ? model : (model.id || model.key || model.name || model.model)).filter(Boolean)
          : [];

        if (mode === 'android-vulkan') {
          setStatus('connected', 'PC Connection', `${models.length} PC model${models.length === 1 ? '' : 's'} returned. Android local runtime still uses its own native model path.`);
        } else if (mode === 'hybrid' && getHybridStrategy() === 'off') {
          setStatus('connected', 'PC only', `${models.length} PC model${models.length === 1 ? '' : 's'} returned. Phone boost is off.`);
        } else if (mode === 'hybrid') {
          const bridge = getNativeInferenceBridge();
          const phoneText = bridge ? 'Android inference bridge detected for phone support.' : 'Android inference bridge not detected; PC server only until the app exposes it.';
          setStatus('connected', 'Hybrid', `${models.length} PC model${models.length === 1 ? '' : 's'} returned. ${phoneText}`);
        } else {
          setStatus('connected', 'Connected', `${models.length} model${models.length === 1 ? '' : 's'} returned by LM Studio.`);
        }
        renderModels(models);

      } catch (error) {
        console.error(error);
        setStatus('error', 'Offline', `Could not reach the server. ${error.message || ''}`.trim());
        renderModels([]);
      }
    }

    function renderModels(models) {
      els.modelList.innerHTML = '';

      // Auto-Detect option
      const autoRow = document.createElement('div');
      autoRow.className = 'model-option';

      const autoName = document.createElement('strong');
      autoName.textContent = 'Auto-Detect';

      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.textContent = !settings.defaultModel ? 'Selected' : 'Use';
      autoBtn.disabled = !settings.defaultModel;
      autoBtn.addEventListener('click', () => {
        settings.defaultModel = '';
        saveSettings();
        fillForm();
        renderModels(models);
        showToast('Default model updated.');
      });

      autoRow.appendChild(autoName);
      autoRow.appendChild(autoBtn);
      els.modelList.appendChild(autoRow);

      if (!models.length) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'No other models loaded yet, or the selected runtime is unavailable.';
        els.modelList.appendChild(hint);
        return;
      }

      models.forEach(model => {
        const row = document.createElement('div');
        row.className = 'model-option';

        const name = document.createElement('strong');
        name.textContent = model;

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.textContent = settings.defaultModel === model ? 'Selected' : 'Use';
        useBtn.disabled = settings.defaultModel === model;
        useBtn.addEventListener('click', () => {
          settings.defaultModel = model;
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

// Expose for HTML
window.saveConnection = saveConnection;
window.saveAppearance = saveAppearance;
window.saveRuntimeSettings = saveRuntimeSettings;
window.testNativeRuntime = testNativeRuntime;
window.saveHelperSettings = saveHelperSettings;
window.saveDefaults = saveDefaults;
window.testConnection = testConnection;
window.restoreDefaults = restoreDefaults;
window.clearSavedChat = clearSavedChat;

window.addEventListener('settingsChanged', () => { settings = loadSettings(); fillForm(); });
})();
