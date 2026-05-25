(function () {
  const COMMANDS = [
    {
      name: '/model',
      desc: 'Select or manage LLM models',
      subcommands: [
        { name: 'list', desc: 'List all loaded/available models' },
        { name: 'select', desc: 'Select active model by name' }
      ]
    },
    {
      name: '/workspace',
      desc: 'Manage workspace context files',
      subcommands: [
        { name: 'select', desc: 'Select a folder from device' },
        { name: 'clear', desc: 'Clear loaded workspace files' },
        { name: 'status', desc: 'Show workspace file counts & status' }
      ]
    },
    {
      name: '/system',
      desc: 'Configure system prompt message',
      subcommands: [
        { name: 'set', desc: 'Set system instructions prompt' },
        { name: 'clear', desc: 'Remove system instruction prompt' },
        { name: 'reset', desc: 'Reset system prompt to default' }
      ]
    },
    {
      name: '/clear',
      desc: 'Clear active chat message history',
      action: () => { if (typeof clearChat === 'function') clearChat(); }
    },
    {
      name: '/help',
      desc: 'Show available slash commands documentation',
      action: () => {
        if (typeof showToast === 'function') showToast('Type / followed by a command to execute actions.');
      }
    },
    {
      name: '/web',
      desc: 'DuckDuckGo web search helper settings',
      subcommands: [
        { name: 'search', desc: 'Perform search query' },
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
    }
  ];

  let dropdown = null;
  let input = null;
  let activeIndex = 0;
  let currentFilteredList = [];
  let queryStartIndex = -1;

  function init() {
    input = document.getElementById('user-input');
    dropdown = document.getElementById('commands-dropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleOuterClick);
  }

  function handleInput() {
    const text = input.value;
    const pos = input.selectionStart;
    const textBeforeCursor = text.slice(0, pos);

    const match = textBeforeCursor.match(/(?:^|\s)\/([\w\s]*)$/);
    if (!match) {
      hideDropdown();
      return;
    }

    const query = match[1];
    queryStartIndex = textBeforeCursor.lastIndexOf('/') + 1;

    const parts = query.split(/\s+/);
    const rootName = parts[0].trim().toLowerCase();

    const matchedRoot = COMMANDS.find(cmd => cmd.name === '/' + rootName);

    if (parts.length > 1 && matchedRoot && matchedRoot.subcommands) {
      const subQuery = parts.slice(1).join(' ').trim().toLowerCase();
      currentFilteredList = matchedRoot.subcommands
        .filter(sub => sub.name.toLowerCase().startsWith(subQuery))
        .map(sub => ({
          name: matchedRoot.name + ' ' + sub.name,
          desc: sub.desc,
          isSub: true,
          valueToInsert: matchedRoot.name + ' ' + sub.name + ' '
        }));
    } else {
      currentFilteredList = COMMANDS.filter(cmd => 
        cmd.name.toLowerCase().substring(1).startsWith(rootName)
      ).map(cmd => ({
        name: cmd.name,
        desc: cmd.desc,
        hasSubs: !!cmd.subcommands,
        valueToInsert: cmd.name + (cmd.subcommands ? ' ' : ' ')
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
        ${item.hasSubs ? '<span class="command-chevron">→</span>' : ''}
      `;

      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectItem(index);
      });

      dropdown.appendChild(el);
    });

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

    if (typeof updateInputHeight === 'function') updateInputHeight();

    const foundRoot = COMMANDS.find(cmd => cmd.name === selected.name);
    if (foundRoot && foundRoot.action) {
      if (selected.name === '/clear' || selected.name === '/help') {
        input.value = beforeCommand + afterCursor;
        const finalCursorPos = queryStartIndex - 1;
        input.setSelectionRange(finalCursorPos, finalCursorPos);
      }
      foundRoot.action();
    }

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
      e.stopImmediatePropagation();
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
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function addLocalSystemMessage(htmlContent) {
    if (typeof addMessage === 'function') {
      const msg = addMessage('ai', '');
      msg.bubble.innerHTML = `<div style="font-family: sans-serif; font-size: 0.92rem; line-height: 1.5;">${htmlContent}</div>`;
      const meta = msg.row.querySelector('.message-meta');
      if (meta) meta.remove();
    }
  }

  window.executeSlashCommand = function(text) {
    const raw = text.trim();
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    if (cmd === '/clear') {
      if (typeof clearChat === 'function') clearChat();
      return;
    }

    if (cmd === '/help') {
      const helpLines = [
        '<strong>Available Slash Commands:</strong>',
        ...COMMANDS.map(c => {
          let line = `- <code>${c.name}</code>: ${c.desc}`;
          if (c.subcommands) {
            line += `<br><small style="margin-left: 20px; opacity: 0.85;">Subcommands: ${c.subcommands.map(s => `<code>${s.name}</code>`).join(', ')}</small>`;
          }
          return line;
        })
      ];
      addLocalSystemMessage(helpLines.join('<br>'));
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
          addLocalSystemMessage('<strong>Loaded Models:</strong><br>' + models.map(m => `- <code>${m}</code>`).join('<br>'));
        }
      } else if (sub === 'select') {
        const targetModel = parts.slice(2).join(' ').trim();
        const select = document.getElementById('model-select');
        if (!targetModel) {
          addLocalSystemMessage('Usage: <code>/model select &lt;model-name&gt;</code>');
          return;
        }
        const option = Array.from(select ? select.options : []).find(o => 
          o.value.toLowerCase().includes(targetModel.toLowerCase()) || 
          targetModel.toLowerCase().includes(o.value.toLowerCase())
        );
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change'));
          addLocalSystemMessage(`Switched active model to: <code>${option.value}</code>`);
        } else {
          addLocalSystemMessage(`Model <code>${targetModel}</code> not found in loaded models list.`);
        }
      } else {
        addLocalSystemMessage('Usage:<br><code>/model list</code><br><code>/model select &lt;name&gt;</code>');
      }
      return;
    }

    if (cmd === '/workspace') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'select') {
        if (typeof openWorkspaceFromChat === 'function') openWorkspaceFromChat();
      } else if (sub === 'clear') {
        if (typeof clearWorkspace === 'function') {
          clearWorkspace();
          addLocalSystemMessage('Workspace cleared.');
        }
      } else if (sub === 'status') {
        const nameEl = document.getElementById('workspace-name');
        const count = window.workspaceFiles ? window.workspaceFiles.length : 0;
        const name = nameEl ? nameEl.textContent : 'No folder loaded';
        addLocalSystemMessage(`<strong>Workspace Status:</strong><br>- Path: <code>${name}</code><br>- Files: ${count} loaded`);
      } else {
        addLocalSystemMessage('Usage:<br><code>/workspace select</code><br><code>/workspace clear</code><br><code>/workspace status</code>');
      }
      return;
    }

    if (cmd === '/system') {
      const sub = parts[1]?.toLowerCase();
      const promptText = parts.slice(2).join(' ').trim();
      const textarea = document.getElementById('system-prompt');
      
      if (sub === 'set') {
        if (!promptText) {
          addLocalSystemMessage('Usage: <code>/system set &lt;prompt&gt;</code>');
          return;
        }
        if (textarea) {
          textarea.value = promptText;
          textarea.dispatchEvent(new Event('input'));
          if (window.settings) {
            window.settings.systemPrompt = promptText;
            if (typeof saveSettings === 'function') saveSettings();
          }
          addLocalSystemMessage(`System prompt set to: "${promptText}"`);
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
          addLocalSystemMessage('Usage: <code>/web search &lt;query&gt;</code>');
          return;
        }
        addLocalSystemMessage(`Performing web search for: "${query}"...`);
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
