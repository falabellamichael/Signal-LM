# Signal LM Telemetry Helper

The browser cannot read real GPU usage, full-system CPU usage, VRAM, or disk capacity by itself. `signal-lm-telemetry-server.js` is a local-only helper that exposes those metrics to the right-side System Status panel.

## Start

From the project folder:

```powershell
node signal-lm-telemetry-server.js
```

Or double-click:

```text
start-telemetry-server.bat
```

The helper listens on:

```text
http://127.0.0.1:8766/status
```

## What It Reports

- CPU usage from local OS CPU time deltas, CPU model, logical cores, and load average.
- System RAM used/free/total from the local OS.
- Storage used/free/total for the project drive.
- GPU usage through `nvidia-smi` when available.
- Windows GPU usage from grouped GPU engine counters, GPU memory counters, and a cached `dxdiag` device probe for dedicated VRAM totals when `nvidia-smi` is not available.
- LM Studio reachability and model count from `http://localhost:1234/v1/models`.

## Notes

- The helper only binds to `127.0.0.1`, so it is local to this PC.
- The frontend still works without it, but CPU, GPU, and full-system RAM cards will show helper-offline states instead of invented browser-only utilization.
- Set `SIGNAL_LM_TELEMETRY_PORT` to use a port other than `8766`.
- Set `SIGNAL_LM_API_BASE_URL` if LM Studio is not at `http://localhost:1234/v1`.
- Set `SIGNAL_LM_API_KEY` if your LM Studio endpoint requires an API key.
