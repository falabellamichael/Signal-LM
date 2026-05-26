const fs = require('fs');
const path = require('path');

const duplicates = [
  'runtime-mode',
  'hybrid-strategy',
  'hybrid-fallback-ms',
  'android-threads',
  'android-gpu-layers',
  'android-context-length',
  'android-batch-size',
  'max-tokens',
  'system-prompt',
  'status-pill',
  'status-text',
  'status-detail'
];

const dirs = [
  __dirname,
  path.join(__dirname, 'SignalLM-Android', 'app', 'src', 'main', 'assets')
];

for (const dir of dirs) {
  const indexHtmlPath = path.join(dir, 'index.html');
  const settingsJsPath = path.join(dir, 'settings.js');

  if (!fs.existsSync(indexHtmlPath)) continue;

  let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  let settingsJs = fs.readFileSync(settingsJsPath, 'utf8');

  // We only want to replace in the #view-settings block
  const viewSettingsStart = indexHtml.indexOf('id="view-settings"');
  if (viewSettingsStart !== -1) {
    let before = indexHtml.substring(0, viewSettingsStart);
    let after = indexHtml.substring(viewSettingsStart);

    duplicates.forEach(id => {
      const regexId = new RegExp(`id=["']${id}["']`, 'g');
      const regexFor = new RegExp(`for=["']${id}["']`, 'g');
      after = after.replace(regexId, `id="settings-${id}"`);
      after = after.replace(regexFor, `for="settings-${id}"`);
    });

    fs.writeFileSync(indexHtmlPath, before + after, 'utf8');
  }

  // Update settings.js getElementById calls
  duplicates.forEach(id => {
    const regex = new RegExp(`getElementById\\(['"]${id}['"]\\)`, 'g');
    settingsJs = settingsJs.replace(regex, `getElementById('settings-${id}')`);
  });

  fs.writeFileSync(settingsJsPath, settingsJs, 'utf8');
  console.log('Fixed duplicates in ' + dir);
}
