(function () {
  const SYSTEM_SIDEBAR_KEY = 'lmStudioLite.systemSidebar.v1';
  const INFERENCE_TELEMETRY_KEY = 'lmStudioLite.inferenceTelemetry.v1';
  const LOCAL_TELEMETRY_URL = 'http://127.0.0.1:8766/status';
  const MAX_SAMPLES = 42;
  const DEFAULT_POLL_SECONDS = {
    cpu: 3,
    gpu: 5,
    memory: 3,
    storage: 10,
    inference: 2
  };

  const METRICS = [
    {
      id: 'cpu',
      label: 'CPU Usage',
      eyebrow: 'Main thread proxy',
      minPoll: 1,
      maxPoll: 15
    },
    {
      id: 'gpu',
      label: 'GPU Usage',
      eyebrow: 'Native telemetry',
      minPoll: 2,
      maxPoll: 30
    },
    {
      id: 'memory',
      label: 'System RAM',
      eyebrow: 'OS memory',
      minPoll: 1,
      maxPoll: 15
    },
    {
      id: 'storage',
      label: 'Storage Metrics',
      eyebrow: 'Origin quota',
      minPoll: 5,
      maxPoll: 60
    },
    {
      id: 'inference',
      label: 'Inference Telemetry',
      eyebrow: 'Runtime throughput',
      minPoll: 1,
      maxPoll: 15
    }
  ];

  const state = new Map();
  const telemetryCache = {
    data: null,
    error: '',
    expiresAt: 0,
    promise: null
  };
  const els = {
    sidebar: document.getElementById('system-sidebar'),
    metricsGrid: document.getElementById('system-metrics-grid'),
    pollingList: document.getElementById('system-polling-list'),
    deviceList: document.getElementById('system-device-list'),
    tabs: Array.from(document.querySelectorAll('[data-system-tab]')),
    panels: Array.from(document.querySelectorAll('[data-system-panel]'))
  };

  if (!els.sidebar || !els.metricsGrid || !els.pollingList || !els.deviceList) return;

  function readPanelSettings() {
    try { return JSON.parse(localStorage.getItem(SYSTEM_SIDEBAR_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writePanelSettings(next) {
    localStorage.setItem(SYSTEM_SIDEBAR_KEY, JSON.stringify(next || {}));
  }

  function updatePanelSettings(updater) {
    const next = readPanelSettings();
    updater(next);
    writePanelSettings(next);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clamp(value, min, max) {
    const numeric = Number(value);
    const clean = Number.isFinite(numeric) ? numeric : min;
    return Math.min(max, Math.max(min, clean));
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const scaled = value / Math.pow(1024, index);
    return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
  }

  function metricState(id) {
    if (!state.has(id)) {
      state.set(id, { samples: [], timer: null, lastResult: null, lastSampleAt: 0 });
    }
    return state.get(id);
  }

  function getPollSeconds(def) {
    const settings = readPanelSettings();
    const rates = settings.systemMetricPollRates || {};
    return clamp(rates[def.id] ?? DEFAULT_POLL_SECONDS[def.id] ?? def.minPoll, def.minPoll, def.maxPoll);
  }

  function savePollSeconds(def, seconds) {
    updatePanelSettings(settings => {
      settings.systemMetricPollRates = {
        ...(settings.systemMetricPollRates || {}),
        [def.id]: clamp(seconds, def.minPoll, def.maxPoll)
      };
    });
  }

  function pollControlMarkup(def, context) {
    const seconds = getPollSeconds(def);
    return `
      <div class="system-poll-control">
        <input type="range" min="${def.minPoll}" max="${def.maxPoll}" step="1" value="${seconds}" data-system-poll="${def.id}" data-system-poll-context="${context}" aria-label="${escapeHtml(def.label)} polling rate" />
        <span class="system-poll-value" data-system-poll-value="${def.id}">${seconds}s</span>
      </div>`;
  }

  function renderMetricCards() {
    els.metricsGrid.innerHTML = METRICS.map(def => `
      <article class="system-metric-card" data-system-card="${def.id}">
        <div class="system-metric-head">
          <div class="system-metric-title">
            <strong>${escapeHtml(def.label)}</strong>
            <span data-system-detail="${def.id}">${escapeHtml(def.eyebrow)}</span>
          </div>
          <div class="system-metric-value" data-system-value="${def.id}">Pending</div>
        </div>
        <canvas class="system-chart" data-system-chart="${def.id}" aria-label="${escapeHtml(def.label)} chart"></canvas>
        ${pollControlMarkup(def, 'card')}
      </article>
    `).join('');
  }

  function renderPollingList() {
    els.pollingList.innerHTML = METRICS.map(def => `
      <div class="system-polling-row">
        <div>
          <strong>${escapeHtml(def.label)}</strong>
          <span data-system-poll-summary="${def.id}">Every ${getPollSeconds(def)}s</span>
        </div>
        ${pollControlMarkup(def, 'panel')}
      </div>
    `).join('');
  }

  function renderDeviceList() {
    const cpu = metricState('cpu').lastResult;
    const memory = metricState('memory').lastResult;
    const storage = metricState('storage').lastResult;
    const gpu = metricState('gpu').lastResult;
    const inference = metricState('inference').lastResult;
    const helper = telemetryCache.data;
    const helperCpu = helper?.cpu;
    const helperMemory = helper?.memory;
    const helperGpu = helper?.gpu;
    const lmStudio = helper?.lmStudio;
    const ramLine = helperMemory?.totalBytes
      ? `${formatBytes(helperMemory.usedBytes)} used / ${formatBytes(helperMemory.totalBytes)} total`
      : memory?.detail || 'Waiting for memory sample';
    const gpuMemoryLine = helperGpu?.memoryTotalBytes
      ? telemetryUsageLine(helperGpu.memoryUsedBytes, helperGpu.memoryTotalBytes, 'VRAM used')
      : helperGpu?.memoryUsedBytes ? `${formatBytes(helperGpu.memoryUsedBytes)} dedicated VRAM used` : 'Waiting for GPU memory';
    const facts = [
      {
        label: 'Telemetry Helper',
        detail: LOCAL_TELEMETRY_URL,
        value: helperStatusLabel()
      },
      {
        label: 'Logical CPU',
        detail: helperCpu?.model || cpu?.detail || 'Waiting for local helper',
        value: helperCpu?.logicalCores
          ? `${helperCpu.logicalCores} cores`
          : navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : 'Not exposed'
      },
      {
        label: 'CPU Sample',
        detail: cpu?.detail || 'Waiting for CPU sample',
        value: cpu?.value || 'Pending'
      },
      {
        label: 'System RAM',
        detail: ramLine,
        value: helperMemory?.usagePercent !== null && helperMemory?.usagePercent !== undefined
          ? `${Math.round(helperMemory.usagePercent)}%`
          : memory?.value || helperStatusLabel()
      },
      {
        label: 'RAM Free',
        detail: helperMemory?.source || 'OS memory telemetry',
        value: helperMemory?.freeBytes ? formatBytes(helperMemory.freeBytes) : 'Pending'
      },
      {
        label: 'Storage Sample',
        detail: storage?.detail || 'Waiting for storage sample',
        value: storage?.value || 'Pending'
      },
      {
        label: 'GPU Telemetry',
        detail: gpu?.detail || 'Waiting for GPU probe',
        value: gpu?.value || 'Pending'
      },
      {
        label: 'GPU Memory',
        detail: gpuMemoryLine,
        value: helperGpu?.memoryTotalBytes ? formatBytes(helperGpu.memoryTotalBytes) : (helperGpu?.deviceProbePending ? 'Probing' : 'Unknown')
      },
      {
        label: 'GPU Source',
        detail: helperGpu?.devices?.[0]?.name || helperGpu?.error || 'Native/browser fallback',
        value: helperGpu?.source || 'Browser'
      },
      {
        label: 'Inference',
        detail: inference?.detail || 'Waiting for inference telemetry',
        value: inference?.value || 'Pending'
      },
      {
        label: 'LM Studio',
        detail: lmStudio?.baseUrl || 'Telemetry helper probe',
        value: lmStudio ? (lmStudio.reachable ? 'Reachable' : lmStudio.authRequired ? 'Needs key' : 'Offline') : 'Pending'
      }
    ];

    els.deviceList.innerHTML = facts.map(fact => `
      <div class="system-device-row">
        <div>
          <strong>${escapeHtml(fact.label)}</strong>
          <span>${escapeHtml(fact.detail)}</span>
        </div>
        <div class="system-device-value">${escapeHtml(fact.value)}</div>
      </div>
    `).join('');
  }

  function syncPollControls(def) {
    const seconds = getPollSeconds(def);
    document.querySelectorAll(`[data-system-poll="${def.id}"]`).forEach(input => { input.value = seconds; });
    document.querySelectorAll(`[data-system-poll-value="${def.id}"]`).forEach(value => { value.textContent = `${seconds}s`; });
    document.querySelectorAll(`[data-system-poll-summary="${def.id}"]`).forEach(value => { value.textContent = `Every ${seconds}s`; });
  }

  function setActiveTab(tabName) {
    els.tabs.forEach(tab => {
      const isActive = tab.dataset.systemTab === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    els.panels.forEach(panel => {
      panel.classList.toggle('active', panel.dataset.systemPanel === tabName);
    });
    requestAnimationFrame(() => METRICS.forEach(def => drawChart(def)));
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

  function telemetryPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 100) : null;
  }

  async function fetchLocalTelemetry() {
    const now = Date.now();
    if (telemetryCache.data && now < telemetryCache.expiresAt) return telemetryCache.data;
    if (telemetryCache.promise) return telemetryCache.promise;

    telemetryCache.promise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(LOCAL_TELEMETRY_URL, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        telemetryCache.data = payload;
        telemetryCache.error = '';
        telemetryCache.expiresAt = Date.now() + 900;
        return payload;
      } catch (error) {
        telemetryCache.data = null;
        telemetryCache.error = error.name === 'AbortError' ? 'Timed out' : (error.message || 'Unavailable');
        telemetryCache.expiresAt = Date.now() + 2500;
        return null;
      } finally {
        clearTimeout(timeout);
        telemetryCache.promise = null;
      }
    })();

    return telemetryCache.promise;
  }

  function helperStatusLabel() {
    if (telemetryCache.data?.ok) return 'Connected';
    return telemetryCache.error ? 'Offline' : 'Pending';
  }

  function telemetryUsageLine(usedBytes, totalBytes, noun = 'used') {
    if (usedBytes === null || usedBytes === undefined || totalBytes === null || totalBytes === undefined) return '';
    const used = Number(usedBytes);
    const total = Number(totalBytes);
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return '';
    const percent = clamp((used / total) * 100, 0, 100);
    return `${formatBytes(used)} ${noun} / ${formatBytes(total)} total (${Math.round(percent)}%)`;
  }

  function getNativeTelemetryBridge() {
    return [
      window.NativeTelemetryBridge,
      window.SignalLMTelemetryBridge,
      window.NativeInferenceBridge,
      window.AndroidInferenceBridge,
      window.SignalLMInferenceBridge,
      window.SignalLMNativeBridge,
      window.lmStudioLiteNative
    ].find(bridge => bridge && typeof bridge.getHardwareStatus === 'function') || null;
  }

  function firstNumericStatus(status, keys) {
    for (const key of keys) {
      const value = status?.[key];
      const numeric = typeof value === 'string' ? Number(value.replace('%', '').trim()) : Number(value);
      if (Number.isFinite(numeric)) return clamp(numeric, 0, 100);
    }
    return null;
  }

  async function readCpuMetric(def) {
    const telemetry = await fetchLocalTelemetry();
    const cpu = telemetry?.cpu;
    const helperPercent = telemetryPercent(cpu?.usagePercent);
    if (helperPercent !== null) {
      return {
        percent: helperPercent,
        value: `${Math.round(helperPercent)}%`,
        detail: `${cpu.logicalCores || navigator.hardwareConcurrency || '?'} cores · ${cpu.model || 'PC telemetry'} · ${cpu.source || 'OS sampler'}`
      };
    }

    return {
      percent: null,
      value: helperStatusLabel(),
      detail: telemetryCache.error ? `Telemetry helper offline · ${telemetryCache.error}` : 'Waiting for CPU telemetry helper'
    };
  }

  async function readMemoryMetric() {
    const telemetry = await fetchLocalTelemetry();
    const memory = telemetry?.memory;
    const helperPercent = telemetryPercent(memory?.usagePercent);
    if (helperPercent !== null) {
      return {
        percent: helperPercent,
        value: `${Math.round(helperPercent)}%`,
        detail: `System RAM · ${telemetryUsageLine(memory.usedBytes, memory.totalBytes) || 'OS memory telemetry'} · ${formatBytes(memory.freeBytes)} free`
      };
    }

    return {
      percent: null,
      value: helperStatusLabel() === 'Offline' ? 'Helper offline' : 'Pending',
      detail: telemetryCache.error ? `System RAM needs local helper · ${telemetryCache.error}` : 'Waiting for system RAM telemetry'
    };
  }

  async function readStorageMetric() {
    const telemetry = await fetchLocalTelemetry();
    const storage = telemetry?.storage;
    const helperPercent = telemetryPercent(storage?.usagePercent);
    if (helperPercent !== null) {
      return {
        percent: helperPercent,
        value: `${formatBytes(storage.usedBytes)}`,
        detail: `${storage.deviceId || 'Drive'} · ${telemetryUsageLine(storage.usedBytes, storage.totalBytes) || 'PC storage telemetry'}`
      };
    }

    if (!navigator.storage || !navigator.storage.estimate) {
      return {
        percent: null,
        value: 'Unavailable',
        detail: 'Storage quota is not exposed by this browser'
      };
    }

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percent = quota ? clamp((usage / quota) * 100, 0, 100) : null;
    return {
      percent,
      value: `${formatBytes(usage)}`,
      detail: quota ? `${Math.round(percent)}% of ${formatBytes(quota)} quota` : 'Quota unavailable'
    };
  }

  async function readGpuMetric() {
    const telemetry = await fetchLocalTelemetry();
    const gpu = telemetry?.gpu;
    if (gpu?.source === 'pending') {
      return {
        percent: null,
        value: 'Warming',
        detail: gpu.error || 'GPU telemetry helper is collecting the first sample'
      };
    }
    const helperPercent = telemetryPercent(gpu?.usagePercent);
    if (helperPercent !== null) {
      const gpuName = gpu.devices?.[0]?.name || gpu.source || 'PC GPU';
      const memoryLine = telemetryUsageLine(gpu.memoryUsedBytes, gpu.memoryTotalBytes, 'VRAM used');
      const dedicatedBytes = Number(gpu.memoryUsedBytes);
      const committedBytes = Number(gpu.memoryCommittedBytes);
      const topEngine = gpu.engineBreakdown?.[0];
      const engineLine = topEngine?.engineType ? `${topEngine.engineType.toUpperCase()} engine` : '';
      const memoryDetail = memoryLine
        || (Number.isFinite(dedicatedBytes) && dedicatedBytes > 0 ? `${formatBytes(dedicatedBytes)} dedicated VRAM` : '')
        || (Number.isFinite(committedBytes) && committedBytes > 0 ? `${formatBytes(committedBytes)} GPU memory committed` : '');
      return {
        percent: helperPercent,
        value: `${Math.round(helperPercent)}%`,
        detail: `${gpuName} · ${[engineLine, memoryDetail || gpu.source || 'telemetry helper'].filter(Boolean).join(' · ')}`
      };
    }

    if (gpu?.error) {
      return {
        percent: null,
        value: 'Unavailable',
        detail: `${gpu.source || 'GPU telemetry'} · ${gpu.error}`
      };
    }

    const bridge = getNativeTelemetryBridge();
    if (bridge) {
      try {
        const status = parseMaybeJson(await asPromise(bridge.getHardwareStatus()));
        const percent = firstNumericStatus(status, ['gpuUsage', 'gpu_usage', 'gpuLoad', 'gpu_load', 'vulkanUsage', 'vulkan_usage']);
        const gpuName = status?.gpu || status?.device || status?.renderer || 'Native GPU';
        if (percent !== null) {
          return {
            percent,
            value: `${Math.round(percent)}%`,
            detail: `${gpuName} telemetry`
          };
        }
        return {
          percent: null,
          value: 'Detected',
          detail: `${gpuName}; usage not exposed`
        };
      } catch (error) {
        return {
          percent: null,
          value: 'Bridge error',
          detail: error?.message || 'Hardware status probe failed'
        };
      }
    }

    return {
      percent: null,
      value: navigator.gpu ? 'WebGPU' : 'Unavailable',
      detail: navigator.gpu ? 'WebGPU is available; usage is not exposed' : 'Usage needs a native telemetry bridge'
    };
  }

  function readInferenceSnapshot() {
    if (window.SignalLMInferenceTelemetry && typeof window.SignalLMInferenceTelemetry.snapshot === 'function') {
      return window.SignalLMInferenceTelemetry.snapshot();
    }
    try { return JSON.parse(localStorage.getItem(INFERENCE_TELEMETRY_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  async function readInferenceMetric() {
    const snapshot = readInferenceSnapshot();
    const run = snapshot.active || snapshot.last;
    const telemetry = await fetchLocalTelemetry();
    const lmStudio = telemetry?.lmStudio;

    if (!run) {
      if (lmStudio?.reachable) {
        return {
          percent: null,
          value: 'Idle',
          detail: `${lmStudio.modelCount || 0} LM Studio model${lmStudio.modelCount === 1 ? '' : 's'} reachable`
        };
      }
      if (lmStudio?.authRequired) {
        return {
          percent: null,
          value: 'Idle',
          detail: 'LM Studio telemetry needs SIGNAL_LM_API_KEY'
        };
      }
      return {
        percent: null,
        value: 'Idle',
        detail: 'No inference run captured yet'
      };
    }

    const active = Boolean(snapshot.active);
    const tokensPerSecond = Number(run.tokensPerSecond);
    const percent = Number.isFinite(tokensPerSecond)
      ? clamp((tokensPerSecond / 80) * 100, 0, 100)
      : null;
    const latency = run.firstTokenMs === null || run.firstTokenMs === undefined
      ? ''
      : ` · first token ${Math.round(run.firstTokenMs)}ms`;
    const status = active ? 'Running' : run.status || 'Complete';
    const tokenText = Number.isFinite(tokensPerSecond) && tokensPerSecond > 0
      ? `${tokensPerSecond.toFixed(tokensPerSecond >= 10 ? 0 : 1)} tok/s`
      : status;

    return {
      percent,
      value: tokenText,
      detail: `${status} · ${run.source || run.runtime || 'runtime'} · ${run.outputTokens || 0} out / ${run.inputTokens || 0} in${latency}`
    };
  }

  async function readMetric(def) {
    if (def.id === 'cpu') return readCpuMetric(def);
    if (def.id === 'memory') return readMemoryMetric();
    if (def.id === 'storage') return readStorageMetric();
    if (def.id === 'gpu') return readGpuMetric();
    if (def.id === 'inference') return readInferenceMetric();
    return { percent: null, value: 'Unavailable', detail: 'Metric reader missing' };
  }

  function updateMetricDom(def, result) {
    const card = document.querySelector(`[data-system-card="${def.id}"]`);
    const value = document.querySelector(`[data-system-value="${def.id}"]`);
    const detail = document.querySelector(`[data-system-detail="${def.id}"]`);
    if (card) card.dataset.metricState = Number.isFinite(result.percent) ? 'live' : 'limited';
    if (value) value.textContent = result.value;
    if (detail) detail.textContent = result.detail;
  }

  function drawChart(def) {
    const canvas = document.querySelector(`[data-system-chart="${def.id}"]`);
    if (!canvas) return;

    const info = metricState(def.id);
    const width = Math.max(220, Math.round(canvas.clientWidth || 280));
    const height = Math.max(56, Math.round(canvas.clientHeight || 66));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#2d2d2d';
    const muted = styles.getPropertyValue('--text-secondary').trim() || '#777';
    const border = styles.getPropertyValue('--border-color').trim() || '#ddd';
    const samples = info.samples;

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i += 1) {
      const y = Math.round((height / 3) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (samples.length < 2) {
      ctx.fillStyle = muted;
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillText('No live usage data', 12, height / 2 + 4);
      return;
    }

    const step = width / Math.max(1, samples.length - 1);
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = index * step;
      const y = height - (clamp(sample, 0, 100) / 100) * (height - 10) - 5;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  async function sampleMetric(def) {
    const info = metricState(def.id);
    const result = await readMetric(def);
    info.lastResult = result;
    if (Number.isFinite(result.percent)) {
      info.samples.push(clamp(result.percent, 0, 100));
      if (info.samples.length > MAX_SAMPLES) info.samples.shift();
    }
    updateMetricDom(def, result);
    drawChart(def);
    renderDeviceList();
  }

  function scheduleMetric(def, immediate = false) {
    const info = metricState(def.id);
    if (info.timer) clearTimeout(info.timer);
    const delay = immediate ? 0 : getPollSeconds(def) * 1000;
    info.timer = setTimeout(async () => {
      try { await sampleMetric(def); }
      catch (error) {
        updateMetricDom(def, { percent: null, value: 'Error', detail: error?.message || 'Metric sample failed' });
      } finally {
        scheduleMetric(def);
      }
    }, delay);
  }

  function bindEvents() {
    els.tabs.forEach(tab => {
      tab.addEventListener('click', () => setActiveTab(tab.dataset.systemTab));
    });

    els.sidebar.addEventListener('input', event => {
      const input = event.target.closest('[data-system-poll]');
      if (!input) return;
      const def = METRICS.find(metric => metric.id === input.dataset.systemPoll);
      if (!def) return;
      savePollSeconds(def, input.value);
      syncPollControls(def);
      scheduleMetric(def, true);
    });

    window.addEventListener('resize', () => {
      METRICS.forEach(def => drawChart(def));
    });

    window.addEventListener('signal-lm-inference-telemetry', () => {
      const def = METRICS.find(metric => metric.id === 'inference');
      if (def) scheduleMetric(def, true);
    });
  }

  function init() {
    renderMetricCards();
    renderPollingList();
    renderDeviceList();
    bindEvents();
    METRICS.forEach(def => {
      syncPollControls(def);
      scheduleMetric(def, true);
    });
  }

  init();
})();
