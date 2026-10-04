// The generated attachment must stay independent of desktop state and online execution.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['src/lib/html-reading/model.ts', 'src/lib/html-reading/render.ts', 'src/lib/html-reading/icons.ts', 'src/lib/html-reading/theme.ts', 'src/lib/repositoryReadingPresentation.ts'];
const violations = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)) {
    if (/^(react|react-dom|electron)(\/|$)|\/(store|services|features|hooks)\//.test(match[2])) violations.push(`${file}: ${match[2]}`);
  }
}
const runtime = fs.readFileSync(path.join(root, 'src/lib/html-reading/reader-runtime.txt'), 'utf8');
if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\belectronAPI\b/.test(runtime)) violations.push('The standalone reader contains a network or Electron dependency.');
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log('Standalone HTML reader has no desktop state, execution or network dependency.');
