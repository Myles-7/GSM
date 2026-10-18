import { getStorageEntriesStrict, indexedDBStorage, setStorageEntries } from './indexedDbStorage';
import type { StarSyncCheckpoint } from './githubApi';
import type { Repository } from '../types';
import {z} from 'zod';
const name=(owner:string)=>`gsm:star-sync:${encodeURIComponent(owner)}`;
const metadata=z.object({version:z.literal(1),nextPage:z.number().int().min(2).max(10000),startedAt:z.string().datetime(),firstPageIds:z.array(z.number().int().positive().refine(Number.isSafeInteger)).max(100)}).strict();
const pageSchema=z.array(z.object({id:z.number().int().positive().refine(Number.isSafeInteger),full_name:z.string().regex(/^[\w.-]+\/[\w.-]+$/)}).passthrough()).max(100);
export async function readStarSyncCheckpoint(owner:string):Promise<StarSyncCheckpoint|undefined> {
  const base=name(owner),[raw]=await getStorageEntriesStrict(base,[`${base}#meta`]);if(!raw)return;
  let meta:Omit<StarSyncCheckpoint,'repositories'>;
  try{meta=metadata.parse(JSON.parse(raw));}catch{await clearStarSyncCheckpoint(owner);return;}
  const age=Date.now()-Date.parse(meta.startedAt);if(age<0||age>=3600000){await clearStarSyncCheckpoint(owner);return;}
  const rows=await getStorageEntriesStrict(base,Array.from({length:meta.nextPage-1},(_,i)=>`${base}#page:${i+1}`));
  try{
    if(rows.some(row=>row===null))throw Error('STAR_CHECKPOINT_INCOMPLETE');
    const pages=rows.map(row=>pageSchema.parse(JSON.parse(row!)) as unknown as Repository[]);
    if(pages.slice(0,-1).some(page=>page.length!==100)||JSON.stringify(pages[0].map(repo=>repo.id))!==JSON.stringify(meta.firstPageIds))throw Error('STAR_CHECKPOINT_BOUNDARY');
    return {...meta,repositories:pages.flat()};
  }catch{await clearStarSyncCheckpoint(owner);return;}
}
export async function writeStarSyncCheckpoint(owner:string,meta:Omit<StarSyncCheckpoint,'repositories'>,page:number,rows:Repository[]) {
  metadata.parse(meta);pageSchema.parse(rows);
  if(!Number.isInteger(page)||page<1||meta.nextPage!==page+1)throw Error('STAR_CHECKPOINT_BOUNDARY');
  const base=name(owner);
  await setStorageEntries(base,[[`${base}#page:${page}`,JSON.stringify(rows)],[`${base}#meta`,JSON.stringify(meta)]]);
}
export const clearStarSyncCheckpoint=(owner:string)=>indexedDBStorage.removeItem(name(owner));
