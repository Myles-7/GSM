const test = require('node:test');
const assert = require('node:assert/strict');
const { tasks, score } = require('./fixtures/ai-ux-content.cjs');

test('content evaluation contains 30 independent tasks in ten requested categories', () => {
  assert.equal(tasks.length, 30);
  assert.equal(new Set(tasks.map(t => t.id)).size, 30);
  assert.equal(new Set(tasks.map(t => t.category)).size, 10);
  assert.equal(score([]).filter(t => t.passed).length, 0);
});
test('content evaluation rejects fabricated facts, quotes, unknown handling and duplicate IDs', () => {
  const answers = tasks.map(t => ({ id: t.id, answer: 'A paragraph.', facts: t.expected,
    quotes: [t.evidence], missing: Object.entries(t.expected).filter(([, v]) => v === 'unknown').map(([k]) => k) }));
  answers[0].facts = { purpose: 'Cloud service' };
  answers[1].quotes = ['sudo install mystery'];
  answers[27].missing = [];
  answers.push(answers[2]);
  const results = score(answers);
  for (const id of ['T01', 'T02', 'T03', 'T28']) assert.equal(results.find(r => r.id === id).passed, false);
});
