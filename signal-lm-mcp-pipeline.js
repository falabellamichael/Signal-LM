(function () {
  if (window.SignalLMMcpPipeline) return;

  const SETTINGS_KEY = 'lmStudioLite.settings.v1';
  const DEFAULT_STEPS = ['web-search', 'workspace-context', 'mcp-integrations', 'model-response', 'file-edits'];

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeSettings(next) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {})); }
  function savePipelineSettings(next) { const settings = readSettings(); Object.assign(settings, next || {}); writeSettings(settings); return settings; }
  function pipelineEnabled() { return readSettings().mcpPipelineEnabled !== false; }
  function pipelineSteps() { const settings = readSettings(); return Array.isArray(settings.mcpPipelineSteps) && settings.mcpPipelineSteps.length ? settings.mcpPipelineSteps : DEFAULT_STEPS.slice(); }
  function stepIsEnabled(step) { return pipelineEnabled() && pipelineSteps().includes(step); }
  function setStepEnabled(step, enabled) { const current = new Set(pipelineSteps()); if (enabled) current.add(step); else current.delete(step); const ordered = DEFAULT_STEPS.filter(item => current.has(item)); savePipelineSettings({ mcpPipelineSteps: ordered }); return ordered; }
  function getMcpServers() { const settings = readSettings(); return Array.isArray(settings.mcpServers) ? settings.mcpServers : []; }
  function enabledMcpServers() { return getMcpServers().filter(server => server && server.enabled !== false); }

  function stepStatus(step) {
    const settings = readSettings();
    const active = stepIsEnabled(step);
    if (step === 'web-search') return { step, active: active && settings.webSearchEnabled !== false, label: 'Built-in Web Search', detail: settings.webSearchEnabled === false ? 'Disabled' : settings.webSearchAuto === false ? 'Manual slash commands only' : 'Auto + slash commands' };
    if (step === 'workspace-context') return { step, active: active && settings.contextHelperEnabled !== false, label: 'Workspace Context Helper', detail: settings.contextHelperEnabled === false ? 'Disabled' : `Mode: ${settings.contextHelperMode || 'smart'}` };
    if (step === 'mcp-integrations') { const count = enabledMcpServers().length; return { step, active: active && Boolean(settings.mcpEnabled) && count > 0, label: 'MCP Integrations', detail: settings.mcpEnabled ? `${count} enabled integration${count === 1 ? '' : 's'}` : 'MCP disabled' }; }
    if (step === 'model-response') return { step, active, label: 'Model Response', detail: settings.model ? `Model: ${settings.model}` : 'No model selected' };
    if (step === 'file-edits') return { step, active, label: 'File Edit Detection', detail: 'Detects fenced JSON edit blocks after model response' };
    return { step, active, label: step, detail: '' };
  }

  function pipelineReport() { return DEFAULT_STEPS.map(stepStatus); }

  function formatPipelineContext(userText, executedOutputs) {
    if (!pipelineEnabled()) return '';
    const lines = ['[MCP TOOL PIPELINE]', 'Purpose: This app runs local tools in a deliberate order before/around the model request.', 'User request: ' + String(userText || '').slice(0, 600), 'Pipeline steps:'];
    pipelineReport().forEach((item, index) => lines.push(`${index + 1}. ${item.label}: ${item.active ? 'active' : 'inactive'} — ${item.detail}`));
    if (Array.isArray(executedOutputs) && executedOutputs.length) {
      lines.push('', 'Executed tool outputs:');
      executedOutputs.forEach(output => lines.push(output));
    }
    lines.push('Guidance: use executed tool outputs above. Do not claim a tool result exists unless it appears in this request context.');
    lines.push('[END MCP TOOL PIPELINE]');
    return lines.join('\n');
  }

  async function runWebSearchStep(userText) {
    const settings = readSettings();
    if (!stepIsEnabled('web-search') || settings.webSearchEnabled === false || !window.SignalLMWebSearch) return '';
    if (!window.SignalLMWebSearch.shouldSearch(userText)) return '';
    try {
      const payload = await window.SignalLMWebSearch.search(userText);
      const formatted = window.SignalLMWebSearch.formatForPrompt(payload);
      return ['[PIPELINE TOOL OUTPUT: BUILT-IN WEB SEARCH]', formatted, '[END PIPELINE TOOL OUTPUT: BUILT-IN WEB SEARCH]'].join('\n');
    } catch (error) {
      return '[PIPELINE TOOL OUTPUT: BUILT-IN WEB SEARCH]\nSearch failed: ' + (error.message || error) + '\n[END PIPELINE TOOL OUTPUT: BUILT-IN WEB SEARCH]';
    }
  }

  async function buildExecutedContext(userText) {
    if (!pipelineEnabled()) return '';
    const outputs = [];
    const webOutput = await runWebSearchStep(userText);
    if (webOutput) outputs.push(webOutput);
    return formatPipelineContext(userText, outputs);
  }

  function installChatPatch() {
    if (window.__signalLmMcpPipelineChatPatch || typeof window.collectWorkspaceContextForPrompt !== 'function') return;
    window.__signalLmMcpPipelineChatPatch = true;
    const previous = window.collectWorkspaceContextForPrompt;
    window.collectWorkspaceContextForPrompt = async function (userText) {
      const pipeline = await buildExecutedContext(userText);
      const existing = await previous.apply(this, arguments);
      return [pipeline, existing].filter(Boolean).join('\n\n');
    };
  }

  function isMcpPage() { return /(^|\/)mcp\.html$/i.test(location.pathname) || Boolean(document.querySelector('a.nav-link.active[href="mcp.html"]')); }
  function escapeHtml(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }

  function renderStepRows(card) {
    const steps = new Set(pipelineSteps());
    const list = card.querySelector('#mcp-pipeline-steps');
    list.innerHTML = DEFAULT_STEPS.map(step => { const status = stepStatus(step); const locked = step === 'model-response'; return `<div class="switch-row" data-pipeline-step="${escapeHtml(step)}"><div><strong>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.detail)}</p></div><input type="checkbox" ${steps.has(step) ? 'checked' : ''} ${locked ? 'disabled' : ''} data-step-toggle="${escapeHtml(step)}" /></div>`; }).join('');
    list.querySelectorAll('[data-step-toggle]').forEach(input => input.addEventListener('change', event => { setStepEnabled(event.target.dataset.stepToggle, event.target.checked); renderStepRows(card); updatePreview(card); }));
  }

  async function updatePreview(card) {
    const query = card.querySelector('#mcp-pipeline-test-query')?.value || 'Explain the current project status.';
    const preview = card.querySelector('#mcp-pipeline-preview');
    preview.textContent = 'Running pipeline preview...';
    preview.textContent = await buildExecutedContext(query);
  }

  function installMcpPanel() {
    if (window.__signalLmMcpPipelinePanel || !isMcpPage()) return;
    const grid = document.querySelector('.grid');
    if (!grid) return;
    window.__signalLmMcpPipelinePanel = true;
    const settings = readSettings();
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2>MCP Tool Pipeline</h2><p class="hint">Runs local tool context before Chat sends the model request. Web search is an executed pipeline step, not just a label.</p><div class="switch-row"><div><strong>Enable pipeline</strong><p>Attach a compact report and real executed tool outputs to Chat requests.</p></div><input id="mcp-pipeline-enabled" type="checkbox" ${settings.mcpPipelineEnabled === false ? '' : 'checked'} /></div><div id="mcp-pipeline-steps"></div><div class="input-group"><label for="mcp-pipeline-test-query">Pipeline Preview Prompt</label><input id="mcp-pipeline-test-query" value="/web latest LM Studio release" /></div><div class="button-row"><button class="ghost-btn" type="button" id="mcp-pipeline-preview-btn">Run Pipeline Preview</button></div><pre class="preview" id="mcp-pipeline-preview"></pre>`;
    const firstColumn = grid.firstElementChild || grid;
    firstColumn.insertBefore(card, firstColumn.children[0] || null);
    const enabledInput = card.querySelector('#mcp-pipeline-enabled');
    enabledInput.addEventListener('change', () => { savePipelineSettings({ mcpPipelineEnabled: enabledInput.checked }); renderStepRows(card); updatePreview(card); });
    card.querySelector('#mcp-pipeline-preview-btn').addEventListener('click', () => updatePreview(card));
    card.querySelector('#mcp-pipeline-test-query').addEventListener('input', () => updatePreview(card));
    renderStepRows(card);
    updatePreview(card);
  }

  function installWhenReady() { installChatPatch(); installMcpPanel(); }
  window.SignalLMMcpPipeline = { readSettings, savePipelineSettings, pipelineEnabled, pipelineSteps, setStepEnabled, pipelineReport, formatPipelineContext, buildExecutedContext, runWebSearchStep, installChatPatch, installMcpPanel };
  const timer = setInterval(installWhenReady, 200);
  setTimeout(() => clearInterval(timer), 6000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady); else installWhenReady();
})();
