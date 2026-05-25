const fs = require('fs');
const path = require('path');
const https = require('https');

const PRISM_VERSION = '1.29.0';
const BASE_URL = `https://cdnjs.cloudflare.com/ajax/libs/prism/${PRISM_VERSION}`;

const JS_FILES = [
  `${BASE_URL}/components/prism-core.min.js`,
  `${BASE_URL}/plugins/line-numbers/prism-line-numbers.min.js`,
  `${BASE_URL}/components/prism-markup.min.js`,
  `${BASE_URL}/components/prism-css.min.js`,
  `${BASE_URL}/components/prism-clike.min.js`,
  `${BASE_URL}/components/prism-javascript.min.js`,
  `${BASE_URL}/components/prism-json.min.js`,
  `${BASE_URL}/components/prism-python.min.js`,
  `${BASE_URL}/components/prism-typescript.min.js`,
  `${BASE_URL}/components/prism-java.min.js`,
  `${BASE_URL}/components/prism-c.min.js`,
  `${BASE_URL}/components/prism-cpp.min.js`,
  `${BASE_URL}/components/prism-csharp.min.js`,
  `${BASE_URL}/components/prism-rust.min.js`,
  `${BASE_URL}/components/prism-go.min.js`,
  `${BASE_URL}/components/prism-bash.min.js`,
  `${BASE_URL}/components/prism-sql.min.js`,
  `${BASE_URL}/components/prism-yaml.min.js`
];

const CSS_FILES = [
  `${BASE_URL}/themes/prism-tomorrow.min.css`,
  `${BASE_URL}/plugins/line-numbers/prism-line-numbers.min.css`
];

function fetchContent(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url} (status ${res.statusCode})`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function build() {
  console.log('Downloading JS files...');
  let jsContent = '';
  for (const url of JS_FILES) {
    console.log(`- ${url}`);
    jsContent += await fetchContent(url) + '\n';
  }

  console.log('Downloading CSS files...');
  let cssContent = '';
  for (const url of CSS_FILES) {
    console.log(`- ${url}`);
    cssContent += await fetchContent(url) + '\n';
  }

  const libsDir = path.join(__dirname, 'libs');
  const androidLibsDir = path.join(__dirname, 'SignalLM-Android', 'app', 'src', 'main', 'assets', 'libs');

  if (!fs.existsSync(libsDir)) fs.mkdirSync(libsDir, { recursive: true });
  if (!fs.existsSync(androidLibsDir)) fs.mkdirSync(androidLibsDir, { recursive: true });

  fs.writeFileSync(path.join(libsDir, 'prism.js'), jsContent);
  fs.writeFileSync(path.join(libsDir, 'prism.css'), cssContent);

  fs.writeFileSync(path.join(androidLibsDir, 'prism.js'), jsContent);
  fs.writeFileSync(path.join(androidLibsDir, 'prism.css'), cssContent);

  console.log('PrismJS successfully bundled and saved to both libs directories!');
}

build().catch(console.error);
