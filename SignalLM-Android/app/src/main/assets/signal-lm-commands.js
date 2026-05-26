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
      name: '/write',
      desc: 'Stage a complete file replacement for review',
      acceptsArgs: true,
      usage: '/write path/to/file.txt replacement text'
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
    const prompt = `Edit ${path}.\n\nRequest: ${instruction}\n\nReturn a complete replacement for ${path} in a fenced code block whose language/header is the relative file path. Preserve unrelated behavior.`;
    if (!api.submitPrompt(prompt)) addLocalSystemMessage('Could not submit the edit prompt.');
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

    if (cmd === '/list') {
      renderWorkspaceList(args);
      return;
    }

    if (cmd === '/read') {
      await renderWorkspaceRead(args);
      return;
    }

    if (cmd === '/write') {
      const parsed = parsePathAndRemainder(raw, '/write');
      stageWrite(parsed.path, parsed.rest);
      return;
    }

    if (cmd === '/edit') {
      const parsed = parsePathAndRemainder(raw, '/edit');
      submitEditPrompt(parsed.path, parsed.rest);
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
      } else if (sub === 'clear') {
        const api = runtime();
        if (typeof api.clearWorkspace === 'function') {
          await api.clearWorkspace();
        }
      } else if (sub === 'status') {
        renderWorkspaceStatus();
      } else {
        addLocalSystemMessage('Usage:<br><code>/workspace select</code><br><code>/workspace list [filter]</code><br><code>/workspace read &lt;path&gt;</code><br><code>/workspace status</code><br><code>/workspace clear</code>');
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
        if (window.LmStudioLiteWebSearch && typeof window.LmStudioLiteWebSearch.performSearch === 'function') {
          window.LmStudioLiteWebSearch.performSearch(query);
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
