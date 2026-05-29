(function() {
const STORAGE_KEYS = {
      settings: 'lmStudioLite.settings.v1',
      fileContext: 'lmStudioLite.fileContext.v1',
      workspaceInfo: 'lmStudioLite.workspaceInfo.v1'
    };

    const HANDLE_DB = 'lmStudioLite.filesystem.v1';
    const HANDLE_STORE = 'handles';
    const WORKSPACE_HANDLE_KEY = 'workspaceHandle';

    const DEFAULT_SETTINGS = {
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: 'auto-detect',
      temperature: 0.7,
      topP: 1,
      maxTokens: 500,
      systemPrompt: 'You are a concise, helpful local assistant.',
      theme: 'system',
      persistChat: true
    };

    const COMPATIBLE_EXTENSIONS = new Set([
      '.txt', '.md', '.markdown', '.csv', '.log', '.html', '.htm', '.css', '.js', '.mjs', '.json', '.xml',
      '.yml', '.yaml', '.py', '.ts', '.tsx', '.jsx', '.php', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
      '.hpp', '.cs', '.swift', '.sql', '.sh', '.zsh', '.bash', '.env', '.gitignore'
    ]);
    const COMPATIBLE_MIME_TYPES = new Set(['text/plain', 'text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json', 'text/markdown', 'text/csv', 'application/xml', 'text/xml']);
    const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'vendor']);
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    const MAX_WORKSPACE_FILES = 220;
    const AI_TOTAL_CONTEXT_CHARS = 120000;
    const AI_FILE_CONTEXT_CHARS = 30000;
    const CHAT_TOTAL_CONTEXT_CHARS = 70000;
    const CHAT_FILE_CONTEXT_CHARS = 18000;

    let workspaceHandle = null;
    let workspaceFiles = [];
    let nativeWorkspace = null;
    let directFolderMode = false;
    let workspaceLabel = '';
    let selectedFile = null;
    let dirty = false;
    let pendingAiChanges = [];
    let pendingAiSummary = '';
    let isAiEditing = false;

    const els = {
      fallbackFolder: document.getElementById('fallback-folder'),
      fallbackFiles: document.getElementById('fallback-files'),
      capabilityPill: document.getElementById('capability-pill'),
      capabilityText: document.getElementById('capability-text'),
      workspaceSearch: document.getElementById('workspace-search'),
      workspaceList: document.getElementById('workspace-list'),
      workspaceFolderMeta: document.getElementById('workspace-folder-meta'),
      workspaceCountMeta: document.getElementById('workspace-count-meta'),
      workspaceAccessMeta: document.getElementById('workspace-access-meta'),
      rescanFolderBtn: document.getElementById('rescan-folder-btn'),
      sendWorkspaceBtn: document.getElementById('send-workspace-btn'),
      editor: document.getElementById('editor'),
      fileName: document.getElementById('file-name'),
      fileStatus: document.getElementById('file-status'),
      dirtyPill: document.getElementById('dirty-pill'),
      dirtyText: document.getElementById('dirty-text'),
      saveSelectedBtn: document.getElementById('save-selected-btn'),
      downloadSelectedBtn: document.getElementById('download-selected-btn'),
      aiInstruction: document.getElementById('ai-instruction'),
      aiPreviewBtn: document.getElementById('ai-preview-btn'),
      aiApplyBtn: document.getElementById('ai-apply-btn'),
      changeList: document.getElementById('change-list'),
      toast: document.getElementById('toast')
    };

    function hasDirectFolderAccess() {
      return 'showDirectoryPicker' in window && window.isSecureContext;
    }
    function supportsFolderFileInput() { return 'webkitdirectory' in document.createElement('input'); }
    function getNativeFileBridge() {
      return window.SignalLMNativeBridge || window.lmStudioLiteNative || window.NativeFileBridge || null;
    }
    async function asPromise(value) { return value && typeof value.then === 'function' ? await value : value; }
    function setCapabilityStatus() {
      if (getNativeFileBridge()?.selectFolder) {
        els.capabilityPill.className = 'status-pill connected';
        els.capabilityText.textContent = 'App folder bridge available';
      } else if (hasDirectFolderAccess()) {
        els.capabilityPill.className = 'status-pill connected';
        els.capabilityText.textContent = 'Writable folders supported';
      } else {
        els.capabilityPill.className = 'status-pill fallback';
        els.capabilityText.textContent = 'Folder/file picker fallback';
      }
    }
    function showToast(message) { els.toast.textContent = message; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 3200); }
    function basename(path) { return String(path || '').split('/').filter(Boolean).pop() || ''; }
    function normalizePath(path) { return String(path || '').replace(/\\/g, '/').replace(/^\/+/, ''); }
    function extensionOf(path) {
      const clean = basename(path).toLowerCase();
      if (clean === '.env' || clean === '.gitignore') return clean;
      const dot = clean.lastIndexOf('.');
      return dot >= 0 ? clean.slice(dot) : '';
    }
    function isCompatibleFile(path, file = null) { return COMPATIBLE_EXTENSIONS.has(extensionOf(path)) || Boolean(file && COMPATIBLE_MIME_TYPES.has(file.type)); }
    function fileSizeLabel(bytes) { const value = Number(bytes) || 0; if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(2)} MB`; }
    function readFileText(file) {
      if (!file) return Promise.resolve('');
      if (typeof file.text === 'function') return file.text().catch(() => readFileTextWithReader(file));
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
    function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
    function loadSettings() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } }
    function normalizeBaseUrl(url) { return (url || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, ''); }
    function endpoint(path, settings = loadSettings()) { return normalizeBaseUrl(settings.baseUrl) + path; }
    function getHeaders(settings = loadSettings()) { const headers = { 'Content-Type': 'application/json' }; if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`; return headers; }

    async function verifyPermission(handle, mode = 'readwrite') {
      const options = { mode };
      if (!handle.queryPermission || !handle.requestPermission) return true;
      if ((await handle.queryPermission(options)) === 'granted') return true;
      return (await handle.requestPermission(options)) === 'granted';
    }

    function setDirty(value) {
      dirty = value;
      els.dirtyPill.className = value ? 'status-pill fallback' : 'status-pill connected';
      els.dirtyText.textContent = value ? 'Unsaved' : 'Clean';
      updateSelectedMeta();
    }



    function openHandleDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(HANDLE_DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open browser workspace storage.'));
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

    async function rememberWorkspaceHandle() {
      if (!workspaceHandle?.kind || workspaceHandle.kind !== 'directory') return;
      try {
        await idbSet(WORKSPACE_HANDLE_KEY, workspaceHandle);
        localStorage.setItem(STORAGE_KEYS.workspaceInfo, JSON.stringify({
          name: workspaceLabel || workspaceHandle.name || 'Selected folder',
          updatedAt: new Date().toISOString()
        }));
      } catch (error) {
        console.error(error);
      }
    }

    function rememberFallbackWorkspace() {
      if (!workspaceLabel) return;
      localStorage.setItem(STORAGE_KEYS.workspaceInfo, JSON.stringify({
        name: workspaceLabel,
        mode: 'context-only',
        updatedAt: new Date().toISOString()
      }));
    }

    function updateWorkspaceMeta() {
      els.workspaceFolderMeta.textContent = workspaceLabel || 'None';
      els.workspaceCountMeta.textContent = String(workspaceFiles.length);
      els.workspaceAccessMeta.textContent = workspaceFiles.length ? (nativeWorkspace?.writable ? 'App writable workspace' : directFolderMode ? 'Writable folder handle' : 'Browser fallback picker') : 'Not selected';
      els.rescanFolderBtn.disabled = !workspaceHandle;
      els.sendWorkspaceBtn.disabled = !workspaceFiles.length;
      els.aiPreviewBtn.disabled = isAiEditing || !workspaceFiles.length;
      els.aiApplyBtn.disabled = isAiEditing || !pendingAiChanges.length;
      els.aiApplyBtn.textContent = (nativeWorkspace?.writable || directFolderMode) ? 'Apply Reviewed Edits' : 'Download Reviewed Edits';
    }

    function updateSelectedMeta() {
      els.fileName.textContent = selectedFile?.path || 'No file selected';
      els.fileStatus.textContent = selectedFile ? (dirty ? 'Selected folder file · unsaved changes' : 'Selected folder file') : 'Select a file from the folder list.';
      els.saveSelectedBtn.disabled = !selectedFile || !dirty;
      els.downloadSelectedBtn.disabled = !selectedFile;
    }

    async function selectFolder() {
      if (dirty && !confirm('Discard unsaved selected-file changes?')) return;

      const bridge = getNativeFileBridge();
      if (bridge?.selectFolder) {
        try {
          const result = await asPromise(bridge.selectFolder());
          const data = typeof result === 'string' ? JSON.parse(result) : result;
          if (data) {
            loadNativeWorkspace(data);
            showToast(`Selected ${workspaceLabel}. App Apply is enabled for this workspace.`);
            return;
          }
        } catch (error) {
          console.error(error);
          showToast('Native folder picker failed. Opening browser fallback.');
        }
      }

      if (hasDirectFolderAccess()) {
        try {
          workspaceHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          nativeWorkspace = null;
          workspaceLabel = workspaceHandle.name || 'Selected folder';
          directFolderMode = await verifyPermission(workspaceHandle, 'readwrite');
          await rememberWorkspaceHandle();
          await scanWorkspaceFolder();
          showToast(`Selected ${workspaceLabel}. Chat Apply is enabled for this workspace.`);
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
          console.error(error);
          showToast('Writable folder picker failed. Opening the file/folder fallback instead.');
        }
      }

      if (supportsFolderFileInput()) els.fallbackFolder.click();
      else els.fallbackFiles.click();
    }

    function selectFilesFallback() { els.fallbackFiles.click(); }

    function loadNativeWorkspace(data) {
      nativeWorkspace = data || {};
      workspaceHandle = null;
      directFolderMode = Boolean(data?.writable !== false);
      workspaceLabel = data?.name || 'Native workspace';
      const files = Array.isArray(data?.files) ? data.files : [];
      workspaceFiles = files
        .map(file => ({
          path: normalizePath(file.path || file.name),
          name: file.name || basename(file.path),
          size: Number(file.size) || new Blob([String(file.content || '')]).size,
          lastModified: file.lastModified || Date.now(),
          handle: null,
          file: null,
          content: typeof file.content === 'string' ? file.content : ''
        }))
        .filter(entry => entry.path && isCompatibleFile(entry.path) && entry.size <= MAX_FILE_BYTES)
        .slice(0, MAX_WORKSPACE_FILES)
        .sort((a, b) => a.path.localeCompare(b.path));
      rememberFallbackWorkspace();
      selectedFile = null;
      els.editor.value = '';
      setDirty(false);
      pendingAiChanges = [];
      pendingAiSummary = '';
      renderWorkspaceList();
      renderAiChanges();
      updateWorkspaceMeta();
      updateSelectedMeta();
    }

    async function rescanFolder() {
      if (!workspaceHandle) return;
      if (dirty && !confirm('Discard unsaved selected-file changes before rescanning?')) return;
      await scanWorkspaceFolder();
      showToast('Folder rescanned.');
    }

    async function scanWorkspaceFolder() {
      workspaceFiles = [];
      selectedFile = null;
      els.editor.value = '';
      setDirty(false);
      pendingAiChanges = [];
      pendingAiSummary = '';

      try {
        if (workspaceHandle?.kind === 'directory') {
          await scanDirectDirectory(workspaceHandle, '');
        } else if (Array.isArray(workspaceHandle)) {
          await scanFallbackFiles(workspaceHandle);
        }
        workspaceFiles.sort((a, b) => a.path.localeCompare(b.path));
        renderWorkspaceList();
        renderAiChanges();
        updateWorkspaceMeta();
        updateSelectedMeta();
      } catch (error) {
        console.error(error);
        showToast('Could not scan the selected folder.');
      }
    }

    async function scanDirectDirectory(directoryHandle, prefix) {
      for await (const [name, handle] of directoryHandle.entries()) {
        if (workspaceFiles.length >= MAX_WORKSPACE_FILES) return;
        if (handle.kind === 'directory') {
          if (SKIP_DIRECTORIES.has(name)) continue;
          await scanDirectDirectory(handle, `${prefix}${name}/`);
          continue;
        }
        const path = normalizePath(`${prefix}${name}`);
        if (!isCompatibleFile(path)) continue;
        const file = await handle.getFile();
        if (file.size > MAX_FILE_BYTES) continue;
        workspaceFiles.push({ path, name, size: file.size, lastModified: file.lastModified, handle, file: null });
      }
    }

    async function scanFallbackFiles(files) {
      workspaceFiles = [];
      const selected = files
        .map(file => ({ path: normalizePath(file.webkitRelativePath || file.name), name: file.name, size: file.size, lastModified: file.lastModified, handle: null, file }))
        .filter(entry => isCompatibleFile(entry.path, entry.file) && entry.size <= MAX_FILE_BYTES)
        .slice(0, MAX_WORKSPACE_FILES);

      for (const entry of selected) {
        try {
          entry.content = await readFileText(entry.file);
          entry.readable = true;
        } catch {
          entry.content = '';
          entry.readable = false;
        }
        workspaceFiles.push(entry);
      }
      const root = workspaceFiles[0]?.path?.split('/')?.[0];
      workspaceLabel = root || 'Selected folder';
      directFolderMode = false;
      rememberFallbackWorkspace();
    }

    function renderWorkspaceList() {
      const query = els.workspaceSearch.value.trim().toLowerCase();
      const files = query ? workspaceFiles.filter(file => file.path.toLowerCase().includes(query)) : workspaceFiles;
      if (!workspaceFiles.length) {
        els.workspaceList.innerHTML = '<div class="empty-box">Select a folder to scan compatible text and code files.</div>';
        return;
      }
      if (!files.length) {
        els.workspaceList.innerHTML = '<div class="empty-box">No compatible files match that filter.</div>';
        return;
      }
      els.workspaceList.innerHTML = '';
      files.forEach(file => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `file-row ${selectedFile?.path === file.path ? 'active' : ''}`;
        row.innerHTML = `<span style="min-width:0;"><span class="file-path">${escapeHtml(file.path)}</span><span class="file-mini">${fileSizeLabel(file.size)}</span></span><span>Open</span>`;
        row.addEventListener('click', () => openWorkspaceFile(file.path));
        els.workspaceList.appendChild(row);
      });
    }

    async function readWorkspaceFile(entry) {
      if (typeof entry?.content === 'string' && entry.content !== '') return entry.content;
      if (entry.handle) return readFileText(await entry.handle.getFile());
      if (entry.file) return readFileText(entry.file);

      const bridge = getNativeFileBridge();
      if (bridge?.readFile) {
        try {
          const result = await asPromise(bridge.readFile(entry.path));
          if (typeof result === 'string') return result;
          if (typeof result?.content === 'string') return result.content;
          if (typeof result?.text === 'string') return result.text;
        } catch (error) {
          console.error(error);
        }
      }
      if (typeof entry?.content === 'string') return entry.content;
      return '';
    }

    async function openWorkspaceFile(path) {
      if (dirty && !confirm('Discard unsaved selected-file changes?')) return;
      const entry = workspaceFiles.find(file => file.path === path);
      if (!entry) return;
      try {
        selectedFile = entry;
        els.editor.value = await readWorkspaceFile(entry);
        setDirty(false);
        renderWorkspaceList();
        updateSelectedMeta();
      } catch (error) {
        console.error(error);
        showToast('Could not read that file.');
      }
    }

    async function saveSelectedFile() {
      if (!selectedFile) return;
      if (selectedFile.handle && directFolderMode && typeof selectedFile.handle.createWritable === 'function') {
        try {
          const permitted = await verifyPermission(workspaceHandle, 'readwrite');
          if (!permitted) throw new Error('Folder write permission was denied.');
          const writable = await selectedFile.handle.createWritable();
          await writable.write(els.editor.value);
          await writable.close();
          selectedFile.size = new Blob([els.editor.value]).size;
          setDirty(false);
          renderWorkspaceList();
          showToast(`Saved ${selectedFile.path}.`);
          return;
        } catch (error) {
          console.error(error);
          showToast(error.message || 'Direct save failed. Download a copy instead.');
          return;
        }
      }
      downloadSelectedFile();
      setDirty(false);
    }

    function downloadSelectedFile() {
      if (!selectedFile) return;
      const blob = new Blob([els.editor.value], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = basename(selectedFile.path) || 'edited-file.txt';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${basename(selectedFile.path)}.`);
    }

    async function collectWorkspaceContents(totalLimit, perFileLimit) {
      const files = [];
      const skipped = [];
      let used = 0;
      for (const entry of workspaceFiles) {
        if (used >= totalLimit) { skipped.push(`${entry.path} (context limit reached)`); continue; }
        try {
          let content = await readWorkspaceFile(entry);
          if (content.length > perFileLimit) {
            content = content.slice(0, perFileLimit) + '\n\n[File clipped for context length.]';
            skipped.push(`${entry.path} (clipped)`);
          }
          const remaining = totalLimit - used;
          if (content.length > remaining) {
            files.push({ path: entry.path, content: content.slice(0, remaining) + '\n\n[Workspace context limit reached.]' });
            used = totalLimit;
          } else {
            files.push({ path: entry.path, content });
            used += content.length;
          }
        } catch {
          skipped.push(`${entry.path} (read failed)`);
        }
      }
      return { files, skipped };
    }

    async function sendWorkspaceToChat() {
      if (!workspaceFiles.length) { showToast('Select a folder first.'); return; }
      try {
        const { files, skipped } = await collectWorkspaceContents(CHAT_TOTAL_CONTEXT_CHARS, CHAT_FILE_CONTEXT_CHARS);
        const blocks = files.map(file => `--- FILE: ${file.path}\n${file.content}\n--- END FILE: ${file.path}`).join('\n\n');
        const skippedNote = skipped.length ? `\n\nSkipped or clipped:\n${skipped.map(item => `- ${item}`).join('\n')}` : '';
        localStorage.setItem(STORAGE_KEYS.fileContext, JSON.stringify({
          kind: 'folder',
          name: workspaceLabel || 'selected folder',
          files,
          skipped,
          content: `Folder: ${workspaceLabel || 'selected folder'}\n\n${blocks}${skippedNote}`,
          updatedAt: new Date().toISOString()
        }));
        window.location.hash = '#chat'; window.dispatchEvent(new Event('workspaceSelected'));
      } catch (error) {
        console.error(error);
        showToast('Could not send folder context to chat.');
      }
    }

    function buildAiPrompt(task, files, skipped) {
      const fileBlocks = files.map(file => `--- FILE: ${file.path}\n${file.content}\n--- END FILE: ${file.path}`).join('\n\n');
      const skippedNote = skipped.length ? `\n\nSome files were omitted or clipped because of context limits. Do not edit omitted files unless their full contents are provided.\n${skipped.map(item => `- ${item}`).join('\n')}` : '';
      return `Task:\n${task}\n\nReturn JSON only. The JSON must match this schema exactly:\n{\n  "summary": "short summary of changes",\n  "files": [\n    { "path": "relative/path/from/workspace", "content": "complete replacement content for the changed file" }\n  ]\n}\n\nRules:\n- Only include files that need changes.\n- Use only paths from the provided workspace files.\n- Each content value must be the complete final file content, not a patch.\n- Preserve unrelated content exactly.\n- Do not include markdown fences, commentary, or extra keys.\n\nWorkspace files:\n${fileBlocks}${skippedNote}`;
    }

    async function previewAiFolderEdits() {
      if (!workspaceFiles.length) { showToast('Select a folder first.'); return; }
      const task = els.aiInstruction.value.trim();
      if (!task) { showToast('Describe what should change first.'); els.aiInstruction.focus(); return; }
      if (dirty) { showToast('Save or discard the selected-file changes before running folder edits.'); return; }
      const settings = loadSettings();
      if (settings.model === 'auto-detect' || !settings.model) {
        try {
          if (typeof window.loadModels === 'function') {
            await window.loadModels({ force: true });
          }
        } catch (error) {
          console.warn('Failed to refresh models in editor:', error);
        }
      }
      const resolvedModel = (settings.model === 'auto-detect' || !settings.model)
        ? (window.__signalLmLoadedModels?.[0] || '')
        : settings.model;
      if (!resolvedModel) { showToast('No active model loaded. Start LM Studio or select a model first.'); return; }

      setAiEditing(true);
      pendingAiChanges = [];
      pendingAiSummary = '';
      renderAiChanges();
      try {
        const { files, skipped } = await collectWorkspaceContents(AI_TOTAL_CONTEXT_CHARS, AI_FILE_CONTEXT_CHARS);
        if (!files.length) throw new Error('No readable compatible files found in the workspace.');
        const response = await fetch(endpoint('/chat/completions', settings), {
          method: 'POST',
          headers: getHeaders(settings),
          body: JSON.stringify({
            model: resolvedModel,
            messages: [
              { role: 'system', content: 'You are a precise code editor. Return only strict JSON that follows the requested schema.' },
              { role: 'user', content: buildAiPrompt(task, files, skipped) }
            ],
            stream: false,
            temperature: 0.2,
            top_p: Number(settings.topP),
            max_tokens: Math.max(4096, parseInt(settings.maxTokens, 10) || 4096)
          })
        });
        if (!response.ok) throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
        const payload = await response.json();
        const parsed = parseAiJson(extractAssistantText(payload));
        pendingAiChanges = normalizeAiChanges(parsed.files || []);
        pendingAiSummary = parsed.summary || '';
        renderAiChanges();
        if (!pendingAiChanges.length) showToast('AI returned no applicable file changes.');
        else if (!(nativeWorkspace?.writable || directFolderMode)) showToast(`AI proposed ${pendingAiChanges.length} change(s). Review, then download the edited files.`);
        else showToast(`AI proposed ${pendingAiChanges.length} change(s). Review, then apply.`);
      } catch (error) {
        console.error(error);
        renderAiChanges(error.message || 'Could not generate AI edits.');
        showToast(error.message || 'Could not generate AI edits.');
      } finally {
        setAiEditing(false);
      }
    }

    function extractAssistantText(payload) { return payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text ?? ''; }
    function parseAiJson(raw) {
      const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      try { return JSON.parse(cleaned); } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI response was not valid JSON.');
        return JSON.parse(match[0]);
      }
    }
    function normalizeAiChanges(files) {
      if (!Array.isArray(files)) return [];
      const knownPaths = new Set(workspaceFiles.map(entry => entry.path));
      const byPath = new Map();
      for (const item of files) {
        const path = normalizePath(item?.path);
        const content = item?.content;
        if (!path || !knownPaths.has(path) || typeof content !== 'string') continue;
        byPath.set(path, { path, content });
      }
      return [...byPath.values()];
    }
    function setAiEditing(value) { isAiEditing = value; els.aiPreviewBtn.textContent = value ? 'Generating...' : 'Preview AI Edits'; updateWorkspaceMeta(); }
    function renderAiChanges(errorMessage = '') {
      updateWorkspaceMeta();
      if (isAiEditing) { els.changeList.innerHTML = '<div class="empty-box">Generating reviewed edits from the selected model...</div>'; return; }
      if (errorMessage) { els.changeList.innerHTML = `<div class="empty-box">${escapeHtml(errorMessage)}</div>`; return; }
      if (!pendingAiChanges.length) { els.changeList.innerHTML = '<div class="empty-box">No pending AI edits.</div>'; return; }
      els.changeList.innerHTML = '';
      if (pendingAiSummary) {
        const summary = document.createElement('div');
        summary.className = 'empty-box';
        summary.textContent = pendingAiSummary;
        els.changeList.appendChild(summary);
      }
      pendingAiChanges.forEach(change => {
        const entry = workspaceFiles.find(file => file.path === change.path);
        const item = document.createElement('div');
        item.className = 'change-item';
        item.innerHTML = `<div class="change-item-head"><div><div class="change-path">${escapeHtml(change.path)}</div><div class="change-mini">Original ${fileSizeLabel(entry?.size || 0)} · replacement ${change.content.length.toLocaleString()} characters</div></div><button class="mini-btn ghost-btn" type="button">Open</button></div>`;
        item.querySelector('button').addEventListener('click', () => previewPendingChange(change.path));
        els.changeList.appendChild(item);
      });
    }
    async function previewPendingChange(path) {
      const change = pendingAiChanges.find(item => item.path === path);
      if (!change) return;
      if (dirty && !confirm('Discard unsaved selected-file changes and preview the AI replacement?')) return;
      selectedFile = workspaceFiles.find(item => item.path === path) || null;
      els.editor.value = change.content;
      setDirty(true);
      renderWorkspaceList();
      updateSelectedMeta();
      showToast(`Previewing pending replacement for ${path}. Apply Reviewed Edits writes all changes.`);
    }
    async function applyAiFolderEdits() {
      if (!pendingAiChanges.length) { showToast('No pending AI edits to apply.'); return; }
      const directApply = Boolean(nativeWorkspace?.writable || (directFolderMode && workspaceHandle));
      const verb = directApply ? 'Apply' : 'Download';
      if (!confirm(`${verb} ${pendingAiChanges.length} AI-edited file${pendingAiChanges.length === 1 ? '' : 's'}?`)) return;
      try {
        if (nativeWorkspace?.writable) {
          await applyEditsWithNativeBridge(pendingAiChanges);
          const changedCount = pendingAiChanges.length;
          pendingAiChanges = [];
          pendingAiSummary = '';
          renderAiChanges();
          showToast(`Applied ${changedCount} AI-edited file${changedCount === 1 ? '' : 's'} through the app workspace.`);
          return;
        }

        if (directFolderMode && workspaceHandle) {
          const permitted = await verifyPermission(workspaceHandle, 'readwrite');
          if (!permitted) throw new Error('Folder write permission was denied.');
          for (const change of pendingAiChanges) {
            const entry = workspaceFiles.find(file => file.path === change.path);
            if (!entry?.handle || typeof entry.handle.createWritable !== 'function') continue;
            const writable = await entry.handle.createWritable();
            await writable.write(change.content);
            await writable.close();
            if (selectedFile?.path === change.path) {
              els.editor.value = change.content;
              setDirty(false);
            }
          }
          const changedCount = pendingAiChanges.length;
          pendingAiChanges = [];
          pendingAiSummary = '';
          await scanWorkspaceFolder();
          renderAiChanges();
          showToast(`Applied ${changedCount} AI-edited file${changedCount === 1 ? '' : 's'} to the folder.`);
          return;
        }

        await downloadEditsZip(pendingAiChanges);
        showToast('Downloaded reviewed edits as a ZIP browser fallback.');
      } catch (error) {
        console.error(error);
        showToast(error.message || 'Could not apply AI edits.');
      }
    }

    async function applyEditsWithNativeBridge(edits) {
      const bridge = getNativeFileBridge();
      if (!bridge) throw new Error('No app file bridge is available.');
      if (bridge.writeFiles) { await asPromise(bridge.writeFiles(edits)); return; }
      if (bridge.writeFile) {
        for (const edit of edits) await asPromise(bridge.writeFile(edit.path, edit.content));
        return;
      }
      throw new Error('The app file bridge does not expose writeFiles or writeFile.');
    }

    function makeCrcTable() {
      const table = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      return table;
    }
    const CRC_TABLE = makeCrcTable();
    function crc32Bytes(bytes) {
      let crc = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    }
    function dosDateTime(date = new Date()) {
      const year = Math.max(1980, date.getFullYear());
      return {
        dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
      };
    }
    function pushU16(parts, value) { parts.push(value & 0xff, (value >>> 8) & 0xff); }
    function pushU32(parts, value) { parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
    async function createZipBlob(files) {
      const encoder = new TextEncoder();
      const localParts = [];
      const centralParts = [];
      let offset = 0;
      const { dosTime, dosDate } = dosDateTime();
      for (const file of files) {
        const safeName = normalizePath(file.path || 'edited-file.txt') || 'edited-file.txt';
        const nameBytes = encoder.encode(safeName);
        const data = encoder.encode(String(file.content || ''));
        const crc = crc32Bytes(data);
        const local = [];
        pushU32(local, 0x04034b50); pushU16(local, 20); pushU16(local, 0x0800); pushU16(local, 0);
        pushU16(local, dosTime); pushU16(local, dosDate); pushU32(local, crc); pushU32(local, data.length); pushU32(local, data.length);
        pushU16(local, nameBytes.length); pushU16(local, 0);
        localParts.push(new Uint8Array(local), nameBytes, data);
        const central = [];
        pushU32(central, 0x02014b50); pushU16(central, 20); pushU16(central, 20); pushU16(central, 0x0800); pushU16(central, 0);
        pushU16(central, dosTime); pushU16(central, dosDate); pushU32(central, crc); pushU32(central, data.length); pushU32(central, data.length);
        pushU16(central, nameBytes.length); pushU16(central, 0); pushU16(central, 0); pushU16(central, 0); pushU16(central, 0); pushU32(central, 0); pushU32(central, offset);
        centralParts.push(new Uint8Array(central), nameBytes);
        offset += local.length + nameBytes.length + data.length;
      }
      const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
      const end = [];
      pushU32(end, 0x06054b50); pushU16(end, 0); pushU16(end, 0); pushU16(end, files.length); pushU16(end, files.length);
      pushU32(end, centralSize); pushU32(end, offset); pushU16(end, 0);
      return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type: 'application/zip' });
    }
    async function downloadEditsZip(edits) {
      const blob = await createZipBlob(edits);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lm-studio-lite-edits-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function bindEvents() {
      els.fallbackFolder.addEventListener('change', () => {
        const files = Array.from(els.fallbackFolder.files || []);
        if (!files.length) return;
        nativeWorkspace = null;
        workspaceHandle = files;
        scanWorkspaceFolder();
        els.fallbackFolder.value = '';
      });
      els.fallbackFiles.addEventListener('change', () => {
        const files = Array.from(els.fallbackFiles.files || []);
        if (!files.length) return;
        nativeWorkspace = null;
        workspaceHandle = files;
        scanWorkspaceFolder();
        els.fallbackFiles.value = '';
      });
      els.workspaceSearch.addEventListener('input', renderWorkspaceList);
      els.editor.addEventListener('input', () => { if (selectedFile) setDirty(true); });
      els.editor.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveSelectedFile(); }
        if (event.key === 'Tab') {
          event.preventDefault();
          const start = els.editor.selectionStart;
          const end = els.editor.selectionEnd;
          els.editor.setRangeText('  ', start, end, 'end');
          if (selectedFile) setDirty(true);
        }
      });
      window.addEventListener('beforeunload', event => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; });
    }

    async function init() {
      setCapabilityStatus();
      bindEvents();
      updateWorkspaceMeta();
      updateSelectedMeta();

      const bridge = getNativeFileBridge();
      if (bridge?.getPersistedWorkspace) {
        try {
          const result = await asPromise(bridge.getPersistedWorkspace());
          const data = typeof result === 'string' ? JSON.parse(result) : result;
          if (data && data.files && data.files.length) {
            loadNativeWorkspace(data);
            showToast(`Loaded persisted workspace: ${workspaceLabel}`);
          }
        } catch (error) {
          console.error("Failed to load persisted workspace:", error);
        }
      }
    }
    init();

// Expose for HTML
window.selectFolder = selectFolder;
window.selectFilesFallback = selectFilesFallback;
window.rescanFolder = rescanFolder;
window.sendWorkspaceToChat = sendWorkspaceToChat;
window.saveSelectedFile = saveSelectedFile;
window.downloadSelectedFile = downloadSelectedFile;
window.previewAiFolderEdits = previewAiFolderEdits;
window.applyAiFolderEdits = applyAiFolderEdits;
Object.defineProperty(window, 'pendingAiChanges', {
  get() { return pendingAiChanges; },
  set(value) { pendingAiChanges = value; },
  configurable: true
});
})();
