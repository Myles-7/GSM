import { openReadingDb } from './storage';
export async function readingCacheStatistics(account:string,clear=false) {
  if(!/^\d+$/.test(account))throw Error('账户无效');
  const db=await openReadingDb();
  try {return await new Promise<{entries:number;bytes:number} >((resolve,reject)=>{
    const tx=db.transaction('discovery-cache',clear?'readwrite':'readonly');let entries=0,bytes=0;
    const request=tx.objectStore('discovery-cache').index('account').openCursor(IDBKeyRange.only(account));
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;entries++;bytes+=Number(cursor.value.bytes)||0;if(clear)cursor.delete();cursor.continue();};
    tx.oncomplete=()=>resolve({entries,bytes});tx.onabort=tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
