import {getCurrentUser,json,accessLevel} from '../../_lib/auth.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {classKey,applyRemovedPlayers} from '../../_lib/removed-players.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
export async function onRequestPost({request,env,waitUntil}){
 try{
  const user=await getCurrentUser(request,env);
  if(!user || accessLevel(env,user)!=='commissioner')return json({ok:false,error:'Commissioner access required.'},{status:403});
  const body=await request.json();
  const state=await readLeagueState(env),p=state?.prospects?.[body.prospectId];
  if(!p)return json({ok:false,error:'Player not found.'},{status:404});
  if(body.expectedUpdatedAt!==state.updatedAt)return json({ok:false,error:'The board changed. Refresh before removing this player.'},{status:409});
  state.removedPlayers ||= {};
  state.removedPlayers[crypto.randomUUID()]={classKey:classKey(state),player:p,offers:state.offersByProspect?.[body.prospectId] || [],removedAt:Date.now(),removedBy:user.discordId};
  applyRemovedPlayers(state);
  const saved=await writeLeagueState(env,state);
  queueLeagueBackup(env,saved,waitUntil,{source:'player-removal'});
  return json({ok:true,state:saved});
 }catch(error){return json({ok:false,error:error.status===409?error.message:'Could not remove player. Please retry.'},{status:error.status || 500});}
}
