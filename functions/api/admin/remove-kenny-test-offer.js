import {getCurrentUser,canCommission,json} from '../../_lib/auth.js';
import {readLeagueState} from '../../_lib/league-state.js';
import {writeTransactionalState} from '../../_lib/transactional-state.js';

// User-requested cleanup of this exact test submission, not a general deletion API.
export async function onRequestPost({request,env}){
 const user=await getCurrentUser(request,env);
 if(!user || !canCommission(env,user))return json({ok:false,error:'Commissioner access required.'},{status:403});
 try{
  if(!env.LEAGUE_DB)return json({ok:false,error:'The league database is unavailable.'},{status:503});
  const state=await readLeagueState(env),player=state?.prospects?.r127;
  const offers=state?.offersByProspect?.r127 || [];
  const id='o_638767694988050432_fe7a8a75-d6dc-47dc-b2c9-384dae25732d';
  const offer=offers.find(o=>o.id===id);
  if(!offer)return json({ok:true,state});
  if(player?.name!=='Kenny Phillips' || player.position!=='OL' || player.commitTeam || offer.team!=='Michigan State')return json({ok:false,error:'This no longer matches the uncommitted test offer.'},{status:409});
  state.offersByProspect.r127=offers.filter(o=>o.id!==id);
  const next={...state,updatedAt:Date.now()};
  const saved=await writeTransactionalState(env.LEAGUE_DB,next,state);
  return json({ok:true,state:saved});
 }catch(error){return json({ok:false,error:error.status===409?'The board changed. Please try again.':'Could not remove the test offer.'},{status:error.status || 503});}
}
