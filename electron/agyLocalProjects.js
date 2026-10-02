const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const ignore = require('ignore');
const { AgyError } = require('./agyProtocol');

const EXCLUDED = /(?:^|\/)(?:\.git|\.ssh|\.aws|\.azure|node_modules|vendor|dist|build|coverage|\.next|\.venv|venv|__pycache__|target|\.env[^/]*|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx|min\.[cm]?js|map)$/i;
const TEXT = /\.(?:md|mdx|markdown|txt|[cm]?[jt]sx?|json|ya?ml|toml|ini|cfg|xml|properties|py|pyi|go|mod|rs|java|kts?|rb|php|cs|c|h|cc|cpp|hpp|m|mm|vue|svelte|swift|dart|scala|exs?|erl|clj|lua|r|jl|sh|bash|ps1|sql|sol|fsx?|vb|zig)$/i;
const MAX_FILE_BYTES = 512 * 1024;

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function createLocalProjects({ selectDirectory }) {
  const grants = new Map();
  const owned = (owner, id) => {
    const grant = grants.get(id);
    if (!grant || grant.owner !== owner) throw new AgyError('LOCAL_GRANT_REQUIRED');
    return grant;
  };
  const assertCurrent = (id, grant) => {
    if (grants.get(id) !== grant) throw new AgyError('CANCELED');
  };
  return {
    async choose(owner) {
      const selected = await selectDirectory();
      if (!selected) throw new AgyError('CANCELED');
      const root = await fs.realpath(selected);
      if (!(await fs.stat(root)).isDirectory()) throw new AgyError('LOCAL_NOT_DIRECTORY');
      const id = randomUUID();
      const grant = { owner, root, files: new Set(), name: path.basename(root) };
      grants.set(id, grant);
      try {
        const entries = [];
        let inspected = 0, truncated = false;
        const visit = async (directory, inherited, depth = 0) => {
          if (depth > 20 || inspected >= 12_000) { truncated = true; return; }
          assertCurrent(id, grant);
          const rules = [...inherited];
          const ignorePath = path.join(directory, '.gitignore');
          try {
            const stat = await fs.lstat(ignorePath);
            if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024) {
              rules.push({ base: directory, matcher: ignore().add(await fs.readFile(ignorePath, 'utf8')) });
            }
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          const children = await fs.readdir(directory, { withFileTypes: true });
          for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
            if (++inspected > 12_000 || entries.length >= 4_000) { truncated = true; break; }
            const target = path.join(directory, entry.name);
            const relative = path.relative(root, target).split(path.sep).join('/');
            if (entry.isSymbolicLink() || EXCLUDED.test(relative)) continue;
            const real = await fs.realpath(target);
            if (!within(root, real) || real.toLowerCase() !== target.toLowerCase()) continue;
            if (rules.some(rule => rule.matcher.ignores(path.relative(rule.base, target).split(path.sep).join('/') + (entry.isDirectory() ? '/' : '')))) continue;
            if (entry.isDirectory()) await visit(target, rules, depth + 1);
            else if (entry.isFile() && (TEXT.test(relative) || /(?:^|\/)(?:Dockerfile|Makefile|Procfile|LICENSE)$/i.test(relative))) {
              const stat = await fs.stat(target);
              if (stat.size <= MAX_FILE_BYTES) { entries.push({ path: relative, type: 'blob', bytes: stat.size }); grant.files.add(relative); }
            }
          }
        };
        await visit(root, []);
        assertCurrent(id, grant);
        const identity = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex');
        return { id, name: grant.name, identity, entries, truncated };
      } catch (error) { grants.delete(id); throw error; }
    },
    async read(owner, id, relative) {
      const grant = owned(owner, id);
      if (typeof relative !== 'string' || !grant.files.has(relative) || EXCLUDED.test(relative)) throw new AgyError('LOCAL_PATH_DENIED');
      const target = path.resolve(grant.root, relative);
      const real = await fs.realpath(target);
      if (!within(grant.root, real) || real.toLowerCase() !== target.toLowerCase()) throw new AgyError('LOCAL_PATH_DENIED');
      const handle = await fs.open(real, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new AgyError('LOCAL_FILE_LIMIT');
        const bytes = await handle.readFile();
        if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) throw new AgyError('LOCAL_BINARY');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        assertCurrent(id, grant);
        return { path: relative, content, contentHash: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString() };
      } finally { await handle.close(); }
    },
    revoke(owner, id) {
      for (const [key, grant] of grants) if (grant.owner === owner && (!id || key === id)) grants.delete(key);
    },
  };
}

module.exports = { createLocalProjects, within };
