import '../../promise-lists.js';
import {chunksFor} from './transactional-state.js';
export const RETAIN_SEASONS=20;
export async function ensureArchives(db){
 if(!db)throw Error('The league D1 database is required.');
 await db.batch([
 db.prepare('CREATE TABLE IF NOT EXISTS recruiting_archives (id TEXT PRIMARY KEY, season INTEGER NOT NULL, stage TEXT NOT NULL, saved_at INTEGER NOT NULL, source_version INTEGER NOT NULL, bytes INTEGER NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS recruiting_archive_chunks (archive_id TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(archive_id,part))'),
 db.prepare('CREATE TABLE IF NOT EXISTS recruiting_archive_uploads (upload_id TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(upload_id,part))')]);
}

export async function writeArchive(db,{season,stage,sourceVersion,payload}){
 const encoder=new TextEncoder(),bytes=encoder.encode(JSON.stringify(payload)).length;
 if(bytes>20000000)throw Error('This cycle exceeds the 20 MB archive limit. Download a backup instead.');
 await ensureArchives(db);
 const id=season+'-'+stage,chunks=chunksFor(payload),uploadId=crypto.randomUUID(),now=Date.now();
 const newer=await db.prepare('SELECT source_version FROM recruiting_archives WHERE id=?').bind(id).first();
 if(newer?.source_version>sourceVersion)throw Error('A newer archive already exists. Refresh first.');
 try{
  await db.prepare('DELETE FROM recruiting_archive_uploads WHERE created_at<?').bind(now-86400000).run();
  // Stage bounded requests. The previous archive stays readable until every
  // chunk is present and one small transaction publishes the complete snapshot.
  let statements=[],size=1024;
  for(const [part,chunk] of chunks.entries()){
   const cost=encoder.encode(JSON.stringify(chunk)).length+1024;
   if(statements.length && size+cost>2_000_000){await db.batch(statements);statements=[];size=1024;}
   statements.push(db.prepare('INSERT INTO recruiting_archive_uploads VALUES (?,?,?,?)').bind(uploadId,part,chunk,now));size+=cost;
  }
  if(statements.length)await db.batch(statements);
  const guard='(SELECT COUNT(*) FROM recruiting_archive_uploads WHERE upload_id=?)=? AND NOT EXISTS(SELECT 1 FROM recruiting_archives WHERE id=? AND source_version>?)';
  const args=[uploadId,chunks.length,id,sourceVersion];
  const result=await db.batch([
   db.prepare('DELETE FROM recruiting_archive_chunks WHERE archive_id=? AND '+guard).bind(id,...args),
   db.prepare('INSERT INTO recruiting_archives SELECT ?,?,?,?,?,? WHERE '+guard+' ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,source_version=excluded.source_version,bytes=excluded.bytes').bind(id,season,stage,now,sourceVersion,bytes,...args),
   db.prepare('INSERT INTO recruiting_archive_chunks SELECT ?,part,content FROM recruiting_archive_uploads WHERE upload_id=? AND '+guard).bind(id,uploadId,...args),
   db.prepare('DELETE FROM recruiting_archives WHERE season NOT IN (SELECT DISTINCT season FROM recruiting_archives ORDER BY season DESC LIMIT ?)').bind(RETAIN_SEASONS),
   db.prepare('DELETE FROM recruiting_archive_chunks WHERE archive_id NOT IN (SELECT id FROM recruiting_archives)'),
   db.prepare('DELETE FROM recruiting_archive_uploads WHERE upload_id=?').bind(uploadId)
  ]);
  if(result[1].meta.changes!==1 || result[2].meta.changes!==chunks.length)throw Error('Archive could not be published. Refresh and archive again; any previous archive was kept.');
  return {id,season,stage};
 }finally{
  try{await db.prepare('DELETE FROM recruiting_archive_uploads WHERE upload_id=?').bind(uploadId).run();}catch{}
 }
}
export function archivePayload(state){
 const prospects={};
 for(const [id,p] of Object.entries(state.prospects || {}))prospects[id]={id,name:p.name,position:p.position,rating:p.rating,commitTeam:p.commitTeam,commitType:p.commitType,homestate:p.homestate,previousTeam:p.previousTeam,grade:p.grade,yearsLeft:p.yearsLeft};
 const offers={};
 for(const [id,rows] of Object.entries(state.offersByProspect || {}))if(prospects[id])offers[id]=rows.map(o=>{
   const listed=globalThis.NZCFLPromiseLists.extract(o.text);
   return {team:o.team,coach:o.coach,text:o.text,promises:listed.length?listed:o.promises,rescinded:!!o.rescinded,createdAt:o.createdAt,editHistory:o.editHistory};
 });
 return {prospects,offers};
}
