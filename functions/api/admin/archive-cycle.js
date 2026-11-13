import {getCurrentUser,accessLevel,json} from '../../_lib/auth.js';
import {readLeagueState} from '../../_lib/league-state.js';
import {writeArchive,archivePayload} from '../../_lib/archives.js';
import '../../../archive-season.js';
import {classKey} from '../../_lib/removed-players.js';
export async function onRequestPost({request,env}){
 const user=await getCurrentUser(request,env);
 if(!user || accessLevel(env,user)!=='commissioner')return json({ok:false,error:'Commissioner access required.'},{status:403});
 try{
  const body=await request.json(),state=await readLeagueState(env);
  if(!state || !Object.keys(state.prospects || {}).length)throw Error('No recruiting class to archive.');
  if(body.expectedUpdatedAt!==state.updatedAt) return json({ok:false,error:'The board changed. Refresh and archive again.'},{status:409});
  if(body.classKey!==undefined && body.classKey!==classKey(state))return json({ok:false,error:'The recruiting class changed. Refresh before archiving.'},{status:409});
  const season=globalThis.NZCFLArchiveSeason.resolve(state,body.season);
  const stage=state.recruitingStage;if(!['hs','cpr','transfer'].includes(stage))throw Error('Unknown recruiting stage.');
  const saved=await writeArchive(env.LEAGUE_DB,{season,stage,sourceVersion:state.updatedAt,payload:archivePayload(state)});
  return json({ok:true,...saved});
 }catch(error){return json({ok:false,error:error.message || 'Archive could not be saved.'},{status:400});}
}
