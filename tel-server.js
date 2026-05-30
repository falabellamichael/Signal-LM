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
const WINDOWS_GPU_DEVICE_CACHE_MS = Number(process.env.SIGNAL_LM_WINDOWS_GPU_DEVICE_CACHE_MS || 10 * 60 * 1000);
const WINDOWS_GPU_DEVICE_TIMEOUT_MS = Number(process.env.SIGNAL_LM_WINDOWS_GPU_DEVICE_TIMEOUT_MS || 25000);
const LM_STUDIO_TIMEOUT_MS = Number(process.env.SIGNAL_LM_TIMEOUT_MS || 900);
const LM_STUDIO_CACHE_MS = Number(process.env.SIGNAL_LM_LM_STUDIO_CACHE_MS || 60000);
const STORAGE_CACHE_MS = Number(process.env.SIGNAL_LM_STORAGE_CACHE_MS || 15000);

let lastCpuSnapshot = readCpuSnapshot();
let lastCpuSnapshotAt = Date.now();
let latestCpuTelemetry = null;
const gpuCache = {
  data: null,
  expiresAt: 0,
  promise: null
};
const windowsGpuDeviceCache = {
  data: null,
  expiresAt: 0,
  promise: null
};
const lmStudioCache = {
  data: null,
  expiresAt: 0,
  promise: null
};
const storageCache = {
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
  const now = Date.now();
  const idleDelta = next.idle - lastCpuSnapshot.idle;
  const totalDelta = next.total - lastCpuSnapshot.total;
  const sampleMs = Math.max(0, now - lastCpuSnapshotAt);
  lastCpuSnapshot = next;
  lastCpuSnapshotAt = now;
  const usagePercent = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
  const cpus = os.cpus();
  return {
    source: 'node-os-cpu-times',
    usagePercent: Number(usagePercent.toFixed(2)),
    sampleMs,
    logicalCores: cpus.length,
    model: (cpus[0]?.model || 'Unknown CPU').trim(),
    loadAverage: os.loadavg()
  };
}

function readMemoryTelemetry() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    source: 'node-os-memory',
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : null
  };
}

function refreshCpuTelemetry() {
  latestCpuTelemetry = readCpuTelemetry();
  return latestCpuTelemetry;
}

const cpuSampler = setInterval(() => {
  try {
    refreshCpuTelemetry();
  } catch {
    // Keep the telemetry helper alive even if one OS sample fails.
  }
}, 1000);
if (typeof cpuSampler.unref === 'function') cpuSampler.unref();

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

function normalizeDeviceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function promiseWithTimeout(promise, timeoutMs, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
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
    ? Math.max(...usageValues)
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

async function readWindowsGpuDevices() {
  const script = `
$controllers = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor,PNPDeviceID)
$dxDevices = @()
$tmp = Join-Path $env:TEMP ("signal-lm-dxdiag-" + [guid]::NewGuid().ToString() + ".txt")
$dx = $null
try {
  $dxPath = Join-Path $env:WINDIR "System32\\dxdiag.exe"
  $dx = Start-Process -FilePath $dxPath -ArgumentList @('/whql:off', '/t', $tmp) -WindowStyle Hidden -PassThru -ErrorAction Stop
  $deadline = (Get-Date).AddMilliseconds(${WINDOWS_GPU_DEVICE_TIMEOUT_MS})
  $lastLength = -1
  $stableTicks = 0
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $tmp) {
      $item = Get-Item $tmp -ErrorAction SilentlyContinue
      if ($item -and $item.Length -gt 0) {
        if ($item.Length -eq $lastLength) {
          $stableTicks += 1
        } else {
          $stableTicks = 0
          $lastLength = $item.Length
        }
        if ($stableTicks -ge 3) { break }
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if (Test-Path $tmp) {
    $current = $null
    foreach ($line in (Get-Content -Path $tmp -ErrorAction SilentlyContinue)) {
      if ($line -match '^\\s*Card name:\\s*(.+?)\\s*$') {
        if ($current) { $dxDevices += [pscustomobject]$current }
        $current = @{ name = $Matches[1].Trim() }
      } elseif ($current -and $line -match '^\\s*Display Memory:\\s*([0-9,]+)\\s*MB') {
        $current.displayMemoryBytes = [double]($Matches[1].Replace(',', '')) * 1MB
      } elseif ($current -and $line -match '^\\s*Dedicated Memory:\\s*([0-9,]+)\\s*MB') {
        $current.dedicatedMemoryBytes = [double]($Matches[1].Replace(',', '')) * 1MB
      } elseif ($current -and $line -match '^\\s*Shared Memory:\\s*([0-9,]+)\\s*MB') {
        $current.sharedMemoryBytes = [double]($Matches[1].Replace(',', '')) * 1MB
      }
    }
    if ($current) { $dxDevices += [pscustomobject]$current }
  }
} catch {
  $dxDevices = @()
} finally {
  if ($dx -and -not $dx.HasExited) {
    Stop-Process -Id $dx.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
  controllers = $controllers
  dxdiag = $dxDevices
} | ConvertTo-Json -Compress -Depth 6
`;
  const output = await execPowerShell(script, WINDOWS_GPU_DEVICE_TIMEOUT_MS + 5000);
  const parsed = JSON.parse(output || '{}');
  const controllers = (Array.isArray(parsed.controllers) ? parsed.controllers : parsed.controllers ? [parsed.controllers] : [])
    .map(device => ({
      name: device.Name || device.name || 'Windows GPU',
      adapterRamBytes: numberOrNull(device.AdapterRAM ?? device.adapterRamBytes),
      driverVersion: device.DriverVersion || device.driverVersion || '',
      videoProcessor: device.VideoProcessor || device.videoProcessor || '',
      pnpDeviceId: device.PNPDeviceID || device.pnpDeviceId || ''
    }));
  const dxDevices = (Array.isArray(parsed.dxdiag) ? parsed.dxdiag : parsed.dxdiag ? [parsed.dxdiag] : [])
    .map(device => ({
      name: device.name || 'Windows GPU',
      displayMemoryBytes: numberOrNull(device.displayMemoryBytes),
      dedicatedMemoryBytes: numberOrNull(device.dedicatedMemoryBytes),
      sharedMemoryBytes: numberOrNull(device.sharedMemoryBytes)
    }))
    .filter(device => device.name || device.dedicatedMemoryBytes);

  const merged = controllers.map(controller => {
    const normalized = normalizeDeviceName(controller.name);
    const dxMatch = dxDevices.find(device => {
      const dxName = normalizeDeviceName(device.name);
      return normalized && dxName && (normalized.includes(dxName) || dxName.includes(normalized));
    });
    const memoryTotalBytes = dxMatch?.dedicatedMemoryBytes || controller.adapterRamBytes || null;
    return {
      name: controller.name || dxMatch?.name || 'Windows GPU',
      memoryTotalBytes,
      memoryTotalSource: dxMatch?.dedicatedMemoryBytes ? 'dxdiag-dedicated-memory' : (controller.adapterRamBytes ? 'win32-adapter-ram' : 'unavailable'),
      displayMemoryBytes: dxMatch?.displayMemoryBytes || null,
      sharedMemoryBytes: dxMatch?.sharedMemoryBytes || null,
      adapterRamBytes: controller.adapterRamBytes || null,
      driverVersion: controller.driverVersion,
      videoProcessor: controller.videoProcessor,
      pnpDeviceId: controller.pnpDeviceId
    };
  });

  dxDevices.forEach(device => {
    const normalized = normalizeDeviceName(device.name);
    const exists = merged.some(entry => {
      const entryName = normalizeDeviceName(entry.name);
      return normalized && entryName && (normalized.includes(entryName) || entryName.includes(normalized));
    });
    if (!exists) {
      merged.push({
        name: device.name,
        memoryTotalBytes: device.dedicatedMemoryBytes || null,
        memoryTotalSource: device.dedicatedMemoryBytes ? 'dxdiag-dedicated-memory' : 'unavailable',
        displayMemoryBytes: device.displayMemoryBytes || null,
        sharedMemoryBytes: device.sharedMemoryBytes || null,
        adapterRamBytes: null,
        driverVersion: '',
        videoProcessor: '',
        pnpDeviceId: ''
      });
    }
  });

  return merged;
}

function readCachedWindowsGpuDevices() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const now = Date.now();
  if (windowsGpuDeviceCache.data && now < windowsGpuDeviceCache.expiresAt) {
    return Promise.resolve(windowsGpuDeviceCache.data);
  }
  if (!windowsGpuDeviceCache.promise) {
    windowsGpuDeviceCache.promise = readWindowsGpuDevices()
      .then(devices => {
        windowsGpuDeviceCache.data = devices;
        windowsGpuDeviceCache.expiresAt = Date.now() + WINDOWS_GPU_DEVICE_CACHE_MS;
        return devices;
      })
      .catch(error => {
        const fallback = windowsGpuDeviceCache.data || [];
        windowsGpuDeviceCache.error = compactErrorMessage(error);
        windowsGpuDeviceCache.expiresAt = Date.now() + Math.min(WINDOWS_GPU_DEVICE_CACHE_MS, 60000);
        return fallback;
      })
      .finally(() => {
        windowsGpuDeviceCache.promise = null;
      });
  }
  return windowsGpuDeviceCache.promise;
}

async function readWindowsGpuTelemetry() {
  const script = `
$engineGroups = @{}
$engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue)
foreach ($engine in $engines) {
  $value = [double]$engine.UtilizationPercentage
  if ($value -le 0) { continue }
  $name = [string]$engine.Name
  $adapter = 'gpu'
  $engineType = 'unknown'
  if ($name -match '(luid_.*?_phys_\\d+)') { $adapter = $Matches[1].ToLowerInvariant() }
  if ($name -match 'engtype_([^_]+)$') { $engineType = $Matches[1].ToLowerInvariant() }
  $key = "$adapter|$engineType"
  if (-not $engineGroups.ContainsKey($key)) { $engineGroups[$key] = 0.0 }
  $engineGroups[$key] += $value
}
$engineBreakdown = @($engineGroups.GetEnumerator() | ForEach-Object {
  $parts = $_.Key -split '\\|', 2
  [pscustomobject]@{
    adapter = $parts[0]
    engineType = $parts[1]
    usagePercent = [math]::Min(100, [math]::Round([double]$_.Value, 2))
  }
} | Sort-Object -Property usagePercent -Descending)
$usage = ($engineBreakdown | Measure-Object -Property usagePercent -Maximum).Maximum
if ($null -eq $usage) { $usage = 0 }

$memoryRows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue)
$dedicatedUsage = ($memoryRows | Measure-Object -Property DedicatedUsage -Sum).Sum
$sharedUsage = ($memoryRows | Measure-Object -Property SharedUsage -Sum).Sum
$totalCommitted = ($memoryRows | Measure-Object -Property TotalCommitted -Sum).Sum
if ($null -eq $dedicatedUsage) { $dedicatedUsage = 0 }
if ($null -eq $sharedUsage) { $sharedUsage = 0 }
if ($null -eq $totalCommitted) { $totalCommitted = 0 }
[pscustomobject]@{
  source = 'windows-performance-counters'
  usagePercent = [math]::Round([double]$usage, 2)
  memoryUsedBytes = [double]$dedicatedUsage
  sharedMemoryBytes = [double]$sharedUsage
  memoryCommittedBytes = [double]$totalCommitted
  engineBreakdown = @($engineBreakdown | Select-Object -First 8)
} | ConvertTo-Json -Compress -Depth 5
`;
  const [output, devices] = await Promise.all([
    execPowerShell(script, WINDOWS_GPU_TIMEOUT_MS),
    promiseWithTimeout(readCachedWindowsGpuDevices(), 1400, windowsGpuDeviceCache.data || [])
  ]);
  const parsed = JSON.parse(output);
  const memoryUsedBytes = numberOrNull(parsed.memoryUsedBytes);
  let totalMemory = devices.reduce((sum, device) => sum + (Number.isFinite(device.memoryTotalBytes) && device.memoryTotalBytes > 0 ? device.memoryTotalBytes : 0), 0);
  let memoryTotalSource = devices.find(device => device.memoryTotalBytes)?.memoryTotalSource || 'unavailable';
  if (totalMemory && Number.isFinite(memoryUsedBytes) && memoryUsedBytes > totalMemory * 1.05) {
    totalMemory = 0;
    memoryTotalSource = 'unavailable';
  }
  return {
    source: parsed.source || 'windows-gpu-counter',
    usagePercent: numberOrNull(parsed.usagePercent),
    memoryUsedBytes,
    memoryTotalBytes: totalMemory || null,
    memoryTotalSource,
    sharedMemoryBytes: numberOrNull(parsed.sharedMemoryBytes),
    memoryCommittedBytes: numberOrNull(parsed.memoryCommittedBytes),
    engineBreakdown: Array.isArray(parsed.engineBreakdown) ? parsed.engineBreakdown : [],
    devices,
    deviceProbePending: Boolean(windowsGpuDeviceCache.promise)
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

function readCachedStorageTelemetry() {
  const now = Date.now();
  if (storageCache.data && now < storageCache.expiresAt) return storageCache.data;

  if (!storageCache.promise) {
    storageCache.promise = readStorageTelemetry()
      .then(telemetry => {
        storageCache.data = {
          ...telemetry,
          cachedAt: new Date().toISOString()
        };
        storageCache.expiresAt = Date.now() + STORAGE_CACHE_MS;
        return storageCache.data;
      })
      .finally(() => {
        storageCache.promise = null;
      });
  }

  if (storageCache.data) {
    return {
      ...storageCache.data,
      refreshing: true
    };
  }

  return {
    source: 'unavailable',
    path: process.cwd(),
    totalBytes: null,
    freeBytes: null,
    usedBytes: null,
    usagePercent: null,
    error: 'Storage telemetry warming up.',
    refreshing: true
  };
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
  if (process.env.SIGNAL_LM_DISABLE_LM_STUDIO_PROBE === 'true' || process.env.SIGNAL_LM_ENABLE_LM_STUDIO_PROBE !== 'true') {
    return {
      baseUrl: LM_STUDIO_BASE_URL,
      reachable: false,
      disabled: true,
      authConfigured: Boolean(LM_STUDIO_API_KEY),
      error: 'LM Studio probe disabled by default'
    };
  }
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

function readCachedLmStudioTelemetry() {
  const now = Date.now();
  if (lmStudioCache.data && now < lmStudioCache.expiresAt) return lmStudioCache.data;

  if (!lmStudioCache.promise) {
    lmStudioCache.promise = readLmStudioTelemetry()
      .then(telemetry => {
        lmStudioCache.data = {
          ...telemetry,
          cachedAt: new Date().toISOString()
        };
        lmStudioCache.expiresAt = Date.now() + LM_STUDIO_CACHE_MS;
        return lmStudioCache.data;
      })
      .finally(() => {
        lmStudioCache.promise = null;
      });
  }

  if (lmStudioCache.data) {
    return {
      ...lmStudioCache.data,
      refreshing: true
    };
  }

  return {
    baseUrl: LM_STUDIO_BASE_URL,
    reachable: false,
    authConfigured: Boolean(LM_STUDIO_API_KEY),
    error: 'LM Studio telemetry warming up.',
    refreshing: true
  };
}

async function buildStatus() {
  const [gpu, storage, lmStudio] = await Promise.all([
    readCachedGpuTelemetry(),
    readCachedStorageTelemetry(),
    readCachedLmStudioTelemetry()
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
    cpu: latestCpuTelemetry || refreshCpuTelemetry(),
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

function createTelemetryServer(host = HOST, port = PORT) {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
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
}

function startTelemetryServer(options = {}) {
  const host = options.host || HOST;
  const port = Number(options.port || PORT);
  const logger = options.logger || console;
  const server = createTelemetryServer(host, port);

  server.on('error', error => {
    if (typeof options.onError === 'function') {
      options.onError(error);
      return;
    }
    if (error && error.code === 'EADDRINUSE') {
      logger.error(`Signal LM telemetry server is already running on http://${host}:${port}/status`);
      return;
    }
    logger.error('Signal LM telemetry server failed:', error);
  });

  server.listen(port, host, () => {
    logger.log(`Signal LM telemetry server listening on http://${host}:${port}/status`);
    logger.log(`LM Studio probe: ${LM_STUDIO_BASE_URL}/models`);
    if (process.platform === 'win32') {
      readCachedWindowsGpuDevices().catch(() => {});
    }
  });

  return server;
}

module.exports = {
  buildStatus,
  createTelemetryServer,
  startTelemetryServer
};

if (require.main === module) {
  const server = startTelemetryServer();
  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
} else if (process.platform === 'win32') {
  readCachedWindowsGpuDevices().catch(() => {});
}
