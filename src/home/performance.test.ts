import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { HomeDatabase } from './database';
import type { HomeRecord } from './types';

it('keeps a 5000 repository / 10000 message cache across incremental updates without rewriting local edits', async () => {
  const db = new HomeDatabase(crypto.randomUUID());
  const repositories: HomeRecord[] = Array.from({length:5000}, (_,i) => ({ collection:'repositories',id:String(i+1),version:1,seq:i+1,data:{id:i+1,full_name:`owner/repo-${i+1}`,ai_summary:'Cached summary'} }));
  const messages: HomeRecord[] = Array.from({length:10000}, (_,i) => ({ collection:'messages',id:`message-${i}`,version:1,seq:5001+i,data:{id:`message-${i}`,sessionId:'session',content:'Historical message'} }));
  await db.applyRemote([...repositories,...messages],15000,true);
  await db.edit('repositories','1',{id:1,full_name:'owner/repo-1',custom_description:'Offline note'});
  await db.applyRemote([{...repositories[1],version:2,seq:15001,data:{...repositories[1].data,ai_summary:'Updated'}}],15001);
  expect(await db.list('repositories')).toHaveLength(5000);
  expect(await db.list('messages')).toHaveLength(10000);
  expect((await db.pending())[0].data?.custom_description).toBe('Offline note');
  expect(await db.metadata('cursor')).toBe(15001);
},15000);
