import { useT, type TranslateFn } from '../../i18n/useT';
import { translateReadingLabels } from './htmlReadingLabels';
import { useState } from 'react';
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
export function HtmlReadingImport({controller:c}:{controller:Controller}) {
  const t=useT('settings');
  const operationLabels=translateReadingLabels(operationFields,'operation',t);
  const valueLabel=(value:string|boolean)=>typeof value==='boolean'?(value?t('htmlReadingUi.yes'):t('htmlReadingUi.no')):({interested:t('htmlReadingUi.interested'),ignored:t('htmlReadingUi.ignored'),neutral:t('htmlReadingUi.unmarked')}[value]??value)||t('htmlReadingUi.empty');
  const statusLabel={ready:t('htmlReadingUi.readyToApply'),conflict:t('htmlReadingUi.selectionRequired'),duplicate:t('htmlReadingUi.duplicateWillSkip'),stale:t('htmlReadingUi.outdatedWillSkip')};
  const [text,setText]=useState('');const [search,setSearch]=useState('');
  const [files,setFiles]=useState<File[]>([]);const [readingFiles,setReadingFiles]=useState(false);const [batchCurrent,setBatchCurrent]=useState(true);const [readError,setReadError]=useState('');
  const [errorBaseline,setErrorBaseline]=useState<Controller['fileErrors']|null>(null);
  const limits=fileLimits(files,t);
  const inspectFiles=async(selected:File[])=>{
    setBatchCurrent(false);setReadError('');setErrorBaseline(c.fileErrors);
    if(!selected.length||fileLimits(selected,t).length)return;
    setReadingFiles(true);
    try{const contents=await Promise.all(selected.map(async file=>{try{return {name:file.name,text:await file.text()};}catch{throw Error(t('htmlReadingUi.theFileCouldNotBeReadRemove', { v1: file.name }));}}));setBatchCurrent(await c.inspectFiles(contents));}
    catch(error){setReadError(error instanceof Error?error.message:t('htmlReadingUi.theFileCouldNotBeReadRemove20'));}
    finally{setReadingFiles(false);}
  };
  const batch=c.batch;
  const batchErrors=c.fileErrors!==errorBaseline?(c.fileErrors??[]).filter(error=>!files.length||files.some(file=>file.name===error.name)):[];
  const unresolved=batch?.rows.some(row=>row.status==='conflict'&&!c.batchChoices[row.key])||batch?.positions.some(row=>row.status==='conflict'&&!c.batchChoices[row.key]);
  const records=Object.entries(c.data?.states??{}).filter(([id,s])=>(s.read||s.interest!=='neutral'||s.note||s.candidate)&&(c.data?.names[id]??'').toLowerCase().includes(search.toLowerCase()));
  return <>
    <ReadingGroup title={t('htmlReadingUi.importMobileReadingRecords')} description={t('htmlReadingUi.pasteReturnTextOrSelectReturnJson')}>
      <Textarea aria-label={t('htmlReadingUi.mobileReturnText')} placeholder={t('htmlReadingUi.pasteChangesExportedFromYourPhone')} value={text} onChange={e=>setText(e.target.value)} className="min-h-28"/>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={c.busy||readingFiles||!text.trim()} onClick={()=>{setBatchCurrent(false);setErrorBaseline(c.fileErrors);setFiles([]);setReadError('');void c.inspect(text);}}>{t('htmlReadingUi.previewReturnedChanges')}</Button><label className="text-sm">{t('htmlReadingUi.selectReturnFiles')}<input aria-label={t('htmlReadingUi.selectReturnFiles')} multiple type="file" accept=".json,application/json" className="ml-2 max-w-full" disabled={c.busy||readingFiles} onChange={e=>{const selected=Array.from(e.target.files??[]);if(!selected.length)return;setFiles(selected);void inspectFiles(selected);e.target.value='';}}/></label></div>
      <p className="text-xs text-muted-foreground">{t('htmlReadingUi.atMostFilesMbPerFileAnd')}</p>
      {!!files.length&&<div className="space-y-2" aria-label={t('htmlReadingUi.selectedReturnFiles')}>{files.map((file,index)=><div key={`${index}:${file.name}`} className="flex items-center justify-between gap-2 rounded border p-2 text-sm"><span className="break-all">{file.name} · {(file.size/1024).toFixed(1)} KB{batchErrors.find(error=>error.name===file.name)?t('htmlReadingUi.invalid'):batchCurrent&&batch?t('htmlReadingUi.validated'):t('htmlReadingUi.awaitingValidation')}</span><Button size="sm" variant="ghost" disabled={c.busy||readingFiles} aria-label={t('htmlReadingUi.remove', { v1: file.name })} onClick={()=>{setFiles(current=>current.filter((_,i)=>i!==index));setBatchCurrent(false);setErrorBaseline(c.fileErrors);setReadError('');}}>{t('htmlReadingUi.remove33')}</Button></div>)}<Button variant="outline" disabled={c.busy||readingFiles||!!limits.length} onClick={()=>void inspectFiles(files)}>{t('htmlReadingUi.previewSelectedFilesAgain')}</Button>{!batchCurrent&&!readingFiles&&<p className="text-xs text-muted-foreground">{t('htmlReadingUi.theseFilesHaveNotPassedValidationPreview')}</p>}</div>}
      {readingFiles&&<p role="status" className="text-sm">{t('htmlReadingUi.readingAndValidatingReturnFiles')}</p>}
      {limits.map(error=><p key={error} role="alert" className="text-sm text-destructive">{error}</p>)}
      {readError&&<p role="alert" className="text-sm text-destructive">{readError}</p>}
      {batchErrors.map((error,index)=><p key={`${index}:${error.name}`} role="alert" className="text-sm text-destructive">{error.name}：{error.error}{t('htmlReadingUi.removeTheFileAndPreviewAgain')}</p>)}
      {batch&&batchCurrent&&!limits.length&&<div className="space-y-3" aria-label={t('htmlReadingUi.batchReturnPreview')}><p className="text-sm">{batch.files.length} {t('htmlReadingUi.files')}{batch.rows.filter(row=>row.status==='ready').length} {t('htmlReadingUi.applicable')}{batch.rows.filter(row=>row.status==='conflict').length} {t('htmlReadingUi.fieldConflicts')}{batch.rows.filter(row=>row.status==='duplicate').length} {t('htmlReadingUi.duplicates')}</p><div className="max-h-96 space-y-3 overflow-y-auto">{batch.rows.map(row=><article key={row.key} className="space-y-2 rounded-md border p-3 text-sm"><p className="font-medium">{row.name} · {operationLabels[row.field]} · {statusLabel[row.status]}</p><p className="whitespace-pre-wrap break-words">{t('htmlReadingUi.desktop')}{valueLabel(row.current)}</p>{row.sources.map((source,index)=><p key={`${index}:${source.op.id}`} className="whitespace-pre-wrap break-words text-muted-foreground">{source.fileName}：{valueLabel(source.op.value)} · {statusLabel[source.status]}</p>)}{row.status==='conflict'&&<ReadingSelect label={t('htmlReadingUi.batchConflictResolution', { v1: row.name, v2: operationLabels[row.field] })} value={c.batchChoices[row.key]??''} options={[["",t('htmlReadingUi.chooseAnOption')],["desktop",t('htmlReadingUi.keepDesktopContent')],...row.sources.filter((source,index,all)=>source.status!=='duplicate'&&all.findIndex(item=>item.op.id===source.op.id)===index).map(source=>[source.op.id,`${source.fileName}：${valueLabel(source.op.value)}`] as [string,string])]} onChange={value=>c.setBatchChoices(current=>({...current,[row.key]:value}))}/>}</article>)}</div>
        {!!batch.positions.length&&<section aria-label={t('htmlReadingUi.batchReadingPositionPreview')} className="space-y-3 rounded-md border p-3"><h4 className="text-sm font-medium">{t('htmlReadingUi.resumeReadingPosition')}</h4><p className="text-xs text-muted-foreground">{t('htmlReadingUi.chooseTheLatestPositionBySnapshotSequence')}</p>{batch.positions.map(row=><article key={row.key} className="space-y-2 text-sm"><p>{row.viewName} · {row.name} · {statusLabel[row.status]}</p><p className="text-xs">{desktopPositionLabel(row,c,t)}</p>{row.sources.map((source,index)=><p key={`${index}:${source.value.id}`} className="text-xs text-muted-foreground">{source.fileName} · {source.row.viewName} · {source.row.name} {t('htmlReadingUi.snapshot')}{source.sequence} {t('htmlReadingUi.revision')}{source.value.revision}{selectablePositions(row).some(item=>item.value.id===source.value.id)?t('htmlReadingUi.latestCandidate'):t('htmlReadingUi.willSkip')}</p>)}{row.status==='conflict'&&<ReadingSelect label={t('htmlReadingUi.readingPositionConflictResolution', { v1: row.viewName })} value={c.batchChoices[row.key]??''} options={[["",t('htmlReadingUi.chooseAnOption')],["desktop",t('htmlReadingUi.keepDesktopPosition')],...selectablePositions(row).filter((source,index,all)=>all.findIndex(item=>item.value.id===source.value.id)===index).map(source=>[source.value.id,`${source.fileName}：${source.row.viewName} · ${source.row.name}`] as [string,string])]} onChange={value=>c.setBatchChoices(current=>({...current,[row.key]:value}))}/>}</article>)}</section>}
        {!batch.rows.length&&!batch.positions.length&&<p className="text-sm text-muted-foreground">{t('htmlReadingUi.theReturnContainsNoChangesOrReading')}</p>}
        <Button disabled={c.busy||readingFiles||!!batchErrors.length||!!unresolved||(!batch.rows.length&&!batch.positions.length)} onClick={c.applyBatch}>{t('htmlReadingUi.confirmBatchImport')}</Button>
      </div>}
      {c.incoming&&!files.length&&<div className="space-y-3">
        <p className="text-sm">{c.importRows.filter(r=>r.status==='ready').length} {t('htmlReadingUi.applicable')}{c.importRows.filter(r=>r.status==='conflict').length} {t('htmlReadingUi.conflicts')}{c.importRows.filter(r=>r.status==='duplicate').length} {t('htmlReadingUi.duplicates')}</p>
        <div className="max-h-96 space-y-3 overflow-y-auto">{c.importRows.map(row=><div key={row.op.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{row.name} · {operationLabels[row.op.field]}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{t('htmlReadingUi.phone')}{valueLabel(row.op.value)}</p>{row.status==='conflict'?<><p className="mt-1 whitespace-pre-wrap break-words">{t('htmlReadingUi.desktop')}{valueLabel(row.current)}</p><ReadingSelect label={t('htmlReadingUi.conflictResolution', { v1: row.name, v2: operationLabels[row.op.field] })} value={c.choices[row.op.id]??''} onChange={value=>c.setChoices(v=>({...v,[row.op.id]:value as 'phone'|'desktop'}))} options={[["",t('htmlReadingUi.chooseAnOption')],["phone",t('htmlReadingUi.usePhoneChanges')],["desktop",t('htmlReadingUi.keepDesktopContent')]]}/></>:<p className="mt-1 text-xs">{row.status==='duplicate'?t('htmlReadingUi.alreadyImportedWillSkip'):t('htmlReadingUi.thisChangeWillBeApplied')}</p>}</div>)}</div>
        {c.positionRows.length>0&&<section aria-label={t('htmlReadingUi.readingPositionPreview')} className="space-y-2 rounded-md border p-3">
          <h4 className="text-sm font-medium">{t('htmlReadingUi.resumeReadingPosition')}</h4>
          <p className="text-xs text-muted-foreground">{c.positionRows.filter(r=>r.status==='ready').length} {t('htmlReadingUi.positionsToSave')}{c.positionRows.filter(r=>r.status==='stale').length} {t('htmlReadingUi.outdated')}{c.positionRows.filter(r=>r.status==='duplicate').length} {t('htmlReadingUi.duplicatesPositionsApplyToTheNextHtml')}</p>
          <div className="max-h-60 space-y-2 overflow-y-auto">{c.positionRows.map(row=><div key={row.id} className="text-sm">
            <p className="break-words">{row.viewName} · {row.name}</p>
            <p className="text-xs text-muted-foreground">{row.status==='ready'?t('htmlReadingUi.thisPositionWillBeSaved'):row.status==='duplicate'?t('htmlReadingUi.alreadyImportedWillSkip'):t('htmlReadingUi.aNewerPositionExistsThisOneWill')}</p>
          </div>)}</div>
        </section>}
        {c.importRows.length===0&&c.positionRows.length===0&&<p className="text-sm text-muted-foreground">{t('htmlReadingUi.theReturnContainsNoChangesOrReading')}</p>}
        <Button disabled={c.busy||(!c.importRows.length&&!c.positionRows.length)||c.importRows.some(r=>r.status==='conflict'&&!c.choices[r.op.id])} onClick={c.apply}>{t('htmlReadingUi.confirmImport')}</Button>
      </div>}
    </ReadingGroup>
    <ReadingGroup title={t('htmlReadingUi.readingRecordsAndCandidates')} description={t('htmlReadingUi.importedRecordsAreStoredUnderThisAccount')}>
      <input aria-label={t('htmlReadingUi.searchReadingRecords')} placeholder={t('htmlReadingUi.searchProjects')} value={search} onChange={e=>setSearch(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"/>
      <div className="max-h-96 space-y-3 overflow-y-auto">{records.slice(0,100).map(([id,state])=><article key={id} className="space-y-2 rounded-md border p-3"><a href={`https://github.com/${c.data?.names[id]}`} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-medium underline">{c.data?.names[id]??id}</a><p className="text-xs text-muted-foreground">{state.read?t('htmlReadingUi.read'):t('htmlReadingUi.unread')} · {valueLabel(state.interest)}{state.candidate?t('htmlReadingUi.candidate'):''}</p><Textarea aria-label={t('htmlReadingUi.readingNote', { v1: c.data?.names[id] })} defaultValue={state.note} key={`${id}:${state.note}`} onBlur={e=>{if(e.target.value!==state.note)void c.setLocal(id,'note',e.target.value);}} maxLength={12000}/><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={c.busy} onClick={()=>c.setLocal(id,'read',!state.read)}>{state.read?t('htmlReadingUi.markUnread'):t('htmlReadingUi.markRead')}</Button><Button size="sm" variant="outline" disabled={c.busy} onClick={()=>c.setLocal(id,'interest',state.interest==='neutral'?'interested':'neutral')}>{state.interest==='neutral'?t('htmlReadingUi.markInterested'):t('htmlReadingUi.clearInterestMark')}</Button>{state.candidate&&<><Button size="sm" disabled={c.busy} onClick={()=>c.star(id)}>{t('htmlReadingUi.confirmStar')}</Button><Button size="sm" variant="outline" disabled={c.busy} onClick={()=>c.setLocal(id,'candidate',false)}>{t('htmlReadingUi.removeCandidate')}</Button></>}</div></article>)}{records.length===0&&<p className="text-sm text-muted-foreground">{t('htmlReadingUi.noMatchingReadingRecords')}</p>}{records.length>100&&<p className="text-xs text-muted-foreground">{t('htmlReadingUi.showingTheFirstRecordsSearchToNarrow')}</p>}</div>
    </ReadingGroup>
  </>;
}
