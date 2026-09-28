// D1 batches are transactions. All chunk writes are conditional on the same
// version; the last statement advances it. Losing writers change zero rows.
const CHUNK_SIZE=192000;
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
 const statements=chunks.map((chunk,part)=>db.prepare('INSERT INTO league_chunks(part,content) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM league_head WHERE id=1)').bind(part,chunk));
 statements.push(db.prepare('INSERT INTO league_head(id,version) SELECT 1,? WHERE NOT EXISTS(SELECT 1 FROM league_head WHERE id=1)').bind(version));
 await db.batch(statements);
 return readTransactionalState(db);
}
export async function writeTransactionalState(db,state,previous){
 const snapshot=previous?.storageSnapshot;
 if(!snapshot)throw new StateConflict();
 const expected=snapshot.version;
 state.updatedAt=Math.max(Date.now(),expected+1);
 const chunks=chunksFor(state),statements=[];
 chunks.forEach((chunk,part)=>{
  if(snapshot.chunks[part]!==chunk)statements.push(db.prepare('INSERT INTO league_chunks(part,content) SELECT ?,? WHERE EXISTS(SELECT 1 FROM league_head WHERE id=1 AND version=?) ON CONFLICT(part) DO UPDATE SET content=excluded.content').bind(part,chunk,expected));
 });
 statements.push(db.prepare('DELETE FROM league_chunks WHERE part>=? AND EXISTS(SELECT 1 FROM league_head WHERE id=1 AND version=?)').bind(chunks.length,expected));
 statements.push(db.prepare('UPDATE league_head SET version=? WHERE id=1 AND version=?').bind(state.updatedAt,expected));
 const result=await db.batch(statements);
 if(result[result.length-1].meta.changes!==1)throw new StateConflict();
 return state;
}
