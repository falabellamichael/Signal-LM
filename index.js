(function() {
const STORAGE_KEYS = {
      settings: 'lmStudioLite.settings.v1',
      messages: 'lmStudioLite.messages.v1',
      fileContext: 'lmStudioLite.fileContext.v1',
      workspaceInfo: 'lmStudioLite.workspaceInfo.v1'
    };

    const DEFAULT_SETTINGS = {
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: '',
      temperature: 0.7,
      topP: 1,
      maxTokens: 500,
      systemPrompt: 'You are a concise, helpful local assistant.',
      persistChat: true,
      theme: 'system',
      runtimeMode: 'server',
      hybridStrategy: 'fallback',
      hybridFallbackMs: 12000,
      androidBackend: 'vulkan',
      androidGpuLayers: 99,
      androidThreads: 4,
      androidContextLength: 4096,
      androidBatchSize: 512,
      androidUseMmap: true,
      androidUseMlock: false,
      contextHelperEnabled: true,
      contextHelperMode: 'smart',
      contextHelperMaxSnippets: 16,
      contextHelperMaxChars: 70000
    };

    const HANDLE_DB = 'lmStudioLite.filesystem.v1';
    const HANDLE_STORE = 'handles';
    const WORKSPACE_HANDLE_KEY = 'workspaceHandle';
    const COMPATIBLE_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.log', '.html', '.htm', '.css', '.js', '.mjs', '.json', '.xml', '.yml', '.yaml', '.py', '.ts', '.tsx', '.jsx', '.php', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.sql', '.sh', '.zsh', '.bash', '.env', '.gitignore']);
    const TEXT_MIME_TYPES = new Set(['text/plain', 'text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json', 'text/markdown', 'text/csv', 'application/xml', 'text/xml']);
    const MAX_ATTACHMENT_TEXT_BYTES = 1024 * 1024;
    const MAX_ATTACHMENT_TEXT_CHARS = 60000;
    const MAX_WORKSPACE_SCAN_FILES = 220;
    const MAX_WORKSPACE_CONTEXT_FILES = 28;
    const MAX_WORKSPACE_TOTAL_CONTEXT_CHARS = 150000;
    const MAX_WORKSPACE_FILE_CONTEXT_CHARS = 45000;
    const MAX_CHAT_HISTORY_WITH_WORKSPACE = 4;

    let settings = loadSettings();
    let messages = settings.persistChat ? loadMessages() : [];
    let abortController = null;
    let isStreaming = false;
    let attachments = [];
    let workspaceHandle = null;
    let workspaceInfo = null;
    let workspaceFiles = [];
    let workspaceSelectedPaths = new Set();
    let nativeWorkspace = null;
    let pendingEdits = [];
    let lastContextScoutReport = null;

    const els = {
      sidebar: document.getElementById('sidebar'),
      scrim: document.getElementById('mobile-scrim'),
      msgContainer: document.getElementById('messages'),
      userInput: document.getElementById('user-input'),
      sendBtn: document.getElementById('send-btn'),
      modelSelect: document.getElementById('model-select'),
      runtimeMode: document.getElementById('runtime-mode'),
      runtimeStatusLine: document.getElementById('runtime-status-line'),
      androidRuntimeFields: document.getElementById('android-runtime-fields'),
      hybridStrategy: document.getElementById('hybrid-strategy'),
      hybridFallbackMs: document.getElementById('hybrid-fallback-ms'),
      hybridStrategyGroup: document.getElementById('hybrid-strategy-group'),
      hybridTimeoutGroup: document.getElementById('hybrid-timeout-group'),
      androidThreads: document.getElementById('android-threads'),
      androidGpuLayers: document.getElementById('android-gpu-layers'),
      androidContextLength: document.getElementById('android-context-length'),
      androidBatchSize: document.getElementById('android-batch-size'),
      tempRange: document.getElementById('temp-range'),
      tempInput: document.getElementById('temp-input'),
      tempValue: document.getElementById('temp-value'),
      topPRange: document.getElementById('top-p-range'),
      topPInput: document.getElementById('top-p-input'),
      topPValue: document.getElementById('top-p-value'),
      maxTokensInput: document.getElementById('max-tokens'),
      systemPrompt: document.getElementById('system-prompt'),
      modelDisplay: document.getElementById('model-display'),
      statusPill: document.getElementById('status-pill'),
      statusText: document.getElementById('status-text'),
      serverUrlCopy: document.getElementById('server-url-copy'),
      toast: document.getElementById('toast'),
      form: document.getElementById('chat-form'),
      composerStack: document.getElementById('composer-stack'),
      composerShell: document.getElementById('composer-shell'),
      attachmentInput: document.getElementById('chat-attachments'),
      attachmentTray: document.getElementById('attachment-tray'),
      workspaceStrip: document.getElementById('workspace-strip'),
      workspaceName: document.getElementById('workspace-name'),
      workspaceContextStatus: document.getElementById('workspace-context-status'),
      contextHelperStatus: document.getElementById('context-helper-status'),
      contextHelperToggle: document.getElementById('context-helper-toggle'),
      workspaceFileRow: document.getElementById('workspace-file-row'),
      contextDebugPanel: document.getElementById('context-debug-panel'),
      contextDebugSummary: document.getElementById('context-debug-summary'),
      contextPreview: document.getElementById('context-preview'),
      workspaceFolderInput: document.getElementById('workspace-folder-input'),
      workspaceFilesInput: document.getElementById('workspace-files-input'),
      pendingEditsPanel: document.getElementById('pending-edits-panel'),
      pendingEditsSummary: document.getElementById('pending-edits-summary'),
      pendingEditChips: document.getElementById('pending-edit-chips'),
      applyEditsBtn: document.getElementById('apply-edits-btn')
    };

    function loadSettings() {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}') };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    function saveSettings() {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    }

    function loadMessages() {
      try {
        const loaded = JSON.parse(localStorage.getItem(STORAGE_KEYS.messages) || '[]');
        return Array.isArray(loaded) ? loaded : [];
      } catch {
        return [];
      }
    }

    function saveMessages() {
      if (settings.persistChat) {
        localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages));
      }
    }

    function normalizeBaseUrl(url) {
      return (url || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '');
    }

    function endpoint(path) {
      return normalizeBaseUrl(settings.baseUrl) + path;
    }

    function getHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      return headers;
    }

    function getRuntimeMode() {
      return settings.runtimeMode || DEFAULT_SETTINGS.runtimeMode;
    }

    function isAndroidRuntime() {
      return getRuntimeMode() === 'android-vulkan';
    }

    function isHybridRuntime() {
      return getRuntimeMode() === 'hybrid';
    }

    function usesAndroidSupport() {
      return isAndroidRuntime() || isHybridRuntime();
    }

    function getNativeInferenceBridge() {
      return window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidInferenceBridge || null;
    }

    function runtimeStatusCopy() {
      if (isAndroidRuntime()) return 'Android Vulkan local runtime';
      if (isHybridRuntime()) return `Hybrid: ${normalizeBaseUrl(settings.baseUrl)} + Android support`;
      return normalizeBaseUrl(settings.baseUrl);
    }

    function updateRuntimeUi() {
      const androidOnly = isAndroidRuntime();
      const hybrid = isHybridRuntime();
      const phoneSupport = usesAndroidSupport();
      if (els.androidRuntimeFields) els.androidRuntimeFields.classList.toggle('hidden', !phoneSupport);
      if (els.hybridStrategyGroup) els.hybridStrategyGroup.classList.toggle('hidden', !hybrid);
      if (els.hybridTimeoutGroup) els.hybridTimeoutGroup.classList.toggle('hidden', !hybrid || (settings.hybridStrategy || DEFAULT_SETTINGS.hybridStrategy) !== 'fallback');
      if (els.runtimeStatusLine) {
        const bridge = getNativeInferenceBridge();
        if (hybrid) {
          els.runtimeStatusLine.textContent = bridge
            ? 'Hybrid boost ready: PC server is primary, phone GPU/CPU/RAM can act as fallback or parallel helper.'
            : 'Hybrid selected. PC server will run; phone support needs the native Android inference bridge in the app build.';
        } else if (androidOnly) {
          els.runtimeStatusLine.textContent = bridge
            ? 'Native Android bridge detected. Requests use the phone GPU/CPU/RAM through the app runtime.'
            : 'Android runtime selected, but the native bridge is not exposed by this app build yet.';
        } else {
          els.runtimeStatusLine.textContent = 'Server mode uses the configured LM Studio API.';
        }
      }
      els.serverUrlCopy.textContent = runtimeStatusCopy();
      const suffix = androidOnly ? ' · Android Vulkan' : hybrid ? ' · Hybrid boost' : '';
      els.modelDisplay.textContent = settings.model ? `${settings.model}${suffix}` : 'No model selected';
    }

    function getAndroidRuntimeOptions() {
      return {
        backend: settings.androidBackend || 'vulkan',
        gpu_layers: Math.max(0, parseInt(settings.androidGpuLayers, 10) || 0),
        threads: Math.max(1, parseInt(settings.androidThreads, 10) || DEFAULT_SETTINGS.androidThreads),
        context_length: Math.max(1024, parseInt(settings.androidContextLength, 10) || DEFAULT_SETTINGS.androidContextLength),
        batch_size: Math.max(32, parseInt(settings.androidBatchSize, 10) || DEFAULT_SETTINGS.androidBatchSize),
        use_mmap: settings.androidUseMmap !== false,
        use_mlock: Boolean(settings.androidUseMlock)
      };
    }

    function parseMaybeJson(value) {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed || !/^[{[]/.test(trimmed)) return value;
      try { return JSON.parse(trimmed); } catch { return value; }
    }

    function extractNativeCompletionText(result) {
      const data = parseMaybeJson(result);
      if (typeof data === 'string') return data;
      if (!data || typeof data !== 'object') return '';
      if (typeof data.text === 'string') return data.text;
      if (typeof data.content === 'string') return data.content;
      if (typeof data.output_text === 'string') return data.output_text;
      if (Array.isArray(data.output)) {
        return data.output.map(item => {
          if (typeof item === 'string') return item;
          if (typeof item?.content === 'string') return item.content;
          if (Array.isArray(item?.content)) return item.content.map(part => part?.text || '').join('');
          return '';
        }).join('\n').trim();
      }
      const choice = data.choices?.[0];
      return choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? '';
    }

    function messagesToPlainPrompt(requestMessages) {
      return requestMessages.map(message => {
        const content = Array.isArray(message.content)
          ? message.content.map(part => part?.text || '').join('\n')
          : String(message.content || '');
        return `${String(message.role || 'user').toUpperCase()}: ${content}`;
      }).join('\n\n') + '\n\nASSISTANT:';
    }

    function buildNativeCompletionPayload(requestMessages) {
      return {
        model: settings.model,
        messages: requestMessages,
        prompt: messagesToPlainPrompt(requestMessages),
        temperature: Number(settings.temperature),
        top_p: Number(settings.topP),
        max_tokens: Number(settings.maxTokens),
        stream: false,
        runtime: getAndroidRuntimeOptions(),
        mode: isHybridRuntime() ? 'hybrid-helper' : 'android-vulkan'
      };
    }

    async function runNativeCompletionText(requestMessages) {
      const bridge = getNativeInferenceBridge();
      if (!bridge) throw new Error('Android Vulkan runtime bridge is not available in this app build. Use server mode or rebuild the Android wrapper with the native inference bridge.');

      const payload = buildNativeCompletionPayload(requestMessages);

      if (abortController?.signal && bridge.cancelGeneration) {
        abortController.signal.addEventListener('abort', () => {
          try { bridge.cancelGeneration(); } catch {}
        }, { once: true });
      }

      let result;
      if (bridge.chatCompletion) result = await callNativeBridgeMethod(bridge, 'chatCompletion', payload);
      else if (bridge.generate) result = await callNativeBridgeMethod(bridge, 'generate', payload);
      else throw new Error('The Android runtime bridge must expose chatCompletion(payload) or generate(payload).');

      return extractNativeCompletionText(result) || '(No content returned.)';
    }

    async function runNativeChatCompletion(requestMessages, assistantUi) {
      const text = await runNativeCompletionText(requestMessages);
      assistantUi.setContent(text);
      assistantUi.streamingFinished();
      scrollToBottom();
      return text;
    }

    function extractOpenAiCompletionText(payload) {
      if (!payload || typeof payload !== 'object') return '';
      if (typeof payload.text === 'string') return payload.text;
      if (typeof payload.content === 'string') return payload.content;
      const choice = payload.choices?.[0];
      const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? '';
      if (Array.isArray(content)) return content.map(part => part?.text || '').join('');
      return content;
    }

    async function runServerChatCompletion(requestMessages, assistantUi) {
      let fullResponse = '';
      const response = await fetch(endpoint('/chat/completions'), {
        method: 'POST',
        headers: getHeaders(),
        signal: abortController.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: requestMessages,
          stream: true,
          temperature: Number(settings.temperature),
          top_p: Number(settings.topP),
          max_tokens: Number(settings.maxTokens)
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `LM Studio API error: HTTP ${response.status}`);
      }

      if (!response.body) throw new Error('This browser does not support streamed responses.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleData = (data) => {
        if (!data || data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = extractDelta(json);
          if (delta) {
            fullResponse += delta;
            assistantUi.setContent(fullResponse);
            scrollToBottom();
          }
        } catch {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseEvents(buffer, handleData);
      }

      if (buffer.trim()) parseSseEvents(buffer + '\n\n', handleData);
      assistantUi.streamingFinished();
      return fullResponse;
    }

    async function runServerChatCompletionText(requestMessages, signal = null) {
      const response = await fetch(endpoint('/chat/completions'), {
        method: 'POST',
        headers: getHeaders(),
        signal: signal || abortController?.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: requestMessages,
          stream: false,
          temperature: Number(settings.temperature),
          top_p: Number(settings.topP),
          max_tokens: Number(settings.maxTokens)
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `LM Studio API error: HTTP ${response.status}`);
      }

      const payload = await response.json();
      return extractOpenAiCompletionText(payload) || '(No content returned.)';
    }

    function firstFulfilled(promises) {
      return new Promise((resolve, reject) => {
        const errors = [];
        let rejected = 0;
        promises.forEach((promise, index) => {
          Promise.resolve(promise).then(resolve).catch(error => {
            errors[index] = error;
            rejected += 1;
            if (rejected === promises.length) reject(errors.find(Boolean) || new Error('All hybrid runtimes failed.'));
          });
        });
      });
    }

    async function runHybridChatCompletion(requestMessages, assistantUi) {
      const bridge = getNativeInferenceBridge();
      if (!bridge) {
        showToast('Phone boost bridge unavailable. Using PC server only.');
        return await runServerChatCompletion(requestMessages, assistantUi);
      }

      const strategy = settings.hybridStrategy || DEFAULT_SETTINGS.hybridStrategy;

      if (strategy === 'race') {
        assistantUi.setContent('Hybrid boost running PC + phone. Using the first completed answer…');
        const pcController = new AbortController();
        const relayAbort = () => {
          pcController.abort();
          try { bridge.cancelGeneration?.(); } catch {}
        };
        abortController?.signal?.addEventListener('abort', relayAbort, { once: true });

        const pcPromise = runServerChatCompletionText(requestMessages, pcController.signal)
          .then(text => ({ source: 'PC server', text }));
        const phonePromise = runNativeCompletionText(requestMessages)
          .then(text => ({ source: 'Android phone', text }));

        const winner = await firstFulfilled([pcPromise, phonePromise]);
        if (winner.source === 'PC server') {
          try { bridge.cancelGeneration?.(); } catch {}
        } else {
          pcController.abort();
        }
        assistantUi.setContent(winner.text);
        assistantUi.streamingFinished();
        scrollToBottom();
        showToast(`Hybrid boost used ${winner.source}.`);
        return winner.text;
      }

      const timeoutMs = Math.max(1000, parseInt(settings.hybridFallbackMs, 10) || DEFAULT_SETTINGS.hybridFallbackMs);
      const pcController = new AbortController();
      const relayAbort = () => pcController.abort();
      abortController?.signal?.addEventListener('abort', relayAbort, { once: true });

      try {
        assistantUi.setContent(`Hybrid boost: trying PC server first. Phone fallback arms after ${timeoutMs} ms…`);
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            pcController.abort();
            reject(new Error('PC server timed out before phone fallback.'));
          }, timeoutMs);
        });
        const text = await Promise.race([runServerChatCompletionText(requestMessages, pcController.signal), timeoutPromise]);
        clearTimeout(timeoutId);
        assistantUi.setContent(text);
        assistantUi.streamingFinished();
        scrollToBottom();
        showToast('Hybrid boost used PC server.');
        return text;
      } catch (error) {
        if (abortController?.signal?.aborted) throw error;
        showToast('PC server failed or was slow. Using Android phone fallback.');
        const text = await runNativeCompletionText(requestMessages);
        assistantUi.setContent(text);
        assistantUi.streamingFinished();
        scrollToBottom();
        return text;
      }
    }

    async function testAndroidRuntime() {
      if (!usesAndroidSupport()) {
        showToast('Switch Runtime to Android Vulkan local or Hybrid boost first.');
        return;
      }
      const bridge = getNativeInferenceBridge();
      if (!bridge) {
        setStatus('error', 'No bridge');
        showToast('Android native inference bridge is not available in this app build.');
        updateRuntimeUi();
        return;
      }
      try {
        let status = {};
        if (bridge.getHardwareStatus) status = parseMaybeJson(await asPromise(bridge.getHardwareStatus())) || {};
        setStatus('connected', 'Android');
        const gpu = status.gpu || status.device || 'Vulkan bridge ready';
        showToast(`Android runtime ready: ${gpu}`);
        updateRuntimeUi();
      } catch (error) {
        console.error(error);
        setStatus('error', 'Runtime error');
        showToast(error.message || 'Could not test Android runtime.');
      }
    }

    function applySettingsToUI() {
      els.tempRange.value = settings.temperature;
      els.tempInput.value = settings.temperature;
      els.tempValue.textContent = settings.temperature;

      els.topPRange.value = settings.topP;
      els.topPInput.value = settings.topP;
      els.topPValue.textContent = settings.topP;

      els.maxTokensInput.value = settings.maxTokens;
      els.systemPrompt.value = settings.systemPrompt || '';
      if (els.runtimeMode) els.runtimeMode.value = settings.runtimeMode || DEFAULT_SETTINGS.runtimeMode;
      if (els.hybridStrategy) els.hybridStrategy.value = settings.hybridStrategy || DEFAULT_SETTINGS.hybridStrategy;
      if (els.hybridFallbackMs) els.hybridFallbackMs.value = settings.hybridFallbackMs || DEFAULT_SETTINGS.hybridFallbackMs;
      if (els.androidThreads) els.androidThreads.value = settings.androidThreads || DEFAULT_SETTINGS.androidThreads;
      if (els.androidGpuLayers) els.androidGpuLayers.value = settings.androidGpuLayers ?? DEFAULT_SETTINGS.androidGpuLayers;
      if (els.androidContextLength) els.androidContextLength.value = settings.androidContextLength || DEFAULT_SETTINGS.androidContextLength;
      if (els.androidBatchSize) els.androidBatchSize.value = settings.androidBatchSize || DEFAULT_SETTINGS.androidBatchSize;
      els.serverUrlCopy.textContent = runtimeStatusCopy();
      updateRuntimeUi();
    }

    function setStatus(type, text) {
      els.statusPill.classList.remove('connected', 'error', 'checking');
      els.statusPill.classList.add(type);
      els.statusText.textContent = text;
    }

    function showToast(message) {
      els.toast.textContent = message;
      els.toast.classList.add('show');
      setTimeout(() => els.toast.classList.remove('show'), 2800);
    }

    async function copyText(value, successMessage = 'Copied.') {
      const text = String(value || '');
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        showToast(successMessage);
      } catch {
        showToast('Copy failed. Select the text manually.');
      }
    }

    function toggleSidebar(force) {
      const shouldOpen = typeof force === 'boolean' ? force : !els.sidebar.classList.contains('open');
      els.sidebar.classList.toggle('open', shouldOpen);
      els.scrim.classList.toggle('show', shouldOpen);
      document.documentElement.classList.toggle('sidebar-open', shouldOpen);
      document.body.classList.toggle('sidebar-open', shouldOpen);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function applyInlineFormatting(text) {
      return text
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    function unescapeHtml(text) {
      return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    }

    function renderMessageText(text) {
      const escaped = escapeHtml(text || '');
      const parts = escaped.split('```');
      
      if (parts.length === 1) {
        return applyInlineFormatting(parts[0]);
      }
      
      let html = '';
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          html += applyInlineFormatting(parts[i]);
        } else {
          let code = parts[i];
          const firstLineBreak = code.indexOf('\n');
          let lang = '';
          let filepath = '';
          if (firstLineBreak !== -1 && firstLineBreak < 200) {
            lang = code.substring(0, firstLineBreak).trim();
            code = code.substring(firstLineBreak + 1);
          } else if (firstLineBreak === -1 && code.length < 200 && !code.includes(' ')) {
            lang = code.trim();
            code = '';
          }

          if (lang === 'json' || lang === 'lmstudio-edits') {
            try {
              const parsed = JSON.parse(unescapeHtml(code));
              if (parsed && Array.isArray(parsed.files)) {
                let reformatted = '';
                for (const file of parsed.files) {
                  const ext = file.path ? file.path.split('.').pop() : '';
                  reformatted += `<div class="file-header">${file.path || 'file'}</div><pre class="line-numbers"><code class="language-${ext}">${escapeHtml(file.content || '').replace(/^\n+|\n+$/g, '')}</code></pre>`;
                }
                html += reformatted;
                continue;
              }
            } catch (e) {
              // Fallback to normal rendering if JSON is incomplete/invalid
            }
          }

          if (lang.includes('.') || lang.includes('/')) {
            filepath = lang;
            lang = lang.split('.').pop();
          }

          let headerHtml = '';
          if (filepath) {
            headerHtml = `<div class="file-header">${filepath}</div>`;
          }

          html += `${headerHtml}<pre class="line-numbers"><code${lang ? ` class="language-${lang}"` : ''}>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`;
        }
      }
      return html;
    }

    function copyIconMarkup() {
      return `
        <svg class="copy-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="8" y="8" width="11" height="11" rx="2" stroke-width="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke-width="2" stroke-linecap="round"></path>
        </svg>`;
    }

    function setCopyButtonLabel(button) {
      button.classList.add('copy-message-btn');
      button.title = 'Copy message';
      button.setAttribute('aria-label', 'Copy message');
      button.innerHTML = `${copyIconMarkup()}<span>Copy</span>`;
    }

    function enhanceCodeBlocks(scope) {
      scope.querySelectorAll('pre').forEach(pre => {
        if (pre.closest('.code-block')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';

        const prev = pre.previousElementSibling;
        const hasHeader = prev && prev.classList.contains('file-header');

        pre.parentNode.insertBefore(wrapper, hasHeader ? prev : pre);

        const btnWrapper = document.createElement('div');
        btnWrapper.className = 'code-copy-wrapper';

        const button = document.createElement('button');
        button.className = 'code-copy-btn';
        button.type = 'button';
        button.title = 'Copy code';
        button.setAttribute('aria-label', 'Copy code');
        button.innerHTML = `${copyIconMarkup()}<span>Copy</span>`;
        button.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();

          const code = pre.querySelector('code')?.innerText ?? pre.innerText ?? '';
          await copyText(code, 'Copied code.');

          const label = button.querySelector('span');
          if (label) {
            const previous = label.textContent;
            label.textContent = 'Copied';
            setTimeout(() => { label.textContent = previous || 'Copy'; }, 1200);
          }
        });

        btnWrapper.appendChild(button);
        if (hasHeader) wrapper.appendChild(prev);
        wrapper.appendChild(btnWrapper);
        wrapper.appendChild(pre);

        if (window.Prism) {
          const codeEl = pre.querySelector('code');
          if (codeEl) Prism.highlightElement(codeEl);
        }
      });
    }

    function renderBubbleContent(bubble, text) {
      bubble.innerHTML = renderMessageText(text);
      enhanceCodeBlocks(bubble);
    }

    function createStreamRenderer(bubble) {
      let pendingText = null;
      let rafId = null;

      function flush() {
        rafId = null;
        if (pendingText === null) return;
        const text = pendingText;
        pendingText = null;
        renderBubbleContent(bubble, text);
      }

      return {
        update(text) {
          pendingText = text;
          if (!rafId) rafId = requestAnimationFrame(flush);
        },
        finish() {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          if (pendingText !== null) {
            renderBubbleContent(bubble, pendingText);
            pendingText = null;
          }
          const row = bubble.closest('.message-row');
          if (row) {
            row.classList.add('stream-done');
            setTimeout(() => row.classList.remove('stream-done'), 800);
          }
        }
      };
    }

    function addMessage(role, content, options = {}) {
      removeEmptyState();

      const row = document.createElement('article');
      row.className = `message-row ${role}`;

      const bubble = document.createElement('div');
      bubble.className = 'bubble';

      if (options.loading) {
        bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      } else {
        renderBubbleContent(bubble, content);
      }

      const meta = document.createElement('div');
      meta.className = 'message-meta';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'meta-btn';
      copyBtn.type = 'button';
      setCopyButtonLabel(copyBtn);
      copyBtn.addEventListener('click', () => {
        copyText(content || bubble.innerText || '', 'Copied message.');
      });

      meta.appendChild(copyBtn);
      row.appendChild(bubble);
      row.appendChild(meta);
      els.msgContainer.appendChild(row);
      scrollToBottom();

      const streamRenderer = createStreamRenderer(bubble);

      return { row, bubble, setContent: (text) => {
        streamRenderer.update(text);
        copyBtn.onclick = () => {
          copyText(text || '', 'Copied message.');
        };
      }, streamingFinished: () => {
        streamRenderer.finish();
      }};
    }

    function renderMessages() {
      els.msgContainer.innerHTML = '';
      if (!messages.length) {
        renderEmptyState();
        return;
      }

      messages.forEach(message => addMessage(message.role === 'assistant' ? 'ai' : 'user', message.displayContent || message.content));
    }

    function renderEmptyState() {
      els.msgContainer.innerHTML = `
        <div class="empty-state" id="empty-state">
          <h2>Local chat, clean and fast.</h2>
          <p>Start LM Studio’s server, pick a model, then send a message. Use Settings when connecting from another device.</p>
          <div class="prompt-chips">
            <button class="chip" type="button" data-prompt="Summarize the difference between quantization levels.">Quantization explainer</button>
            <button class="chip" type="button" data-prompt="Draft a compact project checklist for a local AI interface.">Project checklist</button>
            <button class="chip" type="button" data-prompt="Help me debug a JavaScript streaming fetch response.">Debug streaming</button>
          </div>
        </div>
      `;

      document.querySelectorAll('[data-prompt]').forEach(chip => {
        chip.addEventListener('click', () => {
          els.userInput.value = chip.dataset.prompt;
          updateInputHeight();
          els.userInput.focus();
        });
      });
    }

    function removeEmptyState() {
      const empty = document.getElementById('empty-state');
      if (empty) empty.remove();
    }

    let userHasScrolledUp = false;
    let scrollBottomPill = null;

    function isNearBottom(threshold = 80) {
      const el = els.msgContainer;
      return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }

    function scrollToBottom(force = false) {
      if (force || !userHasScrolledUp) {
        els.msgContainer.scrollTop = els.msgContainer.scrollHeight;
        userHasScrolledUp = false;
        updateScrollPill();
      }
    }

    function updateScrollPill() {
      if (!scrollBottomPill) return;
      const show = isStreaming && userHasScrolledUp && !isNearBottom();
      scrollBottomPill.classList.toggle('visible', show);
    }

    function initScrollPill() {
      scrollBottomPill = document.createElement('button');
      scrollBottomPill.type = 'button';
      scrollBottomPill.className = 'scroll-bottom-pill';
      scrollBottomPill.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      scrollBottomPill.title = 'Jump to bottom';
      scrollBottomPill.setAttribute('aria-label', 'Jump to bottom');
      scrollBottomPill.addEventListener('click', () => {
        userHasScrolledUp = false;
        scrollToBottom(true);
      });

      const mainChat = els.msgContainer.closest('.main-chat');
      if (mainChat) mainChat.appendChild(scrollBottomPill);

      els.msgContainer.addEventListener('scroll', () => {
        if (isNearBottom()) {
          userHasScrolledUp = false;
        } else if (isStreaming) {
          userHasScrolledUp = true;
        }
        updateScrollPill();
      }, { passive: true });
    }

    function updateInputHeight() {
      els.userInput.style.height = 'auto';
      els.userInput.style.height = Math.min(els.userInput.scrollHeight, 150) + 'px';
    }

    function syncRangeAndNumber(rangeEl, numberEl, valueEl, settingKey, min, max) {
      const clamp = (value) => Math.min(max, Math.max(min, Number(value)));
      const update = (value) => {
        const clean = clamp(value);
        settings[settingKey] = clean;
        rangeEl.value = clean;
        numberEl.value = clean;
        valueEl.textContent = clean;
        saveSettings();
      };

      rangeEl.addEventListener('input', () => update(rangeEl.value));
      numberEl.addEventListener('input', () => update(numberEl.value));
    }

    async function loadModels() {
      setStatus('checking', 'Checking');

      if (isAndroidRuntime()) {
        const bridge = getNativeInferenceBridge();
        els.modelSelect.innerHTML = '';
        if (!bridge) {
          const opt = document.createElement('option');
          opt.value = settings.model || '';
          opt.textContent = settings.model || 'Native bridge unavailable';
          els.modelSelect.appendChild(opt);
          setStatus('error', 'No bridge');
          updateRuntimeUi();
          return;
        }

        try {
          const payload = bridge.listModels ? await asPromise(bridge.listModels()) : bridge.getModels ? await asPromise(bridge.getModels()) : [];
          const parsed = parseMaybeJson(payload);
          const models = Array.isArray(parsed)
            ? parsed.map(model => typeof model === 'string' ? model : (model.id || model.name)).filter(Boolean)
            : Array.isArray(parsed?.data)
              ? parsed.data.map(model => model.id || model.name).filter(Boolean)
              : Array.isArray(parsed?.models)
                ? parsed.models.map(model => model.id || model.name).filter(Boolean)
                : [];

          const names = models.length ? models : [settings.model || 'Select model in native app'];
          names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            els.modelSelect.appendChild(opt);
          });

          if (!settings.model && models[0]) {
            settings.model = models[0];
            saveSettings();
          }
          els.modelSelect.value = settings.model || names[0] || '';
          setStatus('connected', 'Android');
          updateRuntimeUi();
        } catch (error) {
          console.error(error);
          const opt = document.createElement('option');
          opt.value = settings.model || '';
          opt.textContent = settings.model || 'Native model unavailable';
          els.modelSelect.appendChild(opt);
          setStatus('error', 'Runtime error');
          showToast(error.message || 'Could not load Android runtime models.');
        }
        return;
      }

      try {
        const response = await fetch(endpoint('/models'), {
          method: 'GET',
          headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
        });

        if (!response.ok) throw new Error(`Model request failed: HTTP ${response.status}`);

        const payload = await response.json();
        const models = Array.isArray(payload.data)
          ? payload.data.map(model => model.id).filter(Boolean)
          : Array.isArray(payload.models)
            ? payload.models.map(model => model.id || model.name).filter(Boolean)
            : [];

        els.modelSelect.innerHTML = '';

        if (!models.length) {
          const opt = document.createElement('option');
          opt.value = settings.model || '';
          opt.textContent = settings.model || 'No models returned';
          els.modelSelect.appendChild(opt);
        } else {
          models.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            els.modelSelect.appendChild(opt);
          });

          if (!settings.model || !models.includes(settings.model)) {
            settings.model = models[0];
            saveSettings();
          }

          els.modelSelect.value = settings.model;
          els.modelDisplay.textContent = settings.model;
        }

        setStatus('connected', 'Connected');
        updateRuntimeUi();
      } catch (error) {
        console.error(error);
        els.modelSelect.innerHTML = '';

        const opt = document.createElement('option');
        opt.value = settings.model || '';
        opt.textContent = settings.model || 'Set model in Settings';
        els.modelSelect.appendChild(opt);

        setStatus('error', 'Offline');
        showToast('Could not reach LM Studio. Check the server URL in Settings.');
      }
    }

    function buildWorkspaceEditInstruction() {
      return 'You have workspace context in this request when files are listed below. A silent in-app helper may pre-search files and attach relevant snippets to reduce context load before the model runs. Trust that helper context as attached workspace evidence, but do not mention the helper unless the user asks. When the user asks you to edit project files, return a fenced code block with the relative file path as the language identifier, like this: ```relative/path/to/file.html\\ncontent here\\n```. Use complete replacement content, not patches. Only use relative paths from the provided workspace manifest or attached files. Do not say that no files are attached when workspace files are provided.';
    }

    function contextHelperEnabled() {
      return settings.contextHelperEnabled !== false;
    }

    function getContextHelperMode() {
      return settings.contextHelperMode || DEFAULT_SETTINGS.contextHelperMode || 'smart';
    }

    function contextHelperMaxChars() {
      return Math.max(12000, parseInt(settings.contextHelperMaxChars, 10) || DEFAULT_SETTINGS.contextHelperMaxChars || 70000);
    }

    function contextHelperMaxSnippets() {
      return Math.max(4, parseInt(settings.contextHelperMaxSnippets, 10) || DEFAULT_SETTINGS.contextHelperMaxSnippets || 16);
    }

    function toggleContextHelper() {
      settings.contextHelperEnabled = !contextHelperEnabled();
      saveSettings();
      renderContextHelperStatus();
      showToast(settings.contextHelperEnabled ? 'Silent helper enabled.' : 'Silent helper disabled. Full selected-file context will be used.');
    }

    function renderContextHelperStatus() {
      if (els.contextHelperToggle) els.contextHelperToggle.textContent = contextHelperEnabled() ? 'Helper On' : 'Helper Off';
      if (!els.contextHelperStatus) return;
      const enabled = contextHelperEnabled();
      const report = lastContextScoutReport;
      const mode = getContextHelperMode();
      const selected = workspaceSelectedPaths.size || workspaceFiles.length;
      const details = report
        ? `${report.filesConsidered} checked · ${report.filesIncluded} included · ${report.snippets} snippet${report.snippets === 1 ? '' : 's'} · ${report.characters.toLocaleString()} chars sent`
        : enabled
          ? `${mode === 'full' ? 'full selected-file mode' : 'smart snippets mode'} · ${selected} selected file${selected === 1 ? '' : 's'} ready`
          : 'disabled · selected files will be sent with the older full-context path';
      els.contextHelperStatus.innerHTML = `<span class="context-helper-badge ${enabled ? 'on' : 'off'}">${enabled ? 'Silent helper on' : 'Silent helper off'}</span><span>${escapeHtml(details)}</span>`;
    }

    const CONTEXT_HELPER_STOPWORDS = new Set(['the','and','for','with','that','this','from','have','into','onto','when','what','where','your','youre','you','are','was','were','will','can','could','should','would','need','needs','make','add','fix','change','edit','update','turn','use','using','more','less','file','files','folder','project','page','app','code','please','lets','let','now']);

    const CONTEXT_HELPER_HINTS = {
      chat: ['chat', 'message', 'messages', 'composer', 'bubble', 'sendMessage', 'user-input', 'input-area', 'renderMessage'],
      copy: ['copy', 'clipboard', 'code-copy', 'codeCopy', 'copyText', 'pre', 'code block', 'copy icon'],
      dark: ['dark', 'theme', 'data-theme', 'color-scheme', 'appearance', 'background', 'composer-shell'],
      folder: ['workspace', 'folder', 'directory', 'showDirectoryPicker', 'webkitdirectory', 'workspaceFiles'],
      file: ['file', 'files', 'attachment', 'attachments', 'FileReader', 'workspaceFiles'],
      image: ['image', 'images', 'image_url', 'attachment', 'readAsDataURL'],
      gpu: ['gpu', 'vulkan', 'android', 'runtime', 'hybrid', 'threads', 'gpu_layers'],
      vram: ['context', 'tokens', 'workspace', 'snippets', 'max_tokens', 'context_length'],
      apply: ['apply', 'pendingEdits', 'edited files', 'extractEdits', 'writeFiles'],
      settings: ['settings', 'DEFAULT_SETTINGS', 'saveSettings', 'fillForm', 'Appearance']
    };

    function buildContextHelperTerms(userText) {
      const text = String(userText || '');
      const terms = new Set();
      const lower = text.toLowerCase();
      const raw = lower.match(/[a-z0-9_.#:-]{3,}/g) || [];
      raw.forEach(term => {
        const clean = term.replace(/^[-_.#]+|[-_.#]+$/g, '');
        if (clean && !CONTEXT_HELPER_STOPWORDS.has(clean)) terms.add(clean);
      });
      const quoted = [...text.matchAll(/["'`]{1}([^"'`]{2,80})["'`]{1}/g)].map(match => match[1]);
      quoted.forEach(value => terms.add(value.toLowerCase()));
      const filenames = text.match(/[\w.-]+\.(?:html|css|js|mjs|json|md|ts|tsx|jsx|py|xml|yml|yaml|java|kt|cpp|h|hpp|c|cs|swift|php|rb|go|rs|sql|sh)/gi) || [];
      filenames.forEach(name => terms.add(name.toLowerCase()));
      Object.entries(CONTEXT_HELPER_HINTS).forEach(([trigger, hints]) => {
        if (lower.includes(trigger)) hints.forEach(hint => terms.add(hint.toLowerCase()));
      });
      if (!terms.size) ['index.html','settings.html','editor.html','folders.html','mcp.html'].forEach(term => terms.add(term));
      return [...terms].slice(0, 80);
    }

    function isLikelyEditRequest(text) {
      return /(add|edit|change|fix|update|replace|remove|implement|create|wire|hook|style|polish|restore|convert|rename)/i.test(String(text || ''));
    }

    function countOccurrences(haystack, needle) {
      if (!needle) return 0;
      let count = 0;
      let index = 0;
      while ((index = haystack.indexOf(needle, index)) !== -1 && count < 50) {
        count++;
        index += Math.max(needle.length, 1);
      }
      return count;
    }

    function scoreWorkspaceText(entry, content, terms) {
      const path = String(entry.path || '').toLowerCase();
      const lower = String(content || '').toLowerCase();
      let score = workspaceSelectedPaths.has(entry.path) ? 6 : 0;
      for (const term of terms) {
        if (!term) continue;
        if (path.includes(term)) score += 18;
        const occurrences = countOccurrences(lower, term);
        if (occurrences) score += Math.min(32, occurrences * 3);
      }
      if (/index\.html$/.test(path) && /chat|message|composer|copy|theme|dark|runtime|workspace/.test(terms.join(' '))) score += 8;
      if (/settings\.html$/.test(path) && /settings|theme|runtime|helper|context/.test(terms.join(' '))) score += 8;
      return score;
    }

    function lineNumberForIndex(text, index) {
      if (index <= 0) return 1;
      return text.slice(0, index).split('\n').length;
    }

    function extractContextSnippets(content, terms, maxSnippets = 3, radius = 720) {
      const text = String(content || '');
      const lower = text.toLowerCase();
      const hits = [];
      for (const term of terms) {
        if (!term || term.length < 2) continue;
        let at = lower.indexOf(term);
        let guard = 0;
        while (at >= 0 && guard < 5) {
          hits.push({ index: at, term });
          at = lower.indexOf(term, at + Math.max(term.length, 1));
          guard++;
        }
      }
      if (!hits.length) {
        const clipped = text.slice(0, Math.min(text.length, radius * 2));
        return clipped ? [{ startLine: 1, endLine: clipped.split('\n').length, text: clipped, terms: [] }] : [];
      }
      hits.sort((a, b) => a.index - b.index);
      const ranges = [];
      for (const hit of hits) {
        const start = Math.max(0, hit.index - radius);
        const end = Math.min(text.length, hit.index + hit.term.length + radius);
        const last = ranges[ranges.length - 1];
        if (last && start <= last.end + 180) {
          last.end = Math.max(last.end, end);
          last.terms.add(hit.term);
        } else {
          ranges.push({ start, end, terms: new Set([hit.term]) });
        }
        if (ranges.length >= maxSnippets) break;
      }
      return ranges.map(range => ({
        startLine: lineNumberForIndex(text, range.start),
        endLine: lineNumberForIndex(text, range.end),
        text: text.slice(range.start, range.end).trim(),
        terms: [...range.terms]
      })).filter(snippet => snippet.text);
    }

    function summarizePathList(files, limit = 120) {
      return files.slice(0, limit).map(file => `- ${file.path}${file.size ? ` (${fileSizeLabel(file.size)})` : ''}`).join('\n');
    }

    async function collectWorkspaceContextForPrompt(userText) {
      if (!workspaceFiles.length) return '';
      if (!contextHelperEnabled() || getContextHelperMode() === 'full') return collectWorkspaceContext();

      const selected = workspaceFiles.filter(file => workspaceSelectedPaths.has(file.path));
      const candidates = (selected.length ? selected : workspaceFiles).slice(0, MAX_WORKSPACE_SCAN_FILES);
      const terms = buildContextHelperTerms(userText);
      const editRequest = isLikelyEditRequest(userText);
      const ranked = [];
      const failed = [];

      for (const entry of candidates) {
        try {
          const content = await readWorkspaceEntry(entry);
          ranked.push({ entry, content, score: scoreWorkspaceText(entry, content, terms) });
        } catch {
          failed.push(entry.path);
        }
      }

      ranked.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
      const nonzero = ranked.filter(item => item.score > 0);
      const chosen = (nonzero.length ? nonzero : ranked).slice(0, Math.min(contextHelperMaxSnippets(), MAX_WORKSPACE_CONTEXT_FILES));
      const fullFileBudget = editRequest ? 2 : 0;
      const maxChars = Math.min(contextHelperMaxChars(), MAX_WORKSPACE_TOTAL_CONTEXT_CHARS);
      const blocks = [];
      const snippetsUsed = [];
      let used = 0;

      for (let i = 0; i < chosen.length && used < maxChars; i++) {
        const { entry, content, score } = chosen[i];
        const includeFull = i < fullFileBudget && content.length <= MAX_WORKSPACE_FILE_CONTEXT_CHARS;
        if (includeFull) {
          const remaining = maxChars - used;
          let body = content.slice(0, remaining);
          if (content.length > body.length) body += '\n\n[Silent helper clipped this full file at the context budget.]';
          used += body.length;
          blocks.push(`--- TARGET FILE SELECTED BY SILENT HELPER: ${entry.path}
Reason: high relevance score ${score}; complete file included for edit planning.
${body}
--- END TARGET FILE: ${entry.path}`);
          continue;
        }

        const snippets = extractContextSnippets(content, terms, editRequest ? 4 : 3);
        const snippetText = snippets.map((snippet, index) => {
          snippetsUsed.push({ path: entry.path, lines: `${snippet.startLine}-${snippet.endLine}` });
          const matched = snippet.terms.length ? ` · matched: ${snippet.terms.slice(0, 6).join(', ')}` : '';
          return `[Snippet ${index + 1}: lines ${snippet.startLine}-${snippet.endLine}${matched}]
${snippet.text}`;
        }).join('\n\n');
        if (!snippetText) continue;
        const remaining = maxChars - used;
        const body = snippetText.length > remaining ? snippetText.slice(0, remaining) + '\n\n[Silent helper context budget reached.]' : snippetText;
        used += body.length;
        blocks.push(`--- RELEVANT SNIPPETS SELECTED BY SILENT HELPER: ${entry.path}
Score: ${score}
${body}
--- END SNIPPETS: ${entry.path}`);
      }

      const manifest = summarizePathList(workspaceFiles);
      const fallback = blocks.length ? blocks.join('\n\n') : '[The helper could not read matching snippets; use the manifest and ask for a narrower request if needed.]';
      lastContextScoutReport = {
        filesConsidered: candidates.length,
        filesIncluded: blocks.length,
        snippets: snippetsUsed.length,
        characters: used,
        terms: terms.slice(0, 24),
        failed: failed.slice(0, 12)
      };
      renderContextHelperStatus();
      const failedText = failed.length ? `

Unreadable files: ${failed.slice(0, 12).join(', ')}${failed.length > 12 ? ', …' : ''}` : '';
      return `Workspace: ${workspaceInfo?.name || workspaceHandle?.name || 'Selected workspace'}
Access: ${workspaceInfo?.source || (workspaceHandle ? 'browser folder handle' : 'browser fallback')}
Files scanned: ${workspaceFiles.length}
Silent helper: enabled. It searched/ranked files on the device before this request to reduce GPU/VRAM pressure from unnecessary context.
Search terms: ${terms.slice(0, 32).join(', ')}
Files considered by helper: ${candidates.length}
Files included in this request: ${blocks.length}

Workspace manifest:
${manifest}

Silent helper selected context:
${fallback}${failedText}`;
    }

    function shouldDropPriorMessageForWorkspace(message) {
      const text = String(message?.content || message?.displayContent || '').toLowerCase();
      return /no files attached|don't see any files|do not see any files|please share the files|upload them directly|paste their contents/.test(text);
    }

    function requestHistoryForWorkspace(hasWorkspaceContext) {
      const source = hasWorkspaceContext
        ? messages.filter(message => !shouldDropPriorMessageForWorkspace(message)).slice(-MAX_CHAT_HISTORY_WITH_WORKSPACE)
        : messages;
      return source.map(message => ({
        role: message.role,
        content: message.content
      }));
    }

    async function collectRequestMessages(extraMessages = [], workspaceContextOverride = null) {
      const requestMessages = [];

      const systemPrompt = (settings.systemPrompt || '').trim();
      if (systemPrompt) requestMessages.push({ role: 'system', content: systemPrompt });

      const workspaceContext = typeof workspaceContextOverride === 'string'
        ? workspaceContextOverride
        : await collectWorkspaceContext();
      const hasWorkspaceContext = Boolean(workspaceContext);

      if (hasWorkspaceContext) {
        requestMessages.push({
          role: 'system',
          content: `${buildWorkspaceEditInstruction()}

Workspace context is present in the latest user message. Treat those files as attached by the app. Ignore older conversation turns that said files were missing.`
        });
      } else if (workspaceFiles.length || workspaceHandle || workspaceInfo) {
        requestMessages.push({ role: 'system', content: buildWorkspaceEditInstruction() });
      }

      requestMessages.push(...requestHistoryForWorkspace(hasWorkspaceContext));
      requestMessages.push(...extraMessages);
      return requestMessages;
    }

    function parseSseEvents(buffer, onData) {
      const eventBlocks = buffer.split(/\n\n|\r\n\r\n/);
      const remainder = eventBlocks.pop() || '';

      for (const block of eventBlocks) {
        const dataLines = block
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.replace(/^data:\s?/, ''));

        if (!dataLines.length && block.trim().startsWith('{')) {
          onData(block.trim());
          continue;
        }

        for (const data of dataLines) onData(data);
      }

      return remainder;
    }

    function extractDelta(json) {
      const choice = json.choices?.[0];
      return choice?.delta?.content
        ?? choice?.message?.content
        ?? choice?.text
        ?? '';
    }

    function setStreamingUI(active) {
      isStreaming = active;
      if (active) {
        els.sendBtn.classList.add('streaming');
        els.sendBtn.title = 'Stop generation';
        userHasScrolledUp = false;
      } else {
        els.sendBtn.classList.remove('streaming');
        els.sendBtn.title = 'Send message';
        userHasScrolledUp = false;
        updateScrollPill();
      }
    }

    async function sendMessage() {
      const text = els.userInput.value.trim();
      if ((!text && !attachments.length) || isStreaming) return;

      if (text.startsWith('/')) {
        els.userInput.value = '';
        if (typeof updateInputHeight === 'function') updateInputHeight();
        if (window.executeSlashCommand) {
          window.executeSlashCommand(text);
        } else {
          showToast('Command processor not loaded.');
        }
        return;
      }

      if (!settings.model) {
        showToast('Select or load a model first.');
        return;
      }

      let userTurn;
      try {
        userTurn = await buildUserTurn(text, attachments);
      } catch (error) {
        console.error(error);
        showToast(error.message || 'Could not read the selected attachment.');
        return;
      }

      let workspaceContext = '';
      try {
        workspaceContext = await collectWorkspaceContextForPrompt(text || userTurn.modelText || '');
      } catch (error) {
        console.error(error);
        showToast('Workspace files were selected, but their contents could not be read. Try Select Files again.');
      }

      const requestContent = workspaceContext
        ? attachWorkspaceContextToUserContent(userTurn.requestContent, workspaceContext)
        : userTurn.requestContent;
      const requestMessages = await collectRequestMessages([{ role: 'user', content: requestContent }], workspaceContext);

      addMessage('user', userTurn.displayContent);
      messages.push({ role: 'user', content: userTurn.modelText, displayContent: userTurn.displayContent });
      saveMessages();

      els.userInput.value = '';
      attachments = [];
      renderAttachmentTray();
      updateInputHeight();

      const assistantUi = addMessage('ai', '', { loading: true });
      let fullResponse = '';
      abortController = new AbortController();
      setStreamingUI(true);

      try {
        fullResponse = isHybridRuntime()
          ? await runHybridChatCompletion(requestMessages, assistantUi)
          : isAndroidRuntime()
            ? await runNativeChatCompletion(requestMessages, assistantUi)
            : await runServerChatCompletion(requestMessages, assistantUi);

        if (!fullResponse.trim()) {
          fullResponse = '(No content returned.)';
          assistantUi.setContent(fullResponse);
        }

        const edits = extractEditsFromAssistantText(fullResponse);
        if (lastContextScoutReport) renderContextHelperStatus();
        if (edits.length) {
          pendingEdits = edits;
          renderPendingEdits();
          showToast(`Ready to apply ${edits.length} edited file${edits.length === 1 ? '' : 's'}.`);
        }

        messages.push({ role: 'assistant', content: fullResponse });
        saveMessages();
      } catch (error) {
        if (error.name === 'AbortError') {
          fullResponse = fullResponse || '(Generation stopped.)';
          assistantUi.setContent(fullResponse);
          messages.push({ role: 'assistant', content: fullResponse });
          saveMessages();
        } else {
          console.error(error);
          assistantUi.setContent(usesAndroidSupport() ? 'Error from the selected runtime. Check the PC server, Android native bridge, selected model, and runtime settings.' : 'Error connecting to LM Studio. Check Settings, confirm the server is running, and verify the selected model is loaded.');
          showToast(error.message || 'LM Studio connection error.');
        }
      } finally {
        setStreamingUI(false);
        abortController = null;
        els.userInput.focus();
      }
    }

    function stopGeneration() {
      if (abortController) abortController.abort();
    }

    function clearChat() {
      messages = [];
      localStorage.removeItem(STORAGE_KEYS.messages);
      renderMessages();
      showToast('Chat cleared.');
    }

    function exportChat() {
      const exportData = {
        exportedAt: new Date().toISOString(),
        model: settings.model,
        messages
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lm-studio-lite-chat-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }



    function fileExtension(name) {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env' || lower === '.gitignore') return lower;
      const dot = lower.lastIndexOf('.');
      return dot >= 0 ? lower.slice(dot) : '';
    }

    function isTextAttachment(file) {
      return TEXT_MIME_TYPES.has(file.type) || COMPATIBLE_EXTENSIONS.has(fileExtension(file.name));
    }

    function isImageAttachment(file) {
      return String(file.type || '').startsWith('image/');
    }

    function fileSizeLabel(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }

    function openAttachmentPicker() {
      els.attachmentInput.click();
    }

    function addAttachments(files) {
      const accepted = Array.from(files || []).filter(file => isImageAttachment(file) || isTextAttachment(file));
      if (!accepted.length) {
        showToast('Attach compatible text/code files or images.');
        return;
      }
      for (const file of accepted) {
        const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
        attachments.push({ id, file, kind: isImageAttachment(file) ? 'image' : 'text' });
      }
      renderAttachmentTray();
      showToast(`${accepted.length} attachment${accepted.length === 1 ? '' : 's'} added.`);
    }

    function renderAttachmentTray() {
      if (!attachments.length) {
        els.attachmentTray.classList.remove('show');
        els.attachmentTray.innerHTML = '';
        return;
      }
      els.attachmentTray.classList.add('show');
      els.attachmentTray.innerHTML = '';
      attachments.forEach(item => {
        const chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.innerHTML = `<span>${item.kind === 'image' ? 'Image' : 'File'} · ${escapeHtml(item.file.name)} · ${fileSizeLabel(item.file.size)}</span><button class="mini-btn ghost-btn" type="button">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
          attachments = attachments.filter(attachment => attachment.id !== item.id);
          renderAttachmentTray();
        });
        els.attachmentTray.appendChild(chip);
      });
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read image attachment.'));
        reader.readAsDataURL(file);
      });
    }

    function readFileText(file) {
      if (!file) return Promise.resolve('');
      if (typeof file.text === 'function') {
        return file.text().catch(() => readFileTextWithReader(file));
      }
      return readFileTextWithReader(file);
    }

    function readFileTextWithReader(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read text file.'));
        reader.readAsText(file);
      });
    }

    async function buildUserTurn(text, items) {
      const displayLines = [text || '(attachments only)'];
      const modelLines = [text || 'Use the attached files/images as context.'];
      const imageParts = [];

      const textItems = items.filter(item => item.kind === 'text');
      const imageItems = items.filter(item => item.kind === 'image');

      if (items.length) displayLines.push('', `Attached: ${items.map(item => item.file.name).join(', ')}`);

      for (const item of textItems) {
        if (item.file.size > MAX_ATTACHMENT_TEXT_BYTES) {
          modelLines.push(`\n[Attached file omitted because it is larger than ${fileSizeLabel(MAX_ATTACHMENT_TEXT_BYTES)}: ${item.file.name}]`);
          continue;
        }
        const raw = await readFileText(item.file);
        const clipped = raw.length > MAX_ATTACHMENT_TEXT_CHARS
          ? raw.slice(0, MAX_ATTACHMENT_TEXT_CHARS) + '\n\n[Attachment clipped for context length.]'
          : raw;
        modelLines.push(`\n\nAttached file: ${item.file.name}\n\`\`\`\n${clipped}\n\`\`\``);
      }

      for (const item of imageItems) {
        imageParts.push({ type: 'image_url', image_url: { url: await readFileAsDataUrl(item.file) } });
      }

      const modelText = modelLines.join('\n');
      const requestContent = imageParts.length
        ? [{ type: 'text', text: modelText }, ...imageParts]
        : modelText;

      return {
        displayContent: displayLines.join('\n'),
        modelText,
        requestContent
      };
    }

    function workspaceEnvelopeForUserText(userText, workspaceContext) {
      const cleanUserText = String(userText || 'Use the attached workspace files as context.');
      return `User request:
${cleanUserText}

[WORKSPACE FILES ATTACHED BY THE APP]
These files are selected in the Workspace panel and are attached by the app in this same request. Use them as project context. Do not ask the user to upload or paste these files again.

${workspaceContext}
[END WORKSPACE FILES]

Answer the user request using the workspace files above. When asked to modify files, return a fenced code block with the relative file path as the language identifier.`;
    }

    function attachWorkspaceContextToUserContent(content, workspaceContext) {
      if (!workspaceContext) return content;
      if (Array.isArray(content)) {
        const next = content.map(part => ({ ...part }));
        const textPart = next.find(part => part && part.type === 'text');
        if (textPart) textPart.text = workspaceEnvelopeForUserText(textPart.text || '', workspaceContext);
        else next.unshift({ type: 'text', text: workspaceEnvelopeForUserText('', workspaceContext) });
        return next;
      }
      return workspaceEnvelopeForUserText(content || '', workspaceContext);
    }


    function getNativeFileBridge() {
      return window.lmStudioLiteNative || window.NativeFileBridge || null;
    }

    function asPromise(value) {
      return value && typeof value.then === 'function' ? value : Promise.resolve(value);
    }

    async function callNativeBridgeMethod(bridge, method, payload) {
      if (!bridge || typeof bridge[method] !== 'function') throw new Error(`Native bridge method missing: ${method}`);
      if (typeof payload === 'undefined') return await asPromise(bridge[method]());

      if (bridge.acceptsObjects === true || bridge.objectBridge === true) {
        return await asPromise(bridge[method](payload));
      }

      const jsonPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
      try {
        return await asPromise(bridge[method](jsonPayload));
      } catch (jsonError) {
        try {
          return await asPromise(bridge[method](payload));
        } catch {
          throw jsonError;
        }
      }
    }

    function supportsFolderFileInput() {
      return 'webkitdirectory' in document.createElement('input');
    }

    function isCompatibleWorkspaceFile(fileOrName) {
      const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
      const type = typeof fileOrName === 'string' ? '' : (fileOrName?.type || '');
      return TEXT_MIME_TYPES.has(type) || COMPATIBLE_EXTENSIONS.has(fileExtension(name));
    }

    function normalizeWorkspaceEntry(entry) {
      const rawPath = entry?.path || entry?.relativePath || entry?.webkitRelativePath || entry?.name || '';
      const path = normalizeWorkspacePath(rawPath);
      if (!path || !isCompatibleWorkspaceFile(path)) return null;
      const content = typeof entry?.content === 'string'
        ? entry.content
        : typeof entry?.text === 'string'
          ? entry.text
          : null;
      return {
        path,
        name: entry?.name || path.split('/').pop(),
        size: Number(entry?.size || (content ? content.length : 0)) || 0,
        lastModified: entry?.lastModified || 0,
        handle: entry?.handle || null,
        file: entry?.file || null,
        content,
        source: entry?.source || 'native'
      };
    }

    function setWorkspaceSelectionDefault() {
      workspaceSelectedPaths = new Set(workspaceFiles.slice(0, MAX_WORKSPACE_CONTEXT_FILES).map(file => file.path));
    }

    function setWorkspaceFiles(files, info = {}) {
      const byPath = new Map();
      for (const file of files || []) {
        const normalized = normalizeWorkspaceEntry(file);
        if (normalized && !byPath.has(normalized.path)) byPath.set(normalized.path, normalized);
        if (byPath.size >= MAX_WORKSPACE_SCAN_FILES) break;
      }
      workspaceFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
      lastContextScoutReport = null;
      setWorkspaceSelectionDefault();
      workspaceInfo = {
        name: info.name || workspaceHandle?.name || workspaceInfo?.name || 'Selected workspace',
        source: info.source || workspaceInfo?.source || 'browser fallback',
        writable: Boolean(info.writable || workspaceHandle || nativeWorkspace?.writable),
        updatedAt: new Date().toISOString(),
        count: workspaceFiles.length
      };
      localStorage.setItem(STORAGE_KEYS.workspaceInfo, JSON.stringify({
        name: workspaceInfo.name,
        source: workspaceInfo.source,
        writable: workspaceInfo.writable,
        updatedAt: workspaceInfo.updatedAt,
        count: workspaceInfo.count
      }));
      renderWorkspaceStrip();
    }

    async function readWorkspaceEntry(entry) {
      if (typeof entry.content === 'string') return entry.content;
      if (entry.file) return readFileText(entry.file);
      if (entry.handle?.getFile) {
        const file = await entry.handle.getFile();
        return readFileText(file);
      }
      const bridge = getNativeFileBridge();
      if (bridge?.readFile) {
        const result = await asPromise(bridge.readFile(entry.path));
        if (typeof result === 'string') return result;
        if (typeof result?.content === 'string') return result.content;
        if (typeof result?.text === 'string') return result.text;
      }
      throw new Error(`Could not read ${entry.path}`);
    }

    async function collectWorkspaceContext() {
      if (!workspaceFiles.length) return '';
      const selected = workspaceFiles.filter(file => workspaceSelectedPaths.has(file.path));
      const contextFiles = (selected.length ? selected : workspaceFiles).slice(0, MAX_WORKSPACE_CONTEXT_FILES);
      const manifest = workspaceFiles
        .slice(0, 120)
        .map(file => `- ${file.path}${file.size ? ` (${fileSizeLabel(file.size)})` : ''}`)
        .join('\n');
      const blocks = [];
      const skipped = [];
      let used = 0;

      for (const entry of contextFiles) {
        if (used >= MAX_WORKSPACE_TOTAL_CONTEXT_CHARS) {
          skipped.push(`${entry.path} (workspace context limit reached)`);
          continue;
        }
        try {
          let content = await readWorkspaceEntry(entry);
          if (content.length > MAX_WORKSPACE_FILE_CONTEXT_CHARS) {
            content = content.slice(0, MAX_WORKSPACE_FILE_CONTEXT_CHARS) + '\n\n[File clipped for context length.]';
            skipped.push(`${entry.path} (clipped)`);
          }
          const remaining = MAX_WORKSPACE_TOTAL_CONTEXT_CHARS - used;
          if (content.length > remaining) {
            content = content.slice(0, remaining) + '\n\n[Workspace context limit reached.]';
            skipped.push(`${entry.path} (truncated by total context limit)`);
          }
          used += content.length;
          blocks.push(`--- FILE: ${entry.path}\n${content}\n--- END FILE: ${entry.path}`);
        } catch {
          skipped.push(`${entry.path} (read failed)`);
        }
      }

      const skippedText = skipped.length ? `\n\nSkipped or clipped:\n${skipped.map(item => `- ${item}`).join('\n')}` : '';
      const fileContents = blocks.length
        ? blocks.join('\n\n')
        : '[No file contents could be read. Ask the user to use Select Files again or use the app-native folder bridge.]';
      return `Workspace: ${workspaceInfo?.name || workspaceHandle?.name || 'Selected workspace'}\nAccess: ${workspaceInfo?.source || (workspaceHandle ? 'browser folder handle' : 'browser fallback')}\nFiles scanned: ${workspaceFiles.length}\nFiles included in this request: ${blocks.length}\n\nWorkspace manifest:\n${manifest}\n\nWorkspace file contents:\n${fileContents}${skippedText}`;
    }

    async function scanDirectoryHandle(directoryHandle, prefix = '') {
      const files = [];
      async function walk(handle, base) {
        for await (const [name, child] of handle.entries()) {
          if (files.length >= MAX_WORKSPACE_SCAN_FILES) return;
          const path = normalizeWorkspacePath(base ? `${base}/${name}` : name);
          if (!path) continue;
          if (child.kind === 'directory') {
            await walk(child, path);
          } else if (child.kind === 'file' && isCompatibleWorkspaceFile(path)) {
            let size = 0;
            let lastModified = 0;
            try {
              const file = await child.getFile();
              size = file.size;
              lastModified = file.lastModified;
            } catch {}
            files.push({ path, name, size, lastModified, handle: child, source: 'directory-handle' });
          }
        }
      }
      await walk(directoryHandle, prefix);
      return files;
    }

    async function loadNativeWorkspace(result) {
      const data = Array.isArray(result) ? { files: result } : (result || {});
      const files = Array.isArray(data.files) ? data.files : [];
      nativeWorkspace = data;
      workspaceHandle = null;
      setWorkspaceFiles(files.map(file => ({ ...file, source: 'native' })), {
        name: data.name || data.rootName || data.path || 'App workspace',
        source: data.writable === false ? 'app read-only workspace' : 'app workspace',
        writable: data.writable !== false
      });
      showToast(`${workspaceFiles.length} compatible workspace file${workspaceFiles.length === 1 ? '' : 's'} loaded.`);
    }

    async function loadWorkspaceFromFileList(fileList, source = 'browser fallback') {
      const selected = Array.from(fileList || []).filter(file => isCompatibleWorkspaceFile(file));
      if (!selected.length) {
        showToast('No compatible text/code files were selected.');
        return;
      }

      showToast(`Reading ${selected.length} workspace file${selected.length === 1 ? '' : 's'}...`);
      const files = [];
      for (const file of selected.slice(0, MAX_WORKSPACE_SCAN_FILES)) {
        const path = normalizeWorkspacePath(file.webkitRelativePath || file.name);
        if (!path) continue;
        let content = '';
        let readable = true;
        try {
          if (file.size <= MAX_WORKSPACE_FILE_CONTEXT_CHARS * 2) content = await readFileText(file);
        } catch {
          readable = false;
        }
        files.push({
          path,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          file,
          content,
          readable,
          source
        });
      }
      const root = Array.from(fileList || []).find(file => file.webkitRelativePath)?.webkitRelativePath?.split('/')?.[0];
      nativeWorkspace = null;
      workspaceHandle = null;
      setWorkspaceFiles(files, {
        name: root || (files.length === 1 ? files[0].name : 'Selected files'),
        source,
        writable: false
      });
      const readableCount = files.filter(file => file.readable !== false).length;
      showToast(`${readableCount}/${workspaceFiles.length} compatible workspace file${workspaceFiles.length === 1 ? '' : 's'} loaded for chat context.`);
    }

    function renderWorkspaceFiles() {
      if (!els.workspaceFileRow) return;
      if (!workspaceFiles.length) {
        els.workspaceFileRow.classList.remove('show');
        els.workspaceFileRow.innerHTML = '';
        return;
      }
      els.workspaceFileRow.classList.add('show');
      els.workspaceFileRow.innerHTML = '';
      const visible = workspaceFiles.slice(0, 48);
      visible.forEach(file => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `workspace-file-chip ${workspaceSelectedPaths.has(file.path) ? 'selected' : ''}`;
        chip.title = workspaceSelectedPaths.has(file.path) ? 'Included in chat context' : 'Click to include in chat context';
        chip.innerHTML = `<span>${escapeHtml(file.path)}</span>`;
        chip.addEventListener('click', () => {
          if (workspaceSelectedPaths.has(file.path)) workspaceSelectedPaths.delete(file.path);
          else workspaceSelectedPaths.add(file.path);
          renderWorkspaceStrip();
        });
        els.workspaceFileRow.appendChild(chip);
      });
      if (workspaceFiles.length > visible.length) {
        const more = document.createElement('span');
        more.className = 'workspace-file-chip';
        more.innerHTML = `<span>+${workspaceFiles.length - visible.length} more</span>`;
        els.workspaceFileRow.appendChild(more);
      }
    }

    function selectWorkspaceFilesFallback() {
      els.workspaceFilesInput.click();
    }

    function normalizeWorkspacePath(path) {
      const clean = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
      if (!clean || clean.includes('../') || clean === '..' || /^[a-z]+:/i.test(clean)) return '';
      return clean;
    }

    function tryParseJson(value) {
      try { return JSON.parse(value); } catch { return null; }
    }

    function normalizeEditPayload(parsed) {
      const source = Array.isArray(parsed) ? parsed : (parsed?.files || parsed?.changes || []);
      if (!Array.isArray(source)) return [];
      const byPath = new Map();
      source.forEach(item => {
        const path = normalizeWorkspacePath(item?.path || item?.file || item?.name);
        const content = item?.content ?? item?.newContent ?? item?.replacement;
        if (!path || typeof content !== 'string') return;
        byPath.set(path, { path, content });
      });
      return [...byPath.values()];
    }

    function extractPendingEdits(raw) {
      const fenced = Array.from(raw.matchAll(/```([^\n]*)\n([\s\S]*?)```/gi));
      const edits = [];
      for (const match of fenced) {
        const langOrPath = match[1].trim();
        const content = match[2];
        if (langOrPath === 'json' || langOrPath === 'lmstudio-edits') {
          const parsed = tryParseJson(content);
          if (parsed && Array.isArray(parsed.files)) {
            edits.push(...parsed.files);
            continue;
          }
        }
        if (langOrPath.includes('.') || langOrPath.includes('/')) {
          edits.push({ path: langOrPath, content: content });
        }
      }
      return edits;
    }

    function extractEditsFromAssistantText(text) {
      const raw = String(text || '');
      const edits = extractPendingEdits(raw);
      if (edits.length) return edits;

      const candidates = [];
      const objectMatch = raw.match(/\{[\s\S]*"(?:files|changes)"[\s\S]*\}/);
      if (objectMatch) candidates.push(objectMatch[0]);

      for (const candidate of candidates) {
        const parsed = tryParseJson(candidate);
        const edits = normalizeEditPayload(parsed);
        if (edits.length) return edits;
      }
      return [];
    }

    function renderPendingEdits() {
      if (!pendingEdits.length) {
        els.pendingEditsPanel.classList.remove('show');
        els.pendingEditChips.innerHTML = '';
        els.pendingEditsSummary.textContent = 'No pending edits';
        return;
      }
      els.pendingEditsPanel.classList.add('show');
      els.pendingEditsSummary.textContent = `${pendingEdits.length} file${pendingEdits.length === 1 ? '' : 's'} ready`;
      els.pendingEditChips.innerHTML = '';
      pendingEdits.forEach(edit => {
        const chip = document.createElement('span');
        chip.className = 'edit-chip';
        chip.innerHTML = `<span>${escapeHtml(edit.path)}</span><button class="mini-btn ghost-btn" type="button">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
          pendingEdits = pendingEdits.filter(item => item.path !== edit.path);
          renderPendingEdits();
        });
        els.pendingEditChips.appendChild(chip);
      });
      els.applyEditsBtn.disabled = !pendingEdits.length;
    }

    function clearPendingEdits() {
      pendingEdits = [];
      renderPendingEdits();
    }

    function openHandleDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(HANDLE_DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open browser workspace storage.'));
      });
    }

    async function idbGet(key) {
      const db = await openHandleDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readonly');
        const request = tx.objectStore(HANDLE_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Could not read workspace handle.'));
        tx.oncomplete = () => db.close();
      });
    }

    async function idbSet(key, value) {
      const db = await openHandleDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error || new Error('Could not save workspace handle.'));
      });
    }

    async function idbDelete(key) {
      const db = await openHandleDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).delete(key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error || new Error('Could not clear workspace handle.'));
      });
    }

    async function verifyPermission(handle, mode = 'readwrite') {
      if (!handle?.queryPermission || !handle?.requestPermission) return false;
      const options = { mode };
      if ((await handle.queryPermission(options)) === 'granted') return true;
      return (await handle.requestPermission(options)) === 'granted';
    }

    async function loadWorkspaceHandle() {
      try {
        workspaceInfo = JSON.parse(localStorage.getItem(STORAGE_KEYS.workspaceInfo) || 'null');
      } catch {
        workspaceInfo = null;
      }
      try {
        workspaceHandle = await idbGet(WORKSPACE_HANDLE_KEY);
        if (workspaceHandle && !workspaceFiles.length) {
          const permitted = await verifyPermission(workspaceHandle, 'read').catch(() => false);
          if (permitted) {
            const files = await scanDirectoryHandle(workspaceHandle);
            setWorkspaceFiles(files, {
              name: workspaceHandle.name || workspaceInfo?.name || 'Selected folder',
              source: 'browser folder handle',
              writable: true
            });
            return;
          }
        }
      } catch {
        workspaceHandle = null;
      }
      renderWorkspaceStrip();
    }

    function renderWorkspaceStrip() {
      const name = workspaceHandle?.name || workspaceInfo?.name || (workspaceFiles.length ? 'Selected workspace' : '');
      if (!name && !workspaceFiles.length) {
        els.workspaceStrip.classList.remove('show');
        renderPendingEdits();
        return;
      }
      els.workspaceStrip.classList.add('show');
      const selectedCount = workspaceSelectedPaths.size;
      const access = nativeWorkspace?.writable === false
        ? 'app read-only'
        : nativeWorkspace
          ? 'app writable'
          : workspaceHandle
            ? 'write enabled'
            : workspaceFiles.length
              ? 'browser fallback'
              : 'context only';
      els.workspaceName.textContent = workspaceFiles.length
        ? `${name} · ${workspaceFiles.length} files scanned · ${selectedCount} ready for next prompt · ${access}`
        : `${name} · ${access}`;
      if (els.workspaceContextStatus) {
        els.workspaceContextStatus.textContent = workspaceFiles.length
          ? `${selectedCount || workspaceFiles.length} selected file${(selectedCount || workspaceFiles.length) === 1 ? '' : 's'} will be inserted directly into the next user message. Older “no files attached” replies are ignored for workspace requests.`
          : 'Select a folder or files to attach workspace context to the next prompt.';
      }
      renderContextHelperStatus();
      renderWorkspaceFiles();
      renderPendingEdits();
    }

    function buildContextPreviewText(requestMessages) {
      return requestMessages.map((message, index) => {
        const content = Array.isArray(message.content)
          ? message.content.map(part => part.type === 'text' ? part.text : `[${part.type || 'part'}]`).join('\n')
          : String(message.content || '');
        return `#${index + 1} ${message.role.toUpperCase()}\n${content}`;
      }).join('\n\n---\n\n');
    }

    async function previewChatContext() {
      const draft = els.userInput.value.trim() || 'List the files you can see in the workspace.';
      let workspaceContext = '';
      try {
        workspaceContext = await collectWorkspaceContextForPrompt(draft);
      } catch (error) {
        console.error(error);
        showToast('Could not build workspace debug context. Try Select Files again.');
        return;
      }
      const requestContent = workspaceContext
        ? attachWorkspaceContextToUserContent(draft, workspaceContext)
        : draft;
      const requestMessages = await collectRequestMessages([{ role: 'user', content: requestContent }], workspaceContext);
      const preview = buildContextPreviewText(requestMessages);
      els.contextPreview.textContent = preview;
      els.contextDebugSummary.textContent = workspaceContext
        ? `${workspaceFiles.length} scanned · ${workspaceSelectedPaths.size || workspaceFiles.length} selected · ${preview.length.toLocaleString()} characters in preview`
        : 'No workspace context will be sent yet.';
      els.contextDebugPanel.classList.add('show');
      showToast('Debug context built from the next request.');
    }

    async function copyContextPreview() {
      await copyText(els.contextPreview.textContent || '', 'Copied context preview.');
    }

    function closeContextPreview() {
      els.contextDebugPanel.classList.remove('show');
    }

    async function clearWorkspace() {
      workspaceHandle = null;
      workspaceInfo = null;
      workspaceFiles = [];
      workspaceSelectedPaths = new Set();
      nativeWorkspace = null;
      lastContextScoutReport = null;
      localStorage.removeItem(STORAGE_KEYS.workspaceInfo);
      try { await idbDelete(WORKSPACE_HANDLE_KEY); } catch {}
      const bridge = getNativeFileBridge();
      if (bridge?.clearPersistedWorkspace) {
        try { await asPromise(bridge.clearPersistedWorkspace()); } catch (err) {}
      }
      closeContextPreview();
      renderWorkspaceStrip();
      showToast('Workspace cleared.');
    }

    async function openWorkspaceFromChat() {
      const bridge = getNativeFileBridge();
      if (bridge?.selectFolder) {
        try {
          const result = await asPromise(bridge.selectFolder());
          if (result) {
            await loadNativeWorkspace(result);
            return;
          }
        } catch (error) {
          console.error(error);
          showToast('App folder picker failed. Opening browser fallback.');
        }
      }

      if ('showDirectoryPicker' in window && window.isSecureContext) {
        try {
          workspaceHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          await idbSet(WORKSPACE_HANDLE_KEY, workspaceHandle);
          nativeWorkspace = null;
          const files = await scanDirectoryHandle(workspaceHandle);
          setWorkspaceFiles(files, {
            name: workspaceHandle.name || 'Selected folder',
            source: 'browser folder handle',
            writable: true
          });
          showToast(`Workspace selected: ${workspaceInfo.name}`);
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
          console.error(error);
          showToast('Folder picker failed. Opening file picker fallback.');
        }
      }

      if (supportsFolderFileInput()) els.workspaceFolderInput.click();
      else els.workspaceFilesInput.click();
    }

    async function getChildDirectory(root, name, create = false) {
      return root.getDirectoryHandle(name, { create });
    }

    async function getFileHandleForPath(root, path, create = true) {
      const parts = normalizeWorkspacePath(path).split('/').filter(Boolean);
      const fileName = parts.pop();
      if (!fileName) throw new Error('Invalid file path.');
      let directory = root;
      for (const part of parts) directory = await getChildDirectory(directory, part, create);
      return directory.getFileHandle(fileName, { create });
    }

    function encodeZipUtf8(value) {
      return new TextEncoder().encode(String(value || ''));
    }

    function makeCrcTable() {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
      }
      return table;
    }

    const CRC_TABLE = makeCrcTable();

    function crc32(bytes) {
      let crc = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    }

    function dosDateTime(date = new Date()) {
      const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
      const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
      return { time, date: dosDate };
    }

    function push16(parts, value) { parts.push(value & 255, (value >>> 8) & 255); }
    function push32(parts, value) { parts.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }

    function buildZipBlob(files) {
      const localParts = [];
      const centralParts = [];
      let offset = 0;
      const stamp = dosDateTime();

      for (const file of files) {
        const nameBytes = encodeZipUtf8(normalizeWorkspacePath(file.path));
        const dataBytes = encodeZipUtf8(file.content);
        const crc = crc32(dataBytes);

        const local = [];
        push32(local, 0x04034b50); push16(local, 20); push16(local, 0x0800); push16(local, 0);
        push16(local, stamp.time); push16(local, stamp.date); push32(local, crc);
        push32(local, dataBytes.length); push32(local, dataBytes.length); push16(local, nameBytes.length); push16(local, 0);
        localParts.push(new Uint8Array(local), nameBytes, dataBytes);

        const central = [];
        push32(central, 0x02014b50); push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
        push16(central, stamp.time); push16(central, stamp.date); push32(central, crc);
        push32(central, dataBytes.length); push32(central, dataBytes.length); push16(central, nameBytes.length);
        push16(central, 0); push16(central, 0); push16(central, 0); push16(central, 0); push32(central, 0); push32(central, offset);
        centralParts.push(new Uint8Array(central), nameBytes);
        offset += local.length + nameBytes.length + dataBytes.length;
      }

      const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
      const eocd = [];
      push32(eocd, 0x06054b50); push16(eocd, 0); push16(eocd, 0); push16(eocd, files.length); push16(eocd, files.length);
      push32(eocd, centralSize); push32(eocd, offset); push16(eocd, 0);
      return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], { type: 'application/zip' });
    }

    function downloadPendingEditsZip() {
      const blob = buildZipBlob(pendingEdits);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lm-studio-lite-edits-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    async function applyPendingEdits() {
      if (!pendingEdits.length) { showToast('No edited files to apply.'); return; }
      const bridge = getNativeFileBridge();
      try {
        if (bridge?.writeFiles) {
          await callNativeBridgeMethod(bridge, 'writeFiles', { files: pendingEdits, workspace: workspaceInfo || null });
          const count = pendingEdits.length;
          clearPendingEdits();
          showToast(`Applied ${count} edited file${count === 1 ? '' : 's'} through the app bridge.`);
          return;
        }
        if (bridge?.writeFile) {
          for (const edit of pendingEdits) await asPromise(bridge.writeFile(edit.path, edit.content));
          const count = pendingEdits.length;
          clearPendingEdits();
          showToast(`Applied ${count} edited file${count === 1 ? '' : 's'} through the app bridge.`);
          return;
        }
        if (workspaceHandle) {
          const permitted = await verifyPermission(workspaceHandle, 'readwrite');
          if (!permitted) throw new Error('Folder write permission was denied.');
          for (const edit of pendingEdits) {
            const handle = await getFileHandleForPath(workspaceHandle, edit.path, true);
            const writable = await handle.createWritable();
            await writable.write(edit.content);
            await writable.close();
          }
          const count = pendingEdits.length;
          clearPendingEdits();
          showToast(`Applied ${count} edited file${count === 1 ? '' : 's'} to the workspace.`);
          return;
        }
        downloadPendingEditsZip();
        showToast('Direct write is unavailable. Downloaded reviewed edits as a ZIP fallback.');
      } catch (error) {
        console.error(error);
        try {
          downloadPendingEditsZip();
          showToast('Apply failed. Downloaded reviewed edits as a ZIP fallback.');
        } catch {
          showToast(error.message || 'Could not apply edited files.');
        }
      }
    }

    function bindEvents() {
      els.form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (isStreaming) {
          stopGeneration();
        } else {
          sendMessage();
        }
      });

      els.userInput.addEventListener('input', updateInputHeight);

      els.attachmentInput.addEventListener('change', () => {
        addAttachments(els.attachmentInput.files);
        els.attachmentInput.value = '';
      });

      els.workspaceFolderInput.addEventListener('change', async () => {
        await loadWorkspaceFromFileList(els.workspaceFolderInput.files, 'browser folder fallback');
        els.workspaceFolderInput.value = '';
      });

      els.workspaceFilesInput.addEventListener('change', async () => {
        await loadWorkspaceFromFileList(els.workspaceFilesInput.files, 'browser file fallback');
        els.workspaceFilesInput.value = '';
      });

      els.composerStack.addEventListener('dragover', (event) => {
        event.preventDefault();
        els.composerStack.classList.add('drop-active');
      });
      els.composerStack.addEventListener('dragleave', () => els.composerStack.classList.remove('drop-active'));
      els.composerStack.addEventListener('drop', (event) => {
        event.preventDefault();
        els.composerStack.classList.remove('drop-active');
        addAttachments(event.dataTransfer?.files);
      });
      els.userInput.addEventListener('paste', (event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length) addAttachments(files);
      });

      els.userInput.addEventListener('keydown', (event) => {
        const dropdown = document.getElementById('commands-dropdown');
        if (dropdown && dropdown.classList.contains('show')) {
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendMessage();
        }
      });

      els.modelSelect.addEventListener('change', () => {
        settings.model = els.modelSelect.value;
        saveSettings();
        updateRuntimeUi();
      });

      if (els.runtimeMode) {
        els.runtimeMode.addEventListener('change', () => {
          settings.runtimeMode = els.runtimeMode.value;
          saveSettings();
          updateRuntimeUi();
          loadModels();
        });
      }

      const bindAndroidNumber = (el, key, fallback, min) => {
        if (!el) return;
        el.addEventListener('input', () => {
          settings[key] = Math.max(min, parseInt(el.value, 10) || fallback);
          saveSettings();
          updateRuntimeUi();
        });
      };

      bindAndroidNumber(els.androidThreads, 'androidThreads', DEFAULT_SETTINGS.androidThreads, 1);
      bindAndroidNumber(els.androidGpuLayers, 'androidGpuLayers', DEFAULT_SETTINGS.androidGpuLayers, 0);
      bindAndroidNumber(els.androidContextLength, 'androidContextLength', DEFAULT_SETTINGS.androidContextLength, 1024);
      bindAndroidNumber(els.androidBatchSize, 'androidBatchSize', DEFAULT_SETTINGS.androidBatchSize, 32);

      if (els.hybridStrategy) {
        els.hybridStrategy.addEventListener('change', () => {
          settings.hybridStrategy = els.hybridStrategy.value;
          saveSettings();
          updateRuntimeUi();
        });
      }

      if (els.hybridFallbackMs) {
        els.hybridFallbackMs.addEventListener('input', () => {
          settings.hybridFallbackMs = Math.max(1000, parseInt(els.hybridFallbackMs.value, 10) || DEFAULT_SETTINGS.hybridFallbackMs);
          saveSettings();
          updateRuntimeUi();
        });
      }

      els.maxTokensInput.addEventListener('input', () => {
        settings.maxTokens = Math.max(1, parseInt(els.maxTokensInput.value, 10) || DEFAULT_SETTINGS.maxTokens);
        saveSettings();
      });

      els.systemPrompt.addEventListener('input', () => {
        settings.systemPrompt = els.systemPrompt.value;
        saveSettings();
      });

      syncRangeAndNumber(els.tempRange, els.tempInput, els.tempValue, 'temperature', 0, 2);
      syncRangeAndNumber(els.topPRange, els.topPInput, els.topPValue, 'topP', 0, 1);
    }

    function hydrateFileContext() {
      const raw = localStorage.getItem(STORAGE_KEYS.fileContext);
      if (!raw) return;

      try {
        const context = JSON.parse(raw);
        const fileName = context.name || 'selected file';
        const content = String(context.content || '');
        if (context.kind === 'folder') {
          const providedFiles = Array.isArray(context.files) ? context.files : [];
          if (providedFiles.length) {
            nativeWorkspace = null;
            workspaceHandle = null;
            setWorkspaceFiles(providedFiles.map(file => ({ ...file, source: 'folders-page' })), {
              name: fileName,
              source: 'folders page context',
              writable: false
            });
          } else {
            workspaceInfo = { name: fileName, source: 'folders page context', writable: false, updatedAt: context.updatedAt || new Date().toISOString() };
            localStorage.setItem(STORAGE_KEYS.workspaceInfo, JSON.stringify(workspaceInfo));
            renderWorkspaceStrip();
          }
          els.userInput.value = `Workspace ${fileName} is loaded. Task:`;
          updateInputHeight();
          showToast(`Loaded ${fileName} workspace. It will be attached to the next prompt.`);
          return;
        }

        const clipped = content.length > 70000
          ? content.slice(0, 70000) + '\n\n[File clipped at 70,000 characters for the chat composer.]'
          : content;

        els.userInput.value = `I am editing ${fileName}. Use this file as context.\n\n\`\`\`\n${clipped}\n\`\`\`\n\nTask:`;
        updateInputHeight();
        showToast(`Loaded ${fileName} into the chat composer.`);
      } catch (error) {
        console.error(error);
        showToast('Could not load the file context from the editor.');
      } finally {
        localStorage.removeItem(STORAGE_KEYS.fileContext);
      }
    }

    function toggleWorkspaceCollapse() {
      const strip = document.getElementById('workspace-strip');
      const body = document.getElementById('workspace-body');
      const btn = document.getElementById('workspace-collapse-btn');
      if (!strip || !body || !btn) return;
      const isCollapsed = strip.classList.toggle('collapsed');
      body.style.display = isCollapsed ? 'none' : 'flex';
      btn.textContent = isCollapsed ? 'Show' : 'Hide';
      localStorage.setItem('lmStudioLite.workspaceCollapsed.v1', isCollapsed ? 'true' : 'false');
    }

    function init() {
      Object.defineProperty(window, 'settings', {
        get: () => settings,
        configurable: true
      });
      Object.defineProperty(window, 'workspaceFiles', {
        get: () => workspaceFiles,
        configurable: true
      });

      applySettingsToUI();
      bindEvents();
      renderMessages();
      initScrollPill();
      loadWorkspaceHandle();
      hydrateFileContext();
      renderAttachmentTray();
      renderPendingEdits();
      renderContextHelperStatus();
      loadModels();

      const collapsed = localStorage.getItem('lmStudioLite.workspaceCollapsed.v1') === 'true';
      if (collapsed) {
        const strip = document.getElementById('workspace-strip');
        const body = document.getElementById('workspace-body');
        const btn = document.getElementById('workspace-collapse-btn');
        if (strip && body && btn) {
          strip.classList.add('collapsed');
          body.style.display = 'none';
          btn.textContent = 'Show';
        }
      }
    }

    init();

// Expose for HTML
window.toggleSidebar = toggleSidebar;
window.loadModels = loadModels;
window.testAndroidRuntime = testAndroidRuntime;
window.exportChat = exportChat;
window.clearChat = clearChat;
window.openWorkspaceFromChat = openWorkspaceFromChat;
window.selectWorkspaceFilesFallback = selectWorkspaceFilesFallback;
window.previewChatContext = previewChatContext;
window.toggleContextHelper = toggleContextHelper;
window.clearWorkspace = clearWorkspace;
window.openAttachmentPicker = openAttachmentPicker;
window.applyPendingEdits = applyPendingEdits;
window.clearPendingEdits = clearPendingEdits;
window.closeContextPreview = closeContextPreview;
window.copyContextPreview = copyContextPreview;
window.toggleWorkspaceCollapse = toggleWorkspaceCollapse;

window.addEventListener('settingsChanged', () => { settings = loadSettings(); if (settings.model) els.modelDisplay.textContent = settings.model; });

window.addEventListener('workspaceSelected', () => { hydrateFileContext(); loadWorkspaceHandle(); });
})();
