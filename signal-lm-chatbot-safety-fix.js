(function () {
  if (window.__signalLmChatbotSafetyFix) return;
  window.__signalLmChatbotSafetyFix = true;

  var SETTINGS_KEY = 'lmStudioLite.settings.v1';
  var MESSAGES_KEY = 'lmStudioLite.messages.v1';
  var FETCH_FLAG = '__signalLmChatbotLoopFetchPatch';
  var SUBMIT_FLAG = '__signalLmChatbotLoopSubmitPatch';
  var APPLY_FLAG = '__signalLmChatbotLoopApplyPatch';
  var JSON_CLASS = 'json-source-preserved';
  var recentPrompts = [];
  var recentFetches = [];
  var recentApplies = [];
  var WINDOW_MS = 90000;
  var APPLY_WINDOW_MS = 45000;
  var MAX_REPEAT = 2;

  var lastInteraction = 0;
  var userHasJustSubmitted = false;
  var submissionTimeout = null;

  function trackInteraction() {
    lastInteraction = Date.now();
  }

  function flagUserSubmission() {
    userHasJustSubmitted = true;
    trackInteraction();
    if (submissionTimeout) clearTimeout(submissionTimeout);
    submissionTimeout = setTimeout(function () {
      userHasJustSubmitted = false;
    }, 60000);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', trackInteraction, true);
    document.addEventListener('mousedown', trackInteraction, true);
    document.addEventListener('touchstart', trackInteraction, true);
    document.addEventListener('input', trackInteraction, true);

    document.addEventListener('submit', function (e) {
      if (e.target && (e.target.id === 'chat-form' || e.target.classList.contains('input-area'))) {
        flagUserSubmission();
      } else {
        trackInteraction();
      }
    }, true);

    document.addEventListener('click', function (e) {
      var target = e.target;
      var isSubmitClick = false;
      while (target && target !== document) {
        if (target.id === 'send-btn' || target.classList.contains('send-btn') || target.classList.contains('submit-btn')) {
          isSubmitClick = true;
          break;
        }
        target = target.parentNode;
      }
      if (isSubmitClick) {
        flagUserSubmission();
      } else {
        trackInteraction();
      }
    }, true);
  }

  function isUserInteracting() {
    return (Date.now() - lastInteraction) < 4000;
  }

  function now() { return Date.now(); }
  function readSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (error) { return {}; } }
  function mcpEnabled() { return Boolean(readSettings().mcpEnabled); }
  function runtime() { return window.SignalLMChatCommands || {}; }
  function toast(message) { var api = runtime(); if (api && typeof api.toast === 'function') api.toast(message); }
  function edits() { return Array.isArray(window.pendingEdits) ? window.pendingEdits : []; }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

  function normalizePrompt(value) {
    return String(value || '')
      .replace(/response_id\s*[:=]\s*[\w.-]+/gi, 'response_id:<id>')
      .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20000);
  }

  function rememberAndCheck(bucket, key, windowMs, maxRepeat) {
    var t = now();
    for (var i = bucket.length - 1; i >= 0; i--) {
      if (t - bucket[i].time > windowMs) bucket.splice(i, 1);
    }
    var count = bucket.filter(function (item) { return item.key === key; }).length;
    bucket.push({ key: key, time: t });
    return count >= maxRepeat;
  }

  function normalizeFetchBody(body) {
    if (!body || typeof body !== 'object') return '';
    var input = typeof body.input === 'string'
      ? body.input
      : Array.isArray(body.input)
        ? body.input.map(function (part) { return part && (part.text || part.content || ''); }).join('\n')
        : '';
    var toolNames = Array.isArray(body.integrations)
      ? body.integrations.map(function (item) {
          if (!item) return '';
          if (typeof item === 'string') return item;
          return [item.type, item.server_label, item.id, Array.isArray(item.allowed_tools) ? item.allowed_tools.join(',') : ''].join(':');
        }).join('|')
      : '';
    return normalizePrompt([body.model || '', input, toolNames].join('\n---\n'));
  }

  function isMcpChatRequest(resource, body) {
    if (!mcpEnabled()) return false;
    var url = typeof resource === 'string' ? resource : resource && resource.url ? resource.url : String(resource || '');
    return /\/api\/v1\/chat(?:[?#].*)?$/i.test(url) || Boolean(body && Array.isArray(body.integrations));
  }

  function installFetchLoopGuard() {
    if (window[FETCH_FLAG] || typeof window.fetch !== 'function') return false;
    window[FETCH_FLAG] = true;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function signalLmLoopGuardFetch(resource, init) {
      try {
        var raw = init && init.body;
        if (typeof raw === 'string' && raw.trim().charAt(0) === '{') {
          var parsed = JSON.parse(raw);
          if (isMcpChatRequest(resource, parsed)) {
            var key = hashString(normalizeFetchBody(parsed));
            if (userHasJustSubmitted) {
              userHasJustSubmitted = false;
              if (submissionTimeout) {
                clearTimeout(submissionTimeout);
                submissionTimeout = null;
              }
              rememberAndCheck(recentFetches, key, WINDOW_MS, MAX_REPEAT);
              return originalFetch(resource, init);
            }
            if (rememberAndCheck(recentFetches, key, WINDOW_MS, MAX_REPEAT)) {
              if (isUserInteracting()) {
                return originalFetch(resource, init);
              }
              var message = 'Loop guard stopped a repeated MCP/chatbot request. The draft remains staged; change the request or clear the staged edits before retrying.';
              toast(message);
              return Promise.reject(new Error(message));
            }
          }
        }
      } catch (error) {
        // Fall through to the original request when body parsing fails.
      }
      return originalFetch(resource, init);
    };
    return true;
  }

  function installSubmitLoopGuard() {
    var api = runtime();
    if (!api || typeof api.submitPrompt !== 'function' || api.submitPrompt[SUBMIT_FLAG]) return false;
    var originalSubmit = api.submitPrompt;
    api.submitPrompt = function signalLmLoopGuardSubmit(prompt) {
      flagUserSubmission();
      var key = hashString(normalizePrompt(prompt));
      if (rememberAndCheck(recentPrompts, key, WINDOW_MS, MAX_REPEAT)) {
        if (isUserInteracting()) {
          return originalSubmit.apply(this, arguments);
        }
        toast('Loop guard stopped a repeated chatbot prompt. Edit the prompt or clear staged edits before retrying.');
        return false;
      }
      return originalSubmit.apply(this, arguments);
    };
    api.submitPrompt[SUBMIT_FLAG] = true;
    return true;
  }

  function applyKey() {
    var data = edits().map(function (edit) {
      return [edit && edit.path || '', hashString(edit && edit.content || '')].join(':');
    }).join('|');
    var selected = '';
    try {
      var helper = window.SignalLMMcpFilePath;
      selected = helper && typeof helper.getMcpFilePath === 'function' ? helper.getMcpFilePath() : (readSettings().mcpFilePath || '');
    } catch (error) {}
    return hashString(String(selected || '') + '\n' + data);
  }

  function installApplyLoopGuard() {
    var api = runtime();
    var originalApply = window.applyPendingEdits || (api && api.applyPendingEdits);
    if (!api || typeof originalApply !== 'function' || originalApply[APPLY_FLAG]) return false;
    var patched = function signalLmLoopGuardApply() {
      trackInteraction();
      if (edits().length) {
        var key = applyKey();
        if (rememberAndCheck(recentApplies, key, APPLY_WINDOW_MS, 1)) {
          if (isUserInteracting()) {
            return originalApply.apply(this, arguments);
          }
          toast('Loop guard stopped a repeated Apply for the same staged draft. The draft is still staged.');
          return true;
        }
      }
      return originalApply.apply(this, arguments);
    };
    patched[APPLY_FLAG] = true;
    patched.__originalApplyPendingEdits = originalApply;
    window.applyPendingEdits = patched;
    api.applyPendingEdits = patched;
    return true;
  }

  function readMessages() {
    try { return JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]') || []; }
    catch (error) { return []; }
  }

  function extractVisibleJsonBlocks(text) {
    var blocks = [];
    var raw = String(text || '');
    var re = /```(json|lmstudio-edits)\s*\n([\s\S]*?)```/gi;
    var match;
    while ((match = re.exec(raw))) {
      var lang = match[1] || 'json';
      var code = String(match[2] || '').trim();
      if (!code) continue;
      var shouldPreserve = false;
      try {
        var parsed = JSON.parse(code);
        shouldPreserve = isToolOrEditJson(parsed);
      } catch (error) {
        shouldPreserve = false;
      }
      if (shouldPreserve) blocks.push({ lang: lang, code: code });
    }
    return blocks;
  }

  function isToolOrEditJson(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (Array.isArray(parsed)) return parsed.some(isToolOrEditJson);
    if (Array.isArray(parsed.files) || Array.isArray(parsed.changes)) return true;
    if (parsed.type === 'tool_use' || parsed.tool || parsed.tool_name || parsed.name || parsed.function_call || parsed.arguments) return true;
    return false;
  }

  function makeJsonBlock(block, index) {
    var outer = document.createElement('details');
    outer.className = JSON_CLASS;
    outer.open = true;
    outer.dataset.jsonIndex = String(index);
    outer.innerHTML = '<summary>Original tool/edit ' + escapeHtml(block.lang) + ' block</summary>' +
      '<pre><code class="language-json">' + escapeHtml(block.code) + '</code></pre>';
    return outer;
  }

  function annotateJsonBlocks() {
    var stored = readMessages();
    if (!stored.length) return;
    var rows = Array.prototype.slice.call(document.querySelectorAll('.message-row'));
    var messageIndex = 0;
    rows.forEach(function (row) {
      if (row.querySelector('.command-result')) return;
      var expectedRole = row.classList.contains('ai') ? 'assistant' : row.classList.contains('user') ? 'user' : '';
      var message = null;
      while (messageIndex < stored.length) {
        var candidate = stored[messageIndex++];
        if ((candidate && candidate.role) === expectedRole) { message = candidate; break; }
      }
      if (!message || expectedRole !== 'assistant') return;
      var content = message.displayContent || message.content || '';
      var blocks = extractVisibleJsonBlocks(content);
      if (!blocks.length) return;
      var bubble = row.querySelector('.bubble');
      if (!bubble || bubble.dataset.jsonSourcePreserved === hashString(content)) return;
      bubble.querySelectorAll('.' + JSON_CLASS).forEach(function (node) { node.remove(); });
      blocks.forEach(function (block, index) { bubble.appendChild(makeJsonBlock(block, index)); });
      bubble.dataset.jsonSourcePreserved = hashString(content);
      if (window.Prism) bubble.querySelectorAll('.' + JSON_CLASS + ' code').forEach(function (code) { Prism.highlightElement(code); });
    });
  }

  function installJsonPreserver() {
    if (window.__signalLmJsonVisibilityPreserver) return false;
    window.__signalLmJsonVisibilityPreserver = true;
    var originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function signalLmStorageSetItem(key, value) {
      var result = originalSetItem.apply(this, arguments);
      if (key === MESSAGES_KEY) setTimeout(annotateJsonBlocks, 0);
      return result;
    };
    var target = document.getElementById('messages');
    if (target && window.MutationObserver) {
      var observer = new MutationObserver(function () { setTimeout(annotateJsonBlocks, 0); });
      observer.observe(target, { childList: true, subtree: true });
    }
    setTimeout(annotateJsonBlocks, 0);
    return true;
  }

  function hookRuntimeCommands() {
    if (typeof window.executeSlashCommand === 'function' && !window.executeSlashCommand.__patchedForInteraction) {
      var originalExec = window.executeSlashCommand;
      window.executeSlashCommand = function () {
        flagUserSubmission();
        return originalExec.apply(this, arguments);
      };
      window.executeSlashCommand.__patchedForInteraction = true;
    }
  }

  function install() {
    installFetchLoopGuard();
    installSubmitLoopGuard();
    installApplyLoopGuard();
    installJsonPreserver();
    hookRuntimeCommands();
  }

  window.SignalLMChatbotSafetyFix = {
    install: install,
    annotateJsonBlocks: annotateJsonBlocks
  };

  var timer = setInterval(install, 250);
  setTimeout(function () { clearInterval(timer); }, 12000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
