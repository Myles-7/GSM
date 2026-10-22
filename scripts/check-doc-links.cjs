'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(file => file.endsWith('.md') && fs.existsSync(path.join(root, file)));
const failures = [];
let links = 0;
for (const file of new Set(files)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  for (const match of source.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\)/g)) {
    const href = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
    const relative = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!relative) continue;
    const target = relative.startsWith('/') ? path.resolve(root, '.' + relative) : path.resolve(root, path.dirname(file), relative);
    links++;
    if (!fs.existsSync(target)) failures.push(`${file}: ${href}`);
  }
}
if (failures.length) {
  console.error(`Broken local documentation links (${failures.length}):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else console.log(`Documentation: ${files.length} Markdown files, ${links} local links checked.`);
