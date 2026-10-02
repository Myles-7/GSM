const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../server/src/core');
const violations = [];
function visit(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\b(?:window|document|localStorage|indexedDB|electronAPI)\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))) violations.push(file + ': browser runtime dependency');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)) {
    if (match[2] === 'zod') continue;
    if (!match[2].startsWith('./')) violations.push(file + ': external import ' + match[2]);
    else if (!path.resolve(path.dirname(file), match[2]).startsWith(root + path.sep)) violations.push(file + ': escapes core');
  }
}
for (const file of fs.readdirSync(root)) if (file.endsWith('.ts')) visit(path.join(root, file));
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log('Shared AI core has no frontend/runtime dependencies.');
