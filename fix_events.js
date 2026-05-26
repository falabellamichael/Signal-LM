const fs = require('fs');
const path = require('path');

const dirs = [
  __dirname,
  path.join(__dirname, 'SignalLM-Android', 'app', 'src', 'main', 'assets')
];

for (const dir of dirs) {
  // Fix settings.js saveSettings
  const settingsJsPath = path.join(dir, 'settings.js');
  if (fs.existsSync(settingsJsPath)) {
    let content = fs.readFileSync(settingsJsPath, 'utf8');
    if (!content.includes("window.dispatchEvent(new Event('settingsChanged'));")) {
      content = content.replace(/localStorage\.setItem\(STORAGE_KEYS\.settings, JSON\.stringify\(settings\)\);/g, "localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));\n      window.dispatchEvent(new Event('settingsChanged'));");
      fs.writeFileSync(settingsJsPath, content, 'utf8');
    }
  }

  // Fix mcp.js saveSettings
  const mcpJsPath = path.join(dir, 'mcp.js');
  if (fs.existsSync(mcpJsPath)) {
    let content = fs.readFileSync(mcpJsPath, 'utf8');
    if (!content.includes("window.dispatchEvent(new Event('settingsChanged'));")) {
      content = content.replace(/localStorage\.setItem\(STORAGE_KEYS\.settings, JSON\.stringify\(settings\)\);/g, "localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));\n      window.dispatchEvent(new Event('settingsChanged'));");
      fs.writeFileSync(mcpJsPath, content, 'utf8');
    }
  }

  // Fix index.js listener
  const indexJsPath = path.join(dir, 'index.js');
  if (fs.existsSync(indexJsPath)) {
    let content = fs.readFileSync(indexJsPath, 'utf8');
    content = content.replace(/loadWorkspaceContext\(\);/g, "hydrateFileContext(); loadWorkspaceHandle();");
    fs.writeFileSync(indexJsPath, content, 'utf8');
  }
}
