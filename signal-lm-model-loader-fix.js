(function () {
  if (window.__signalLmModelLoaderFix) return;
  window.__signalLmModelLoaderFix = true;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var DEFAULT_BASE_URL = 'http://localhost:1234/v1';

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function writeSettings(settings) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings || {})); }
    catch (error) {}
  }

  function cleanBase(url) {
    return String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  }

  function apiBase(settings) {
    var base = cleanBase((settings || readSettings()).baseUrl);
    if (/\/api\/v1$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return base.replace(/\/v1$/i, '/api/v1');
    return base + '/api/v1';
  }

  function openAiBase(settings) {
    var base = cleanBase((settings || readSettings()).baseUrl);
    if (/\/api\/v1$/i.test(base)) return base.replace(/\/api\/v1$/i, '/v1');
    if (/\/v1$/i.test(base)) return base;
    return base + '/v1';
  }

  function parseJson(value) {
    if (typeof value !== 'string') return value;
    var text = value.trim();
    if (!text || !/^[{[]/.test(text)) return value;
    try { return JSON.parse(text); } catch (error) { return value; }
  }

  function modelName(model) {
    if (!model) return '';
    if (typeof model === 'string') return model.replace(/:\d+$/, '').trim();
    if (typeof model !== 'object') return '';
    var name = String(model.id || model.name || model.model || model.identifier || model.path || model.filename || '').trim();
    return name.replace(/:\d+$/, '');
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function normalizeModels(payload) {
    var data = parseJson(payload);
    var lists = [data, data && data.data, data && data.models, data && data.result, data && data.items];
    for (var i = 0; i < lists.length; i++) {
      if (Array.isArray(lists[i])) {
        var names = unique(lists[i].map(modelName).filter(Boolean));
        if (names.length) return names;
      }
    }
    return [];
  }

  function getBridge() {
    return window.NativeInferenceBridge || window.AndroidInferenceBridge || window.SignalLMInferenceBridge || window.SignalLMNativeBridge || window.lmStudioLiteNative || null;
  }

  function toPromise(value) {
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  async function nativeModels() {
    var bridge = getBridge();
    if (!bridge) throw new Error('Native bridge unavailable');
    var payload = bridge.listModels ? await toPromise(bridge.listModels()) : bridge.getModels ? await toPromise(bridge.getModels()) : [];
    var models = normalizeModels(payload);
    if (!models.length) throw new Error('No native models returned');
    return { models: models, loaded: models.slice(), source: 'Android native bridge' };
  }

  function requestHeaders(settings) {
    var headers = { Accept: 'application/json' };
    var key = settings && settings.apiKey ? String(settings.apiKey).trim() : '';
    if (key) headers.Authorization = /^Bearer\s+/i.test(key) ? key : 'Bearer ' + key;
    return headers;
  }

  async function urlModels(url, settings) {
    var response = await fetch(url, { method: 'GET', cache: 'no-store', headers: requestHeaders(settings) });
    if (!response.ok) {
      var error = new Error('HTTP ' + response.status + ' from ' + url);
      error.status = response.status;
      error.url = url;
      error.authRequired = response.status === 401 || response.status === 403;
      throw error;
    }
    var payload = await response.json();
    var models = normalizeModels(payload);
    var loaded = [];
    try {
      var rawModels = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
      var llmModels = rawModels.filter(function (m) {
        return m && typeof m === 'object' && m.type !== 'embedding';
      });
      var supportsLoadedInstances = llmModels.some(function (m) {
        return m && typeof m === 'object' && 'loaded_instances' in m;
      });
      if (supportsLoadedInstances) {
        llmModels.forEach(function (m) {
          if (Array.isArray(m.loaded_instances)) {
            m.loaded_instances.forEach(function (inst) {
              var id = inst && (inst.id || inst.key || inst.name || m.id || m.key || m.name || '');
              if (id) {
                var cleanId = String(id).trim();
                if (cleanId && loaded.indexOf(cleanId) === -1) {
                  loaded.push(cleanId);
                }
              }
            });
          }
        });
      } else {
        if (models.length) {
          loaded.push(models[0]);
        }
      }
    } catch (e) {}
    return { models: models, loaded: loaded, source: url };
  }

  function authErrorMessage(settings, error) {
    if (settings && settings.apiKey) {
      return 'LM Studio rejected the saved API key. Re-enter the API Key / Bearer Token in Settings, save it, then load models again.';
    }
    return 'LM Studio requires an API key. Enter the API Key / Bearer Token in Settings, save it, then load models again.';
  }

  async function serverModels(settings) {
    var urls = unique([apiBase(settings) + '/models', cleanBase(settings.baseUrl) + '/models', openAiBase(settings) + '/models']);
    var lastError = null;
    var succeededWithEmpty = false;
    var successUrl = '';
    for (var i = 0; i < urls.length; i++) {
      try {
        var result = await urlModels(urls[i], settings);
        if (result.models && result.models.length > 0) {
          return result;
        }
        succeededWithEmpty = true;
        successUrl = urls[i];
      }
      catch (error) {
        lastError = error;
        if (error && error.authRequired) {
          error.message = authErrorMessage(settings, error);
          throw error;
        }
        try { console.warn('Model endpoint failed:', urls[i], error); } catch (ignored) {}
      }
    }
    if (succeededWithEmpty) {
      return { models: [], loaded: [], source: successUrl };
    }
    throw lastError || new Error('No model endpoint responded');
  }

  function valueOf(element) {
    return element ? String(element.value || '').trim() : '';
  }

  function wasTouched(element) {
    return Boolean(element && element.dataset && element.dataset.signalLmTouched === '1');
  }

  function markTouched(event) {
    if (event && event.currentTarget && event.currentTarget.dataset) {
      event.currentTarget.dataset.signalLmTouched = '1';
    }
  }

  function bindTouchedFields() {
    ['base-url', 'api-key', 'settings-runtime-mode', 'runtime-mode', 'settings-hybrid-strategy', 'hybrid-strategy'].forEach(function (id) {
      var element = document.getElementById(id);
      if (!element || element.dataset.signalLmTouchBound === '1') return;
      element.dataset.signalLmTouchBound = '1';
      element.addEventListener('input', markTouched);
      element.addEventListener('change', markTouched);
    });
  }

  function saveVisibleFields() {
    var settings = readSettings();
    var baseUrl = document.getElementById('base-url');
    var apiKey = document.getElementById('api-key');
    var runtimeMode = document.getElementById('settings-runtime-mode') || document.getElementById('runtime-mode');
    var hybridStrategy = document.getElementById('settings-hybrid-strategy') || document.getElementById('hybrid-strategy');
    var baseUrlValue = valueOf(baseUrl);
    var apiKeyValue = valueOf(apiKey);
    var runtimeModeValue = valueOf(runtimeMode);
    var hybridStrategyValue = valueOf(hybridStrategy);

    settings.baseUrl = cleanBase(wasTouched(baseUrl) && baseUrlValue ? baseUrlValue : settings.baseUrl || DEFAULT_BASE_URL);
    if (wasTouched(apiKey) || (!settings.apiKey && apiKeyValue)) settings.apiKey = apiKeyValue;
    if (!settings.apiKey) settings.apiKey = '';
    if (wasTouched(runtimeMode) && runtimeModeValue) settings.runtimeMode = runtimeModeValue;
    else settings.runtimeMode = settings.runtimeMode || 'server';
    if (wasTouched(hybridStrategy) && hybridStrategyValue) settings.hybridStrategy = hybridStrategyValue;
    else settings.hybridStrategy = settings.hybridStrategy || 'off';
    writeSettings(settings);
    return settings;
  }

  function selectModel(settings, models) {
    if (settings.model === 'auto-detect') return 'auto-detect';
    if (settings.model && models.indexOf(settings.model) !== -1) return settings.model;
    return models[0] || settings.model || '';
  }

  function setStatus(type, text, detail) {
    [['status-pill', 'status-text'], ['settings-status-pill', 'settings-status-text']].forEach(function (ids) {
      var pill = document.getElementById(ids[0]);
      var label = document.getElementById(ids[1]);
      if (pill) {
        pill.classList.remove('connected', 'error', 'checking', 'fallback');
        pill.classList.add(type);
      }
      if (label) label.textContent = text;
    });
    var detailEl = document.getElementById('settings-status-detail');
    if (detailEl && detail) detailEl.textContent = detail;
  }

  function renderSelect(models, settings) {
    var select = document.getElementById('model-select');
    if (!select) return;
    select.innerHTML = '';

    var autoOpt = document.createElement('option');
    autoOpt.value = 'auto-detect';
    var resolved = window.__signalLmLoadedModels && window.__signalLmLoadedModels[0];
    autoOpt.textContent = resolved ? 'Auto-Detect (' + resolved + ')' : 'Auto-Detect';
    select.appendChild(autoOpt);

    if (!models.length) {
      if (settings.model && settings.model !== 'auto-detect') {
        var empty = document.createElement('option');
        empty.value = settings.model;
        empty.textContent = settings.emptyModelLabel || settings.model || 'No models returned';
        select.appendChild(empty);
      }
      select.value = settings.model || 'auto-detect';
      return;
    }
    models.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    });
    select.value = selectModel(settings, models);
  }

  function renderSettingsList(models, settings) {
    var list = document.getElementById('model-list');
    if (!list) return;
    if (!models.length) {
      list.innerHTML = '<p class="hint">No models loaded yet, or the selected runtime is unavailable.</p>';
      return;
    }
    list.innerHTML = '';
    models.forEach(function (model) {
      var row = document.createElement('div');
      row.className = 'model-option';
      var name = document.createElement('strong');
      name.textContent = model;
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = settings.model === model ? 'Selected' : 'Use';
      button.disabled = settings.model === model;
      button.onclick = function () {
        var next = readSettings();
        next.model = model;
        writeSettings(next);
        renderSelect(models, next);
        renderSettingsList(models, next);
        updateDisplay(next);
      };
      row.appendChild(name);
      row.appendChild(button);
      list.appendChild(row);
    });
  }

  function updateDisplay(settings) {
    var display = document.getElementById('model-display');
    if (display) {
      var modelText = settings.model || 'No model selected';
      if (settings.model === 'auto-detect') {
        var resolved = window.__signalLmLoadedModels && window.__signalLmLoadedModels[0];
        modelText = resolved ? 'Auto-Detect (' + resolved + ')' : 'Auto-Detect';
      }
      display.textContent = modelText;
    }
    var copy = document.getElementById('server-url-copy');
    if (copy) copy.textContent = settings.runtimeMode === 'android-vulkan' ? 'Android Vulkan local runtime' : cleanBase(settings.baseUrl || DEFAULT_BASE_URL);
  }

  var lastFetchTime = 0;
  var lastFetchResult = null;

  async function loadModels(options) {
    var settings = saveVisibleFields();
    var force = options && options.force;
    var now = Date.now();

    // 10 second throttle on fetching models
    if (!force && lastFetchResult && (now - lastFetchTime < 10000)) {
      return lastFetchResult;
    }

    // Check if index.js already fetched recently
    if (!force && window.__signalLmLastModelFetchResult && (now - window.__signalLmLastModelFetchTime < 10000)) {
      lastFetchTime = window.__signalLmLastModelFetchTime;
      lastFetchResult = window.__signalLmLastModelFetchResult;
      renderSelect(lastFetchResult, settings);
      renderSettingsList(lastFetchResult, settings);
      updateDisplay(settings);
      setStatus('connected', settings.runtimeMode === 'android-vulkan' ? 'Android' : 'Connected', lastFetchResult.length + ' model' + (lastFetchResult.length === 1 ? '' : 's') + ' returned.');
      return lastFetchResult;
    }

    setStatus('checking', 'Checking', 'Loading models...');
    try {
      var result = settings.runtimeMode === 'android-vulkan' ? await nativeModels() : await serverModels(settings);
      var selected = selectModel(settings, result.models);
      if (selected && settings.model !== selected) {
        settings.model = selected;
        writeSettings(settings);
      }
      lastFetchTime = Date.now();
      lastFetchResult = result.models;
      window.__signalLmLastModelFetchTime = lastFetchTime;
      window.__signalLmLastModelFetchResult = lastFetchResult;
      window.__signalLmLoadedModels = result.loaded || [];

      renderSelect(result.models, settings);
      renderSettingsList(result.models, settings);
      updateDisplay(settings);
      setStatus('connected', settings.runtimeMode === 'android-vulkan' ? 'Android' : 'Connected', result.models.length + ' model' + (result.models.length === 1 ? '' : 's') + ' returned from ' + result.source + '.');

      return result.models;
    } catch (error) {
      if (error && error.authRequired) console.warn(error.message);
      else console.error(error);
      var authFailed = error && error.authRequired;
      renderSelect([], authFailed ? Object.assign({}, settings, { emptyModelLabel: 'API key required' }) : settings);
      renderSettingsList([], settings);
      updateDisplay(settings);
      setStatus('error', authFailed ? 'Auth required' : 'Offline', authFailed ? error.message : 'Could not load models. ' + (error && error.message ? error.message : ''));
      return [];
    }
  }

  function install() {
    bindTouchedFields();
    window.loadModels = loadModels;
    window.testConnection = loadModels;
    window.SignalLMModelLoader = { loadModels: loadModels, normalizeModels: normalizeModels, apiBase: apiBase, openAiBase: openAiBase };
  }

  install();
  var timer = setInterval(install, 250);
  setTimeout(function () { clearInterval(timer); install(); }, 8000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(loadModels, 250); });
  else setTimeout(loadModels, 250);
})();
