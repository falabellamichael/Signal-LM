(function () {
  if (window.__signalLmMcpApplyFix) return;
  window.__signalLmMcpApplyFix = true;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var MESSAGES_KEY = 'lmStudioLite.messages.v1';
  var APPLY_STATE_KEY = 'signalLm.mcpApply.pending.v1';
  var FLAG = '__signalLmMcpApplyPatched';
  var CLEAR_FLAG = '__signalLmMcpApplyClearWatcher';

  function runtime() { return window.SignalLMChatCommands || {}; }
  function edits() { return Array.isArray(window.pendingEdits) ? window.pendingEdits : []; }
  function html(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
  function addResult(value) { var api = runtime(); if (typeof api.addResult === 'function') api.addResult(value); }
  function toast(value) { var api = runtime(); if (typeof api.toast === 'function') api.toast(value); }
  function readSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (error) { return {}; } }

  function stripLanguagePrefix(path) {
    return String(path || '').trim().replace(/^(?:html|htm|javascript|js|css|json|markdown|md|text|txt):(?=(?:[a-z]:[\\/]|\\\\|\/|content:\/\/|file:\/\/|[\w.-]+\.[a-z0-9]))/i, '');
  }

  function normalizeSlash(path) {
    return stripLanguagePrefix(path).replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  }

  function normalizeComparablePath(path) {
    return normalizeSlash(path).replace(/\/+$/, '').toLowerCase();
  }

  function normalizeRelative(path) {
    var clean = normalizeSlash(path).replace(/^\/+/, '');
    if (!clean || clean.indexOf('../') !== -1 || clean === '..') return '';
    if (/^[a-zA-Z]:\//.test(clean) || /^content:\/\//i.test(clean) || /^file:\/\//i.test(clean)) {
      return basename(clean);
    }
    return clean;
  }

  function basename(path) {
    var clean = normalizeSlash(path).replace(/\/+$/, '');
    return clean.split('/').pop() || clean || 'generated.html';
  }

  function dirname(path) {
    var clean = normalizeSlash(path).replace(/\/+$/, '');
    var index = clean.lastIndexOf('/');
    if (index < 0) return '';
    if (/^[a-zA-Z]:$/.test(clean.slice(0, index))) return clean.slice(0, index + 1);
    return clean.slice(0, index);
  }

  function hasExtension(path) {
    return /\.[a-z0-9]{1,12}$/i.test(basename(path));
  }

  function isAbsolutePath(path) {
    var clean = stripLanguagePrefix(path);
    return /^([a-zA-Z]:[\\/])/.test(clean) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(clean) || /^\//.test(clean) || /^file:\/\//i.test(clean);
  }

  function isAndroidContentUri(path) {
    return /^content:\/\//i.test(String(path || '').trim());
  }

  function mcpEnabled() {
    return Boolean(readSettings().mcpEnabled);
  }

  function selectedMcpPath() {
    var helper = window.SignalLMMcpFilePath;
    if (helper && typeof helper.getMcpFilePath === 'function') return String(helper.getMcpFilePath() || '').trim();
    return String(readSettings().mcpFilePath || '').trim();
  }

  function selectedMcpTargetType() {
    var helper = window.SignalLMMcpFilePath;
    if (helper && typeof helper.getMcpTargetType === 'function') return String(helper.getMcpTargetType() || '').trim();
    var settings = readSettings();
    return String(settings.mcpFileTargetType || settings.mcpPathTargetType || '').trim();
  }

  function canApplyViaMcp() {
    var selected = selectedMcpPath();
    return Boolean(mcpEnabled() && selected && !isAndroidContentUri(selected) && isAbsolutePath(selected));
  }

  function joinPath(folder, relativePath) {
    var base = normalizeSlash(folder).replace(/\/+$/, '');
    var rel = normalizeRelative(relativePath).replace(/^\/+/, '');
    if (/^[a-zA-Z]:$/.test(base)) return base + '/' + rel;
    return base ? base + '/' + rel : rel;
  }

  function targetFilePathForEdit(edit) {
    var selected = normalizeSlash(selectedMcpPath());
    var type = selectedMcpTargetType();
    var cleanEditPath = normalizeRelative(edit && edit.path);
    if (!cleanEditPath) cleanEditPath = 'generated.html';

    if (type === 'file' || hasExtension(selected)) {
      var parent = dirname(selected);
      return joinPath(parent, basename(cleanEditPath));
    }
    return joinPath(selected, cleanEditPath);
  }

  function sanitizePendingEdits() {
    var clean = edits().map(function (edit) {
      var path = normalizeRelative(edit && edit.path);
      if (!path) path = basename(edit && edit.path) || 'generated.html';
      return Object.assign({}, edit, { path: path });
    }).filter(function (edit) {
      return edit && typeof edit.content === 'string' && edit.content.length > 0;
    });
    if (clean.length !== edits().length || clean.some(function (edit, index) { return edit.path !== edits()[index].path; })) {
      window.pendingEdits = clean;
    }
    return clean;
  }

  function fenceContent(content) {
    var text = String(content || '');
    var ticks = '```';
    while (text.indexOf(ticks) !== -1) ticks += '`';
    return ticks + '\n' + text + '\n' + ticks;
  }

  function buildMcpApplyPrompt(files) {
    var selected = normalizeSlash(selectedMcpPath());
    var lines = [
      'Apply these reviewed staged edits to the selected MCP filesystem target.',
      '',
      'Use the MCP write_file tool directly. Do not answer with replacement code instead of using the tool.',
      'For every staged file below, call write_file exactly once with only these two arguments: file_path and content.',
      'Do not include format, language, encoding, mime_type, overwrite, create, root, cwd, path, filename, or any extra keys.',
      '',
      'Hard safety rule:',
      'The selected target root is: ' + (selected || '<none>'),
      'Write only to the exact Target file_path values listed below.',
      'If any write_file call to the listed Target file_path fails for permissions or any other reason, STOP and report that failure.',
      'Do not retry to C:/, user folders, .lmstudio, extensions, plugins, skills, node_modules, package folders, recycle-bin paths, temporary folders, or any fallback directory.',
      'Do not claim success if the selected Target file_path failed but another fallback path succeeded.',
      'If a write_file call fails due to argument parsing only, retry once using exactly file_path and content, with the same Target file_path and no other keys.',
      ''
    ];

    files.forEach(function (file, index) {
      lines.push('Staged file ' + (index + 1) + ':');
      lines.push('Target file_path: ' + file.targetPath);
      lines.push('Allowed write destination: ' + file.targetPath);
      lines.push('Call shape: write_file({ file_path: ' + JSON.stringify(file.targetPath) + ', content: "<exact staged content>" })');
      lines.push('Exact staged content:');
      lines.push(fenceContent(file.content));
      lines.push('');
    });

    lines.push('After all write_file calls to the listed Target file_path values succeed, reply briefly with only the created/updated file path(s).');
    lines.push('If any listed Target file_path fails, reply briefly with the failed path and the permission/error message. Do not mention or use fallback paths.');
    return lines.join('\n');
  }

  function hashString(value) {
    var str = String(value || '');
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function rememberApplyState(files) {
    var state = {
      at: Date.now(),
      targetPaths: files.map(function (file) { return file.targetPath; }),
      targetKeys: files.map(function (file) { return normalizeComparablePath(file.targetPath); }),
      sourceKeys: files.map(function (file) { return normalizeComparablePath(file.sourcePath); }),
      contentHashes: files.map(function (file) { return hashString(file.content); })
    };
    try { localStorage.setItem(APPLY_STATE_KEY, JSON.stringify(state)); } catch (error) {}
    window.__signalLmLastMcpApplyState = state;
    return state;
  }

  function readApplyState() {
    var state = window.__signalLmLastMcpApplyState || null;
    if (!state) {
      try { state = JSON.parse(localStorage.getItem(APPLY_STATE_KEY) || 'null'); } catch (error) { state = null; }
    }
    if (!state || !Array.isArray(state.targetKeys) || Date.now() - Number(state.at || 0) > 10 * 60 * 1000) return null;
    return state;
  }

  function readMessages() {
    try { return JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]') || []; } catch (error) { return []; }
  }

  function latestAssistantText() {
    var messages = readMessages();
    for (var i = messages.length - 1; i >= 0; i--) {
      var message = messages[i];
      if (message && message.role === 'assistant') return String(message.displayContent || message.content || '');
    }
    return '';
  }

  function responseLooksFailed(text) {
    return /\b(failed|failure|error|permission|denied|blocked|unable|could not|cannot|can't|not allowed|rejected|exception)\b/i.test(String(text || ''));
  }

  function responseConfirmsTargets(text, state) {
    var lower = normalizeSlash(text).toLowerCase();
    return state.targetKeys.every(function (target) {
      return target && lower.indexOf(target) !== -1;
    });
  }

  function pendingEditsStillMatch(state) {
    var current = edits();
    if (!current.length) return false;
    var currentHashes = current.map(function (edit) { return hashString(edit && edit.content || ''); });
    return state.contentHashes.some(function (hash) { return currentHashes.indexOf(hash) !== -1; });
  }

  function clearAfterSuccessfulMcpApply(reason) {
    var api = runtime();
    if (typeof api.clearPendingEdits === 'function') api.clearPendingEdits();
    else if (typeof window.clearPendingEdits === 'function') window.clearPendingEdits();
    else window.pendingEdits = [];
    try { localStorage.removeItem(APPLY_STATE_KEY); } catch (error) {}
    window.__signalLmLastMcpApplyState = null;
    toast(reason || 'MCP apply confirmed. Staged edits cleared.');
  }

  function inspectMcpApplyResult() {
    var state = readApplyState();
    if (!state || !pendingEditsStillMatch(state)) return;
    var text = latestAssistantText();
    if (!text) return;
    if (responseLooksFailed(text)) return;
    if (!responseConfirmsTargets(text, state)) return;
    clearAfterSuccessfulMcpApply('MCP apply confirmed. Edited files cleared.');
  }

  function installApplyResultWatcher() {
    if (window[CLEAR_FLAG]) return false;
    window[CLEAR_FLAG] = true;
    var originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function signalLmMcpApplySetItem(key, value) {
      var result = originalSetItem.apply(this, arguments);
      if (key === MESSAGES_KEY) setTimeout(inspectMcpApplyResult, 0);
      return result;
    };
    if (window.MutationObserver) {
      var target = document.getElementById('messages') || document.body;
      var observer = new MutationObserver(function () { setTimeout(inspectMcpApplyResult, 80); });
      if (target) observer.observe(target, { childList: true, subtree: true, characterData: true });
    }
    setInterval(inspectMcpApplyResult, 1500);
    return true;
  }

  function applyViaMcp() {
    var clean = sanitizePendingEdits();
    if (!clean.length) {
      toast('No valid staged file content to apply.');
      return true;
    }
    var files = clean.map(function (edit) {
      return { sourcePath: edit.path, targetPath: targetFilePathForEdit(edit), content: edit.content };
    });
    var api = runtime();
    if (typeof api.submitPrompt !== 'function') {
      toast('MCP apply needs the chat submit hook, but it is unavailable.');
      return true;
    }
    rememberApplyState(files);
    var summary = files.map(function (file) {
      return '<li><code>' + html(file.sourcePath) + '</code> → <code>' + html(file.targetPath) + '</code></li>';
    }).join('');
    addResult('<strong>Applying staged edit via MCP write_file</strong><ul>' + summary + '</ul><p>The draft stays staged until MCP confirms the exact target path. It clears automatically after confirmed success.</p>');
    api.submitPrompt(buildMcpApplyPrompt(files));
    toast('Apply sent to MCP write_file for the selected path only.');
    return true;
  }

  function install() {
    installApplyResultWatcher();
    var api = runtime();
    var original = window.applyPendingEdits || (api && api.applyPendingEdits);
    if (!api || typeof original !== 'function' || original[FLAG]) return false;

    var patched = async function () {
      if (canApplyViaMcp() && edits().length) return applyViaMcp();
      return original.apply(this, arguments);
    };
    patched[FLAG] = true;
    patched.__originalApplyPendingEdits = original;
    window.applyPendingEdits = patched;
    api.applyPendingEdits = patched;
    return true;
  }

  window.SignalLMMcpApplyFix = {
    install: install,
    canApplyViaMcp: canApplyViaMcp,
    targetFilePathForEdit: targetFilePathForEdit,
    buildMcpApplyPrompt: buildMcpApplyPrompt,
    inspectMcpApplyResult: inspectMcpApplyResult
  };

  var timer = setInterval(install, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();