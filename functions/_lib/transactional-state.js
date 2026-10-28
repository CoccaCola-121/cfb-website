// D1 batches are transactions. All chunk writes are conditional on the same
// version; the last statement advances it. Losing writers change zero rows.
const CHUNK_SIZE=192000;
// Large Settings edits shift almost every chunk of the board. Stage their data
// in bounded requests, then publish it in one small, version-checked transaction.
// Readers continue to see only league_chunks; staging never exposes a partial save.
const MAX_BATCH_BYTES=2_000_000;
const encoder=new TextEncoder();
export class StateConflict extends Error {
 constructor(){super('The league changed before saving. Retry with the latest board.');this.status=409;}
}
export function chunksFor(state){
 const text=JSON.stringify(state),chunks=[];
 for(let start=0;start<text.length;){
  let end=Math.min(text.length,start+CHUNK_SIZE);
  if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]))end--;
  chunks.push(text.slice(start,end));start=end;
 }
 return chunks;
}
export async function readTransactionalState(db){
 const result=await db.prepare('SELECT h.version,c.part,c.content FROM league_head h LEFT JOIN league_chunks c ON 1=1 WHERE h.id=1 ORDER BY c.part').all();
 if(!result.results?.length)return null;
 const chunks=result.results.filter(row=>row.part!=null).map(row=>row.content);
 const state=JSON.parse(chunks.join(''));
 Object.defineProperty(state,'storageSnapshot',{value:{version:result.results[0].version,chunks},enumerable:false});
 return state;
}
export async function initializeTransactionalState(db,state){
 const version=state.updatedAt || Date.now();
 const chunks=chunksFor({...state,updatedAt:version});
 await publishChunks(db,chunks.map((content,part)=>({content,part})),chunks.length,version,null);
 return readTransactionalState(db);
}
export async function writeTransactionalState(db,state,previous){
 const snapshot=previous?.storageSnapshot;
 if(!snapshot)throw new StateConflict();
 const expected=snapshot.version;
 state.updatedAt=Math.max(Date.now(),expected+1);
 const chunks=chunksFor(state),changes=[];
 chunks.forEach((chunk,part)=>{
  if(snapshot.chunks[part]!==chunk)changes.push({content:chunk,part});
 });
 if(!await publishChunks(db,changes,chunks.length,state.updatedAt,expected))throw new StateConflict();
 return state;
}

async function publishChunks(db,changes,length,version,expected){
 const initial=expected===null;
 const guard=initial?'NOT EXISTS(SELECT 1 FROM league_head WHERE id=1)':'EXISTS(SELECT 1 FROM league_head WHERE id=1 AND version=?)';
 const guardArgs=initial?[]:[expected];
 const upsert=initial?'':' ON CONFLICT(part) DO UPDATE SET content=excluded.content';
 // Count JSON escaping and UTF-8 bytes, leaving room for SQL and parameter metadata.
 const sizes=changes.map(row=>encoder.encode(JSON.stringify(row.content)).length+1024);
 const staged=sizes.reduce((sum,size)=>sum+size,1024)>MAX_BATCH_BYTES;
 let writeId;
 try{
  if(staged){
   writeId=crypto.randomUUID();
   const now=Date.now();
   await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS league_pending_chunks (write_id TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(write_id,part))'),
    db.prepare('DELETE FROM league_pending_chunks WHERE created_at<?').bind(now-86400000),
   ]);
   let batch=[],bytes=0;
   const upload=async()=> (await db.batch(batch)).every(result=>result.meta.changes===1);
   for(let i=0;i<changes.length;i++){
    if(batch.length && bytes+sizes[i]>MAX_BATCH_BYTES){if(!await upload())return false;batch=[];bytes=0;}
    const row=changes[i];
    // Stop uploading as soon as another writer wins instead of filling staging
    // with the rest of a board that can no longer be published.
    batch.push(db.prepare('INSERT INTO league_pending_chunks(write_id,part,content,created_at) SELECT ?,?,?,? WHERE '+guard).bind(writeId,row.part,row.content,now,...guardArgs));
    bytes+=sizes[i];
   }
   if(batch.length && !await upload())return false;
  }
  // The count guard also prevents a missing/expired staging row from publishing
  // an incomplete board. The final version check protects against concurrent saves.
  const complete=staged?' AND (SELECT COUNT(*) FROM league_pending_chunks WHERE write_id=?)=?':'';
  const completeArgs=staged?[writeId,changes.length]:[];
  const statements=staged?[
   db.prepare('INSERT INTO league_chunks(part,content) SELECT part,content FROM league_pending_chunks WHERE write_id=? AND '+guard+complete+upsert).bind(writeId,...guardArgs,...completeArgs),
  ]:changes.map(row=>db.prepare('INSERT INTO league_chunks(part,content) SELECT ?,? WHERE '+guard+upsert).bind(row.part,row.content,...guardArgs));
  statements.push(db.prepare('DELETE FROM league_chunks WHERE part>=? AND '+guard+complete).bind(length,...guardArgs,...completeArgs));
  statements.push(initial?
   db.prepare('INSERT INTO league_head(id,version) SELECT 1,? WHERE '+guard+complete).bind(version,...completeArgs):
   db.prepare('UPDATE league_head SET version=? WHERE id=1 AND version=?'+complete).bind(version,expected,...completeArgs));
  const headIndex=statements.length-1;
  if(staged)statements.push(db.prepare('DELETE FROM league_pending_chunks WHERE write_id=?').bind(writeId));
  const result=await db.batch(statements);
  writeId=null;
  return result[headIndex].meta.changes===1;
 }finally{
  // Failed uploads never change the active board. Remove their temporary rows;
  // the age-based cleanup above handles interrupted requests as well.
  if(writeId)try{await db.batch([db.prepare('DELETE FROM league_pending_chunks WHERE write_id=?').bind(writeId)]);}catch{}
 }
}
