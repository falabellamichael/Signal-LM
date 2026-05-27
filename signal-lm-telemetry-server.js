#!/usr/bin/env node
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HOST = process.env.SIGNAL_LM_TELEMETRY_HOST || '127.0.0.1';
const PORT = Number(process.env.SIGNAL_LM_TELEMETRY_PORT || 8766);
const LM_STUDIO_BASE_URL = (process.env.SIGNAL_LM_API_BASE_URL || 'http://localhost:1234/v1').replace(/\/+$/, '');
const LM_STUDIO_API_KEY = process.env.SIGNAL_LM_API_KEY || process.env.LM_STUDIO_API_KEY || '';
const GPU_CACHE_MS = Number(process.env.SIGNAL_LM_GPU_CACHE_MS || 5000);
const WINDOWS_GPU_TIMEOUT_MS = Number(process.env.SIGNAL_LM_WINDOWS_GPU_TIMEOUT_MS || 12000);
const LM_STUDIO_TIMEOUT_MS = Number(process.env.SIGNAL_LM_TIMEOUT_MS || 900);

let lastCpuSnapshot = readCpuSnapshot();
const gpuCache = {
  data: null,
  expiresAt: 0,
  promise: null
};

function readCpuSnapshot() {
  return os.cpus().reduce((total, cpu) => {
    const times = cpu.times || {};
    const cpuTotal = Object.values(times).reduce((sum, value) => sum + value, 0);
    total.idle += times.idle || 0;
    total.total += cpuTotal;
    return total;
  }, { idle: 0, total: 0 });
}

function readCpuTelemetry() {
  const next = readCpuSnapshot();
  const idleDelta = next.idle - lastCpuSnapshot.idle;
  const totalDelta = next.total - lastCpuSnapshot.total;
  lastCpuSnapshot = next;
  const usagePercent = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
  const cpus = os.cpus();
  return {
    usagePercent: Number(usagePercent.toFixed(2)),
    logicalCores: cpus.length,
    model: cpus[0]?.model || 'Unknown CPU',
    loadAverage: os.loadavg()
  };
}

function readMemoryTelemetry() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : null
  };
}

function execFileText(file, args, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function execPowerShell(script, timeoutMs = 3000) {
  return execFileText('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], timeoutMs);
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function compactErrorMessage(error) {
  const raw = error?.stderr || error?.message || String(error || '');
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, 360);
}

function unavailableGpuTelemetry(error, source = 'unavailable') {
  return {
    source,
    usagePercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    devices: [],
    error: error ? compactErrorMessage(error) : ''
  };
}

async function readNvidiaTelemetry() {
  const output = await execFileText('nvidia-smi', [
    '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
    '--format=csv,noheader,nounits'
  ], 2500);

  const devices = output.split(/\r?\n/)
    .map(line => line.split(',').map(part => part.trim()))
    .filter(parts => parts.length >= 4)
    .map(parts => {
      const memoryUsedMb = numberOrNull(parts[2]);
      const memoryTotalMb = numberOrNull(parts[3]);
      return {
        name: parts[0] || 'NVIDIA GPU',
        usagePercent: numberOrNull(parts[1]),
        memoryUsedBytes: memoryUsedMb === null ? null : memoryUsedMb * 1024 * 1024,
        memoryTotalBytes: memoryTotalMb === null ? null : memoryTotalMb * 1024 * 1024,
        temperatureC: numberOrNull(parts[4]),
        powerDrawW: numberOrNull(parts[5])
      };
    });

  if (!devices.length) throw new Error('nvidia-smi returned no GPU rows.');
  const usageValues = devices.map(device => device.usagePercent).filter(Number.isFinite);
  const usagePercent = usageValues.length
    ? usageValues.reduce((sum, value) => sum + value, 0) / usageValues.length
    : null;
  const memoryUsedBytes = devices.reduce((sum, device) => sum + (device.memoryUsedBytes || 0), 0);
  const memoryTotalBytes = devices.reduce((sum, device) => sum + (device.memoryTotalBytes || 0), 0);

  return {
    source: 'nvidia-smi',
    usagePercent: usagePercent === null ? null : Number(usagePercent.toFixed(2)),
    memoryUsedBytes: memoryTotalBytes ? memoryUsedBytes : null,
    memoryTotalBytes: memoryTotalBytes || null,
    devices
  };
}

async function readWindowsGpuTelemetry() {
  const script = `
$engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue)
$active = $engines | Where-Object { $_.UtilizationPercentage -gt 0 }
$sum = ($active | Measure-Object -Property UtilizationPercentage -Sum).Sum
if ($null -eq $sum) {
  $samples = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples
  $active = $samples | Where-Object { $_.CookedValue -gt 0 }
  $sum = ($active | Measure-Object -Property CookedValue -Sum).Sum
}
if ($null -eq $sum) { $sum = 0 }
$memorySamples = @()
try {
  $memorySamples = (Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage','\\GPU Adapter Memory(*)\\Shared Usage','\\GPU Adapter Memory(*)\\Total Committed' -ErrorAction Stop).CounterSamples
} catch {
  $memorySamples = @()
}
$dedicatedUsage = ($memorySamples | Where-Object { $_.Path -like '*\\dedicated usage' } | Measure-Object -Property CookedValue -Sum).Sum
$sharedUsage = ($memorySamples | Where-Object { $_.Path -like '*\\shared usage' } | Measure-Object -Property CookedValue -Sum).Sum
$totalCommitted = ($memorySamples | Where-Object { $_.Path -like '*\\total committed' } | Measure-Object -Property CookedValue -Sum).Sum
if ($null -eq $dedicatedUsage) { $dedicatedUsage = 0 }
if ($null -eq $sharedUsage) { $sharedUsage = 0 }
if ($null -eq $totalCommitted) { $totalCommitted = 0 }
$controllers = @(Get-CimInstance Win32_VideoController | Select-Object -First 6 Name,AdapterRAM)
$devices = @($controllers | ForEach-Object {
  $adapterRam = [double]$_.AdapterRAM
  $memoryTotal = if ($adapterRam -gt 0 -and $adapterRam -lt 4293918720) { $adapterRam } else { $null }
  [pscustomobject]@{
    name = $_.Name
    memoryTotalBytes = $memoryTotal
    adapterRamBytes = $adapterRam
  }
})
[pscustomobject]@{
  source = 'windows-gpu-counter'
  usagePercent = [math]::Min(100, [math]::Round([double]$sum, 2))
  memoryUsedBytes = [double]$dedicatedUsage
  sharedMemoryBytes = [double]$sharedUsage
  memoryCommittedBytes = [double]$totalCommitted
  devices = $devices
} | ConvertTo-Json -Compress -Depth 5
`;
  const output = await execPowerShell(script, WINDOWS_GPU_TIMEOUT_MS);
  const parsed = JSON.parse(output);
  const devices = Array.isArray(parsed.devices) ? parsed.devices.map(device => ({
    name: device.name || 'Windows GPU',
    memoryTotalBytes: numberOrNull(device.memoryTotalBytes),
    adapterRamBytes: numberOrNull(device.adapterRamBytes)
  })) : [];
  const totalMemory = devices.reduce((sum, device) => sum + (Number.isFinite(device.memoryTotalBytes) && device.memoryTotalBytes > 0 ? device.memoryTotalBytes : 0), 0);
  return {
    source: parsed.source || 'windows-gpu-counter',
    usagePercent: numberOrNull(parsed.usagePercent),
    memoryUsedBytes: numberOrNull(parsed.memoryUsedBytes),
    memoryTotalBytes: totalMemory || null,
    sharedMemoryBytes: numberOrNull(parsed.sharedMemoryBytes),
    memoryCommittedBytes: numberOrNull(parsed.memoryCommittedBytes),
    devices
  };
}

async function readGpuTelemetry() {
  try {
    return await readNvidiaTelemetry();
  } catch (nvidiaError) {
    if (process.platform === 'win32') {
      try {
        const telemetry = await readWindowsGpuTelemetry();
        telemetry.fallbackReason = nvidiaError.message;
        return telemetry;
      } catch (windowsError) {
        return {
          source: 'unavailable',
          usagePercent: null,
          memoryUsedBytes: null,
          memoryTotalBytes: null,
          devices: [],
          error: compactErrorMessage(windowsError) || compactErrorMessage(nvidiaError)
        };
      }
    }
    return {
      source: 'unavailable',
      usagePercent: null,
      memoryUsedBytes: null,
      memoryTotalBytes: null,
      devices: [],
      error: compactErrorMessage(nvidiaError)
    };
  }
}

function readCachedGpuTelemetry() {
  const now = Date.now();
  if (gpuCache.data && now < gpuCache.expiresAt) return gpuCache.data;

  if (!gpuCache.promise) {
    gpuCache.promise = readGpuTelemetry()
      .then(telemetry => {
        gpuCache.data = {
          ...telemetry,
          cachedAt: new Date().toISOString()
        };
        gpuCache.expiresAt = Date.now() + GPU_CACHE_MS;
        return gpuCache.data;
      })
      .catch(error => {
        gpuCache.data = {
          ...unavailableGpuTelemetry(error),
          cachedAt: new Date().toISOString()
        };
        gpuCache.expiresAt = Date.now() + GPU_CACHE_MS;
        return gpuCache.data;
      })
      .finally(() => {
        gpuCache.promise = null;
      });
  }

  if (gpuCache.data) {
    return {
      ...gpuCache.data,
      refreshing: true
    };
  }

  return {
    ...unavailableGpuTelemetry('GPU telemetry warming up.', 'pending'),
    refreshing: true
  };
}

async function readWindowsStorageTelemetry(rootPath) {
  const drive = path.parse(rootPath).root.replace(/[\\\/]+$/, '') || 'C:';
  const script = `
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive.replace("'", "''")}'"
if ($null -eq $disk) { throw 'Disk not found' }
[pscustomobject]@{
  deviceId = $disk.DeviceID
  volumeName = $disk.VolumeName
  totalBytes = [double]$disk.Size
  freeBytes = [double]$disk.FreeSpace
  usedBytes = [double]($disk.Size - $disk.FreeSpace)
} | ConvertTo-Json -Compress
`;
  const output = await execPowerShell(script, 2500);
  const parsed = JSON.parse(output);
  const totalBytes = Number(parsed.totalBytes) || 0;
  const usedBytes = Number(parsed.usedBytes) || 0;
  return {
    source: 'win32-logical-disk',
    path: rootPath,
    deviceId: parsed.deviceId || drive,
    volumeName: parsed.volumeName || '',
    totalBytes,
    freeBytes: Number(parsed.freeBytes) || 0,
    usedBytes,
    usagePercent: totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : null
  };
}

async function readPosixStorageTelemetry(rootPath) {
  const output = await execFileText('df', ['-k', rootPath], 2500);
  const lines = output.split(/\r?\n/).filter(Boolean);
  const parts = lines[1]?.trim().split(/\s+/) || [];
  if (parts.length < 6) throw new Error('Could not parse df output.');
  const totalBytes = Number(parts[1]) * 1024;
  const usedBytes = Number(parts[2]) * 1024;
  const freeBytes = Number(parts[3]) * 1024;
  return {
    source: 'df',
    path: rootPath,
    deviceId: parts[0],
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : null
  };
}

async function readStorageTelemetry() {
  const rootPath = process.cwd();
  try {
    if (process.platform === 'win32') return await readWindowsStorageTelemetry(rootPath);
    return await readPosixStorageTelemetry(rootPath);
  } catch (error) {
    return {
      source: 'unavailable',
      path: rootPath,
      totalBytes: null,
      freeBytes: null,
      usedBytes: null,
      usagePercent: null,
      error: error.message
    };
  }
}

async function fetchJson(url, timeoutMs = 1400, headers = {}) {
  if (typeof fetch !== 'function') throw new Error('fetch is unavailable in this Node runtime.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readLmStudioTelemetry() {
  const headers = LM_STUDIO_API_KEY ? { Authorization: `Bearer ${LM_STUDIO_API_KEY}` } : {};
  try {
    const payload = await fetchJson(`${LM_STUDIO_BASE_URL}/models`, LM_STUDIO_TIMEOUT_MS, headers);
    const models = Array.isArray(payload?.data)
      ? payload.data.map(model => model.id || model.name).filter(Boolean)
      : [];
    return {
      baseUrl: LM_STUDIO_BASE_URL,
      reachable: true,
      authConfigured: Boolean(LM_STUDIO_API_KEY),
      modelCount: models.length,
      models: models.slice(0, 12)
    };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Timed out' : error.message;
    return {
      baseUrl: LM_STUDIO_BASE_URL,
      reachable: false,
      authConfigured: Boolean(LM_STUDIO_API_KEY),
      authRequired: /HTTP 401|HTTP 403/.test(message),
      error: message
    };
  }
}

async function buildStatus() {
  const [gpu, storage, lmStudio] = await Promise.all([
    readCachedGpuTelemetry(),
    readStorageTelemetry(),
    readLmStudioTelemetry()
  ]);

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      cwd: process.cwd()
    },
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      release: os.release(),
      arch: os.arch()
    },
    cpu: readCpuTelemetry(),
    memory: readMemoryTelemetry(),
    storage,
    gpu,
    lmStudio
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/status') {
    try {
      sendJson(res, 200, await buildStatus());
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || 'Telemetry failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Signal LM telemetry server listening on http://${HOST}:${PORT}/status`);
  console.log(`LM Studio probe: ${LM_STUDIO_BASE_URL}/models`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
