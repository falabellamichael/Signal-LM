const fs = require('fs');
const path = require('path');

function getBodyContent(htmlStr) {
  const mainMatch = htmlStr.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return mainMatch ? mainMatch[1] : '';
}

const dirs = [
  __dirname,
  path.join(__dirname, 'SignalLM-Android', 'app', 'src', 'main', 'assets')
];

for (const dir of dirs) {
  const indexHtmlPath = path.join(dir, 'index.html');
  const editorHtmlPath = path.join(dir, 'editor.html');
  const mcpHtmlPath = path.join(dir, 'mcp.html');
  const settingsHtmlPath = path.join(dir, 'settings.html');

  if (!fs.existsSync(indexHtmlPath)) continue;

  let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  // If already merged, skip
  if (indexHtml.includes('id="view-chat"')) continue;

  const editorHtml = fs.readFileSync(editorHtmlPath, 'utf8');
  const mcpHtml = fs.readFileSync(mcpHtmlPath, 'utf8');
  const settingsHtml = fs.readFileSync(settingsHtmlPath, 'utf8');

  const editorContent = getBodyContent(editorHtml);
  const mcpContent = getBodyContent(mcpHtml);
  const settingsContent = getBodyContent(settingsHtml);

  // Replace <main class="main-chat"> with <main class="main-app">
  indexHtml = indexHtml.replace(/<main class="main-chat">([\s\S]*?)<\/main>/i, function(match, p1) {
    return `<main class="main-app">
      <div id="view-chat" class="app-view active">
        ${p1}
      </div>
      <div id="view-editor" class="app-view" style="display:none;">
        ${editorContent}
      </div>
      <div id="view-mcp" class="app-view" style="display:none;">
        ${mcpContent}
      </div>
      <div id="view-settings" class="app-view" style="display:none;">
        ${settingsContent}
      </div>
    </main>`;
  });

  // Update nav links
  indexHtml = indexHtml.replace(/href="index\.html"/g, 'href="#chat"');
  indexHtml = indexHtml.replace(/href="editor\.html"/g, 'href="#editor"');
  indexHtml = indexHtml.replace(/href="mcp\.html"/g, 'href="#mcp"');
  indexHtml = indexHtml.replace(/href="settings\.html"/g, 'href="#settings"');

  // Update script tags: add the others
  indexHtml = indexHtml.replace('</body>', `
  <script src="editor.js"></script>
  <script src="mcp.js"></script>
  <script src="settings.js"></script>
  <script src="signal-lm-mcp-file-path.js"></script>
  <script>
    // SPA Router
    function handleRouting() {
      const hash = window.location.hash || '#chat';
      const views = document.querySelectorAll('.app-view');
      views.forEach(v => {
        v.style.display = 'none';
        v.classList.remove('active');
      });
      
      const targetView = document.getElementById('view-' + hash.substring(1));
      if (targetView) {
        targetView.style.display = 'block';
        targetView.classList.add('active');
      } else {
        document.getElementById('view-chat').style.display = 'block';
        document.getElementById('view-chat').classList.add('active');
      }

      // Update active nav link
      document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('href') === hash) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
      
      // Toggle sidebar on mobile when navigating
      if (typeof window.toggleSidebar === 'function') {
        window.toggleSidebar(false);
      }
    }
    window.addEventListener('hashchange', handleRouting);
    document.addEventListener('DOMContentLoaded', handleRouting);
  </script>
</body>`);

  // Add the additional CSS files to the head
  indexHtml = indexHtml.replace('</head>', `
  <link rel="stylesheet" href="editor.css">
  <link rel="stylesheet" href="mcp.css">
  <link rel="stylesheet" href="settings.css">
</head>`);

  fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
  console.log('Merged HTML in ' + dir);
}
