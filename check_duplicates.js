const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const idMatches = html.match(/id=(['"])(.*?)\1/g) || [];
const ids = idMatches.map(m => m.split(/['"]/)[1]);
const duplicates = ids.filter((item, index) => ids.indexOf(item) !== index);
console.log('Duplicates:', new Set(duplicates));
