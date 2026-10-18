import { useT, type TranslateFn } from '../../i18n/useT';
import { translateReadingLabels } from './htmlReadingLabels';
import { useEffect, useState } from 'react';
import { HtmlReadingCandidates } from './HtmlReadingCandidates';
import { HtmlReadingRecords } from './HtmlReadingRecords';
import { ReadingImportRows } from './ReadingImportRows';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import type { BatchPositionRow } from '../../lib/html-reading/batch';
import { operationFields } from '../../lib/html-reading/model';
import { ReadingGroup, ReadingSelect } from './HtmlReadingFields';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
type Controller=ReturnType<typeof useHtmlReading>;
function selectablePositions(row:BatchPositionRow) {
  if(row.status==='stale'||row.status==='duplicate')return [];
  const pending=row.sources.filter(source=>source.row.status!=='duplicate');
  const newest=[...pending].sort((a,b)=>b.sequence-a.sequence||b.value.revision-a.value.revision)[0];
  return newest?pending.filter(source=>source.sequence===newest.sequence&&source.value.revision===newest.value.revision):[];
}
function fileLimits(files:File[],t:TranslateFn) {
  const errors:string[]=[];
  if(files.length>20)errors.push(t('htmlReadingUi.selectAtMostReturnFilesAtA'));
  if(files.reduce((total,file)=>total+file.size,0)>20*1024*1024)errors.push(t('htmlReadingUi.theTotalFileSizeExceedsMibRemove'));
  for(const file of files)if(file.size>4_000_000)errors.push(t('htmlReadingUi.thisFileExceedsMbBytes', { v1: file.name }));
  return errors;
}
function desktopPositionLabel(row:BatchPositionRow,c:Controller,t:TranslateFn) {
  if(!row.current)return t('htmlReadingUi.desktopNoSavedReadingPosition');
  try{
    const value=JSON.parse(row.current) as {viewId:string;repoId?:number;sequence:number;revision:number};
    const snapshotName=Object.values(c.data?.snapshots??{}).map(snapshot=>snapshot.viewNames?.[value.viewId]).find(Boolean);
    const viewName=snapshotName??(value.viewId==='repositories'?t('htmlReadingUi.repositories'):c.catalog?.channels.find(channel=>channel.id===value.viewId)?.name??value.viewId);
    const name=value.repoId?c.data?.names[String(value.repoId)]??t('htmlReadingUi.project', { v1: value.repoId }):t('htmlReadingUi.pageToOpenNext');
    return t('htmlReadingUi.desktopSnapshotRevision', { v1: viewName, v2: name, v3: value.sequence, v4: value.revision });
  }catch{return t('htmlReadingUi.desktopTheSavedPositionCannotBeDisplayed');}
}
export function HtmlReadingImport({controller:c,guided=false,onProjects}:{controller:Controller;guided?:boolean;onProjects?:()=>void}) {
  const t=useT('settings');
  const [method,setMethod]=useState<'file'|'paste'|null>(null);
  const [validatedText,setValidatedText]=useState('');
  const [step,setStep]=useState<'choose'|'preview'|'done'>('choose');
  const busy=c.busy||c.candidates?.busy||false;
  const operationLabels=translateReadingLabels(operationFields,'operation',t);
  const valueLabel=(value:string|boolean)=>typeof value==='boolean'?(value?t('htmlReadingUi.yes'):t('htmlReadingUi.no')):({interested:t('htmlReadingUi.interested'),ignored:t('htmlReadingUi.ignored'),neutral:t('htmlReadingUi.unmarked')}[value]??value)||t('htmlReadingUi.empty');
  const statusLabel={ready:t('htmlReadingUi.readyToApply'),conflict:t('htmlReadingUi.selectionRequired'),duplicate:t('htmlReadingUi.duplicateWillSkip'),stale:t('htmlReadingUi.outdatedWillSkip')};
  const [text,setText]=useState('');const [tab,setTab]=useState('import');
  useEffect(()=>{setTab('import');setText('');setMethod(null);setStep('choose');setValidatedText('');setFiles([]);setReadError('');setBatchCurrent(true);},[c.account]);
  useEffect(()=>{if(c.lastImportSummary)setStep('done');},[c.lastImportSummary,c.account]);
  const [files,setFiles]=useState<File[]>([]);const [readingFiles,setReadingFiles]=useState(false);const [batchCurrent,setBatchCurrent]=useState(true);const [readError,setReadError]=useState('');
  const [errorBaseline,setErrorBaseline]=useState<Controller['fileErrors']|null>(null);
  const limits=fileLimits(files,t);
  const inspectFiles=async(selected:File[])=>{
    setBatchCurrent(false);setReadError('');setErrorBaseline(c.fileErrors);
    if(!selected.length||fileLimits(selected,t).length)return;
    setReadingFiles(true);
    try{const contents=await Promise.all(selected.map(async file=>{try{return {name:file.name,text:await file.text()};}catch{throw Error(t('htmlReadingUi.theFileCouldNotBeReadRemove', { v1: file.name }));}}));const valid=await c.inspectFiles(contents);setBatchCurrent(valid);if(valid)setStep('preview');}
    catch(error){setReadError(error instanceof Error?error.message:t('htmlReadingUi.theFileCouldNotBeReadRemove20'));}
    finally{setReadingFiles(false);}
  };
  const batch=c.batch;
  const batchErrors=c.fileErrors!==errorBaseline?(c.fileErrors??[]).filter(error=>!files.length||files.some(file=>file.name===error.name)):[];
  const unresolved=batch?.rows.some(row=>row.status==='conflict'&&!c.batchChoices[row.key])||batch?.positions.some(row=>row.status==='conflict'&&!c.batchChoices[row.key]);
  const skippedBatchRows=batch?.rows.filter(row=>row.status==='duplicate'||row.status==='ready'&&row.sources.every(source=>source.status==='duplicate'||source.op.value===row.current))??[];
  const actionableBatchRows=batch?.rows.filter(row=>!skippedBatchRows.includes(row))??[];
  const skippedRows=c.importRows.filter(row=>row.status==='duplicate'||row.status==='ready'&&row.op.value===row.current);
  const actionableRows=c.importRows.filter(row=>!skippedRows.includes(row));
  const setStateConflicts=(phone:boolean)=>{
    if(batch)c.setBatchChoices(current=>{const next={...current};for(const row of batch.rows){if(row.status!=='conflict'||row.field==='note')continue;const pending=row.sources.filter(source=>source.status!=='duplicate');if(phone&&new Set(pending.map(source=>JSON.stringify(source.op.value))).size!==1)continue;next[row.key]=phone?pending[0].op.id:'desktop';}return next;});
    else c.setChoices(current=>{const next={...current};for(const row of c.importRows){if(row.status!=='conflict'||row.op.field==='note')continue;if(phone&&new Set(c.importRows.filter(item=>item.op.repoId===row.op.repoId&&item.op.field===row.op.field&&item.status!=='duplicate').map(item=>JSON.stringify(item.op.value))).size!==1)continue;next[row.op.id]=phone?'phone':'desktop';}return next;});
  };
  const summary=batch?{projects:new Set(batch.rows.map(row=>row.repoId)).size,fields:actionableBatchRows.length,candidates:actionableBatchRows.filter(row=>row.field==='candidate'&&row.sources.some(source=>source.op.value===true)).length,conflicts:batch.rows.filter(row=>row.status==='conflict').length+batch.positions.filter(row=>row.status==='conflict').length,positions:batch.positions.filter(row=>row.status==='ready'||row.status==='conflict').length}:{projects:new Set(c.importRows.map(row=>row.op.repoId)).size,fields:actionableRows.length,candidates:actionableRows.filter(row=>row.op.field==='candidate'&&row.op.value===true).length,conflicts:c.importRows.filter(row=>row.status==='conflict').length,positions:c.positionRows.filter(row=>row.status==='ready').length};
  return <Tabs value={tab} onValueChange={setTab} className="space-y-4">
    <TabsList hidden={guided} aria-label={t('htmlReadingWorkflow.importSummary')} className="h-auto flex-wrap justify-start"><TabsTrigger value="import">{t('htmlReadingWorkflow.importTab')}</TabsTrigger><TabsTrigger value="candidates">{t('htmlReadingWorkflow.candidates')} ({c.candidates?.items.length??0})</TabsTrigger><TabsTrigger value="records">{t('htmlReadingWorkflow.records')}</TabsTrigger></TabsList>
    <TabsContent value="import" hidden={tab!=='import'} forceMount className="data-[state=inactive]:hidden">
    {guided&&<ol aria-label={t('dailyReading.importSteps')} className="mb-4 flex flex-wrap gap-2 text-sm">{(['choose','preview','done'] as const).map((id,index)=><li key={id} aria-current={step===id?'step':undefined} className={step===id?'rounded-md bg-secondary px-3 py-2 font-medium':'px-3 py-2 text-muted-foreground'}>{index+1}. {t(`dailyReading.step.${id}`)}</li>)}</ol>}
    <ReadingGroup title={t('htmlReadingUi.importMobileReadingRecords')} description={t('htmlReadingUi.pasteReturnTextOrSelectReturnJson')}>
      {guided&&<div className="flex flex-wrap gap-3"><Button variant={method==='file'?'secondary':'outline'} disabled={busy||readingFiles} onClick={()=>{setMethod('file');setStep('choose');}}>{t('dailyReading.selectFiles')}</Button><Button variant={method==='paste'?'secondary':'outline'} disabled={busy||readingFiles} onClick={()=>{setMethod('paste');setStep('choose');}}>{t('dailyReading.pasteRecords')}</Button></div>}
      <div hidden={guided&&method!=='paste'}><Textarea aria-label={t('htmlReadingUi.mobileReturnText')} placeholder={t('htmlReadingUi.pasteChangesExportedFromYourPhone')} value={text} onChange={e=>{setText(e.target.value);if(guided)setStep('choose');}} className="min-h-28"/>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy||readingFiles||!text.trim()} onClick={()=>{setBatchCurrent(false);setErrorBaseline(c.fileErrors);setFiles([]);setReadError('');setValidatedText(text);setStep('preview');void c.inspect(text);}}>{t('htmlReadingUi.previewReturnedChanges')}</Button></div></div><div hidden={guided&&method!=='file'}><label className="text-sm">{t('htmlReadingUi.selectReturnFiles')}<input aria-label={t('htmlReadingUi.selectReturnFiles')} multiple type="file" accept=".json,application/json" className="ml-2 max-w-full" disabled={busy||readingFiles} onChange={e=>{const selected=Array.from(e.target.files??[]);if(!selected.length)return;setFiles(selected);void inspectFiles(selected);e.target.value='';}}/></label></div>
      <p className="text-xs text-muted-foreground">{t('htmlReadingUi.atMostFilesMbPerFileAnd')}</p>
      {!!files.length&&<div className="space-y-2" aria-label={t('htmlReadingUi.selectedReturnFiles')}>{files.map((file,index)=><div key={`${index}:${file.name}`} className="flex items-center justify-between gap-2 rounded border p-2 text-sm"><span className="break-all">{file.name} · {(file.size/1024).toFixed(1)} KB{batchErrors.find(error=>error.name===file.name)?t('htmlReadingUi.invalid'):batchCurrent&&batch?t('htmlReadingUi.validated'):t('htmlReadingUi.awaitingValidation')}</span><Button size="sm" variant="ghost" disabled={busy||readingFiles} aria-label={t('htmlReadingUi.remove', { v1: file.name })} onClick={()=>{setFiles(current=>current.filter((_,i)=>i!==index));setBatchCurrent(false);setErrorBaseline(c.fileErrors);setReadError('');}}>{t('htmlReadingUi.remove33')}</Button></div>)}<Button variant="outline" disabled={busy||readingFiles||!!limits.length} onClick={()=>void inspectFiles(files)}>{t('htmlReadingUi.previewSelectedFilesAgain')}</Button>{!batchCurrent&&!readingFiles&&<p className="text-xs text-muted-foreground">{t('htmlReadingUi.theseFilesHaveNotPassedValidationPreview')}</p>}</div>}
      {readingFiles&&<p role="status" className="text-sm">{t('htmlReadingUi.readingAndValidatingReturnFiles')}</p>}
      {limits.map(error=><p key={error} role="alert" className="text-sm text-destructive">{error}</p>)}
      {readError&&<p role="alert" className="text-sm text-destructive">{readError}</p>}
      {batchErrors.map((error,index)=><p key={`${index}:${error.name}`} role="alert" className="text-sm text-destructive">{error.name}：{error.error}{t('htmlReadingUi.removeTheFileAndPreviewAgain')}</p>)}
      {c.lastImportSummary&&(!guided||step==='done')&&<section aria-label={t('htmlReadingWorkflow.importSummary')} className="space-y-2 rounded-md border p-3"><p className="text-sm font-medium">{t('htmlReadingWorkflow.appliedSummary')}</p><p className="text-sm text-muted-foreground">{t('htmlReadingWorkflow.previewSummary',{projects:c.lastImportSummary.projects,fields:c.lastImportSummary.applied,candidates:c.lastImportSummary.candidates,conflicts:0,positions:c.lastImportSummary.positionApplied})}</p><p className="text-sm text-muted-foreground">{t('htmlReadingWorkflow.importSkipped',{duplicate:c.lastImportSummary.duplicate,unchanged:c.lastImportSummary.unchanged??0,kept:c.lastImportSummary.kept,positions:c.lastImportSummary.positionStale+c.lastImportSummary.positionDuplicate})}</p><Button variant="outline" onClick={()=>guided?onProjects?.():setTab('candidates')}>{t(guided?'dailyReading.browseImported':'htmlReadingWorkflow.showCandidates')}</Button></section>}
      {batch&&batchCurrent&&!limits.length&&(!guided||method==='file'&&step==='preview')&&<div className="space-y-3" aria-label={t('htmlReadingUi.batchReturnPreview')}><p className="text-sm font-medium">{t('htmlReadingWorkflow.previewSummary',summary)}</p>{summary.conflicts>0&&<div className="space-y-2"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={()=>setStateConflicts(false)}>{t('htmlReadingWorkflow.resolveDesktop')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setStateConflicts(true)}>{t('htmlReadingWorkflow.resolvePhone')}</Button></div><p className="text-xs text-muted-foreground">{t('htmlReadingWorkflow.manualConflictHint')}</p></div>}<p className="text-sm">{batch.files.length} {t('htmlReadingUi.files')}{batch.rows.filter(row=>row.status==='ready').length} {t('htmlReadingUi.applicable')}{batch.rows.filter(row=>row.status==='conflict').length} {t('htmlReadingUi.fieldConflicts')}{batch.rows.filter(row=>row.status==='duplicate').length} {t('htmlReadingUi.duplicates')}</p><ReadingImportRows rows={actionableBatchRows} guided={guided} renderRow={row=><article key={row.key} className="space-y-2 rounded-md border p-3 text-sm"><p className="font-medium">{row.name} · {operationLabels[row.field]} · {statusLabel[row.status]}</p><p className="whitespace-pre-wrap break-words">{t('htmlReadingUi.desktop')}{valueLabel(row.current)}</p>{row.sources.map((source,index)=><p key={`${index}:${source.op.id}`} className="whitespace-pre-wrap break-words text-muted-foreground">{source.fileName}：{valueLabel(source.op.value)} · {statusLabel[source.status]}</p>)}{row.status==='conflict'&&<ReadingSelect label={t('htmlReadingUi.batchConflictResolution', { v1: row.name, v2: operationLabels[row.field] })} value={c.batchChoices[row.key]??''} options={[["",t('htmlReadingUi.chooseAnOption')],["desktop",t('htmlReadingUi.keepDesktopContent')],...row.sources.filter((source,index,all)=>source.status!=='duplicate'&&all.findIndex(item=>item.op.id===source.op.id)===index).map(source=>[source.op.id,`${source.fileName}：${valueLabel(source.op.value)}`] as [string,string])]} onChange={value=>c.setBatchChoices(current=>({...current,[row.key]:value}))}/>}</article>}/>
        {skippedBatchRows.length>0&&<details className="rounded-md border p-3"><summary className="cursor-pointer text-sm">{t('htmlReadingWorkflow.skippedDetails',{count:skippedBatchRows.length})}</summary><div className="mt-2 space-y-2">{skippedBatchRows.map(row=><p key={row.key} className="text-sm">{row.name} · {operationLabels[row.field]} · {row.status==='ready'?t('htmlReadingWorkflow.unchanged'):statusLabel[row.status]}</p>)}</div></details>}
        {!!batch.positions.length&&<section aria-label={t('htmlReadingUi.batchReadingPositionPreview')} className="space-y-3 rounded-md border p-3"><h4 className="text-sm font-medium">{t('htmlReadingUi.resumeReadingPosition')}</h4><p className="text-xs text-muted-foreground">{t('htmlReadingUi.chooseTheLatestPositionBySnapshotSequence')}</p>{batch.positions.map(row=><details key={row.key} open={row.status==='ready'||row.status==='conflict'}><summary className="cursor-pointer text-sm">{row.viewName} · {statusLabel[row.status]}</summary><article className="space-y-2 text-sm"><p>{row.viewName} · {row.name} · {statusLabel[row.status]}</p><p className="text-xs">{desktopPositionLabel(row,c,t)}</p>{row.sources.map((source,index)=><p key={`${index}:${source.value.id}`} className="text-xs text-muted-foreground">{source.fileName} · {source.row.viewName} · {source.row.name} {t('htmlReadingUi.snapshot')}{source.sequence} {t('htmlReadingUi.revision')}{source.value.revision}{selectablePositions(row).some(item=>item.value.id===source.value.id)?t('htmlReadingUi.latestCandidate'):t('htmlReadingUi.willSkip')}</p>)}{row.status==='conflict'&&<ReadingSelect label={t('htmlReadingUi.readingPositionConflictResolution', { v1: row.viewName })} value={c.batchChoices[row.key]??''} options={[["",t('htmlReadingUi.chooseAnOption')],["desktop",t('htmlReadingUi.keepDesktopPosition')],...selectablePositions(row).filter((source,index,all)=>all.findIndex(item=>item.value.id===source.value.id)===index).map(source=>[source.value.id,`${source.fileName}：${source.row.viewName} · ${source.row.name}`] as [string,string])]} onChange={value=>c.setBatchChoices(current=>({...current,[row.key]:value}))}/>}</article></details>)}</section>}
        {!batch.rows.length&&!batch.positions.length&&<p className="text-sm text-muted-foreground">{t('htmlReadingUi.theReturnContainsNoChangesOrReading')}</p>}
        <Button disabled={busy||readingFiles||!!batchErrors.length||!!unresolved||(!batch.rows.length&&!batch.positions.length)} onClick={c.applyBatch}>{t('htmlReadingUi.confirmBatchImport')}</Button>
      </div>}
      {c.incoming&&!files.length&&(!guided||method==='paste'&&step==='preview'&&validatedText===text)&&<div className="space-y-3">
        <p className="text-sm font-medium">{t('htmlReadingWorkflow.previewSummary',summary)}</p>
        {summary.conflicts>0&&<div className="space-y-2"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={()=>setStateConflicts(false)}>{t('htmlReadingWorkflow.resolveDesktop')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setStateConflicts(true)}>{t('htmlReadingWorkflow.resolvePhone')}</Button></div><p className="text-xs text-muted-foreground">{t('htmlReadingWorkflow.manualConflictHint')}</p></div>}
        <p className="text-sm">{c.importRows.filter(r=>r.status==='ready').length} {t('htmlReadingUi.applicable')}{c.importRows.filter(r=>r.status==='conflict').length} {t('htmlReadingUi.conflicts')}{c.importRows.filter(r=>r.status==='duplicate').length} {t('htmlReadingUi.duplicates')}</p>
        <ReadingImportRows rows={actionableRows} guided={guided} renderRow={row=><div key={row.op.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{row.name} · {operationLabels[row.op.field]}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{t('htmlReadingUi.phone')}{valueLabel(row.op.value)}</p>{row.status==='conflict'?<><p className="mt-1 whitespace-pre-wrap break-words">{t('htmlReadingUi.desktop')}{valueLabel(row.current)}</p><ReadingSelect label={t('htmlReadingUi.conflictResolution', { v1: row.name, v2: operationLabels[row.op.field] })} value={c.choices[row.op.id]??''} onChange={value=>c.setChoices(v=>({...v,[row.op.id]:value as 'phone'|'desktop'}))} options={[["",t('htmlReadingUi.chooseAnOption')],["phone",t('htmlReadingUi.usePhoneChanges')],["desktop",t('htmlReadingUi.keepDesktopContent')]]}/></>:<p className="mt-1 text-xs">{row.status==='duplicate'?t('htmlReadingUi.alreadyImportedWillSkip'):t('htmlReadingUi.thisChangeWillBeApplied')}</p>}</div>}/>
        {skippedRows.length>0&&<details className="rounded-md border p-3"><summary className="cursor-pointer text-sm">{t('htmlReadingWorkflow.skippedDetails',{count:skippedRows.length})}</summary><div className="mt-2 space-y-2">{skippedRows.map(row=><p key={row.op.id} className="text-sm">{row.name} · {operationLabels[row.op.field]} · {row.status==='ready'?t('htmlReadingWorkflow.unchanged'):statusLabel[row.status]}</p>)}</div></details>}
        {c.positionRows.length>0&&<section aria-label={t('htmlReadingUi.readingPositionPreview')} className="space-y-2 rounded-md border p-3">
          <h4 className="text-sm font-medium">{t('htmlReadingUi.resumeReadingPosition')}</h4>
          <p className="text-xs text-muted-foreground">{c.positionRows.filter(r=>r.status==='ready').length} {t('htmlReadingUi.positionsToSave')}{c.positionRows.filter(r=>r.status==='stale').length} {t('htmlReadingUi.outdated')}{c.positionRows.filter(r=>r.status==='duplicate').length} {t('htmlReadingUi.duplicatesPositionsApplyToTheNextHtml')}</p>
          <div className="max-h-60 space-y-2 overflow-y-auto">{c.positionRows.map(row=><details key={row.id} open={row.status==='ready'}><summary className="cursor-pointer text-xs text-muted-foreground">{row.viewName} · {statusLabel[row.status]}</summary><div className="text-sm">
            <p className="break-words">{row.viewName} · {row.name}</p>
            <p className="text-xs text-muted-foreground">{row.status==='ready'?t('htmlReadingUi.thisPositionWillBeSaved'):row.status==='duplicate'?t('htmlReadingUi.alreadyImportedWillSkip'):t('htmlReadingUi.aNewerPositionExistsThisOneWill')}</p>
          </div></details>)}</div>
        </section>}
        {c.importRows.length===0&&c.positionRows.length===0&&<p className="text-sm text-muted-foreground">{t('htmlReadingUi.theReturnContainsNoChangesOrReading')}</p>}
        <Button disabled={busy||(!c.importRows.length&&!c.positionRows.length)||c.importRows.some(r=>r.status==='conflict'&&!c.choices[r.op.id])} onClick={c.apply}>{t('htmlReadingUi.confirmImport')}</Button>
      </div>}
    </ReadingGroup>
    </TabsContent>
    <TabsContent value="candidates" hidden={tab!=='candidates'} forceMount className="data-[state=inactive]:hidden">{!guided&&c.candidates&&<HtmlReadingCandidates key={c.account} controller={c.candidates} lastImportId={c.lastImportId}/>}</TabsContent>
    <TabsContent value="records" hidden={tab!=='records'} forceMount className="data-[state=inactive]:hidden">{!guided&&<HtmlReadingRecords key={c.account} data={c.data} busy={busy} onSave={c.setLocal}/>}</TabsContent>
  </Tabs>;
}
