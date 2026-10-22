// Offline audit fixtures only; never imported by the production entry point.
import { useAppStore } from '../../src/store/useAppStore';
import { aiTaskJournal, type AITaskRecord } from '../../src/services/aiTaskJournal';
import { taskObservability } from '../../src/services/taskObservability';

export async function configureProjectAudit(params: URLSearchParams) {
  const state = useAppStore.getState();
  if (state.user?.id !== 990001) throw new Error('Project audit requires the isolated fixture account');
  const language = params.get('lang') === 'en' ? 'en' : 'zh';
  state.setLanguage(language);
  state.setTheme(params.get('theme') === 'dark' ? 'dark' : 'light');
  const mode = params.get('projectAudit');
  if (mode === 'observability') {
    const owner=String(state.user.id),id='project-audit-observability';await aiTaskJournal.load(owner);
    const at=new Date().toISOString();
    aiTaskJournal.project({id,owner,kind:'exploration',state:'running',title:language==='zh'?'项目地图探索 · 合成验收':'Project map exploration · Synthetic audit',createdAt:at,updatedAt:at,startedAt:at,
      config:{provider:'agy-cli',model:'gemini-3.8-flash-high',effort:'high',timeoutSeconds:180},location:'device',executor:'agy-device',units:{items:'batches',repositories:25},
      items:Array.from({length:5},(_,i)=>({id:`batch-${i}`,label:`synthetic/projects-${i*5+1}–${i*5+5}`,state:i===0?'complete':i===1?'failed':'running',phase:i===2?'initializing':'generating',providerOutcome:i===0?'succeeded':i===1?'unknown':'in_flight',commitStatus:i===0?'saved':'not_started',error:i===1?'AGY_TIMEOUT':undefined})),usage:{configured_concurrency:5,admission_concurrency:5,peak_generating_concurrency:5},target:{view:'repositories',id:'project-map'}});
    for(let i=0;i<5;i++){
      const requestId=`audit-request-${i}`;
      taskObservability.begin({owner,taskId:id,requestId,itemId:`batch-${i}`,label:`synthetic/projects-${i*5+1}–${i*5+5}`,source:'agy',mode:'stream',model:'gemini-3.8-flash-high'});
      taskObservability.phase(owner,id,requestId,i===2?'initializing':'generating');
      if(i!==2)taskObservability.append(owner,id,requestId,'answer',i===0?'[{"repositoryId":1,"summary":"Local Markdown editor for Windows and Linux.","topics":["notes","search"],"evidence":"Synthetic README: local notes and full-text search."}]':i===1?'Partial answer retained before timeout.':'Synthetic incremental response.\n'.repeat(45));
      if(i===0){taskObservability.complete(owner,id,requestId,{outcome:'succeeded',answer:'[{"repositoryId":1,"summary":"Local Markdown editor for Windows and Linux."}]'});taskObservability.result(owner,id,{id:'repo-1',itemId:'batch-0',repositoryId:state.repositories[0].id,label:'synthetic/notes',commitStatus:'saved',data:{summary:'Local Markdown editor for Windows and Linux.',topics:['Notes','Search'],evidence:[{source:'Synthetic README',excerpt:'Local notes and full-text search.'}]}});}
      if(i===1)taskObservability.complete(owner,id,requestId,{outcome:'unknown',error:'AGY_TIMEOUT'});
    }
    await taskObservability.flush(owner,id);
    if (params.has('checkpoint')) {
      const { explorationRuntime } = await import('../../src/services/explorationRuntime');
      await explorationRuntime.update(owner, current => ({ ...current, task: {
        id:'synthetic-observability-checkpoint', journalId:id, type:'build', status:'interrupted',
        startedAt:at, model:'Synthetic UI fixture', fingerprint:'synthetic', completed:5, total:25,
        draft:Object.fromEntries(Object.entries(current.index?.profiles ?? {}).slice(0,5)),
      } }));
    }
    useAppStore.getState().setCurrentView('tasks');
  }
  if (mode === 'map-regression') {
    const repositories=state.repositories.slice(0,3).map((repo,i)=>({
      ...repo, custom_description:null, forks:undefined, pushed_at:null,
      name:i===0?'codex-legacy-sample':repo.name,full_name:i===0?'synthetic/codex-legacy-sample':repo.full_name,
      owner:{login:repo.owner.login},
    })) as unknown as typeof state.repositories;
    useAppStore.setState({repositories,searchResults:repositories});
  }
  if (mode === 'populated') {
    const gists = state.repositories.slice(0, 5).map((repo, i) => ({
      id: `audit-gist-${i}`, description: `Offline audit snippet ${i}`, public: true,
      html_url: `https://example.invalid/gist/${i}`, created_at: repo.created_at, updated_at: repo.updated_at,
      comments: 0, owner: state.user, files: { 'example.ts': { filename: 'example.ts', type: 'text/plain', language: 'TypeScript', size: 32, content: 'export const answer = 42;' } },
    }));
    const forks = state.repositories.slice(0, 5).map(repo => ({
      ...repo, fork: true, default_branch: 'main', owner: { login: state.user!.login, avatar_url: '' },
      source: { ...repo, owner: repo.owner },
    }));
    const releases = state.repositories.slice(0, 5).map((repo, i) => ({
      id: repo.id * 10, tag_name: `v1.${i}`, name: `Audit release ${i}`, body:'Offline release notes',
      published_at:'2026-10-20T00:00:00Z', html_url:`https://example.invalid/release/${i}`, assets:[],
      repository:{id:repo.id,name:repo.name,full_name:repo.full_name},
    }));
    useAppStore.setState({ gists, starredGists: [gists[0]], forks, releases,
      releaseSubscriptions: new Set(releases.map(release => release.repository.id)),
    });
  }
  if (mode === 'boundary') {
    const repositories = state.repositories.map((repo, i) => i === 0 ? {
      ...repo, name: 'long-continuous-repository-identifier-'.repeat(4),
      full_name: `synthetic/${'long-continuous-repository-identifier-'.repeat(4)}`,
      description: 'A long repository description with https://example.test/'.repeat(12),
      ai_summary: '仓库说明与边界文本 '.repeat(80),
    } : repo);
    useAppStore.setState({ repositories, searchResults: repositories });
  }
  if (mode === 'empty') useAppStore.setState({ repositories: [], searchResults: [] });
  if (mode === 'agy-timeout') {
    const owner=String(state.user.id);await aiTaskJournal.load(owner);
    aiTaskJournal.project({id:'project-audit-agy-timeout',owner,kind:'exploration',state:'running',title:'深入探索：codex',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),startedAt:new Date(Date.now()-473000).toISOString(),
      executor:'agy-device',location:'device',providerOutcome:'unknown',failureCode:'unknown_provider_outcome',phase:'generating',
      config:{model:'gemini-3.8-flash-high',provider:'agy-cli',effort:'high',timeoutSeconds:180},
      usage:{configured_concurrency:5,admission_concurrency:5,peak_generating_concurrency:5,phase_generating_ms:540290},
      items:Array.from({length:26},(_,i)=>({id:`batch-${i}`,label:state.repositories.slice(i*5,i*5+5).map(repo=>repo.full_name).join(' · '),
        state:i<3?'failed':i===3?'running':'pending',providerOutcome:i<3?'unknown':i===3?'in_flight':'not_started',
        error:i<3?'AGY_TIMEOUT':undefined})),target:{view:'repositories',id:'query:codex'},
    });
    useAppStore.getState().setCurrentView('tasks');
  }
  if (mode === 'tasks') {
    const owner = String(state.user.id);
    await aiTaskJournal.load(owner);
    const states: AITaskRecord['state'][] = ['failed', 'running', 'partial', 'interrupted', 'complete', 'canceled'];
    for (let i = 0; i < 35; i++) {
      const status = states[i % states.length];
      aiTaskJournal.project({
        id: `project-audit-${i}`, owner, kind: i % 2 ? 'details' : 'summary', state: status,
        title: i === 0 ? `synthetic/${'very-long-continuous-project-name-'.repeat(5)}` : `synthetic/project-${i}`,
        createdAt: new Date(Date.now() - i * 1000).toISOString(), updatedAt: new Date().toISOString(),
        startedAt: new Date(Date.now() - 70000).toISOString(), endedAt: status === 'running' ? undefined : new Date().toISOString(),
        phase: 'verification', error: status === 'failed' ? 'Provider request timed out. Saved results are retained.' : undefined,
        items: Array.from({ length: Math.min(120, state.repositories.length) }, (_, j) => ({
          id: String(state.repositories[j % state.repositories.length].id),
          label: state.repositories[j % state.repositories.length].full_name,
          state: status === 'complete' || j < 80 ? 'complete' : j % 2 ? 'failed' : status === 'canceled' ? 'canceled' : 'pending',
          providerOutcome: status === 'complete' || j < 80 ? 'succeeded' : j % 2 ? 'failed' : 'not_started',
          commitStatus: status === 'complete' || j < 80 ? 'saved' : 'not_started',
        })),
        target: { view: 'repositories' },
      });
    }
    aiTaskJournal.bind('project-audit-1', {
      pause: () => aiTaskJournal.patch('project-audit-1', { state:'paused' }),
      resume: () => aiTaskJournal.patch('project-audit-1', { state:'running' }),
      stop: () => { aiTaskJournal.patch('project-audit-1', { state:'canceled', endedAt:new Date().toISOString() }); aiTaskJournal.unbind('project-audit-1'); },
    });
    await aiTaskJournal.flush(owner);
    useAppStore.getState().setCurrentView('tasks');
  }
}
