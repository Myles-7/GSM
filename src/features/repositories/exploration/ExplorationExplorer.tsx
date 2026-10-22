import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Search, Sparkles, Map, List, ArrowLeft, RefreshCw, MoreHorizontal, Download, Upload, PencilLine, X, Layers3, ArrowUpRight, Bookmark, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/Modal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { useDialog } from '../../../hooks/useDialog';
import { useExploration } from '../hooks/useExploration';
import { conceptId, normalizeConcept, projectScene, relationOrder, repositorySummary, resolveExplorationTargets, resultsForRelationKind } from './model';
import type { ExplorationCamera, SavedExploration, ExplorationEntity, ExplorationFocus, ExplorationOverride, RelationKind } from './types';
import type { Repository } from '../../../types';
import { ExplorationMap } from './ExplorationMap';
import { ExplorationEvidenceList, ExplorationProjectCard } from './ExplorationProjectCard';
import './exploration.css';
import { createSavedExploration, localExplorationAccount, savedChanges, savedExplorationAccount } from './local';
import { SavedExplorations } from './SavedExplorations';
import { ExplorationTaskStatus } from './ExplorationTaskStatus';
import { useTaskTarget } from '../../../hooks/useTaskTarget';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { retainPageTaskFailure } from '../../../services/pageTaskFailure';

interface Props { repositories?: Repository[]; onOpenRepository: (repository: Repository) => void; viewControls?: ReactNode }
const root: ExplorationFocus = { type: 'all' };
export function ExplorationExplorer({ onOpenRepository, viewControls }: Props) {
  const t = useT('repositories');
  const controller = useExploration(); const { account: savedAccount, repositories } = controller;
  const liveOwner = useRef(controller.ownerId); liveOwner.current = controller.ownerId;
  const canRun = controller.canRun ?? !!controller.config;
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const activeSaved = savedAccount?.saved?.find(row => row.id === selectedSavedId);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const cameraRef = useRef<ExplorationCamera>();
  const positionsRef = useRef<SavedExploration['layoutPositions']>();
  const [initialPositions,setInitialPositions] = useState<SavedExploration['layoutPositions']>();
  const [initialCamera, setInitialCamera] = useState<ExplorationCamera>();
  const browserRef = useRef<HTMLDivElement>(null);
  const buildCheckpoint = savedAccount?.task?.type === 'build' ? savedAccount.task : savedAccount?.pendingTasks?.find(task=>task.type==='build');
  const previewProfiles = !savedAccount?.index && buildCheckpoint && buildCheckpoint.completed > 0 ? buildCheckpoint.draft : null;
  const account = useMemo(() => activeSaved ? savedExplorationAccount(activeSaved, controller.ownerId) : savedAccount ? localExplorationAccount(savedAccount, repositories) : null, [activeSaved, savedAccount, repositories, controller.ownerId]);
  const sceneRepositories = activeSaved?.repositories ?? repositories;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!controller.busy) { setElapsed(0); return; }
    const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [controller.busy]);
  const { confirm, toast } = useDialog();
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [path, setPath] = useState<ExplorationFocus[]>([root]);
  const focus = path[path.length - 1];
  const effectiveQuery = query || (focus.type !== 'all' ? focus.label : '');
  const [choices, setChoices] = useState<ExplorationEntity[]>([]);
  const [mobileMap, setMobileMap] = useState(false);
  const [kindFilter, setKindFilter] = useState<RelationKind | 'all'>('all');
  const [visible, setVisible] = useState(40);
  const [selection, setSelection] = useState<{ id: number; anchor: Element } | null>(null);
  const [dialog, setDialog] = useState<'topics' | 'corrections' | 'rename' | 'edit-project' | 'save-exploration' | 'rename-saved' | null>(null);
  const [name, setName] = useState(''); const [chosenTopics, setChosenTopics] = useState<string[]>([]);
  const [editingRepository, setEditingRepository] = useState<number | null>(null);
  const [message, setMessage] = useState(''); const [topicQuery, setTopicQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingSaved, setEditingSaved] = useState<SavedExploration | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => account ? projectScene(account, sceneRepositories, focus, focus.type === 'all' ? '' : effectiveQuery) : null, [account, sceneRepositories, focus, effectiveQuery]);
  const globalScene = useMemo(() => account ? projectScene(account, sceneRepositories, root) : null, [account, sceneRepositories]);
  const repositoryMap = useMemo(() => new globalThis.Map(sceneRepositories.map(repo => [repo.id, repo])), [sceneRepositories]);
  const hasScene = !!scene;
  useEffect(() => {
    const browser = browserRef.current;
    if (!browser) return;
    const measure = () => browser.style.setProperty('--explore-available-height', `${Math.max(280, window.innerHeight - browser.getBoundingClientRect().top - 18)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (browser.parentElement) observer?.observe(browser.parentElement);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [hasScene, controller.loading]);
  useEffect(() => { setPath([root]); setSearch(''); setQuery(''); setChoices([]); setSelection(null); setDialog(null); setMessage(''); setSelectedSavedId(''); setInitialCamera(undefined); setInitialPositions(undefined); setKindFilter('all'); }, [controller.ownerId]);
  useEffect(() => { setVisible(40); setSelection(null); listRef.current?.scrollTo?.({ top: 0 }); }, [focus]);
  useEffect(() => {
    if (!scene || focus.type !== 'entity' || !query || scene.entities.some(entity => entity.id === focus.id)) return;
    const targets = resolveExplorationTargets(scene, query).filter(candidate => scene.entities.some(entity => entity.id === candidate.id));
    if (targets.length === 1) setPath([root, { type: 'entity', id: targets[0].id, label: targets[0].label }]);
    else if (targets.length > 1) setChoices(targets);
  }, [scene, focus, query]);
  const closeCard = useCallback(() => setSelection(null), []);
  const navigate = (next: ExplorationFocus) => { setKindFilter('all'); setPath(current => [...current, next]); setSelection(null); setChoices([]); };
  const navigateBack = (index: number) => { if (index === 0 && activeSaved) { home(); return; } setKindFilter('all'); const next = path.slice(0, index + 1); setPath(next); setSelection(null); const entity = [...next].reverse().find(item => item.type === 'entity'); const text = entity && 'label' in entity ? entity.label : ''; setQuery(text); setSearch(text); };
  const choose = (entity: ExplorationEntity) => { setKindFilter('all'); setChoices([]); setPath([root, { type: 'entity', id: entity.id, label: entity.label }]); };
  const submit = () => {
    const text = search.trim(); if (!text || !globalScene) return;
    if (activeSaved) { setSelectedSavedId(''); setInitialCamera(undefined); setInitialPositions(undefined); }
    setQuery(text); setSelection(null); setKindFilter('all');
    const topic = globalScene.topics.find(item => normalizeConcept(item.label) === normalizeConcept(text));
    if (topic && !globalScene.entities.some(item => [item.label, ...item.aliases].some(label => normalizeConcept(label) === normalizeConcept(text)))) { setChoices([]); setPath([root, { type: 'topic', id: topic.id, label: topic.label }]); return; }
    const targets = resolveExplorationTargets(globalScene, text);
    if (targets.length > 1) setChoices(targets); else choose(targets[0]);
  };
  const deepenQuery = search.trim() || effectiveQuery;
  const deepenReason = controller.busy ? t('exploration.an-ai-task-is-running-finish-or-cancel') : !canRun ? controller.setupIssue || t('exploration.select-and-enable-an-ai-model-first') : !deepenQuery ? t('exploration.enter-a-topic-to-explore') : choices.length ? t('exploration.select-a-specific-exploration-target-first') : activeSaved ? t('exploration.update-the-saved-exploration') : t('exploration.analyze-candidates-for-this-topic-while-keeping-existing');
  const deepen = () => {
    if (!deepenQuery) return;
    if (!canRun) { controller.configureAI(); return; }
    if (activeSaved && search.trim() === activeSaved.query.trim()) { void controller.updateSaved(activeSaved, true); return; }
    if (search.trim() && (search.trim()!==query || focus.type==='all')) {
      const ambiguous = globalScene && resolveExplorationTargets(globalScene,search.trim()).length>1;
      submit(); if(!ambiguous) void controller.deepen(search.trim());
    }
    else if (focus.type==='entity') void controller.deepen(effectiveQuery);
    else void controller.deepen(effectiveQuery,JSON.stringify(focus));
  };
  const openSaved = (item: SavedExploration) => { setSelectedSavedId(item.id); setPath(item.path); setSearch(item.query); setQuery(item.query); setKindFilter(item.kindFilter); setInitialCamera(item.camera); setInitialPositions(item.layoutPositions); setChoices([]); setSelection(null); };
  const home = () => { setSelectedSavedId(''); setPath([root]); setSearch(''); setQuery(''); setKindFilter('all'); setInitialCamera(undefined); setInitialPositions(undefined); };
  const requestedSaved = useRef('');
  useTaskTarget('repositories', id => { if (id === 'project-map') home(); else if (id.startsWith('query:')) { const text = id.slice(6); setSelectedSavedId(''); setSearch(text); setQuery(text); setPath([root,{type:'entity',id:conceptId('entity',text),label:text}]); } else requestedSaved.current = id; });
  useEffect(() => { const item = savedAccount?.saved?.find(row => row.id === requestedSaved.current); if (item) { requestedSaved.current = ''; openSaved(item); } }, [savedAccount]);
  const onCameraChange = (camera: ExplorationCamera) => { cameraRef.current = camera; };
  const saveExploration = async (event: FormEvent) => {
    event.preventDefault(); if (!account || !name.trim() || saving) return; setSaving(true);
    const owner = controller.ownerId;
    try { if (dialog === 'rename-saved' && editingSaved) { const ok = await controller.editSaved(editingSaved.id, { name: name.trim() }); if (liveOwner.current !== owner) return; if (ok) setDialog(null); else toast(t('exploration.not-saved-check-the-task-history'), 'error'); }
      else { const item = createSavedExploration(account, sceneRepositories, { name: name.trim(), query: effectiveQuery, path, kindFilter, camera: cameraRef.current, layoutPositions: positionsRef.current });
        if (activeSaved) item.checked = { ...activeSaved.checked };
        const ok = await controller.saveExploration(item);
        if (liveOwner.current !== owner) return;
        if (ok) { openSaved(item); setDialog(null); setMessage(t('exploration.saved')); } else toast(t('exploration.not-saved-check-the-task-history'), 'error'); }
    } catch (reason) {
      retainPageTaskFailure(owner, 'exploration', reason instanceof Error ? reason.message : String(reason), { title:t('exploration.save-project-exploration'), target:{view:'repositories',id:'project-map'} });
      if (liveOwner.current === owner) toast(t('exploration.not-saved-check-the-task-history'), 'error');
    } finally { setSaving(false); }
  };
  const changes = activeSaved ? savedChanges(activeSaved, repositories) : null;
  const removedIds = new Set(activeSaved?.repositories.filter(repo => !repositories.some(live => live.id === repo.id)).map(repo => repo.id));
  const appendOverride = async (change: Omit<Extract<ExplorationOverride, { type: 'remove-relation' }>, 'id' | 'createdAt'> | Omit<Extract<ExplorationOverride, { type: 'rename-topic' }>, 'id' | 'createdAt'> | Omit<Extract<ExplorationOverride, { type: 'set-topics' }>, 'id' | 'createdAt'>) => {
    const value = { ...change, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    if (activeSaved) return controller.saveExploration({ ...activeSaved, overrides: [...activeSaved.overrides, value] });
    return controller.addOverride(value);
  };
  const saveRename = async (event: FormEvent) => {
    event.preventDefault(); if (focus.type !== 'topic' || !name.trim() || saving) return;
    const topicId = focus.id, label = name.trim(); setSaving(true);
    try { if (await appendOverride({ type: 'rename-topic', topicId, label })) { setPath(current => current.map(item => item.type === 'topic' && item.id === topicId ? { ...item, label } : item)); setDialog(null); } }
    finally { setSaving(false); }
  };
  const saveProjectTopics = async (event: FormEvent) => {
    event.preventDefault(); if (editingRepository === null || saving) return; setSaving(true);
    try { if (await appendOverride({ type: 'set-topics', repositoryId: editingRepository, topics: (globalScene?.topics ?? []).filter(topic => chosenTopics.includes(topic.id)).map(({ id, label }) => ({ id, label })) })) setDialog(null); }
    finally { setSaving(false); }
  };
  const exportData = () => {
    const record = aiTaskJournal.begin(controller.ownerId, 'export', [], undefined, undefined, { title: t('exploration.export-project-map'), target: { view: 'repositories', id: 'project-map' } });
    try { const blob = new Blob([controller.exportData()], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gsm-exploration-${controller.ownerId}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); record.finish('complete'); } catch (reason) { record.error(reason); record.finish('failed'); setMessage('task-record'); }
  };
  const importData = async (file: File) => {
    const record = aiTaskJournal.begin(controller.ownerId, 'import', [], undefined, undefined, { title: t('exploration.import-project-map'), target: { view: 'repositories', id: 'project-map' } });
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error(t('exploration.the-map-file-exceeds-25-mb'));
      if (!await confirm(t('exploration.import-local-map'), t('exploration.this-replaces-this-account-s-local-exploration-index'), { type: 'warning' })) { record.finish('canceled'); return; }
      await controller.importData(await file.text()); setPath([root]); setQuery(''); setSearch(''); setMessage(t('exploration.imported')); record.finish('complete');
    } catch (error) { record.error(error); record.finish('failed'); setMessage('task-record'); }
  };
  const startEditTopics = (id: number) => { setEditingRepository(id); setChosenTopics(scene?.profiles[String(id)]?.topics.map(topic => topic.id) ?? []); setSelection(null); setDialog('edit-project'); };
  const results = resultsForRelationKind(scene?.results ?? [], kindFilter);
  if (activeSaved) { const order = new globalThis.Map(activeSaved.resultIds.map((id,index) => [id,index])); results.sort((a,b) => (order.get(a.repositoryId) ?? 1000)-(order.get(b.repositoryId) ?? 1000)); }
  const mapScene = scene ? { ...scene, results, branches: scene.branches.filter(branch => kindFilter === 'all' || branch.kind === kindFilter) } : null;
  const selectedModel = controller.config?.provider === 'agy-cli' ? controller.config.agyFeatureOverrides?.organization?.model || controller.config.model : controller.config?.model;
  const displayModel = controller.config?.name && selectedModel && controller.config.name !== selectedModel ? `${controller.config.name} / ${selectedModel}` : selectedModel || controller.config?.name || t('exploration.no-model-selected');
  const selectedRepository = selection ? repositoryMap.get(selection.id) : undefined;
  const selectedResult = results.find(row => row.repositoryId === selection?.id);
  const removeCurrentOverride = (id: string) => activeSaved ? controller.saveExploration({ ...activeSaved, overrides: activeSaved.overrides.filter(row => row.id !== id) }) : controller.removeOverride(id);
  const correctionLabel = (override: ExplorationOverride) => override.type === 'remove-relation' ? t('exploration.ignored-relation', { value: override.relationId }) : override.type === 'rename-topic' ? t('exploration.renamed-topic', { value: override.label }) : t('exploration.changed-topics', { value: repositoryMap.get(override.repositoryId)?.name ?? override.repositoryId });
  const directionControls = focus.type === 'entity' && !!scene?.branches.length && <label className="explore-direction-control">{t('exploration.relationship-direction')}<select aria-label={t('exploration.choose-relationship-direction')} value="" onChange={event => {
    const branch = scene.branches.find(item => item.id === event.target.value);
    if (branch) navigate({ type: 'branch', targetId: focus.id, branch: branch.label, kind: branch.kind, label: branch.label });
  }}><option value="">{t('exploration.all-directions')}{scene.branches.length})</option>{scene.branches.map(branch => <option key={branch.id} value={branch.id}>{t(`exploration.relations.${branch.kind}`)} / {branch.label} ({branch.count})</option>)}</select></label>;
  return <section className="exploration-page" aria-label={t('exploration.explore-project-relationships')}>
    <header className="explore-page-header"><div><h1>{t('exploration.project-map')}</h1></div><div className="explore-header-actions">{viewControls}
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" aria-label={t('exploration.map-actions')}><MoreHorizontal size={17} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem disabled={controller.busy || !canRun || !savedAccount?.index} onSelect={() => void (async () => { if (await confirm(t('exploration.rebuild-the-entire-project-map'), t('exploration.reanalyze-all-local-projects-and-retain-manual-corrections'), { type: 'warning' })) await controller.build(true); })()}>{t('exploration.rebuild-entire-map')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog('corrections')}>{t('exploration.corrections')}{account?.overrides.length ?? 0})</DropdownMenuItem><DropdownMenuSeparator />
        <DropdownMenuItem disabled={!savedAccount?.index && !savedAccount?.saved?.length} onSelect={exportData}><Download size={14} /> {' '}{t('exploration.export-local-map')}</DropdownMenuItem><DropdownMenuItem disabled={controller.busy} onSelect={() => input.current?.click()}><Upload size={14} /> {' '}{t('exploration.import-local-map')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <input ref={input} hidden type="file" accept="application/json,.json" aria-label={t('exploration.import-map-file')} onChange={event => { const file = event.target.files?.[0]; if (file) void importData(file); event.currentTarget.value = ''; }} />
    </div></header>
    <div className="explore-command-bar"><form onSubmit={event => { event.preventDefault(); submit(); }}><Search size={18} /><input aria-label={t('exploration.exploration-topic')} placeholder={t('exploration.start-with-codex-browser-automation-or-knowledge-search')} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /><Button size="sm" type="submit" variant="secondary" disabled={!account || !search.trim()}>{t('exploration.explore')}</Button></form>
      <Button variant="outline" title={deepenReason} disabled={controller.busy || !deepenQuery || !!choices.length} onClick={deepen}><Sparkles size={15} /> {' '}{t('exploration.explore-further-with-ai')}</Button>
      <Button variant="outline" disabled={!account || !!choices.length || focus.type === 'all'} onClick={() => { setName(effectiveQuery || (focus.type !== 'all' ? focus.label : t('exploration.my-exploration'))); setDialog('save-exploration'); }}><Bookmark size={15} />{t('exploration.save-exploration')}</Button>
    </div>
    <div className="explore-index-bar"><div><span className="explore-local-dot" />{activeSaved ? t('exploration.snapshot-count', { count: activeSaved.resultIds.length, total: repositories.length }) : t('exploration.repository-count', { count: repositories.length })}{account?.index?.createdAt && <> · {new Date(account.index.createdAt).toLocaleDateString()}</>}
      {!activeSaved && savedAccount?.index && controller.changedCount > 0 && <strong>{controller.changedCount} {' '}{t('exploration.items-to-update')}</strong>}</div><div><select aria-label={t('exploration.ai-model-for-exploration')} disabled={controller.busy} value={controller.configId} onChange={event => controller.setConfigId(event.target.value)}><option value="">{t('exploration.choose-an-ai-model')}</option>{controller.configs.map(config => <option key={config.id} value={config.id}>{config.name || config.model}</option>)}</select><Button size="sm" variant="ghost" disabled={controller.loading || !!activeSaved || controller.busy || !canRun || !repositories.length} onClick={() => void controller.build()}><RefreshCw size={13} />{savedAccount?.index ? t('exploration.update-map') : t('exploration.organize-map-with-ai')}</Button></div></div>
    <ExplorationTaskStatus ownerId={controller.ownerId} task={savedAccount?.task} busy={controller.busy} error={controller.error} setupIssue={controller.setupIssue} message={message} preview={!!previewProfiles && savedAccount?.task?.type==='build'}
      readyCount={Object.values(account?.index?.profiles ?? {}).filter(profile => profile.status === 'ready').length} model={displayModel} elapsed={elapsed} concurrency={controller.concurrency ?? 2} activity={controller.activity ?? ''}
      canRun={canRun} checking={controller.checking} pendingCount={savedAccount?.pendingTasks?.length} recoveryStorageFull={controller.recoveryStorageFull} onRetry={() => void controller.retry()} onCancel={controller.cancel} onTasks={() => controller.openTaskCenter()} onResults={() => controller.openTaskCenter('results')} onConfigure={controller.configureAI} onRefresh={() => void controller.refreshStatus()} />
    {controller.loading ? <div className="explore-onboarding" role="status">{t('exploration.loading-local-map')}</div> : !account?.index ? <div className="explore-onboarding"><span className="explore-onboarding-icon"><Layers3 size={32} /></span><h2>{t('exploration.no-project-map-yet')}</h2><Button disabled={!canRun || controller.busy || !repositories.length} onClick={() => void controller.build()}><Sparkles size={16} /> {' '}{t('exploration.build-project-map')}{' '}{repositories.length} {' '}{t('exploration.repositories')}</Button>{!controller.ownerId && <p>{t('exploration.sign-in-first')}</p>}{!controller.configs.length && <Button variant="outline" onClick={controller.configureAI}>{t('exploration.configure-ai-in-settings')}</Button>}</div> : <>
      {choices.length > 0 && <div className="explore-disambiguation"><strong>{t('exploration.choose-what-to-explore')}</strong>{choices.map(entity => <button key={entity.id} onClick={() => choose(entity)}><b>{entity.label}</b><span>{entity.description}</span></button>)}</div>}
      <div className="explore-navigation"><Button size="icon" variant="ghost" aria-label={sidebarOpen ? t('exploration.collapse-saved-explorations') : t('exploration.expand-saved-explorations')} onClick={() => setSidebarOpen(value => !value)}>{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</Button><nav aria-label={t('exploration.exploration-path')}>{path.map((item, index) => <span key={index}>{index > 0 && <span className="explore-path-separator">/</span>}{index === path.length - 1 ? <strong>{item.type === 'all' ? t('exploration.all-library-topics') : item.label}</strong> : <button onClick={() => navigateBack(index)}>{item.type === 'all' ? t('exploration.all-library-topics') : item.label}</button>}</span>)}</nav><div>{path.length > 1 && <Button variant="ghost" size="sm" onClick={() => navigateBack(path.length - 2)}><ArrowLeft size={13} /> {' '}{t('exploration.back')}</Button>}{focus.type === 'topic' && <Button variant="ghost" size="sm" onClick={() => { setName(focus.label); setDialog('rename'); }}><PencilLine size={13} />{t('exploration.rename-topic')}</Button>}<div className="explore-mobile-switch"><Button variant={!mobileMap ? 'secondary' : 'ghost'} size="sm" onClick={() => setMobileMap(false)}><List size={14} />{t('exploration.results')}</Button><Button variant={mobileMap ? 'secondary' : 'ghost'} size="sm" onClick={() => setMobileMap(true)}><Map size={14} />{t('exploration.map')}</Button></div></div></div>
      {activeSaved && <div className="explore-snapshot-status"><span><Bookmark size={14} />{activeSaved.name} {' '}{t('exploration.saved-snapshot')}{' '}{new Date(activeSaved.updatedAt).toLocaleDateString()}<small>{t('exploration.new')}{' '}{changes?.added} {' '}{t('exploration.changed')}{' '}{changes?.changed} {' '}{t('exploration.removed')}{' '}{changes?.removed}</small></span><Button size="sm" variant="outline" disabled={controller.busy || !canRun || !((changes?.added ?? 0)+(changes?.changed ?? 0))} onClick={() => void controller.updateSaved(activeSaved)}>{t('exploration.analyze-new-and-changed-projects')}</Button><Button size="sm" variant="ghost" onClick={() => void controller.editSaved(activeSaved.id, { camera: cameraRef.current, layoutPositions: positionsRef.current, path, kindFilter }).then(ok => { if (ok) setMessage(t('exploration.position-and-filters-saved')); })}>{t('exploration.save-current-position')}</Button></div>}
      <div ref={browserRef} className={`explore-browser ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      {sidebarOpen && <SavedExplorations items={savedAccount?.saved ?? []} selected={selectedSavedId} busy={controller.busy} onOpen={openSaved} onHome={home}
        onRename={item => { setEditingSaved(item); setName(item.name); setDialog('rename-saved'); }}
        onDelete={item => void (async () => { if (await confirm(t('exploration.delete-saved-exploration'), t('exploration.delete-snapshot-confirm', { name: item.name }), { type: 'warning' }) && await controller.deleteSaved(item.id) && activeSaved?.id === item.id) home(); })()}
        onMove={(item,direction) => { const ids = (savedAccount?.saved ?? []).map(row => row.id); const index = ids.indexOf(item.id); [ids[index],ids[index+direction]] = [ids[index+direction],ids[index]]; void controller.reorderSaved(ids); }} />}
      {scene && <div className={`explore-workspace ${mobileMap ? 'show-map' : 'show-results'}`}>
        <ExplorationMap scene={mapScene!} focus={focus} repositories={sceneRepositories} viewKey={`${controller.ownerId}:${selectedSavedId}`} initialCamera={initialCamera} onCameraChange={onCameraChange} initialPositions={initialPositions} onLayoutChange={positions => { positionsRef.current = positions; }} onMoreProjects={() => { setVisible(results.length); setMobileMap(false); listRef.current?.scrollIntoView({ block: 'nearest' }); }} onFocus={navigate} onSelect={(id, anchor) => setSelection({ id, anchor })} onBlank={closeCard} onAllTopics={() => { setTopicQuery(''); setDialog('topics'); }} />
        <aside className="explore-results" aria-label={t('exploration.exploration-project-results')}><header><div><h2>{focus.type === 'all' ? t('exploration.all-projects') : t('exploration.current-exploration-projects')}</h2><b>{results.length}</b></div>{focus.type !== 'all' && focus.type !== 'topic' && focus.type !== 'branch' && <div className="explore-kind-filters"><button aria-pressed={kindFilter === 'all'} onClick={() => setKindFilter('all')}>{t('exploration.all')}</button>{focus.type==='entity' && scene.branches.filter(branch=>branch.label===t('exploration.explicitly-mentioned')||branch.label.startsWith(t('exploration.similar-purpose'))).map(branch=><button key={branch.id} onClick={()=>navigate({type:'branch',targetId:focus.id,branch:branch.label,kind:branch.kind,label:branch.label})}>{branch.label===t('exploration.explicitly-mentioned')?t('exploration.explicitly-mentioned'):branch.label} {branch.count}</button>)}{relationOrder.filter(kind => resultsForRelationKind(scene.results.filter(row=>row.relations.length), kind).length > 0).map(kind => <button key={kind} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>{t(`exploration.relations.${kind}`)} {resultsForRelationKind(scene.results.filter(row=>row.relations.length), kind).length}</button>)}</div>}</header>
          {directionControls}<div className="explore-results-scroll" ref={listRef}>{results.slice(0, visible).map(row => { const repo = repositoryMap.get(row.repositoryId)!; return <article className="explore-result" key={repo.id}>
            <button className="explore-result-title" title={repo.full_name} onClick={event => setSelection({ id: repo.id, anchor: event.currentTarget })}><span className="explore-initial">{repo.name[0]?.toUpperCase()}</span><strong>{repo.name}</strong><ArrowUpRight size={13} /></button>
            <p className="explore-result-owner">{repo.full_name}{removedIds.has(repo.id) && <strong> {' '}{t('exploration.no-longer-in-the-library')}</strong>}</p><p className="explore-result-summary">{scene.profiles[String(repo.id)]?.summary || repositorySummary(repo)}</p>
            <p className="explore-result-reason">{focus.type !== 'all' && focus.type !== 'topic' && <span className={row.verified ? 'is-verified' : 'is-inferred'}>{!row.relations.length && row.localBranch === t('exploration.explicitly-mentioned') ? t('exploration.explicitly-mentioned-relationship-unverified') : `${t(`exploration.relations.${row.kind}`)} · ${row.verified ? t('exploration.verified') : t('exploration.inferred')}`}</span>}{row.reason}</p>
            <div className="explore-result-actions"><button onClick={() => navigate({ type: 'repository', id: repo.id, label: repo.name })}>{t('exploration.explore-from-this-project')}</button><button disabled={removedIds.has(repo.id)} onClick={() => onOpenRepository(repositories.find(live => live.id === repo.id) ?? repo)}>{t('exploration.full-details')}</button><button onClick={() => startEditTopics(repo.id)}>{t('exploration.edit-topics')}</button></div>
            {row.evidence.length > 0 && <details><summary>{t('exploration.relationship-evidence')}{row.evidence.length})</summary><ExplorationEvidenceList evidence={row.evidence} />{row.relations.map(relation => <button className="explore-dismiss-relation" key={relation.id} onClick={() => void appendOverride({ type: 'remove-relation', relationId: relation.id })}>{t('exploration.ignore-incorrect-relationship')}{relation.branch}</button>)}</details>}
          </article>; })}{!results.length && <div className="explore-empty-results"><Search size={25} /><h3>{t('exploration.no-results-in-this-direction')}</h3></div>}{visible < results.length && <Button variant="outline" className="explore-more-results" onClick={() => setVisible(current => current + 40)}>{t('exploration.show-more')}{visible} / {results.length})</Button>}</div>
        </aside>
      </div>}
      </div>
      {focus.type === 'all' && globalScene && globalScene.entities.length > 0 && <div className="explore-ecosystems"><span>{t('exploration.cross-topic-tool-ecosystems')}</span>{globalScene.entities.slice(0, 12).map(entity => <button key={entity.id} onClick={() => { setQuery(entity.label); setSearch(entity.label); choose(entity); }}>{entity.label} ↗</button>)}</div>}
    </>}
    {selectedRepository && selection && <ExplorationProjectCard repository={selectedRepository} result={selectedResult} anchor={selection.anchor} positionKey={JSON.stringify(focus)} onClose={closeCard} onOpen={() => { closeCard(); const live = repositories.find(repo => repo.id === selectedRepository.id); if (live) onOpenRepository(live); }} onExplore={() => navigate({ type: 'repository', id: selectedRepository.id, label: selectedRepository.name })} onEditTopics={() => startEditTopics(selectedRepository.id)} onRemoveRelation={id => void appendOverride({ type: 'remove-relation', relationId: id })} topics={scene?.profiles[String(selectedRepository.id)]?.topics ?? []} entities={scene?.profiles[String(selectedRepository.id)]?.entities ?? []} onFocus={next => { if (next.type === 'entity') { setQuery(next.label); setSearch(next.label); } navigate(next); }} />}
    <Modal isOpen={dialog !== null} onClose={() => { if (!saving) setDialog(null); }} title={dialog === 'save-exploration' ? t('exploration.save-current-exploration') : dialog === 'rename-saved' ? t('exploration.rename-exploration') : dialog === 'corrections' ? t('exploration.manual-corrections') : dialog === 'rename' ? t('exploration.rename-exploration-topic') : dialog === 'edit-project' ? t('exploration.edit-project-exploration-topics') : t('exploration.all-exploration-topics')} maxWidth="max-w-lg">
      {(dialog === 'save-exploration' || dialog === 'rename-saved') && <form className="explore-edit-form" onSubmit={saveExploration}><label>{t('exploration.exploration-name')}<input autoFocus aria-label={t('exploration.exploration-name')} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><Button type="submit" disabled={saving || !name.trim()}>{t('exploration.save')}</Button></form>}
      {dialog === 'topics'  && <div className="explore-topics-dialog"><input aria-label={t('exploration.search-exploration-topics')} placeholder={t('exploration.search-topic-names')} value={topicQuery} onChange={event => setTopicQuery(event.target.value)} />{globalScene?.topics.filter(topic => topic.label.toLowerCase().includes(topicQuery.toLowerCase())).map(topic => <button key={topic.id} onClick={() => { navigate({ type: 'topic', id: topic.id, label: topic.label }); setDialog(null); }}><span>{topic.label}</span><b>{topic.repositoryIds.length}</b></button>)}</div>}
      {dialog === 'rename' && focus.type === 'topic' && <form className="explore-edit-form" onSubmit={saveRename}><label>{t('exploration.name')}<input autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><Button type="submit" disabled={saving || !name.trim()}>{t('exploration.save-topic-name')}</Button></form>}
      {dialog === 'edit-project' && <form className="explore-edit-form" onSubmit={saveProjectTopics}><p>{repositoryMap.get(editingRepository ?? 0)?.full_name} {' '}{t('exploration.select-up-to-8-topics')}</p><div className="explore-topic-checkboxes">{globalScene?.topics.map(topic => <label key={topic.id}><input type="checkbox" checked={chosenTopics.includes(topic.id)} disabled={!chosenTopics.includes(topic.id) && chosenTopics.length >= 8} onChange={() => setChosenTopics(current => current.includes(topic.id) ? current.filter(id => id !== topic.id) : [...current, topic.id])} />{topic.label}</label>)}</div><Button type="submit" disabled={saving}>{t('exploration.save-exploration-topics')}</Button></form>}
      {dialog === 'corrections' && <div className="explore-corrections"><p>{t('exploration.manual-updates-retain-corrections-including-unmatched-records-until')}</p>{!account?.overrides.length && <p>{t('exploration.no-manual-corrections-yet')}</p>}{account?.overrides.map(override => <div key={override.id}><span>{correctionLabel(override)}{scene?.unresolvedOverrides.some(row => row.id === override.id) && <small>{t('exploration.not-matched-in-the-current-index-record-retained')}</small>}</span><Button size="sm" variant="ghost" aria-label={t('exploration.undo-correction', { value: correctionLabel(override) })} onClick={() => void removeCurrentOverride(override.id)}><X size={12} />{t('exploration.undo')}</Button></div>)}</div>}
    </Modal>
  </section>;
}
