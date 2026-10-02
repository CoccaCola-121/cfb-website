export const RETAIN_SEASONS=20;
export async function ensureArchives(db){
 if(!db)throw Error('The league D1 database is required.');
 await db.batch([
 db.prepare('CREATE TABLE IF NOT EXISTS recruiting_archives (id TEXT PRIMARY KEY, season INTEGER NOT NULL, stage TEXT NOT NULL, saved_at INTEGER NOT NULL, source_version INTEGER NOT NULL, bytes INTEGER NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS recruiting_archive_chunks (archive_id TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(archive_id,part))')]);
}
export function archivePayload(state){
 const prospects={};
 for(const [id,p] of Object.entries(state.prospects || {}))prospects[id]={id,name:p.name,position:p.position,rating:p.rating,commitTeam:p.commitTeam,commitType:p.commitType,homestate:p.homestate,previousTeam:p.previousTeam,grade:p.grade,yearsLeft:p.yearsLeft};
 const offers={};
 for(const [id,rows] of Object.entries(state.offersByProspect || {}))if(prospects[id])offers[id]=rows.map(o=>({team:o.team,coach:o.coach,text:o.text,promises:o.promises,rescinded:!!o.rescinded,createdAt:o.createdAt,editHistory:o.editHistory}));
 return {prospects,offers};
}
