const fs = require('fs');

// Check index.html for duplicate IDs
console.log("=== Checking index.html ===");
const html = fs.readFileSync('index.html', 'utf8');
const idMatches = html.match(/id=(['"])(.*?)\1/g) || [];
const ids = idMatches.map(m => m.split(/['"]/)[1]);

console.log(`Total IDs found: ${ids.length}`);
const duplicates = new Set();
ids.forEach(id => {
  if (ids.indexOf(id) !== id) duplicates.add(id);
});

if (duplicates.size > 0) {
  console.log('DUPLICATES FOUND:');
  [...duplicates].sort().forEach(dup => console.log(`  - ${dup}`));
} else {
  console.log('No duplicate IDs found in index.html');
}

// Check for duplicate class names
console.log("\n=== Checking for duplicate classes ===");
const classMatches = html.match(/class=["']([^"']*)["']/g) || [];
const classNames = classMatches.map(m => m.split(/["']/)[1]);
const classDuplicates = new Set();
classNames.forEach(cls => {
  if (classNames.indexOf(cls) !== classNames.lastIndexOf(cls)) classDuplicates.add(cls);
});

if (classDuplicates.size > 0) {
  console.log(`Classes with duplicates: ${classDuplicates.size}`);
  [...classDuplicates].sort().slice(0, 20).forEach(dup => console.log(`  - ${dup}`));
} else {
  console.log('No duplicate classes found');
}
