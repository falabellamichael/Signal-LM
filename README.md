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

The local installer is written to `dist\Signal-LM-Setup.exe`.

## Publishing desktop releases

Desktop installers should be published as GitHub Release assets, not committed to the repo.

To publish a new Windows desktop installer:

```powershell
npm version patch
git push origin main --tags
```

Pushing a `v*` tag runs `.github/workflows/desktop-release.yml`, builds the Windows installer on GitHub, and uploads `Signal-LM-Setup.exe` to the release.

The stable latest-installer URL is:

```text
https://github.com/falabellamichael/Signal-LM/releases/latest/download/Signal-LM-Setup.exe
```

The app header and Settings page link to that URL.

To update an installed desktop app, download the latest installer and run it. The installer uses the same app ID, so it replaces the existing Signal LM install.
