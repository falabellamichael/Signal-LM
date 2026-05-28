# Signal-LM
A lightweight local LLM studio/chat/agent

Deployment marker: GitHub Pages workflow enabled.

## Desktop app

Install dependencies once:

```powershell
npm install
```

Run the desktop wrapper:

```powershell
npm run desktop
```

The desktop wrapper opens the local app and starts `tel-server.js` automatically so the right-side telemetry panel can read CPU, RAM, GPU, and storage data without a separate terminal command.

Build a Windows installer:

```powershell
npm run dist
```
