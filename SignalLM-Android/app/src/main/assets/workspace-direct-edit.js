(function () {
  const WORKSPACE_INFO_KEY = 'lmStudioLite.workspaceInfo.v1';
  const BRIDGE_NAMES = [
    'lmStudioLiteNative',
    'NativeFileBridge',
    'AndroidBridge',
    'AndroidFileBridge',
    'AndroidWorkspaceBridge'
  ];

  function getBridge() {
    for (const name of BRIDGE_NAMES) {
      const bridge = window[name];
      if (bridge && typeof bridge === 'object') return bridge;
    }
    return null;
  }

  function parseBridgeResult(result) {
    if (typeof result !== 'string') return result;
    const trimmed = result.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch { return result; }
  }

  async function bridgeCall(method, payload) {
    const bridge = getBridge();
    if (!bridge || typeof bridge[method] !== 'function') throw new Error(`Missing app file bridge method: ${method}`);
    const value = typeof payload === 'undefined'
      ? bridge[method]()
      : bridge.acceptsObjects === true || bridge.objectBridge === true
        ? bridge[method](payload)
        : bridge[method](typeof payload === 'string' ? payload : JSON.stringify(payload));
    return parseBridgeResult(value && typeof value.then === 'function' ? await value : value);
  }

  function normalizePath(path) {
    var clean = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
    var roots = [];
    if (typeof window.__signalLmActiveWorkspacePath === 'string' && window.__signalLmActiveWorkspacePath) {
      roots.push(window.__signalLmActiveWorkspacePath);
    }
    try {
      var mcpSettings = JSON.parse(localStorage.getItem('lmStudioLite.settings.v1') || '{}') || {};
      if (mcpSettings.mcpFilePath) {
        roots.push(mcpSettings.mcpFilePath);
      }
    } catch (e) {}

    for (var i = 0; i < roots.length; i++) {
      var root = String(roots[i]).replace(/\\/g, '/').replace(/\/+$/, '').trim();
      if (root && clean.toLowerCase().indexOf(root.toLowerCase()) === 0) {
        clean = clean.slice(root.length).replace(/^\/+/, '').trim();
        break;
      }
    }
    return clean;
  }

  function rememberWorkspace(info) {
    if (!info || typeof info !== 'object') return;
    const files = Array.isArray(info.files) ? info.files : [];
    const name = info.name || info.rootName || info.path || 'App workspace';
    try {
      localStorage.setItem(WORKSPACE_INFO_KEY, JSON.stringify({
        name,
        source: info.writable === false ? 'app read-only workspace' : 'app workspace',
        writable: info.writable !== false,
        count: files.length,
        updatedAt: new Date().toISOString()
      }));
    } catch {}
  }

  function hasWorkspaceBridge() {
    const bridge = getBridge();
    return Boolean(bridge && (bridge.selectFolder || bridge.getActiveWorkspace || bridge.getPersistedWorkspace || bridge.readFile || bridge.writeFile || bridge.writeFiles));
  }

  async function loadPersistedWorkspaceIntoPage() {
    const bridge = getBridge();
    if (!bridge) return false;
    const method = bridge.getActiveWorkspace ? 'getActiveWorkspace' : bridge.getPersistedWorkspace ? 'getPersistedWorkspace' : null;
    if (!method || typeof window.loadNativeWorkspace !== 'function') return false;
    try {
      const data = await bridgeCall(method);
      if (!data || typeof data !== 'object') return false;
      rememberWorkspace(data);
      await window.loadNativeWorkspace(data);
      return true;
    } catch (error) {
      console.warn('Workspace restore through app bridge failed:', error);
      return false;
    }
  }

  async function selectFolderThroughBridge(fallback) {
    const bridge = getBridge();
    if (!bridge?.selectFolder || typeof window.loadNativeWorkspace !== 'function') {
      return fallback ? fallback() : undefined;
    }
    try {
      const data = await bridgeCall('selectFolder');
      if (data && typeof data === 'object') {
        rememberWorkspace(data);
        await window.loadNativeWorkspace(data);
        return data;
      }
    } catch (error) {
      console.warn('App folder picker failed:', error);
    }
    return fallback ? fallback() : undefined;
  }

  async function writeEditsThroughBridge(edits) {
    const bridge = getBridge();
    if (!bridge) return false;
    const files = (Array.isArray(edits) ? edits : [])
      .map(edit => ({ path: normalizePath(edit.path || edit.file || edit.name), content: String(edit.content ?? edit.newContent ?? edit.replacement ?? '') }))
      .filter(edit => edit.path);
    if (!files.length) return false;

    if (typeof bridge.writeFiles === 'function') {
      try {
        await bridgeCall('writeFiles', { files });
      } catch (firstError) {
        try { await bridgeCall('writeFiles', files); }
        catch { throw firstError; }
      }
      return true;
    }

    if (typeof bridge.writeFile === 'function') {
      for (const file of files) {
        try {
          await bridgeCall('writeFile', { path: file.path, content: file.content });
        } catch (firstError) {
          try { await bridgeCall('writeFile', [file.path, file.content]); }
          catch {
            try {
              const result = bridge.writeFile(file.path, file.content);
              if (result && typeof result.then === 'function') await result;
            } catch { throw firstError; }
          }
        }
      }
      return true;
    }

    return false;
  }

  function patchCommonFolderPage() {
    const originalSelectFolder = window.selectFolder;
    if (typeof originalSelectFolder === 'function') {
      window.selectFolder = function patchedSelectFolder() {
        return selectFolderThroughBridge(originalSelectFolder);
      };
    }

    const originalApplyAiFolderEdits = window.applyAiFolderEdits;
    if (typeof originalApplyAiFolderEdits === 'function') {
      window.applyAiFolderEdits = async function patchedApplyAiFolderEdits() {
        const edits = Array.isArray(window.pendingAiChanges) ? window.pendingAiChanges : null;
        if (edits && edits.length && hasWorkspaceBridge()) {
          const ok = await writeEditsThroughBridge(edits);
          if (ok) {
            window.pendingAiChanges = [];
            if (typeof window.renderAiChanges === 'function') window.renderAiChanges();
            return;
          }
        }
        return originalApplyAiFolderEdits();
      };
    }
  }

  function patchChatPage() {
    const originalOpenWorkspaceFromChat = window.openWorkspaceFromChat;
    if (typeof originalOpenWorkspaceFromChat === 'function') {
      window.openWorkspaceFromChat = function patchedOpenWorkspaceFromChat() {
        return selectFolderThroughBridge(originalOpenWorkspaceFromChat);
      };
    }

    const originalApplyPendingEdits = window.applyPendingEdits;
    if (typeof originalApplyPendingEdits === 'function') {
      window.applyPendingEdits = async function patchedApplyPendingEdits() {
        const panel = document.getElementById('pending-edit-chips');
        const edits = Array.isArray(window.pendingEdits) ? window.pendingEdits : null;
        if (edits && edits.length && hasWorkspaceBridge()) {
          const ok = await writeEditsThroughBridge(edits);
          if (ok) {
            if (typeof window.clearPendingEdits === 'function') window.clearPendingEdits();
            return;
          }
        }
        return originalApplyPendingEdits();
      };
    }
  }

  function patchCapabilityText() {
    if (!hasWorkspaceBridge()) return;
    const capabilityText = document.getElementById('capability-text');
    const capabilityPill = document.getElementById('capability-pill');
    if (capabilityText) capabilityText.textContent = 'App folder bridge available';
    if (capabilityPill) capabilityPill.className = 'status-pill connected';
  }

  window.LmStudioLiteWorkspaceBridge = {
    getBridge,
    bridgeCall,
    loadPersistedWorkspaceIntoPage,
    writeEditsThroughBridge,
    hasWorkspaceBridge
  };

  patchCommonFolderPage();
  patchChatPage();
  patchCapabilityText();

  window.addEventListener('DOMContentLoaded', () => {
    patchCapabilityText();
    setTimeout(loadPersistedWorkspaceIntoPage, 100);
  });
  setTimeout(loadPersistedWorkspaceIntoPage, 250);
})();
