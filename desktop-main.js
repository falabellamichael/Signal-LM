const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

let mainWindow = null;
let telemetryServer = null;

function startTelemetry() {
  try {
    const { startTelemetryServer } = require('./tel-server');
    telemetryServer = startTelemetryServer({
      logger: console,
      onError(error) {
        if (error && error.code === 'EADDRINUSE') {
          console.warn('Signal LM telemetry server is already running.');
          telemetryServer = null;
          return;
        }
        console.error('Signal LM telemetry server failed:', error);
      }
    });
  } catch (error) {
    console.error('Could not start Signal LM telemetry server:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    title: 'Signal LM',
    backgroundColor: '#090a0d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', event => {
    const target = event.url || '';
    if (/^https?:\/\//i.test(target)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startTelemetry();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (telemetryServer) {
    telemetryServer.close();
    telemetryServer = null;
  }
});
