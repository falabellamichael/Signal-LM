const fs = require('fs');
const path = require('path');

const dirs = [
  __dirname,
  path.join(__dirname, 'SignalLM-Android', 'app', 'src', 'main', 'assets')
];

for (const dir of dirs) {
  for (const filename of ['editor.js', 'folders.js']) {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) continue;
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(/window\.location\.href\s*=\s*['"]index\.html['"];/g, "window.location.hash = '#chat'; window.dispatchEvent(new Event('workspaceSelected'));");
    fs.writeFileSync(p, content, 'utf8');
    console.log('Replaced in ' + p);
  }
}
