(function () {
  const COMMANDS = [
    {
      name: '/help',
      desc: 'Show available slash commands'
    },
    {
      name: '/list',
      desc: 'List workspace files, optionally filtered',
      acceptsArgs: true,
      usage: '/list css'
    },
    {
      name: '/read',
      desc: 'Read a workspace file into chat',
      acceptsArgs: true,
      usage: '/read path/to/file.js'
    },
    {
      name: '/edit',
      desc: 'Ask the model to edit a workspace file',
      acceptsArgs: true,
      usage: '/edit path/to/file.js make the header smaller'
    },
    {
      name: '/patch',
      desc: 'Stage a direct find/replace patch for a workspace file',
      acceptsArgs: true,
      usage: '/patch path/to/file.js old text => new text'
    },
    {
      name: '/replace',
      desc: 'Alias for /patch find/replace staging',
      acceptsArgs: true,
      usage: '/replace path/to/file.js old text => new text'
    },
    {
      name: '/write',
      desc: 'Stage a complete file replacement for review',
      acceptsArgs: true,
      usage: '/write path/to/file.txt replacement text'
    },
    {
      name: '/append',
      desc: 'Append text to a workspace file and stage the result',
      acceptsArgs: true,
      usage: '/append notes.md new line to add'
    },
    {
      name: '/find',
      desc: 'Search workspace paths and file contents',
      acceptsArgs: true,
      usage: '/find functionName'
    },
    {
      name: '/tree',
      desc: 'Show a compact workspace tree',
      acceptsArgs: true,
      usage: '/tree css'
    },
    {
      name: '/stats',
      desc: 'Show workspace file counts and extension stats'
    },
    {
      name: '/context',
      desc: 'Preview the workspace context that will be sent',
      acceptsArgs: true,
      usage: '/context fix the chat layout'
    },
    {
      name: '/apply',
      desc: 'Apply staged file edits or download fallback'
    },
    {
      name: '/pending',
      desc: 'Show staged file edits'
    },
    {
      name: '/select',
      desc: 'Select or load a workspace folder'
    },
    {
      name: '/status',
      desc: 'Show workspace and staged edit status'
    },
    {
      name: '/tools',
      desc: 'List built-in tools available without MCP'
    },
    {
      name: '/review',
      desc: 'Ask the model for a code review using workspace context',
      acceptsArgs: true,
      usage: '/review focus on mobile bugs'
    },
    {
      name: '/security',
      desc: 'Ask for a security review of the loaded workspace',
      acceptsArgs: true,
      usage: '/security check auth and uploads'
    },
    {
      name: '/tests',
      desc: 'Ask for a focused test plan or test code',
      acceptsArgs: true,
      usage: '/tests for slash commands'
    },
    {
      name: '/explain',
      desc: 'Ask the model to explain a file or system',
      acceptsArgs: true,
      usage: '/explain index.js chat flow'
    },
    {
      name: '/summarize',
      desc: 'Ask for a concise summary of workspace or file context',
      acceptsArgs: true,
      usage: '/summarize recent UI changes'
    },
    {
      name: '/refactor',
      desc: 'Ask for a refactor plan or replacement code',
      acceptsArgs: true,
      usage: '/refactor index.js reduce duplication'
    },
    {
      name: '/debug',
      desc: 'Ask for debugging steps using current workspace context',
      acceptsArgs: true,
      usage: '/debug dropdown is clipped'
    },
    {
      name: '/docs',
      desc: 'Ask for docs, README, or usage text',
      acceptsArgs: true,
      usage: '/docs write command help'
    },
    {
      name: '/report',
      desc: 'Ask for a structured report',
      acceptsArgs: true,
      usage: '/report project status'
    },
    {
      name: '/data',
      desc: 'Ask for data analysis or CSV/chart guidance',
      acceptsArgs: true,
      usage: '/data analyze attached CSV'
    },
    {
      name: '/commit',
      desc: 'Ask for commit message, changelog, or PR text',
      acceptsArgs: true,
      usage: '/commit summarize staged UI changes'
    },
    {
      name: '/android',
      desc: 'Ask for Android/Capacitor/WebView help',
      acceptsArgs: true,
      usage: '/android check WebView layout'
    },
    {
      name: '/supabase',
      desc: 'Ask for Supabase auth/storage/RLS guidance',
      acceptsArgs: true,
      usage: '/supabase review upload security'
    },
    {
      name: '/model',
      desc: 'Select or manage LLM models',
      subcommands: [
        { name: 'list', desc: 'List all loaded/available models' },
        { name: 'select', desc: 'Select active model by name', acceptsArgs: true }
      ]
    },
    {
      name: '/workspace',
      desc: 'Manage workspace context files',
      subcommands: [
        { name: 'select', desc: 'Select a folder from device' },
        { name: 'list', desc: 'List workspace files', acceptsArgs: true },
        { name: 'read', desc: 'Read a workspace file', acceptsArgs: true },
        { name: 'find', desc: 'Search workspace files', acceptsArgs: true },
        { name: 'tree', desc: 'Show workspace tree', acceptsArgs: true },
        { name: 'stats', desc: 'Show workspace stats' },
        { name: 'clear', desc: 'Clear loaded workspace files' },
        { name: 'status', desc: 'Show workspace file counts & status' }
      ]
    },
    {
      name: '/system',
      desc: 'Configure system prompt message',
      subcommands: [
        { name: 'set', desc: 'Set system instructions prompt', acceptsArgs: true },
        { name: 'clear', desc: 'Remove system instruction prompt' },
        { name: 'reset', desc: 'Reset system prompt to default' }
      ]
    },
    {
      name: '/web',
      desc: 'DuckDuckGo web search helper settings',
      subcommands: [
        { name: 'search', desc: 'Perform search query', acceptsArgs: true },
        { name: 'toggle', desc: 'Toggle quiet search helper' }
      ]
    },
    {
      name: '/mcp',
      desc: 'Model Context Protocol server settings',
      subcommands: [
        { name: 'status', desc: 'Show connected MCP server statuses' },
        { name: 'reload', desc: 'Reload and re-register MCP tools' }
      ]
    },
    {
      name: '/clear',
      desc: 'Clear active chat message history'
    }
  ];

  const PROMPT_TOOLS = {
    '/review': {
      title: 'Code Review',
      prompt: (args) => `Review the loaded workspace or named files for bugs, regressions, maintainability issues, performance problems, and missing tests.\n\nFocus: ${args || 'general code review'}\n\nReturn findings first, ordered by severity, with file paths and exact code references when possible.`
    },
    '/security': {
      title: 'Security Review',
      prompt: (args) => `Audit the loaded workspace for security issues.\n\nFocus: ${args || 'auth, storage, secrets, unsafe inputs, network calls, and client/server trust boundaries'}\n\nCall out any Supabase RLS, storage bucket, token exposure, upload, or WebView risks if relevant.`
    },
    '/tests': {
      title: 'Test Planner',
      prompt: (args) => `Create focused tests or a manual test checklist for this workspace.\n\nTarget: ${args || 'the current app behavior'}\n\nPrefer concrete test cases, expected results, and any useful code snippets.`
    },
    '/explain': {
      title: 'Explainer',
      prompt: (args) => `Explain the requested file, feature, or system using the loaded workspace context.\n\nTopic: ${args || 'the current app architecture'}\n\nKeep it practical and point to relevant files or functions.`
    },
    '/summarize': {
      title: 'Summarizer',
      prompt: (args) => `Summarize the loaded workspace or selected files.\n\nFocus: ${args || 'what this project does, important files, and current risks'}\n\nKeep it concise but useful.`
    },
    '/refactor': {
      title: 'Refactor Assistant',
      prompt: (args) => `Propose a safe refactor for the loaded workspace.\n\nGoal: ${args || 'improve readability and reduce duplication'}\n\nPreserve behavior. If code changes are needed, return complete replacement blocks for the affected files.`
    },
    '/debug': {
      title: 'Debugger',
      prompt: (args) => `Debug this issue using the loaded workspace context.\n\nIssue: ${args || 'describe likely causes and next checks'}\n\nPrioritize concrete causes, affected files, and one clear fix path.`
    },
    '/docs': {
      title: 'Docs Writer',
      prompt: (args) => `Write or improve documentation for this project.\n\nNeed: ${args || 'usage notes and developer documentation'}\n\nMake it copy/paste-ready and grounded in the loaded workspace.`
    },
    '/report': {
      title: 'Report Writer',
      prompt: (args) => `Write a structured report.\n\nTopic: ${args || 'project status, risks, and next steps'}\n\nUse clear headings and concise recommendations.`
    },
    '/data': {
      title: 'Data Analyst',
      prompt: (args) => `Analyze the loaded data or CSV-like files.\n\nQuestion: ${args || 'find patterns, issues, and useful summaries'}\n\nIf charts would help, describe the chart and the data columns needed.`
    },
    '/commit': {
      title: 'Commit Helper',
      prompt: (args) => `Draft a commit message, PR description, changelog entry, or release note.\n\nContext: ${args || 'the current workspace changes'}\n\nUse concise professional wording. Do not mention AI or generated wording.`
    },
    '/android': {
      title: 'Android Helper',
      prompt: (args) => `Review Android, Capacitor, or WebView behavior for this project.\n\nIssue: ${args || 'layout, build, permissions, and WebView integration'}\n\nTreat the app as web-first unless the problem is clearly native.`
    },
    '/supabase': {
      title: 'Supabase Helper',
      prompt: (args) => `Review Supabase-related behavior.\n\nIssue: ${args || 'auth, uploads, storage, RLS, signed URLs, and ownership checks'}\n\nSeparate client-side UX checks from real server-side enforcement.`
    }
  };

  let dropdown = null;
  let input = null;
  let activeIndex = 0;
  let currentFilteredList = [];
  let queryStartIndex = -1;

  function runtime() {
    return window.SignalLMChatCommands || {};
  }

  function toast(message) {
    const api = runtime();
    if (typeof api.toast === 'function') api.toast(message);
  }

  function addLocalSystemMessage(htmlContent) {
    const api = runtime();
    if (typeof api.addResult === 'function') {
      api.addResult(htmlContent);
      return;
    }
    toast(stripHtml(htmlContent));
  }

  function stripHtml(value) {
    const div = document.createElement('div');
    div.innerHTML = String(value || '');
    return div.textContent || div.innerText || '';
  }

  function splitArgs(raw) {
    const tokens = [];
    let token = '';
    let quote = '';
    for (const char of String(raw || '').trim()) {
      if (quote) {
        if (char === quote) {
          quote = '';
        } else {
          token += char;
        }
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (/\s/.test(char)) {
        if (token) {
          tokens.push(token);
          token = '';
        }
      } else {
        token += char;
      }
    }
    if (token) tokens.push(token);
    return tokens;
  }

  function parsePathAndRemainder(raw, commandText) {
    let rest = String(raw || '').slice(commandText.length).trim();
    if (!rest) return { path: '', rest: '' };
    if (rest[0] === '"' || rest[0] === "'" || rest[0] === '`') {
      const quote = rest[0];
      let index = 1;
      let path = '';
      while (index < rest.length && rest[index] !== quote) {
        path += rest[index];
        index++;
      }
      return { path, rest: rest.slice(index + 1).trim() };
    }
    const match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    return { path: match?.[1] || '', rest: match?.[2] || '' };
  }

  function commandUsage(commandName) {
    const command = COMMANDS.find(item => item.name === commandName);
    return command?.usage || commandName;
  }

  function showUsage(usage, description = '') {
    addLocalSystemMessage(`<strong>Usage:</strong> <code>${escapeHtml(usage)}</code>${description ? `<br>${escapeHtml(description)}` : ''}`);
  }

  function commandHelp() {
    const lines = COMMANDS.map(command => {
      const usage = command.usage ? ` <small>${escapeHtml(command.usage)}</small>` : '';
      const subcommands = command.subcommands
        ? `<br><small>Subcommands: ${command.subcommands.map(sub => `<code>${escapeHtml(sub.name)}</code>`).join(', ')}</small>`
        : '';
      return `<li><code>${escapeHtml(command.name)}</code>${usage}: ${escapeHtml(command.desc)}${subcommands}</li>`;
    }).join('');
    addLocalSystemMessage(`<strong>Available Slash Commands</strong><ul>${lines}</ul>`);
  }

  function renderWorkspaceStatus() {
    const api = runtime();
    const status = typeof api.getWorkspaceStatus === 'function' ? api.getWorkspaceStatus() : null;
    if (!status) {
      addLocalSystemMessage('Workspace status is unavailable on this page.');
      return;
    }
    addLocalSystemMessage(
      `<strong>Workspace Status</strong><ul>` +
      `<li>Name: <code>${escapeHtml(status.name)}</code></li>` +
      `<li>Access: ${escapeHtml(status.access)}</li>` +
      `<li>Files: ${Number(status.count || 0).toLocaleString()}</li>` +
      `<li>Selected for chat: ${Number(status.selectedCount || 0).toLocaleString()}</li>` +
      `<li>Pending edits: ${Number(status.pendingEditCount || 0).toLocaleString()}</li>` +
      `</ul>`
    );
  }

  function renderWorkspaceList(filter = '') {
    const api = runtime();
    const files = typeof api.listWorkspaceFiles === 'function' ? api.listWorkspaceFiles(filter, 80) : [];
    if (!files.length) {
      addLocalSystemMessage(filter
        ? `No workspace files match <code>${escapeHtml(filter)}</code>.`
        : 'No workspace files are loaded. Use <code>/select</code> first.');
      return;
    }
    const lines = files.map(file => {
      const selected = file.selected ? ' selected' : '';
      const size = file.size ? ` (${fileSizeLabel(file.size)})` : '';
      return `<li><code>${escapeHtml(file.path)}</code>${size}${selected}</li>`;
    }).join('');
    addLocalSystemMessage(`<strong>Workspace Files${filter ? ` matching "${escapeHtml(filter)}"` : ''}</strong><ul>${lines}</ul>`);
  }

  async function renderWorkspaceRead(path) {
    if (!path) {
      showUsage(commandUsage('/read'));
      return;
    }
    const api = runtime();
    if (typeof api.readWorkspaceFile !== 'function') {
      addLocalSystemMessage('File reading is unavailable on this page.');
      return;
    }
    try {
      const file = await api.readWorkspaceFile(path);
      const maxChars = 12000;
      const clipped = file.content.length > maxChars;
      const content = clipped ? file.content.slice(0, maxChars) + '\n\n[File clipped for display.]' : file.content;
      addLocalSystemMessage(`<strong>${escapeHtml(file.path)}</strong><pre><code>${escapeHtml(content)}</code></pre>`);
    } catch (error) {
      addLocalSystemMessage(escapeHtml(error.message || 'Could not read that file.'));
    }
  }

  function renderBuiltInTools() {
    const directTools = [
      '/select', '/status', '/list', '/tree', '/find', '/read', '/write', '/append', '/patch', '/replace', '/pending', '/apply', '/context', '/stats'
    ];
    const promptTools = Object.keys(PROMPT_TOOLS);
    addLocalSystemMessage(
      '<strong>Built-in Tools</strong>' +
      '<p>These run inside Signal-LM without an MCP integration. File-changing tools stage edits for review before applying.</p>' +
      `<strong>Local tools</strong><ul>${directTools.map(name => `<li><code>${escapeHtml(name)}</code> ${escapeHtml(COMMANDS.find(cmd => cmd.name === name)?.desc || '')}</li>`).join('')}</ul>` +
      `<strong>Prompt tools</strong><ul>${promptTools.map(name => `<li><code>${escapeHtml(name)}</code> ${escapeHtml(COMMANDS.find(cmd => cmd.name === name)?.desc || '')}</li>`).join('')}</ul>`
    );
  }

  function renderWorkspaceStats() {
    const api = runtime();
    const stats = typeof api.getWorkspaceStats === 'function' ? api.getWorkspaceStats() : null;
    if (!stats || !stats.count) {
      addLocalSystemMessage('No workspace files are loaded. Use <code>/select</code> first.');
      return;
    }
    const rows = stats.byExtension.slice(0, 24)
      .map(item => `<li><code>${escapeHtml(item.extension)}</code>: ${item.count} file${item.count === 1 ? '' : 's'} (${fileSizeLabel(item.bytes)})</li>`)
      .join('');
    addLocalSystemMessage(
      `<strong>Workspace Stats</strong><ul>` +
      `<li>Name: <code>${escapeHtml(stats.name)}</code></li>` +
      `<li>Files: ${Number(stats.count || 0).toLocaleString()}</li>` +
      `<li>Selected for chat: ${Number(stats.selectedCount || 0).toLocaleString()}</li>` +
      `<li>Total listed size: ${fileSizeLabel(stats.totalBytes)}</li>` +
      `</ul><strong>Extensions</strong><ul>${rows}</ul>`
    );
  }

  function renderWorkspaceTree(filter = '') {
    const api = runtime();
    const tree = typeof api.getWorkspaceTree === 'function' ? api.getWorkspaceTree(filter, 220) : null;
    if (!tree || !tree.lines.length) {
      addLocalSystemMessage(filter
        ? `No workspace tree entries match <code>${escapeHtml(filter)}</code>.`
        : 'No workspace files are loaded. Use <code>/select</code> first.');
      return;
    }
    const suffix = tree.truncated ? `\n\n[Showing ${tree.shown} of ${tree.total} files.]` : '';
    addLocalSystemMessage(`<strong>Workspace Tree${filter ? ` matching "${escapeHtml(filter)}"` : ''}</strong><pre><code>${escapeHtml(tree.lines.join('\n') + suffix)}</code></pre>`);
  }

  async function renderWorkspaceFind(query) {
    if (!query) {
      showUsage(commandUsage('/find'));
      return;
    }
    const api = runtime();
    if (typeof api.searchWorkspace !== 'function') {
      addLocalSystemMessage('Workspace search is unavailable on this page.');
      return;
    }
    try {
      const results = await api.searchWorkspace(query, 60);
      if (!results.length) {
        addLocalSystemMessage(`No workspace matches for <code>${escapeHtml(query)}</code>.`);
        return;
      }
      const rows = results.map(result => {
        const line = result.line ? `:${result.line}` : '';
        return `<li><code>${escapeHtml(result.path)}${line}</code> ${escapeHtml(result.preview || '')}</li>`;
      }).join('');
      addLocalSystemMessage(`<strong>Find: ${escapeHtml(query)}</strong><ul>${rows}</ul>`);
    } catch (error) {
      addLocalSystemMessage(escapeHtml(error.message || 'Search failed.'));
    }
  }

  async function renderContextPreview(draft) {
    const api = runtime();
    if (typeof api.getContextPreview !== 'function') {
      addLocalSystemMessage('Context preview is unavailable on this page.');
      return;
    }
    try {
      const context = await api.getContextPreview(draft);
      const maxChars = 12000;
      const preview = context.preview.length > maxChars
        ? context.preview.slice(0, maxChars) + '\n\n[Context preview clipped for display.]'
        : context.preview;
      addLocalSystemMessage(
        `<strong>Context Preview</strong><ul>` +
        `<li>Workspace files: ${Number(context.files || 0).toLocaleString()}</li>` +
        `<li>Selected: ${Number(context.selectedCount || 0).toLocaleString()}</li>` +
        `<li>Preview size: ${Number(context.length || 0).toLocaleString()} characters</li>` +
        `</ul><pre><code>${escapeHtml(preview)}</code></pre>`
      );
    } catch (error) {
      addLocalSystemMessage(escapeHtml(error.message || 'Could not build context preview.'));
    }
  }

  function stageWrite(path, content) {
    if (!path || !content) {
      showUsage(commandUsage('/write'), 'This stages a full replacement, then you can review and apply it.');
      return;
    }
    const api = runtime();
    if (typeof api.stageEdit !== 'function') {
      addLocalSystemMessage('File writing is unavailable on this page.');
      return;
    }
    try {
      const result = api.stageEdit(path, content);
      addLocalSystemMessage(`Staged <code>${escapeHtml(result.path)}</code>. Review the pending edit panel, then run <code>/apply</code>.`);
    } catch (error) {
      addLocalSystemMessage(escapeHtml(error.message || 'Could not stage that edit.'));
    }
  }

  async function stageAppend(path, content) {
    if (!path || !content) {
      showUsage(commandUsage('/append'), 'This reads the current file, appends text, and stages the full replacement.');
      return;
    }
    const api = runtime();
    if (typeof api.stageAppend !== 'function') {
      addLocalSystemMessage('Append is unavailable on this page.');
      return;
    }
    try {
      const result = await api.stageAppend(path, content);
      addLocalSystemMessage(`Appended text and staged <code>${escapeHtml(result.path)}</code>. Review, then run <code>/apply</code>.`);
    } catch (error) {
      addLocalSystemMessage(escapeHtml(error.message || 'Could not stage append.'));
    }
  }

  function parseFindReplace(rest) {
    const marker = rest.indexOf('=>');
    if (marker === -1) return null;
    return {
      find: rest.slice(0, marker).trim(),
      replacement: rest.slice(marker + 2).trim()
    };
  }

  async function stagePatch(commandName, raw) {
    const parsed = parsePathAndRemainder(raw, commandName);
    const change = parseFindReplace(parsed.rest);
    if (!parsed.path || !change || !change.find) {
      showUsage(commandUsage(commandName), 'This stages a direct find/replace patch. The original text must match exactly.');
      return;
    }
    const api = runtime();
    if (typeof api.stageReplace !== 'function') {
      addLocalSystemMessage('Patch is unavailable on this page.');
      return;
    }
    try {
      const result = await api.stageReplace(parsed.path, change.find, change.replacement);
      addLocalSystemMessage(`Patched and staged <code>${escapeHtml(result.path)}</code>. Review, then run <code>/apply</code>.`);
    } catch (error) {
      addLocalSystemMessage(escapeHtml(error.message || 'Could not stage patch.'));
    }
  }

  function submitEditPrompt(path, instruction) {
    if (!path || !instruction) {
      showUsage(commandUsage('/edit'), 'This asks the model to produce a replacement for the named workspace file.');
      return;
    }
    const api = runtime();
    if (typeof api.submitPrompt !== 'function') {
      addLocalSystemMessage('The chat submit hook is unavailable on this page.');
      return;
    }
    const prompt = `Edit ${path}.\n\nRequest: ${instruction}\n\nReturn the edits as one or more SEARCH/REPLACE blocks. Use this exact format:\n<<<<<<< SEARCH\n[exact code to find]\n=======\n[code to replace with]\n>>>>>>>\nKeep the SEARCH blocks long enough to be unique.`;
    if (!api.submitPrompt(prompt)) addLocalSystemMessage('Could not submit the edit prompt.');
  }

  function submitPromptTool(commandName, args) {
    const tool = PROMPT_TOOLS[commandName];
    if (!tool) return false;
    const api = runtime();
    if (typeof api.submitPrompt !== 'function') {
      addLocalSystemMessage('The chat submit hook is unavailable on this page.');
      return true;
    }
    const prompt = `[Built-in tool: ${tool.title}]\n\n${tool.prompt(args)}`;
    if (!api.submitPrompt(prompt)) addLocalSystemMessage(`Could not submit ${escapeHtml(commandName)}.`);
    return true;
  }

  function renderPendingEdits() {
    const api = runtime();
    const edits = typeof api.getPendingEdits === 'function' ? api.getPendingEdits() : [];
    if (!edits.length) {
      addLocalSystemMessage('No file edits are staged.');
      return;
    }
    const lines = edits.map(edit => `<li><code>${escapeHtml(edit.path)}</code> (${fileSizeLabel(edit.size || 0)})</li>`).join('');
    addLocalSystemMessage(`<strong>Pending Edits</strong><ul>${lines}</ul>`);
  }

  function fileSizeLabel(value) {
    const size = Number(value || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }

  function completeOrExecuteFromDropdown(selected) {
    if (!selected) return;
    if (!selected.hasSubs && !selected.acceptsArgs) {
      hideDropdown();
      input.value = '';
      if (typeof window.updateInputHeight === 'function') window.updateInputHeight();
      window.executeSlashCommand(selected.name);
      return;
    }
    selectItem(activeIndex);
  }

  function submitCurrentCommand() {
    const commandText = input.value.trim();
    if (!commandText) return;
    hideDropdown();
    input.value = '';
    if (typeof window.updateInputHeight === 'function') window.updateInputHeight();
    window.executeSlashCommand(commandText);
  }

  function shouldExecuteCurrentCommand() {
    const selected = currentFilteredList[activeIndex];
    if (!selected) return false;
    if (selected.hasSubs && !selected.isSub) return false;
    return input.value.trim().toLowerCase() === selected.name.toLowerCase();
  }

  function positionDropdown() {
    if (!dropdown || !input) return;
    const shell = document.getElementById('composer-shell') || input;
    const rect = shell.getBoundingClientRect();
    const viewport = window.visualViewport || { width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0 };
    const margin = 8;
    const gap = 8;
    const maxWidth = Math.max(260, viewport.width - margin * 2);
    const width = Math.min(rect.width, maxWidth);
    const left = Math.min(Math.max(rect.left + (rect.width - width) / 2, viewport.offsetLeft + margin), viewport.offsetLeft + viewport.width - width - margin);
    const bottom = Math.max(margin, viewport.offsetTop + viewport.height - rect.top + gap);
    const availableAbove = Math.max(96, rect.top - viewport.offsetTop - margin - gap);
    dropdown.style.setProperty('--commands-left', `${Math.round(left)}px`);
    dropdown.style.setProperty('--commands-width', `${Math.round(width)}px`);
    dropdown.style.setProperty('--commands-bottom', `${Math.round(bottom)}px`);
    dropdown.style.setProperty('--commands-max-height', `${Math.round(Math.min(320, availableAbove))}px`);
  }

  function init() {
    input = document.getElementById('user-input');
    dropdown = document.getElementById('commands-dropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleOuterClick);
    window.addEventListener('resize', positionDropdown);
    window.addEventListener('scroll', positionDropdown, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', positionDropdown);
      window.visualViewport.addEventListener('scroll', positionDropdown);
    }
  }

  function handleInput() {
    const text = input.value;
    const pos = input.selectionStart;
    const textBeforeCursor = text.slice(0, pos);

    const match = textBeforeCursor.match(/(?:^|\s)\/([^\n]*)$/);
    if (!match) {
      hideDropdown();
      return;
    }

    const query = match[1];
    queryStartIndex = textBeforeCursor.lastIndexOf('/') + 1;

    const parts = query.split(/\s+/);
    const rootName = parts[0].trim().toLowerCase();

    const matchedRoot = COMMANDS.find(cmd => cmd.name === '/' + rootName);

    if (parts.length > 1 && matchedRoot && !matchedRoot.subcommands) {
      hideDropdown();
      return;
    }

    activeIndex = 0;

    if (parts.length > 1 && matchedRoot && matchedRoot.subcommands) {
      const subQuery = parts.slice(1).join(' ').trim().toLowerCase();
      currentFilteredList = matchedRoot.subcommands
        .filter(sub => sub.name.toLowerCase().startsWith(subQuery))
        .map(sub => ({
          name: matchedRoot.name + ' ' + sub.name,
          desc: sub.desc,
          isSub: true,
          acceptsArgs: !!sub.acceptsArgs,
          valueToInsert: matchedRoot.name + ' ' + sub.name + (sub.acceptsArgs ? ' ' : '')
        }));
    } else {
      currentFilteredList = COMMANDS.filter(cmd => 
        cmd.name.toLowerCase().substring(1).startsWith(rootName)
      ).map(cmd => ({
        name: cmd.name,
        desc: cmd.desc,
        hasSubs: !!cmd.subcommands,
        acceptsArgs: !!cmd.acceptsArgs,
        valueToInsert: cmd.name + (cmd.subcommands || cmd.acceptsArgs ? ' ' : '')
      }));
    }

    if (currentFilteredList.length > 0) {
      renderDropdown();
    } else {
      hideDropdown();
    }
  }

  function renderDropdown() {
    dropdown.innerHTML = '';
    activeIndex = Math.min(activeIndex, currentFilteredList.length - 1);
    if (activeIndex < 0) activeIndex = 0;

    currentFilteredList.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = `command-item ${index === activeIndex ? 'active' : ''}`;
      el.innerHTML = `
        <span class="command-name">${escapeHtml(item.name)}</span>
        <span class="command-desc">${escapeHtml(item.desc)}</span>
        ${item.hasSubs ? '<span class="command-chevron">&rsaquo;</span>' : ''}
      `;

      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeIndex = index;
        completeOrExecuteFromDropdown(item);
      });

      dropdown.appendChild(el);
    });

    positionDropdown();
    dropdown.classList.add('show');
  }

  function selectItem(index) {
    if (index < 0 || index >= currentFilteredList.length) return;
    const selected = currentFilteredList[index];
    const text = input.value;
    const pos = input.selectionStart;

    const beforeCommand = text.slice(0, queryStartIndex - 1);
    const afterCursor = text.slice(pos);

    input.value = beforeCommand + selected.valueToInsert + afterCursor;

    const newCursorPos = queryStartIndex - 1 + selected.valueToInsert.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    input.focus();

    if (typeof window.updateInputHeight === 'function') window.updateInputHeight();

    handleInput();
  }

  function handleKeyDown(e) {
    if (!dropdown.classList.contains('show')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentFilteredList.length;
      renderDropdown();
      scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentFilteredList.length) % currentFilteredList.length;
      renderDropdown();
      scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shouldExecuteCurrentCommand()) submitCurrentCommand();
      else selectItem(activeIndex);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      selectItem(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideDropdown();
    }
  }

  function scrollActiveIntoView() {
    const activeEl = dropdown.querySelector('.command-item.active');
    if (!activeEl) return;
    activeEl.scrollIntoView({ block: 'nearest' });
  }

  function handleOuterClick(e) {
    if (!dropdown.contains(e.target) && e.target !== input) {
      hideDropdown();
    }
  }

  function hideDropdown() {
    dropdown.classList.remove('show');
    activeIndex = 0;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.executeSlashCommand = async function(text) {
    const raw = text.trim();
    const parts = splitArgs(raw);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    if (cmd === '/clear') {
      if (typeof window.clearChat === 'function') window.clearChat();
      return;
    }

    if (cmd === '/help') {
      commandHelp();
      return;
    }

    if (cmd === '/tools') {
      renderBuiltInTools();
      return;
    }

    if (cmd === '/select') {
      const api = runtime();
      if (typeof api.openWorkspace === 'function') api.openWorkspace();
      else if (typeof window.openWorkspaceFromChat === 'function') window.openWorkspaceFromChat();
      return;
    }

    if (cmd === '/status') {
      renderWorkspaceStatus();
      return;
    }

    if (cmd === '/stats') {
      renderWorkspaceStats();
      return;
    }

    if (cmd === '/tree') {
      renderWorkspaceTree(args);
      return;
    }

    if (cmd === '/find') {
      await renderWorkspaceFind(args);
      return;
    }

    if (cmd === '/list') {
      renderWorkspaceList(args);
      return;
    }

    if (cmd === '/read') {
      await renderWorkspaceRead(args);
      return;
    }

    if (cmd === '/patch' || cmd === '/replace') {
      await stagePatch(cmd, raw);
      return;
    }

    if (cmd === '/write') {
      const parsed = parsePathAndRemainder(raw, '/write');
      stageWrite(parsed.path, parsed.rest);
      return;
    }

    if (cmd === '/append') {
      const parsed = parsePathAndRemainder(raw, '/append');
      await stageAppend(parsed.path, parsed.rest);
      return;
    }

    if (cmd === '/edit') {
      const parsed = parsePathAndRemainder(raw, '/edit');
      submitEditPrompt(parsed.path, parsed.rest);
      return;
    }

    if (cmd === '/context') {
      await renderContextPreview(args);
      return;
    }

    if (cmd === '/apply') {
      const api = runtime();
      if (typeof api.applyPendingEdits === 'function') api.applyPendingEdits();
      else addLocalSystemMessage('Apply is unavailable on this page.');
      return;
    }

    if (cmd === '/pending') {
      renderPendingEdits();
      return;
    }

    if (submitPromptTool(cmd, args)) {
      return;
    }

    if (cmd === '/model') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'list') {
        const select = document.getElementById('model-select');
        const models = Array.from(select ? select.options : []).map(o => o.value);
        if (models.length === 0) {
          addLocalSystemMessage('No models loaded.');
        } else {
          addLocalSystemMessage('<strong>Loaded Models:</strong><br>' + models.map(m => `- <code>${escapeHtml(m)}</code>`).join('<br>'));
        }
      } else if (sub === 'select') {
        const targetModel = parts.slice(2).join(' ').trim();
        const select = document.getElementById('model-select');
        if (!targetModel) {
          showUsage('/model select <model-name>');
          return;
        }
        const option = Array.from(select ? select.options : []).find(o => 
          o.value.toLowerCase().includes(targetModel.toLowerCase()) || 
          targetModel.toLowerCase().includes(o.value.toLowerCase())
        );
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change'));
          addLocalSystemMessage(`Switched active model to: <code>${escapeHtml(option.value)}</code>`);
        } else {
          addLocalSystemMessage(`Model <code>${escapeHtml(targetModel)}</code> not found in loaded models list.`);
        }
      } else {
        showUsage('/model list');
        addLocalSystemMessage('Also available: <code>/model select &lt;name&gt;</code>');
      }
      return;
    }

    if (cmd === '/workspace') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'select') {
        const api = runtime();
        if (typeof api.openWorkspace === 'function') api.openWorkspace();
        else if (typeof window.openWorkspaceFromChat === 'function') window.openWorkspaceFromChat();
      } else if (sub === 'list') {
        renderWorkspaceList(parts.slice(2).join(' '));
      } else if (sub === 'read') {
        await renderWorkspaceRead(parts.slice(2).join(' '));
      } else if (sub === 'find') {
        await renderWorkspaceFind(parts.slice(2).join(' '));
      } else if (sub === 'tree') {
        renderWorkspaceTree(parts.slice(2).join(' '));
      } else if (sub === 'stats') {
        renderWorkspaceStats();
      } else if (sub === 'clear') {
        const api = runtime();
        if (typeof api.clearWorkspace === 'function') {
          await api.clearWorkspace();
        }
      } else if (sub === 'status') {
        renderWorkspaceStatus();
      } else {
        addLocalSystemMessage('Usage:<br><code>/workspace select</code><br><code>/workspace list [filter]</code><br><code>/workspace read &lt;path&gt;</code><br><code>/workspace find &lt;term&gt;</code><br><code>/workspace tree [filter]</code><br><code>/workspace stats</code><br><code>/workspace status</code><br><code>/workspace clear</code>');
      }
      return;
    }

    if (cmd === '/system') {
      const sub = parts[1]?.toLowerCase();
      const promptText = parts.slice(2).join(' ').trim();
      const textarea = document.getElementById('system-prompt');
      
      if (sub === 'set') {
        if (!promptText) {
          showUsage('/system set <prompt>');
          return;
        }
        if (textarea) {
          textarea.value = promptText;
          textarea.dispatchEvent(new Event('input'));
          if (window.settings) {
            window.settings.systemPrompt = promptText;
            if (typeof saveSettings === 'function') saveSettings();
          }
          addLocalSystemMessage(`System prompt set to: "${escapeHtml(promptText)}"`);
        }
      } else if (sub === 'clear') {
        if (textarea) {
          textarea.value = '';
          textarea.dispatchEvent(new Event('input'));
          if (window.settings) {
            window.settings.systemPrompt = '';
            if (typeof saveSettings === 'function') saveSettings();
          }
          addLocalSystemMessage('System prompt cleared.');
        }
      } else if (sub === 'reset') {
        if (textarea) {
          textarea.value = 'You are a helpful assistant.';
          textarea.dispatchEvent(new Event('input'));
          if (window.settings) {
            window.settings.systemPrompt = 'You are a helpful assistant.';
            if (typeof saveSettings === 'function') saveSettings();
          }
          addLocalSystemMessage('System prompt reset to default (<em>You are a helpful assistant.</em>).');
        }
      } else {
        addLocalSystemMessage('Usage:<br><code>/system set &lt;prompt&gt;</code><br><code>/system clear</code><br><code>/system reset</code>');
      }
      return;
    }

    if (cmd === '/web') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'search') {
        const query = parts.slice(2).join(' ').trim();
        if (!query) {
          showUsage('/web search <query>');
          return;
        }
        addLocalSystemMessage(`Performing web search for: "${escapeHtml(query)}"...`);
        if (window.LmStudioLiteWebSearch && typeof window.LmStudioLiteWebSearch.search === 'function') {
          try {
            const payload = await window.LmStudioLiteWebSearch.search(query);
            const formatted = typeof window.LmStudioLiteWebSearch.formatForPrompt === 'function'
              ? window.LmStudioLiteWebSearch.formatForPrompt(payload)
              : JSON.stringify(payload, null, 2);
            addLocalSystemMessage(`<strong>Web Search Results</strong><pre><code>${escapeHtml(formatted)}</code></pre>`);
          } catch (error) {
            addLocalSystemMessage(`Web search failed: ${escapeHtml(error.message || String(error))}`);
          }
        } else {
          addLocalSystemMessage('Web search helper is not loaded or configured.');
        }
      } else if (sub === 'toggle') {
        const helperBtn = document.getElementById('context-helper-toggle');
        if (helperBtn) {
          helperBtn.click();
          const state = helperBtn.textContent.includes('On') ? 'Enabled' : 'Disabled';
          addLocalSystemMessage(`Workspace context helper toggle triggered: <strong>${state}</strong>`);
        } else {
          addLocalSystemMessage('Context helper control not found.');
        }
      } else {
        addLocalSystemMessage('Usage:<br><code>/web search &lt;query&gt;</code><br><code>/web toggle</code>');
      }
      return;
    }

    if (cmd === '/mcp') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'status') {
        addLocalSystemMessage('MCP status checks not available locally.');
      } else if (sub === 'reload') {
        addLocalSystemMessage('MCP reloading...');
      } else {
        addLocalSystemMessage('Usage:<br><code>/mcp status</code><br><code>/mcp reload</code>');
      }
      return;
    }

    addLocalSystemMessage(`Unknown command: <code>${cmd}</code>. Type <code>/help</code> for available commands.`);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
