import {getCurrentUser,accessLevel,json} from '../../_lib/auth.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
const RULE='fe166785-3a55-4b6e-bae6-046d967a08ab',AT=1791049834582;
export async function onRequestPost({request,env,waitUntil}){
 const user=await getCurrentUser(request,env);
 if(!user || accessLevel(env,user)!=='commissioner')return json({ok:false,error:'Commissioner access required.'},{status:403});
 for(let attempt=0;attempt<16;attempt++)try{
  const state=await readLeagueState(env);const restoredIds=new Set();
  state.conditionalRescinds=(state.conditionalRescinds || []).filter(r=>!(r.id===RULE && r.team==='UCONN'));
  for(const [id,offers] of Object.entries(state.offersByProspect || {}))for(const o of offers){
   if(o.team!=='UCONN' || !o.rescinded || o.conditionalRescindRuleId!==RULE || o.rescindedAt!==AT || state.prospects?.[id]?.commitTeam)continue;
   o.rescinded=false;delete o.rescindedAt;delete o.rescindReason;delete o.conditionalRescindRuleId;restoredIds.add(o.id);
  }
  const saved=await writeLeagueState(env,state);queueLeagueBackup(env,saved,waitUntil,{source:'undo-uconn-mistaken-rule'});
  const restored=Object.values(saved.offersByProspect || {}).flat().filter(o=>restoredIds.has(o.id) && !o.rescinded).length;
  return json({ok:true,state:saved,count:restored});
 }catch(e){if(e.status===409 && attempt<15)continue;return json({ok:false,error:e.message || 'Undo failed.'},{status:e.status || 503});}
}
