const fs = require('fs');
const path = require('path');

const files = {
  'settings.js': ['saveConnection', 'saveAppearance', 'saveRuntimeSettings', 'testNativeRuntime', 'saveHelperSettings', 'saveDefaults', 'testConnection', 'restoreDefaults', 'clearSavedChat'],
  'mcp.js': ['saveMcpSettings', 'syncNewTypeFields', 'addIntegration', 'addHuggingFaceExample', 'addPlaywrightExample', 'copyPreview', 'resetNativeThread', 'testNativeModels', 'testMcpChat'],
  'editor.js': ['selectFolder', 'selectFilesFallback', 'rescanFolder', 'sendWorkspaceToChat', 'saveSelectedFile', 'downloadSelectedFile', 'previewAiFolderEdits', 'applyAiFolderEdits'],
  'index.js': ['toggleSidebar', 'loadModels', 'testAndroidRuntime', 'exportChat', 'clearChat', 'openWorkspaceFromChat', 'selectWorkspaceFilesFallback', 'previewChatContext', 'toggleContextHelper', 'clearWorkspace', 'openAttachmentPicker', 'applyPendingEdits', 'clearPendingEdits', 'closeContextPreview', 'copyContextPreview', 'toggleWorkspaceCollapse']
};

const dirs = [
  __dirname,
  path.join(__dirname, 'SignalLM-Android', 'app', 'src', 'main', 'assets')
];

for (const dir of dirs) {
  for (const [filename, exports] of Object.entries(files)) {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) continue;
    
    let content = fs.readFileSync(p, 'utf8');
    
    // Prevent double wrapping
    if (content.startsWith('(function() {')) continue;

    let newContent = `(function() {\n${content}\n\n// Expose for HTML\n`;
    for (const exp of exports) {
      newContent += `window.${exp} = ${exp};\n`;
    }
    
    // Add special event listeners
    if (filename === 'settings.js') {
      newContent += `\nwindow.addEventListener('settingsChanged', () => { settings = loadSettings(); fillForm(); });\n`;
    } else if (filename === 'mcp.js') {
      newContent += `\nwindow.addEventListener('settingsChanged', () => { renderAll(); });\n`;
    } else if (filename === 'index.js') {
      newContent += `\nwindow.addEventListener('settingsChanged', () => { settings = loadSettings(); if (settings.model) els.modelDisplay.textContent = settings.model; });\n`;
      newContent += `\nwindow.addEventListener('workspaceSelected', () => { loadWorkspaceContext(); });\n`;
    }

    newContent += `})();\n`;
    fs.writeFileSync(p, newContent, 'utf8');
    console.log(`Wrapped ${p}`);
  }
}
