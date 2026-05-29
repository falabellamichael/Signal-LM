(function () {
  if (window.__signalLmWriteCommandFix) return;
  window.__signalLmWriteCommandFix = true;

  var pendingWrite = null;
  var WEAK_NAMES = { a: true, b: true, c: true, file: true, newfile: true, output: true, generated: true, code: true, content: true, result: true, temp: true, index: true };
  var GENERIC_LANGS = { html: true, htm: true, css: true, js: true, javascript: true, json: true, md: true, markdown: true, txt: true, text: true, xml: true, yaml: true, yml: true, ts: true, typescript: true, jsx: true, tsx: true, python: true, py: true };

  function runtime() { return window.SignalLMChatCommands || {}; }
  function html(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
  function addResult(value) { var api = runtime(); if (typeof api.addResult === 'function') api.addResult(value); }
  function toast(value) { var api = runtime(); if (typeof api.toast === 'function') api.toast(value); }

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
  }

  function extension(path) {
    var match = normalizePath(path).match(/\.([a-z0-9]{1,12})$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function baseName(path) {
    return (normalizePath(path).split('/').pop() || '').replace(/\.[a-z0-9]{1,12}$/i, '').toLowerCase();
  }

  function hasExtension(path) {
    return /\.[a-z0-9]{1,12}$/i.test(normalizePath(path));
  }

  function weakPath(path) {
    var clean = normalizePath(path);
    if (!clean) return true;
    var base = baseName(clean);
    return !hasExtension(clean) || base.length <= 1 || Boolean(WEAK_NAMES[base]);
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/&[^;]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'generated';
  }

  function stripLeadingCreateWords(value) {
    return String(value || '').replace(/^(create|make|build|generate|write|add|implement)\s+(a|an|the)?\s*/i, '').trim();
  }

  function explicitPath(request) {
    var match = String(request || '').match(/(?:file|path|filename|called|named|as)\s+`?([\w./-]+\.[a-z0-9]{1,12})`?/i);
    return match && match[1] ? normalizePath(match[1]) : '';
  }

  function inferTargetPath(request) {
    var explicit = explicitPath(request);
    if (explicit && !weakPath(explicit)) return explicit;
    if (/\bsudoku\b/i.test(request)) return 'sudoku.html';
    if (/\bcalculator\b/i.test(request)) return 'calculator.html';
    if (/\btodo\b|\bto-do\b/i.test(request)) return 'todo.html';
    if (/\btimer\b/i.test(request)) return 'timer.html';
    if (/\bclock\b/i.test(request)) return 'clock.html';
    if (/\bmarkdown\b|\breadme\b/i.test(request)) return 'README.md';
    if (/\bjson\b/i.test(request)) return slug(stripLeadingCreateWords(request)).slice(0, 48) + '.json';
    if (/\bcss\b/i.test(request)) return slug(stripLeadingCreateWords(request)).slice(0, 48) + '.css';
    if (/\bjavascript\b|\bscript\b|\bjs\b/i.test(request)) return slug(stripLeadingCreateWords(request)).slice(0, 48) + '.js';
    return slug(stripLeadingCreateWords(request)).slice(0, 48) + '.html';
  }

  function commandRequest(raw) {
    return String(raw || '').replace(/^\s*\/write\b/i, '').trim();
  }

  function fileCreationInstruction(targetPath, request) {
    return [
      'You are creating a new file for Signal-LM.',
      'Create exactly one complete file unless the user explicitly asks for multiple files.',
      'Target path: ' + targetPath,
      'User request: ' + request,
      'Return a single fenced code block whose info string is exactly the target path.',
      'The first line of your response should be the code block. Do not echo these instructions.',
      'For a self-contained browser app, game, page, or prototype, put all HTML, CSS, and JavaScript into that one HTML file.',
      'Do not use placeholder filenames such as a, file, output, generated, result, code, or index unless the user explicitly asks for index.html.',
      'Do not return a patch. Return complete file contents.'
    ].join('\n');
  }

  function firstUsefulCodeBlock(responseText) {
    var text = String(responseText || '');
    var re = /```([^\n`]*)\n([\s\S]*?)```/g;
    var match;
    while ((match = re.exec(text))) {
      var info = String(match[1] || '').trim().toLowerCase();
      var content = String(match[2] || '').trim();
      if (!content) continue;
      if (info === 'json' && /^\s*\{[\s\S]*"files"\s*:/.test(content)) continue;
      if (!info || GENERIC_LANGS[info] || /<!doctype\s+html|<html[\s>]/i.test(content) || content.length > 20) {
        return content;
      }
    }
    return '';
  }

  function installCommandPatch() {
    if (typeof window.executeSlashCommand !== 'function' || window.executeSlashCommand.__signalLmWriteCreateOnly) return false;
    var previous = window.executeSlashCommand;
    window.executeSlashCommand = async function (rawCommand) {
      var raw = String(rawCommand || '').trim();
      if (!/^\/write(?:\s|$)/i.test(raw)) return previous.apply(this, arguments);
      var request = commandRequest(raw);
      if (!request) {
        addResult('<strong>Usage:</strong> <code>/write a sudoku game</code><br>Creates a new file. Use <code>/replace</code> to replace content in an existing file.');
        return true;
      }
      var targetPath = inferTargetPath(request);
      pendingWrite = { targetPath: targetPath, request: request, at: Date.now(), autoApply: true };
      var api = runtime();
      if (typeof api.submitPrompt !== 'function') {
        addResult('The chat submit hook is unavailable on this page.');
        return true;
      }
      addResult('Creating <code>' + html(targetPath) + '</code>. Use <code>/replace</code> for existing-file replacements.');
      api.submitPrompt('Create ' + targetPath + ': ' + request);
      return true;
    };
    window.executeSlashCommand.__signalLmWriteCreateOnly = true;
    return true;
  }

  function latestUserText(extraMessages) {
    var extras = Array.isArray(extraMessages) ? extraMessages : [];
    for (var i = extras.length - 1; i >= 0; i--) {
      if (extras[i] && extras[i].role === 'user') {
        var content = extras[i].content;
        if (Array.isArray(content)) {
          return content.map(function (part) { return part && (part.text || part.content || ''); }).join('\n');
        }
        return String(content || '');
      }
    }
    return '';
  }

  function installRequestPatch() {
    if (typeof window.collectRequestMessages !== 'function' || window.collectRequestMessages.__signalLmWriteCreateOnly) return false;
    var previous = window.collectRequestMessages;
    window.collectRequestMessages = async function (extraMessages, workspaceContextOverride) {
      var messages = await previous.apply(this, arguments);
      if (pendingWrite && Date.now() - pendingWrite.at < 120000) {
        var latest = latestUserText(extraMessages);
        if (latest.indexOf('Create ' + pendingWrite.targetPath + ':') === 0) {
          messages.unshift({ role: 'system', content: fileCreationInstruction(pendingWrite.targetPath, pendingWrite.request) });
        }
      }
      return messages;
    };
    window.collectRequestMessages.__signalLmWriteCreateOnly = true;
    return true;
  }

  function repairEditPath(edit, targetPath) {
    if (!edit || typeof edit.content !== 'string') return edit;
    if (weakPath(edit.path)) return Object.assign({}, edit, { path: targetPath });
    if (normalizePath(edit.path).toLowerCase() === 'index.html' && normalizePath(targetPath).toLowerCase() !== 'index.html') {
      return Object.assign({}, edit, { path: targetPath });
    }
    return edit;
  }

  function applyAfterStage() {
    setTimeout(function () {
      var api = runtime();
      if (typeof api.applyPendingEdits === 'function') {
        toast('Created file is staged. Applying it to the selected Android/PC workspace...');
        api.applyPendingEdits();
      } else {
        toast('Created file is staged. Run /apply to write it to the selected workspace.');
      }
    }, 450);
  }

  function installExtractPatch() {
    if (typeof window.extractEditsFromAssistantText !== 'function' || window.extractEditsFromAssistantText.__signalLmWriteCreateOnly) return false;
    var previous = window.extractEditsFromAssistantText;
    window.extractEditsFromAssistantText = function (responseText) {
      var edits = previous.apply(this, arguments) || [];
      if (pendingWrite && Date.now() - pendingWrite.at < 120000) {
        var targetPath = pendingWrite.targetPath;
        if (!edits.length) {
          var content = firstUsefulCodeBlock(responseText);
          if (content) edits = [{ path: targetPath, content: content }];
        }
        if (edits.length) {
          edits = edits.length === 1
            ? [Object.assign({}, edits[0], { path: targetPath })]
            : edits.map(function (edit) { return repairEditPath(edit, targetPath); });
          var shouldApply = pendingWrite.autoApply;
          pendingWrite = null;
          if (shouldApply) applyAfterStage();
        }
      }
      return edits;
    };
    window.extractEditsFromAssistantText.__signalLmWriteCreateOnly = true;
    return true;
  }

  function install() {
    installCommandPatch();
    installRequestPatch();
    installExtractPatch();
  }

  window.SignalLMWriteCommandFix = { install: install, inferTargetPath: inferTargetPath };
  var timer = setInterval(install, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();