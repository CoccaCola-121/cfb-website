import {getCurrentUser,accessLevel,json} from '../../_lib/auth.js';
import {readLeagueState} from '../../_lib/league-state.js';
import {ensureArchives,archivePayload} from '../../_lib/archives.js';
import {chunksFor} from '../../_lib/transactional-state.js';
export async function onRequestPost({request,env}){
 const user=await getCurrentUser(request,env);
 if(!user || accessLevel(env,user)!=='commissioner')return json({ok:false,error:'Commissioner access required.'},{status:403});
 try{
  const body=await request.json(),state=await readLeagueState(env);
  if(!state || !Object.keys(state.prospects || {}).length)throw Error('No recruiting class to archive.');
  if(body.expectedUpdatedAt!==state.updatedAt) return json({ok:false,error:'The board changed. Refresh and archive again.'},{status:409});
  const season=Number(state.fullRoster?.[0]?.metadataSeason || state.fullRoster?.[0]?.season);
  if(!Number.isInteger(season) || season<1900 || season>9999)throw Error('The uploaded roster needs a valid season before archiving.');
  const stage=state.recruitingStage;if(!['hs','cpr','transfer'].includes(stage))throw Error('Unknown recruiting stage.');
  await ensureArchives(env.LEAGUE_DB);
  const id=season+'-'+stage,payload=archivePayload(state),chunks=chunksFor(payload),bytes=new TextEncoder().encode(JSON.stringify(payload)).length;
  if(bytes>20000000)throw Error('This cycle exceeds the 20 MB archive limit. Download a backup instead.');
  const newest=await env.LEAGUE_DB.prepare('SELECT MAX(source_version) AS version FROM recruiting_archives WHERE id=?').bind(id).first();
  if(newest?.version>state.updatedAt)throw Error('A newer archive already exists. Refresh first.');
  const statements=[env.LEAGUE_DB.prepare('DELETE FROM recruiting_archive_chunks WHERE archive_id=? AND NOT EXISTS (SELECT 1 FROM recruiting_archives WHERE id=? AND source_version>?)').bind(id,id,state.updatedAt),env.LEAGUE_DB.prepare('INSERT INTO recruiting_archives VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,source_version=excluded.source_version,bytes=excluded.bytes WHERE recruiting_archives.source_version<=excluded.source_version').bind(id,season,stage,Date.now(),state.updatedAt,bytes),...chunks.map((chunk,i)=>env.LEAGUE_DB.prepare('INSERT INTO recruiting_archive_chunks SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM recruiting_archives WHERE id=? AND source_version=?)').bind(id,i,chunk,id,state.updatedAt)),env.LEAGUE_DB.prepare('DELETE FROM recruiting_archives WHERE season NOT IN (SELECT DISTINCT season FROM recruiting_archives ORDER BY season DESC LIMIT 20)'),env.LEAGUE_DB.prepare('DELETE FROM recruiting_archive_chunks WHERE archive_id NOT IN (SELECT id FROM recruiting_archives)')];
  await env.LEAGUE_DB.batch(statements);
  return json({ok:true,id,season,stage});
 }catch(error){return json({ok:false,error:error.message || 'Archive could not be saved.'},{status:400});}
}
