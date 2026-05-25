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
      if (isLikelyCodeFileRequest(latestUserText)) {
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
