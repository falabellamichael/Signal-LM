(function () {
  if (window.__signalLmJsonEditEnforcer) return;
  window.__signalLmJsonEditEnforcer = true;

  var CODE_LANG_TO_FILE = {
    html: 'index.html',
    htm: 'index.html',
    css: 'styles.css',
    js: 'script.js',
    javascript: 'script.js',
    mjs: 'script.mjs',
    json: 'data.json',
    md: 'README.md',
    markdown: 'README.md',
    py: 'script.py',
    python: 'script.py',
    ts: 'script.ts',
    typescript: 'script.ts',
    tsx: 'App.tsx',
    jsx: 'App.jsx',
    xml: 'file.xml',
    yaml: 'config.yaml',
    yml: 'config.yml',
    sql: 'query.sql',
    sh: 'script.sh',
    bash: 'script.sh'
  };

  function instruction() {
    return [
      'Code/file output rule for this app:',
      'Any generated code that is meant to become a file must be returned as a fenced JSON edit block, not as raw fenced html/css/js/code.',
      'Use exactly this schema:',
      '```json',
      '{"files":[{"path":"relative/path/from/workspace-or-best-filename","content":"complete replacement file content"}]}',
      '```',
      'Use complete file content, not patches. Escape newlines and quotes as valid JSON string content. If no filename is given, choose a clear filename such as index.html, sudoku.html, styles.css, or script.js. Keep any explanation outside the JSON block very short.'
    ].join('\n');
  }

  function textFromContent(content) {
    if (Array.isArray(content)) {
      return content.map(function (part) {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return part.text || part.content || '';
      }).join('\n');
    }
    return String(content || '');
  }

  function isLikelyCodeFileRequest(text) {
    return /\b(create|make|build|write|generate|edit|fix|update|replace|implement|code|file|html|css|javascript|js|page|app|component|game|website)\b/i.test(String(text || ''));
  }

  function isEditCommand(text) {
    return /^Edit\s+[^\n]+\r?\n\r?\nRequest:/i.test(String(text || '').trim());
  }

  function installRequestPatch() {
    if (window.__signalLmJsonEditRequestPatch || typeof window.collectRequestMessages !== 'function') return false;
    window.__signalLmJsonEditRequestPatch = true;
    var previous = window.collectRequestMessages;
    window.collectRequestMessages = async function (extraMessages, workspaceContextOverride) {
      var requestMessages = await previous.apply(this, arguments);
      var latestUserText = '';
      try {
        var extras = Array.isArray(extraMessages) ? extraMessages : [];
        for (var i = extras.length - 1; i >= 0; i--) {
          if (extras[i] && extras[i].role === 'user') {
            latestUserText = textFromContent(extras[i].content);
            break;
          }
        }
      } catch (error) {
        latestUserText = '';
      }
      if (isLikelyCodeFileRequest(latestUserText) && !isEditCommand(latestUserText)) {
        requestMessages.unshift({ role: 'system', content: instruction() });
      }
      return requestMessages;
    };
    return true;
  }

  function normalizeWorkspacePath(path) {
    var clean = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
    if (!clean || clean.indexOf('../') !== -1 || clean === '..' || /^[a-z]+:/i.test(clean)) return '';
    return clean;
  }

  function slug(value) {
    var clean = String(value || '').toLowerCase().replace(/&[^;]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return clean || 'index';
  }

  function inferHtmlPath(code, rawText) {
    var title = String(code || '').match(/<title[^>]*>([^<]{1,80})<\/title>/i);
    if (title && title[1]) return slug(title[1]) + '.html';
    var named = String(rawText || '').match(/(?:file|path|filename)\s*[:=]\s*`?([\w./-]+\.html?)`?/i);
    if (named && named[1]) return normalizeWorkspacePath(named[1]) || 'index.html';
    return 'index.html';
  }

  function inferPath(lang, code, rawText) {
    var named = String(rawText || '').match(/(?:file|path|filename)\s*[:=]\s*`?([\w./-]+\.[a-z0-9]+)`?/i);
    if (named && named[1]) return normalizeWorkspacePath(named[1]);
    var normalizedLang = String(lang || '').toLowerCase().trim();
    if (normalizedLang === 'html' || normalizedLang === 'htm' || /<!doctype\s+html|<html[\s>]/i.test(code)) return inferHtmlPath(code, rawText);
    return CODE_LANG_TO_FILE[normalizedLang] || 'generated.txt';
  }

  function tryParseJson(value) {
    try { return JSON.parse(value); }
    catch (error) { return null; }
  }

  function normalizeEditPayload(parsed) {
    var source = Array.isArray(parsed) ? parsed : parsed && (parsed.files || parsed.changes || []);
    if (!Array.isArray(source)) return [];
    var byPath = {};
    source.forEach(function (item) {
      var path = normalizeWorkspacePath(item && (item.path || item.file || item.name));
      var content = item && (item.content != null ? item.content : item.newContent != null ? item.newContent : item.replacement);
      if (!path || typeof content !== 'string') return;
      byPath[path] = { path: path, content: content };
    });
    return Object.keys(byPath).map(function (path) { return byPath[path]; });
  }

  function extractJsonEdits(raw) {
    var candidates = [];
    var text = String(raw || '');
    var fencedRe = /```(?:json|lmstudio-edits)?\s*([\s\S]*?)```/gi;
    var match;
    while ((match = fencedRe.exec(text))) candidates.push(String(match[1] || '').trim());
    var objectMatch = text.match(/\{[\s\S]*"(?:files|changes)"[\s\S]*\}/);
    if (objectMatch) candidates.push(objectMatch[0]);
    for (var i = 0; i < candidates.length; i++) {
      var edits = normalizeEditPayload(tryParseJson(candidates[i]));
      if (edits.length) return edits;
    }
    return [];
  }

  function recoverSingleCodeBlock(raw) {
    var text = String(raw || '');
    var blocks = [];
    var re = /```([a-z0-9_-]+)?\s*\n([\s\S]*?)```/gi;
    var match;
    while ((match = re.exec(text))) {
      var lang = String(match[1] || '').toLowerCase();
      var code = String(match[2] || '').trim();
      if (!code) continue;
      if (lang === 'json' || /"files"\s*:/.test(code)) continue;
      blocks.push({ lang: lang, code: code });
    }
    if (blocks.length !== 1) return [];
    var only = blocks[0];
    var path = inferPath(only.lang, only.code, text);
    if (!path) return [];
    if (path === 'generated.txt' && !isLikelyCodeFileRequest(text)) return [];
    return [{ path: path, content: only.code }];
  }

  function installExtractPatch() {
    if (window.__signalLmJsonEditExtractPatch || typeof window.extractEditsFromAssistantText !== 'function') return false;
    window.__signalLmJsonEditExtractPatch = true;
    var previous = window.extractEditsFromAssistantText;
    window.extractEditsFromAssistantText = function (text) {
      var edits = [];
      try { edits = previous.apply(this, arguments) || []; }
      catch (error) { edits = []; }
      if (edits.length) return edits;
      edits = extractJsonEdits(text);
      if (edits.length) return edits;
      return recoverSingleCodeBlock(text);
    };
    return true;
  }

  function install() {
    installRequestPatch();
    installExtractPatch();
  }

  window.SignalLMJsonEditEnforcer = {
    instruction: instruction,
    install: install,
    extractJsonEdits: extractJsonEdits,
    recoverSingleCodeBlock: recoverSingleCodeBlock,
    inferPath: inferPath
  };

  var timer = setInterval(install, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();

(function () {
  if (window.__signalLmApplyNoAutoZipPatch) return;
  window.__signalLmApplyNoAutoZipPatch = true;

  function toast(message) {
    var api = window.SignalLMChatCommands;
    if (api && typeof api.toast === 'function') return api.toast(message);
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function looksLikeEditsZip(anchor) {
    var name = String(anchor && (anchor.getAttribute('download') || anchor.download) || '');
    var href = String(anchor && (anchor.getAttribute('href') || anchor.href) || '');
    return /^blob:/i.test(href) && /(?:lm-studio-lite-edits|signal-lm-edits).*\.zip$/i.test(name);
  }

  function installApplyPatch() {
    var api = window.SignalLMChatCommands;
    var original = window.applyPendingEdits || (api && api.applyPendingEdits);
    if (!api || typeof original !== 'function' || original.__signalLmNoAutoZip) return Boolean(original && original.__signalLmNoAutoZip);

    var patched = async function () {
      var blocked = false;
      var originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (looksLikeEditsZip(this)) {
          blocked = true;
          return undefined;
        }
        return originalClick.apply(this, arguments);
      };
      try {
        return await original.apply(this, arguments);
      } finally {
        HTMLAnchorElement.prototype.click = originalClick;
        if (blocked) setTimeout(function () {
          toast('Direct write unavailable. Edits stayed staged. ZIP export now requires a manual browser/app download action.');
        }, 0);
      }
    };

    patched.__signalLmNoAutoZip = true;
    patched.__originalApplyPendingEdits = original;
    window.applyPendingEdits = patched;
    api.applyPendingEdits = patched;
    return true;
  }

  var timer = setInterval(installApplyPatch, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installApplyPatch);
  else installApplyPatch();
})();

(function () {
  if (window.__signalLmNaturalWriteCommandPatch) return;
  window.__signalLmNaturalWriteCommandPatch = true;

  var WEAK_NAMES = { a: true, b: true, c: true, file: true, newfile: true, output: true, generated: true, code: true, content: true, result: true, temp: true };

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function splitWrite(raw) {
    var rest = String(raw || '').replace(/^\s*\/write\b/i, '').trim();
    if (!rest) return { path: '', rest: '', full: '' };
    if (rest[0] === '"' || rest[0] === "'" || rest[0] === '`') {
      var quote = rest[0];
      var i = 1;
      var path = '';
      while (i < rest.length && rest[i] !== quote) path += rest[i++];
      return { path: path, rest: rest.slice(i + 1).trim(), full: rest };
    }
    var match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    return { path: match && match[1] || '', rest: match && match[2] || '', full: rest };
  }

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
  }

  function extension(path) {
    var match = normalizePath(path).match(/\.([a-z0-9]{1,12})$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function baseName(path) {
    var name = normalizePath(path).split('/').pop() || '';
    return name.replace(/\.[a-z0-9]{1,12}$/i, '').toLowerCase();
  }

  function hasUsefulExtension(path) {
    return /\.[a-z0-9]{1,12}$/i.test(normalizePath(path));
  }

  function weakPath(path) {
    var clean = normalizePath(path);
    if (!clean) return true;
    var base = baseName(clean);
    if (WEAK_NAMES[base]) return true;
    if (base.length <= 1) return true;
    return !hasUsefulExtension(clean);
  }

  function naturalInstruction(text) {
    var value = String(text || '').trim();
    if (!value) return false;
    if (/^(create|make|build|generate|write|implement|add|fix|update|replace)\b/i.test(value)) return true;
    return /\b(app|game|page|website|html|css|javascript|js|sudoku|calculator|todo|timer|clock|form|component)\b/i.test(value) && value.length < 500;
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/&[^;]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'generated';
  }

  function inferTargetPath(request, explicitPath) {
    var explicit = normalizePath(explicitPath);
    if (explicit && hasUsefulExtension(explicit) && !weakPath(explicit)) return explicit;
    var named = String(request || '').match(/(?:file|path|filename|called|named)\s+`?([\w./-]+\.[a-z0-9]{1,12})`?/i);
    if (named && named[1]) return normalizePath(named[1]);
    if (/\bsudoku\b/i.test(request)) return 'sudoku.html';
    if (/\bcalculator\b/i.test(request)) return 'calculator.html';
    if (/\btodo\b|\bto-do\b/i.test(request)) return 'todo.html';
    if (/\btimer\b/i.test(request)) return 'timer.html';
    if (/\bclock\b/i.test(request)) return 'clock.html';
    if (/\bgame\b|\bapp\b|\bpage\b|\bwebsite\b|\bhtml\b/i.test(request)) return slug(request).slice(0, 48).replace(/^(create|make|build|generate|write)-/, '') + '.html';
    return 'generated.html';
  }

  function generationPrompt(request, targetPath) {
    return [
      '[Built-in tool: Write/Create File]',
      '',
      'User request: ' + request,
      '',
      'Create the requested file content and return it as a staged edit for this app.',
      'Return ONLY a fenced JSON edit block using this schema:',
      '```json',
      '{"files":[{"path":"' + targetPath.replace(/\\/g, '/') + '","content":"complete replacement file content"}]}',
      '```',
      'Use the exact path "' + targetPath.replace(/\\/g, '/') + '" unless the user explicitly named a better filename with an extension.',
      'Never use a one-letter filename or placeholder path such as a, file, output, generated, code, or result.',
      'For a self-contained browser app/game/page, put all HTML, CSS, and JavaScript into one complete HTML file.',
      'Do not return patches. Do not omit boilerplate. Keep any text outside the JSON block empty or very short.'
    ].join('\n');
  }

  function addResult(html) {
    var api = window.SignalLMChatCommands;
    if (api && typeof api.addResult === 'function') return api.addResult(html);
  }

  function submitPrompt(prompt) {
    var api = window.SignalLMChatCommands;
    if (api && typeof api.submitPrompt === 'function') return api.submitPrompt(prompt);
    var input = document.getElementById('user-input');
    var form = document.getElementById('chat-form');
    if (!input || !form) return false;
    input.value = prompt;
    if (typeof window.updateInputHeight === 'function') window.updateInputHeight();
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  }

  function installNaturalWritePatch() {
    if (typeof window.executeSlashCommand !== 'function' || window.executeSlashCommand.__signalLmNaturalWrite) return false;
    var previous = window.executeSlashCommand;
    window.executeSlashCommand = async function (text) {
      var raw = String(text || '').trim();
      if (!/^\/write(?:\s|$)/i.test(raw)) return previous.apply(this, arguments);
      var parsed = splitWrite(raw);
      if (!parsed.full) return previous.apply(this, arguments);
      var shouldGenerate = weakPath(parsed.path) || naturalInstruction(parsed.rest);
      if (!shouldGenerate) return previous.apply(this, arguments);
      var request = parsed.full;
      var targetPath = inferTargetPath(request, parsed.path);
      addResult('Generating <code>' + escapeHtml(targetPath) + '</code> from <code>/write</code>.');
      if (!submitPrompt(generationPrompt(request, targetPath))) return previous.apply(this, arguments);
      return true;
    };
    window.executeSlashCommand.__signalLmNaturalWrite = true;
    return true;
  }

  function repairWeakEditPaths() {
    if (typeof window.extractEditsFromAssistantText !== 'function' || window.extractEditsFromAssistantText.__signalLmRepairWeakPaths) return false;
    var previous = window.extractEditsFromAssistantText;
    window.extractEditsFromAssistantText = function (text) {
      var edits = previous.apply(this, arguments) || [];
      return edits.map(function (edit) {
        if (!edit || !weakPath(edit.path)) return edit;
        var content = String(edit.content || '');
        var inferred = /\bsudoku\b/i.test(content + '\n' + text) ? 'sudoku.html'
          : /<html[\s>]|<!doctype\s+html/i.test(content) ? 'generated.html'
          : extension(edit.path) ? 'generated.' + extension(edit.path)
          : 'generated.html';
        return Object.assign({}, edit, { path: inferred });
      });
    };
    window.extractEditsFromAssistantText.__signalLmRepairWeakPaths = true;
    return true;
  }

  function install() {
    installNaturalWritePatch();
    repairWeakEditPaths();
  }

  var timer = setInterval(install, 200);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();