(function () {
  const SYSTEM_SIDEBAR_KEY = 'lmStudioLite.systemSidebar.v1';
  const MAX_SAMPLES = 42;
  const DEFAULT_POLL_SECONDS = {
    cpu: 3,
    gpu: 5,
    memory: 3,
    storage: 10
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
      label: 'Memory Usage',
      eyebrow: 'Browser heap',
      minPoll: 1,
      maxPoll: 15
    },
    {
      id: 'storage',
      label: 'Storage Metrics',
      eyebrow: 'Origin quota',
      minPoll: 5,
      maxPoll: 60
    }
  ];

  const state = new Map();
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
    const memory = metricState('memory').lastResult;
    const storage = metricState('storage').lastResult;
    const gpu = metricState('gpu').lastResult;
    const facts = [
      {
        label: 'Logical CPU',
        detail: 'Browser hardware hint',
        value: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : 'Not exposed'
      },
      {
        label: 'Device Memory',
        detail: 'Browser memory hint',
        value: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'Not exposed'
      },
      {
        label: 'JS Heap',
        detail: memory?.detail || 'Waiting for memory sample',
        value: memory?.value || 'Pending'
      },
      {
        label: 'Storage Quota',
        detail: storage?.detail || 'Waiting for storage sample',
        value: storage?.value || 'Pending'
      },
      {
        label: 'GPU Telemetry',
        detail: gpu?.detail || 'Waiting for GPU probe',
        value: gpu?.value || 'Pending'
      },
      {
        label: 'WebGPU API',
        detail: 'Browser capability',
        value: navigator.gpu ? 'Available' : 'Not exposed'
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
    const info = metricState(def.id);
    const now = performance.now();
    const pollMs = getPollSeconds(def) * 1000;
    const drift = info.lastSampleAt ? Math.max(0, now - info.lastSampleAt - pollMs) : 0;
    info.lastSampleAt = now;
    const percent = clamp(Math.round((drift / Math.max(250, pollMs)) * 400), 0, 100);
    const cores = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical cores` : 'CPU cores not exposed';
    return {
      percent,
      value: `${percent}%`,
      detail: `${cores} · main thread pressure`
    };
  }

  async function readMemoryMetric() {
    const memory = performance.memory;
    if (memory && memory.jsHeapSizeLimit) {
      const percent = clamp((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100, 0, 100);
      return {
        percent,
        value: `${formatBytes(memory.usedJSHeapSize)}`,
        detail: `${Math.round(percent)}% of ${formatBytes(memory.jsHeapSizeLimit)} JS heap`
      };
    }

    if (navigator.deviceMemory) {
      return {
        percent: null,
        value: `${navigator.deviceMemory} GB`,
        detail: 'Device memory hint; live heap unavailable'
      };
    }

    return {
      percent: null,
      value: 'Unavailable',
      detail: 'Memory usage is not exposed by this browser'
    };
  }

  async function readStorageMetric() {
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

  async function readMetric(def) {
    if (def.id === 'cpu') return readCpuMetric(def);
    if (def.id === 'memory') return readMemoryMetric();
    if (def.id === 'storage') return readStorageMetric();
    if (def.id === 'gpu') return readGpuMetric();
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
