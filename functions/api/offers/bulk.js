import '../../../cpr-rules.js';
import '../../../offer-window.js';
import '../../../walkon-limit.js';
import {removedPlayer} from '../../_lib/removed-players.js';
import {getCurrentUser,json} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
export async function onRequestPost({request,env,waitUntil}){
 const receivedAt=Date.now(),user=await getCurrentUser(request,env);
 if(!user?.team)return json({ok:false,error:'Sign in with your linked team.'},{status:401});
 if(!env.LEAGUE_DB)return json({ok:false,error:'Bulk offers require the league database.'},{status:503});
 const body=await request.json().catch(()=>({}));
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || '') || !Array.isArray(body.players) || !body.players.length || body.players.length>1500 || body.players.some(p=>!p || typeof p.id!=='string' || !['walkon','scholarship'].includes(p.type)) || new Set(body.players.map(p=>p.id)).size!==body.players.length)return json({ok:false,error:'Invalid batch. Refresh your filtered board.'},{status:400});
 for(let attempt=0;attempt<12;attempt++){
  try{
   const state=await readLeagueState(env);
   if(state?.recruitingStage!=='cpr')return json({ok:false,error:'Bulk offers are only available on the CPR board.'},{status:409});
   const own=o=>teamKey(o.team)===teamKey(user.team);
   const already=body.players.filter(({id})=>(state.offersByProspect?.[id] || []).some(o=>own(o) && o.requestId===body.requestId));
   // Every batch writes atomically. A receipt on any offer means the whole batch finished.
   if(already.length)return json({ok:true,state,submitted:already.length,skipped:body.players.length-already.length});
   if(!state.wave1Released || globalThis.NZCFLOfferWindow.locked(state,receivedAt))return json({ok:false,error:'Offers are closed.'},{status:403});
   const leaders=globalThis.NZCFLCprRules.leaders(state.fullRoster || []);
   const board=new Set((state.threads || []).flatMap(t=>t.prospectIds || []));
   const fullWalkons=(globalThis.NZCFLWalkonLimit.counts(state)[String(user.team).toLowerCase().replace(/[^a-z0-9]/g,'')] || 0)>=15;
   let submitted=0,skipped=0;
   for(const item of body.players){
    const p=state.prospects?.[item.id],offers=state.offersByProspect?.[item.id] || [];
    if(!p || !board.has(item.id) || p.commitTeam || removedPlayer(state,p) || p.offerMode==='pitch' || leaders[p.position]?.rank===p.rank || offers.some(own)){skipped++;continue;}
    const type=globalThis.NZCFLCprRules.scholarshipRecruit(p,offers)?'scholarship':'walkon';
    // Don't silently change a reviewed walk-on into a scholarship offer, or vice versa.
    if(type!==item.type || type==='walkon' && fullWalkons){skipped++;continue;}
    const offer={id:'o_'+user.discordId+'_'+body.requestId+'_'+item.id,requestId:body.requestId,team:user.team,coach:user.displayName || user.username || '',text:user.team+' offers '+p.position+' '+p.name+'\n\n'+(type==='scholarship'?'Scholarship':'Walk-On'),offerType:type,visits:{},promises:[],createdAt:receivedAt};
    state.offersByProspect[item.id]=[...offers,offer];submitted++;
   }
   if(!submitted)return json({ok:true,state,submitted:0,skipped});
   const saved=await writeLeagueState(env,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'bulk-offer-submit'});
   return json({ok:true,state:saved,submitted,skipped});
  }catch(error){
   if(error.status===409 && attempt<11){await new Promise(resolve=>setTimeout(resolve,40+Math.random()*200));continue;}
   return json({ok:false,error:'The batch could not be confirmed. Retry this same batch; existing offers will not be duplicated.'},{status:error.status || 503});
  }
 }
}
