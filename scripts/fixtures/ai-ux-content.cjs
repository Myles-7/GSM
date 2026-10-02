const task = (id, category, question, evidence, expected, format = 'prose') =>
  ({ id, category, question, evidence, expected, format });
const notes = 'NoteA is a local Markdown editor for Windows and Linux. Full-text search is supported. Cloud sync and mobile apps are not supported. Install: npm install. Start: npm start.';
const release = 'v2 adds full-text search and fixes a Windows startup crash. Breaking change: the setting dataDir is renamed to storagePath. Migration: rename dataDir to storagePath in config.json. Cloud sync remains unsupported.';
const tasks = [
  task('T01', 'long-readme', 'Summarize the actual purpose, ignoring sponsorship noise. facts: purpose.', '# Sponsors\n' + 'Thank you to our sponsors.\n'.repeat(160) + '\n# Features\n' + notes, { purpose: 'Markdown editor' }),
  task('T02', 'long-readme', 'Give installation and startup steps. facts: install,start.', notes, { install: 'npm install', start: 'npm start' }, 'steps'),
  task('T03', 'long-readme', 'Name both supported platforms. facts: platforms.', notes, { platforms: ['Windows', 'Linux'] }),
  task('T04', 'negation', 'Does it support cloud sync? facts: cloudSync.', notes, { cloudSync: false }),
  task('T05', 'negation', 'Can I use a mobile app? facts: mobile.', notes, { mobile: false }),
  task('T06', 'negation', 'Does lack of cloud sync mean no search? facts: search,cloudSync.', notes, { search: true, cloudSync: false }),
  task('T07', 'format', 'Answer ONLY JSON with keys platforms and mobile. facts must have the same fields.', notes, { platforms: ['Windows', 'Linux'], mobile: false }, 'json'),
  task('T08', 'format', 'Write exactly two numbered installation steps, no heading. facts: install,start.', notes, { install: 'npm install', start: 'npm start' }, 'steps'),
  task('T09', 'format', 'Write a short Chinese paragraph, not a list, about purpose and limitations. facts: cloudSync,mobile.', notes, { cloudSync: false, mobile: false }, 'zh-prose'),
  task('T10', 'follow-up', 'Earlier question: Windows support? Follow-up: And Linux? Answer the follow-up. facts: linux.', notes, { linux: true }),
  task('T11', 'follow-up', 'Earlier question: recommend a local editor. Follow-up: It must also have cloud sync. Does NoteA still qualify? facts: qualifies.', notes, { qualifies: false }),
  task('T12', 'follow-up', 'Earlier answer named NoteA. Follow-up asks about mobile support only. facts: mobile.', notes, { mobile: false }),
  task('T13', 'multi-repository', 'Which project is a better documented match for Markdown notes? facts: recommended.', notes + '\nCalcB is a terminal arithmetic calculator; it cannot edit notes.', { recommended: 'NoteA' }),
  task('T14', 'multi-repository', 'Compare cloud support. facts: NoteA,CloudB. Do not infer that a browser app is offline.', notes + '\nCloudB is a browser note service with cloud sync.', { NoteA: false, CloudB: true }),
  task('T15', 'multi-repository', 'Is CalcB known to support mobile? facts: mobile. If unknown, missing must contain mobile.', 'CalcB is an arithmetic calculator. No platform documentation was supplied.', { mobile: 'unknown' }),
  task('T16', 'local', 'State the documented startup command, not a guessed alternative. facts: start.', 'README.md: Run npm start. package.json: {"scripts":{"start":"electron ."}}', { start: 'npm start' }),
  task('T17', 'local', 'Old evidence said Python 3.9. Current pyproject.toml says requires-python = ">=3.11". Use current evidence. facts: minimumPython.', 'Current pyproject.toml: requires-python = ">=3.11"', { minimumPython: '3.11' }),
  task('T18', 'local', 'Does the project write files? facts: writesFiles. Do not confuse read-only research with project behavior.', 'main.py: open("result.txt", "w").write("result")', { writesFiles: true }),
  task('T19', 'gist', 'What does this function compute? facts: operation.', 'def add(a, b):\n    return a + b', { operation: 'addition' }),
  task('T20', 'gist', 'Does this code perform a network request? facts: network.', 'def add(a, b):\n    return a + b\n# No imports or other code.', { network: false }),
  task('T21', 'gist', 'Does this function modify its input list? facts: mutatesInput.', 'def ordered(values):\n    return sorted(values)', { mutatesInput: false }),
  task('T22', 'release', 'What breaking change affects config? facts: oldKey,newKey.', release, { oldKey: 'dataDir', newKey: 'storagePath' }),
  task('T23', 'release', 'Give the documented migration action and affected file. facts: file,newKey.', release, { file: 'config.json', newKey: 'storagePath' }),
  task('T24', 'release', 'Does upgrading enable cloud sync? facts: cloudSync.', release, { cloudSync: false }),
  task('T25', 'classification', 'Choose only Notes or Calculators. facts: category.', notes, { category: 'Notes' }),
  task('T26', 'classification', 'Current category is Manual and locked. No override authorized. Should a proposal apply a category change? facts: applyChange.', 'Current category: Manual. category_locked=true. overrideLocked=false.', { applyChange: false }),
  task('T27', 'classification', 'Draft was based on Notes, but user changed category to Work. Should the stale draft overwrite it? facts: overwrite,conflict.', 'Before snapshot: Notes. Current category: Work. Proposed: Tools.', { overwrite: false, conflict: true }),
  task('T28', 'missing', 'Give the installation command if documented. facts: install. If absent use unknown and missing must contain install. Do not invent a command.', 'UnknownProject is a project name. No other documentation is available.', { install: 'unknown' }),
  task('T29', 'missing', 'Does it support Kubernetes? facts: kubernetes. Use unknown for absent evidence; missing must contain kubernetes.', notes, { kubernetes: 'unknown' }),
  task('T30', 'missing', 'Is version 3 compatible with version 2 config? facts: compatible. Missing evidence is not proof of incompatibility; missing must contain compatible.', 'Only version 2 release notes are available.', { compatible: 'unknown' }),
];

function score(answers) {
  if (!Array.isArray(answers)) return tasks.map(t => ({ id: t.id, passed: false, failures: ['answers-not-array'] }));
  return tasks.map(t => {
    const matches = answers.filter(a => a?.id === t.id), a = matches[0], failures = [];
    if (matches.length !== 1) failures.push('missing-or-duplicate-id');
    if (!a || typeof a.answer !== 'string' || !a.answer.trim()) failures.push('empty-answer');
    if (JSON.stringify(a?.facts) !== JSON.stringify(t.expected)) {
      const keys = Object.keys(t.expected);
      if (!a?.facts || Object.keys(a.facts).length !== keys.length ||
        keys.some(k => JSON.stringify(a.facts[k]) !== JSON.stringify(t.expected[k]))) failures.push('incorrect-facts');
    }
    if (!Array.isArray(a?.quotes) || a.quotes.some(q => typeof q !== 'string' || !q.trim() || !t.evidence.includes(q))) failures.push('invalid-quote');
    const unknown = Object.entries(t.expected).filter(([, v]) => v === 'unknown').map(([k]) => k);
    if (!Array.isArray(a?.missing) || unknown.some(k => !a.missing.includes(k)) || a.missing.some(k => !unknown.includes(k))) failures.push('incorrect-missing');
    if (!unknown.length && !a?.quotes?.length) failures.push('missing-evidence');
    if (t.format === 'json') {
      try {
        const value = JSON.parse(a.answer);
        if (Object.keys(value).length !== Object.keys(t.expected).length ||
          Object.keys(t.expected).some(k => JSON.stringify(value[k]) !== JSON.stringify(t.expected[k]))) failures.push('json-format');
      } catch { failures.push('json-format'); }
    }
    if (t.format === 'steps' && !/^1[.)] .+\n2[.)] .+$/s.test(a?.answer?.trim() ?? '')) failures.push('steps-format');
    if (t.format === 'zh-prose' && (!/[\u4e00-\u9fff]/.test(a?.answer ?? '') || /^\s*(?:[-*#]|\d+[.)])/m.test(a?.answer ?? ''))) failures.push('paragraph-format');
    return { id: t.id, category: t.category, passed: !failures.length, failures };
  });
}
module.exports = { tasks, score };
