const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const directory = path.resolve(__dirname, '../../examples/plugins/repo-insights/ui');

function fixture(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'plugin-page://com.githubstarsmanager.repo-insights/insights/index.html' });
  t.after(() => dom.window.close());
  const rafs = new Map();
  let next = 0;
  dom.window.requestAnimationFrame = callback => { rafs.set(++next, callback); return next; };
  dom.window.cancelAnimationFrame = id => rafs.delete(id);
  class Chart {
    static defaults = { font: {} };
    constructor(canvas, config) { this.canvas = canvas; this.config = config; this.resizes = 0; }
    destroy() { this.canvas = null; }
    resize() { assert.ok(this.canvas); this.resizes++; }
  }
  dom.window.Chart = Chart;
  const expose = `globalThis.fixture = { state, drawChart, charts, readCache, writeCache, cacheKey,
    renderCommits, renderChurn, renderLanguages, renderContributors, renderAdvisories, renderRadar,
    computeBusFactor, markSectionError, buildAiPrompt, setRequest: fn => { request = fn; } }; })();`;
  dom.window.eval(fs.readFileSync(path.join(directory, 'index.js'), 'utf8').replace(/\}\)\(\);\s*$/, expose));
  return { ...dom.window.fixture, window: dom.window, rafs };
}

test('Insights cancels stale chart resize callbacks across redraw, minimize/restore and removed canvases', t => {
  const p = fixture(t);
  const id = 'card-commits-canvas';
  p.drawChart(id, { type: 'line', data: { datasets: [] } });
  const first = p.charts.get(id);
  const oldCallback = [...p.rafs.values()][0];
  for (let i = 0; i < 20; i++) p.drawChart(id, { type: 'line', data: { datasets: [] } });
  assert.equal(p.rafs.size, 1);
  assert.equal(first.canvas, null);
  oldCallback(); // A queued callback that escaped cancellation must still be harmless.
  assert.equal(first.resizes, 0);
  const current = p.charts.get(id);
  [...p.rafs.values()][0]();
  assert.equal(current.resizes, 1);
  p.window.document.getElementById(id).remove();
  p.drawChart(id, { type: 'line' });
  assert.equal(p.charts.has(id), false);
});

test('Insights draws 52-week activity/churn/languages/contributors/radar and security fixtures', t => {
  const p = fixture(t);
  p.state.repository = { full_name: 'owner/repo', stargazers_count: 42, forks_count: 2, owner: { login: 'owner' } };
  const weeks = Array.from({ length: 52 }, (_, i) => ({ week: 1700000000 + i * 604800, total: i + 1, days: [1, 2, 3, 4, 5, 6, 7] }));
  p.state.data.set('commitActivity', weeks);
  assert.equal(p.renderCommits(weeks, { stale: false }), true);
  assert.equal(p.renderChurn(weeks.map(w => [w.week, 100, -10])), true);
  assert.equal(p.renderLanguages({ TypeScript: 1000, JavaScript: 500 }), true);
  assert.equal(p.renderContributors([{ login: 'a', contributions: 80, html_url: 'https://github.com/a' }, { login: 'b', contributions: 20 }]), true);
  p.renderRadar();
  p.renderAdvisories([]);
  assert.ok(p.charts.size >= 3);
  assert.deepEqual(Array.from(p.charts.get('card-languages-canvas').config.data.labels), ['TypeScript', 'JavaScript']);
});

test('Insights caches only confirmed public data and rejects A-B-A account mismatches', async t => {
  const p = fixture(t);
  const storage = new Map();
  const calls = [];
  p.setRequest(async (method, args) => {
    calls.push(method);
    if (method === 'storage.get') return storage.get(args.key);
    if (method === 'storage.set') storage.set(args.key, args.value);
    if (method === 'storage.delete') storage.delete(args.key);
  });
  p.state.acct = 'accountA';
  for (const visibility of [null, true]) { p.state.privateRepo = visibility; p.writeCache('a/b', 'languages', { TypeScript: 100 }, 10000); }
  assert.equal(storage.size, 0);
  p.state.privateRepo = false;
  p.writeCache('a/b', 'languages', { TypeScript: 100 }, 10000);
  assert.ok(await p.readCache('a/b', 'languages'));
  p.state.acct = 'accountB';
  assert.equal(await p.readCache('a/b', 'languages'), null);
  p.state.acct = 'accountA';
  assert.equal(await p.readCache('a/b', 'languages'), null);
  assert.ok(calls.includes('storage.delete'));
});
