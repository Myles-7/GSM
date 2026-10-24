'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Test fixtures and runner configuration are not application entry points.
function isApplicationSource(file) {
  return /\.[cm]?[jt]sx?$/.test(file)
    && !/(?:^|\/)(?:test|__tests__|__fixtures__)\//.test(file)
    && !/\.(?:test|spec|fixture|test-support|vitest\.config|d)\.[cm]?[jt]sx?$/.test(file)
    && !/(?:^|\/)testFixtures\.[jt]sx?$/.test(file);
}

function checkReachability(root, entries = ['src/main.tsx']) {
  root = path.resolve(root);
  const files = new Set();
  function collect(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) collect(full);
      else if (item.isFile()) {
        const file = path.relative(root, full).replaceAll('\\', '/');
        if (isApplicationSource(file)) files.add(file);
      }
    }
  }
  collect(path.join(root, 'src'));
  for (const entry of entries) if (!files.has(entry)) throw new Error(`Missing source entry: ${entry}`);
  const edges = new Map();
  const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX };
  for (const file of files) {
    const full = path.join(root, file);
    const ast = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);
    const dependencies = new Set();
    function visit(node) {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require') && ts.isStringLiteral(node.arguments[0] || {})) specifier = node.arguments[0].text;
      if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && ts.isStringLiteral(node.arguments?.[0] || {})) specifier = node.arguments[0].text;
      if (specifier?.startsWith('.')) {
        const resolved = ts.resolveModuleName(specifier, full, options, ts.sys).resolvedModule?.resolvedFileName;
        if (resolved) {
          const target = path.relative(root, resolved).replaceAll('\\', '/');
          if (files.has(target)) dependencies.add(target);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    edges.set(file, dependencies);
  }
  const reachable = new Set();
  function trace(file) {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const dependency of edges.get(file) || []) trace(dependency);
  }
  entries.forEach(trace);
  return { count: files.size, unreachable: [...files].filter(file => !reachable.has(file)).sort() };
}

if (require.main === module) {
  const result = checkReachability(path.resolve(__dirname, '..'));
  if (result.unreachable.length) {
    console.error(`Application modules unreachable from src/main.tsx:\n${result.unreachable.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Source reachability: ${result.count} application modules are reachable.`);
}
module.exports = { checkReachability, isApplicationSource };
