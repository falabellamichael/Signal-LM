// Signal-LM Android/WebView runtime fixes.
(function () {
  if (window.__signalLmRuntimeFix) return;
  window.__signalLmRuntimeFix = true;

  function syncViewport() {
    var vv = window.visualViewport;
    var h = vv && vv.height ? vv.height : window.innerHeight;
    var offsetTop = vv && typeof vv.offsetTop === 'number' ? vv.offsetTop : 0;
    var inset = Math.max(0, Math.round((window.innerHeight || h || 0) - h - offsetTop));
    if (h) document.documentElement.style.setProperty('--app-height', Math.round(h) + 'px');
    document.documentElement.style.setProperty('--viewport-offset-top', Math.round(offsetTop) + 'px');
    document.documentElement.style.setProperty('--keyboard-inset', inset + 'px');
    if (document.body) document.body.classList.toggle('keyboard-open', inset > 80);
  }

  function installKeyboardCss() {
    if (document.getElementById('signal-lm-keyboard-css')) return;
    var style = document.createElement('style');
    style.id = 'signal-lm-keyboard-css';
    style.textContent = ':root{--viewport-offset-top:0px;--keyboard-inset:0px}@media(max-width:768px){html,body{height:var(--app-height)!important;min-height:var(--app-height)!important;max-height:var(--app-height)!important;overflow:hidden!important}body{position:fixed;inset:0;width:100%}.main-chat{position:fixed!important;top:var(--viewport-offset-top)!important;left:0!important;right:0!important;height:var(--app-height)!important;max-height:var(--app-height)!important;overflow:hidden!important}#messages{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overscroll-behavior:contain}.composer-stack{flex:0 0 auto!important;position:relative;z-index:35}.keyboard-open .composer-stack{padding-bottom:.55rem!important}}';
    document.head.appendChild(style);
  }

  function rawBridge() {
    return window.lmStudioLiteNative || window.NativeFileBridge || window.NativeInferenceBridge || window.AndroidInferenceBridge || null;
  }

  function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;
    var text = value.trim();
    if (!text || !/^[{[]/.test(text)) return value;
    try { return JSON.parse(text); } catch (error) { return value; }
  }

  function bridgePromise(triggerName, resolveName, rejectName, argsBuilder) {
    return function () {
      var bridge = rawBridge();
      var args = Array.prototype.slice.call(arguments);
      if (!bridge || typeof bridge[triggerName] !== 'function') return Promise.reject(new Error('Native bridge method missing: ' + triggerName));
      return new Promise(function (resolve, reject) {
        window[resolveName] = function (value) { resolve(parseMaybeJson(value)); };
        window[rejectName] = function (error) { reject(new Error(String(error || 'Native bridge request failed.'))); };
        bridge[triggerName].apply(bridge, argsBuilder ? argsBuilder(args) : args);
      });
    };
  }

  function installBridge() {
    var bridge = rawBridge();
    if (!bridge) return null;
    var normalized = window.SignalLMNativeBridge || {};
    normalized.acceptsObjects = true;
    normalized.objectBridge = true;

    if (typeof bridge.triggerSelectFolder === 'function') normalized.selectFolder = bridgePromise('triggerSelectFolder', '__selectFolderResolve', '__selectFolderReject');
    if (typeof bridge.triggerGetPersistedWorkspace === 'function') normalized.getPersistedWorkspace = bridgePromise('triggerGetPersistedWorkspace', '__getPersistedWorkspaceResolve', '__getPersistedWorkspaceReject');
    if (typeof bridge.triggerReadFile === 'function') normalized.readFile = bridgePromise('triggerReadFile', '__readFileResolve', '__readFileReject');
    if (typeof bridge.triggerWriteFile === 'function') normalized.writeFile = bridgePromise('triggerWriteFile', '__writeFileResolve', '__writeFileReject');
    if (typeof bridge.triggerWriteFiles === 'function') {
      normalized.writeFiles = bridgePromise('triggerWriteFiles', '__writeFilesResolve', '__writeFilesReject', function (args) {
        return [typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0] || { files: [] })];
      });
    }
    if (typeof bridge.triggerClearPersistedWorkspace === 'function') normalized.clearPersistedWorkspace = bridgePromise('triggerClearPersistedWorkspace', '__clearPersistedWorkspaceResolve', '__clearPersistedWorkspaceReject');
    if (typeof bridge.triggerHttpRequest === 'function') {
      normalized.httpRequest = function (payload) {
        var id = 'http_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        return new Promise(function (resolve, reject) {
          window['__httpResolve_' + id] = resolve;
          window['__httpReject_' + id] = function (error) { reject(new Error(String(error || 'Native HTTP bridge failed.'))); };
          bridge.triggerHttpRequest(typeof payload === 'string' ? payload : JSON.stringify(payload || {}), id);
        });
      };
      normalized.request = normalized.httpRequest;
      normalized.fetchJson = normalized.httpRequest;
    }
    window.SignalLMNativeBridge = normalized;
    window.SignalLMTools = window.SignalLMTools || {};
    window.SignalLMTools.bridge = normalized;
    return normalized;
  }

  function normalizePath(path) {
    var clean = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
    if (!clean || clean.indexOf('../') !== -1 || clean === '..' || /^[a-z]+:/i.test(clean)) return '';
    return clean;
  }

  function normalizeEdits(parsed) {
    var list = Array.isArray(parsed) ? parsed : (parsed && (parsed.files || parsed.changes || parsed.edits)) || [];
    if (!Array.isArray(list)) return [];
    var edits = [];
    var seen = {};
    list.forEach(function (item) {
      var path = normalizePath(item && (item.path || item.file || item.name || item.relativePath));
      var content = item && (item.content !== undefined ? item.content : item.newContent !== undefined ? item.newContent : item.replacement);
      if (path && typeof content === 'string' && !seen[path]) {
        seen[path] = true;
        edits.push({ path: path, content: content });
      }
    });
    return edits;
  }

  function extractEdits(text, previous) {
    var raw = String(text || '');
    var candidates = [];
    raw.replace(/```(?:json|lmstudio-edits|signal-lm-edits)?\s*([\s\S]*?)```/gi, function (_, body) { candidates.push(body.trim()); });
    var obj = raw.match(/\{[\s\S]*"(?:files|changes|edits)"[\s\S]*\}/);
    if (obj) candidates.push(obj[0]);
    for (var i = 0; i < candidates.length; i++) {
      try {
        var edits = normalizeEdits(JSON.parse(candidates[i]));
        if (edits.length) return edits;
      } catch (error) {}
    }
    return typeof previous === 'function' ? previous(raw) : [];
  }

  function patchAppHooks() {
    installBridge();
    if (typeof window.getNativeFileBridge === 'function' && !window.__signalLmGetBridgePatched) {
      var oldGet = window.getNativeFileBridge;
      window.getNativeFileBridge = function () {
        var normalized = installBridge();
        return normalized || oldGet();
      };
      window.__signalLmGetBridgePatched = true;
    }
    if (typeof window.extractEditsFromAssistantText === 'function' && !window.__signalLmExtractPatched) {
      var oldExtract = window.extractEditsFromAssistantText;
      window.extractEditsFromAssistantText = function (text) { return extractEdits(text, oldExtract); };
      window.__signalLmExtractPatched = true;
    }
    if (typeof window.buildWorkspaceEditInstruction === 'function' && !window.__signalLmInstructionPatched) {
      var oldInstruction = window.buildWorkspaceEditInstruction;
      window.buildWorkspaceEditInstruction = function () {
        return oldInstruction() + '\n\nSignal-LM edit tool contract: for file edits, output exactly one fenced JSON block: {"files":[{"path":"relative/path","content":"complete replacement content"}]}. The app will parse it and show Apply.';
      };
      window.__signalLmInstructionPatched = true;
    }
  }

  async function restoreWorkspace() {
    try {
      var bridge = installBridge();
      if (!bridge || !bridge.getPersistedWorkspace || typeof window.loadNativeWorkspace !== 'function') return;
      var ws = await bridge.getPersistedWorkspace();
      if (ws && Array.isArray(ws.files) && ws.files.length) await window.loadNativeWorkspace(ws);
    } catch (error) {}
  }

  window.SignalLMInstallNativeBridge = installBridge;
  installKeyboardCss();
  syncViewport();
  window.addEventListener('resize', syncViewport, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(syncViewport, 80); }, { passive: true });
  window.addEventListener('focusin', function () { setTimeout(syncViewport, 60); }, { passive: true });
  window.addEventListener('focusout', function () { setTimeout(syncViewport, 160); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', syncViewport, { passive: true });
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    patchAppHooks();
    if (attempts === 4 || attempts === 10) restoreWorkspace();
    if (attempts > 20) clearInterval(timer);
  }, 150);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchAppHooks);
  else patchAppHooks();
})();
