import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { decrypt } from './crypto.js';
import { assertWorkspace, getRecord, pushOperations, type Operation } from './syncV2.js';

export interface StarsCheckpoint { nextPage: number; complete: boolean; fetched: number }
export function initializeStarsRefresh(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS task_refresh_stars (task_id TEXT NOT NULL,repository_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(task_id,repository_id))');
}
// Only GitHub facts may cross the refresh boundary. User and model fields are
// always taken from the latest canonical record inside the commit transaction.
const upstream = ['id','name','full_name','description','html_url','stargazers_count','forks_count','forks','language','created_at','updated_at','pushed_at','topics','archived','disabled','fork','is_template','open_issues_count','default_branch'] as const;
function repositoryFacts(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') throw new Error('GITHUB_STARS_INVALID_RESPONSE');
  const item = entry as Record<string, unknown>, repo = item.repo as Record<string, unknown>;
  if (!repo || !Number.isSafeInteger(repo.id) || Number(repo.id) <= 0 || typeof repo.full_name !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name) || typeof repo.name !== 'string' || typeof item.starred_at !== 'string' || !Number.isFinite(Date.parse(item.starred_at))) throw new Error('GITHUB_STARS_INVALID_RESPONSE');
  const facts: Record<string, unknown> = {};
  for (const key of upstream) if (repo[key] !== undefined) facts[key] = repo[key];
  const owner = repo.owner as Record<string, unknown> | undefined;
  if (owner && typeof owner.login === 'string') facts.owner = { login: owner.login, avatar_url: typeof owner.avatar_url === 'string' ? owner.avatar_url : '' };
  facts.license = repo.license && typeof repo.license === 'object' ? (repo.license as Record<string, unknown>).spdx_id ?? null : null;
  facts.starred_at = item.starred_at;
  return facts;
}
export async function refreshStars(db: Database.Database, task: {id:string;workspaceId:string;githubUserId:number}, signal: AbortSignal,
  options: {state?:StarsCheckpoint;fetch?:typeof fetch;stage:(stage:string)=>void;checkpoint:(state:StarsCheckpoint)=>void;progress:(data:unknown)=>void;finish:(result:Record<string,unknown>)=>void}) {
  const row = db.prepare("SELECT value FROM settings WHERE key='github_token'").get() as {value:string}|undefined;
  if (!row?.value) throw new Error('GITHUB_CREDENTIAL_REQUIRED');
  let token: string;
  try { token = decrypt(row.value, config.encryptionKey); } catch { throw new Error('GITHUB_CREDENTIAL_INVALID'); }
  if (!token.trim()) throw new Error('GITHUB_CREDENTIAL_REQUIRED');
  const request = options.fetch ?? fetch;
  const get = async (path:string, stars=false) => {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    const timeout = setTimeout(()=>controller.abort(new Error('GITHUB_REQUEST_TIMEOUT')),20000);
    let onAbort!:()=>void;
    const interrupted = new Promise<never>((_resolve,reject)=>{
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    try {
      // Race also releases the runner slot for fetch/body adapters which ignore
      // abort. The linked signal cancels native fetch and body reads together.
      return await Promise.race([interrupted,(async()=>{
        const response = await request(`https://api.github.com${path}`, { headers: {Authorization:`Bearer ${token}`,Accept:stars?'application/vnd.github.star+json':'application/vnd.github+json'}, signal:controller.signal, redirect:'error' });
        controller.signal.throwIfAborted();
        if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
        const text = await response.text();
        controller.signal.throwIfAborted();
        if (text.length > 4_000_000) throw new Error('GITHUB_RESPONSE_TOO_LARGE');
        return {response, value:JSON.parse(text)};
      })()]);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort',abort);
      controller.signal.removeEventListener('abort',onAbort);
    }
  };
  options.stage('verifying');
  const account = await get('/user');
  if (account.value.id !== task.githubUserId) throw new Error('GITHUB_ACCOUNT_MISMATCH');
  const state:StarsCheckpoint = options.state ? {...options.state} : {nextPage:1,complete:false,fetched:0};
  if (!Number.isSafeInteger(state.nextPage) || state.nextPage < 1 || typeof state.complete !== 'boolean') throw new Error('GITHUB_STARS_INVALID_CHECKPOINT');
  while (!state.complete) {
    assertWorkspace(db,task.workspaceId,task.githubUserId);
    options.stage('fetching');
    const page = await get(`/user/starred?per_page=100&page=${state.nextPage}`,true);
    if (!Array.isArray(page.value) || page.value.length > 100) throw new Error('GITHUB_STARS_INVALID_RESPONSE');
    const facts = page.value.map(repositoryFacts);
    // GitHub supplies a Link header. Fall back to a final empty/short page for
    // adapters which omit it, and never accept an arbitrary redirect URL.
    const link = page.response.headers.get('link');
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    if (next) {
      const url = new URL(next[1]);
      if (url.origin !== 'https://api.github.com' || url.pathname !== '/user/starred' || Number(url.searchParams.get('page')) !== state.nextPage+1) throw new Error('GITHUB_STARS_INVALID_PAGINATION');
    }
    if (state.nextPage >= 10000 && (next || (!link && facts.length === 100))) throw new Error('GITHUB_STARS_PAGE_LIMIT');
    db.transaction(() => {
      signal.throwIfAborted();
      const insert = db.prepare('INSERT INTO task_refresh_stars VALUES(?,?,?) ON CONFLICT(task_id,repository_id) DO UPDATE SET data=excluded.data');
      for (const repo of facts) insert.run(task.id,String(repo.id),JSON.stringify(repo));
      state.fetched += facts.length;
      state.nextPage++;
      state.complete = link !== null ? !next : facts.length < 100;
      options.checkpoint(state);
    })();
    options.progress({pages:state.nextPage-1,fetched:state.fetched});
  }
  options.stage('saving');
  db.transaction(() => {
    signal.throwIfAborted();
    assertWorkspace(db,task.workspaceId,task.githubUserId);
    const checkedAt = new Date().toISOString();
    const incoming = db.prepare('SELECT repository_id,data FROM task_refresh_stars WHERE task_id=?').all(task.id) as Array<{repository_id:string;data:string}>;
    const ids = new Set(incoming.map(r=>r.repository_id));
    let updated=0,added=0,unstarred=0;
    const save = (id:string, data:Record<string,unknown>, version:number) => {
      const operation:Operation={opId:`stars:${task.id}:${id}`,collection:'repositories',id,kind:'put',baseVersion:version,data};
      const result=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-stars-refresh',operations:[operation]}).results[0];
      if (result.status !== 'applied') throw new Error('STARS_SYNC_CONFLICT');
    };
    for (const repo of incoming) {
      const current = getRecord(db,'repositories',repo.repository_id);
      // A deliberately deleted business record must not be resurrected.
      if (current?.deleted) continue;
      save(repo.repository_id,{...current?.data,...JSON.parse(repo.data),github_star_state:'starred',github_star_checked_at:checkedAt},current?.version ?? 0);
      if (current) updated++; else added++;
    }
    for (const record of db.prepare("SELECT id FROM sync_v2_records WHERE collection='repositories' AND deleted=0").all() as {id:string}[]) {
      if (ids.has(record.id)) continue;
      const current=getRecord(db,'repositories',record.id)!;
      save(record.id,{...current.data,github_star_state:'unstarred',github_star_checked_at:checkedAt},current.version);
      unstarred++;
    }
    const organization=getRecord(db,'organization','default');
    const saved=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-stars-refresh',operations:[{opId:`stars:${task.id}:checked`,collection:'organization',id:'default',kind:'put',baseVersion:organization?.version ?? 0,data:{...organization?.data,githubStarsLastCheckedAt:checkedAt}}]});
    if(saved.results[0].status !== 'applied') throw new Error('STARS_SYNC_CONFLICT');
    options.finish({fetched:ids.size,updated,added,unstarred,checkedAt});
    db.prepare('DELETE FROM task_refresh_stars WHERE task_id=?').run(task.id);
  })();
}
