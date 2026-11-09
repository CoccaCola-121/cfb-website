import {getCurrentUser,canModerate,json} from '../../_lib/auth.js';
import {readLeagueState} from '../../_lib/league-state.js';
import {writeTransactionalState} from '../../_lib/transactional-state.js';
import {classKey} from '../../_lib/removed-players.js';
import {queueLeagueBackup} from '../../_lib/backup.js';

const fail=(error,status)=>json({ok:false,error},{status});
export async function onRequestPost({request,env,waitUntil}){
 const user=await getCurrentUser(request,env);
 if(!user || !canModerate(env,user))return fail('Moderator access is required to open or close offers.',403);
 if(!env.LEAGUE_DB)return fail('The league database is unavailable. Please retry.',503);
 const body=await request.json().catch(()=>null);
 if(!body || typeof body.locked!=='boolean' || typeof body.classKey!=='string')return fail('Choose whether offers should be open or closed.',400);
 for(let attempt=0;attempt<16;attempt++){
  try{
   const state=await readLeagueState(env);
   if(!state || body.classKey!==classKey(state))return fail('The recruiting class changed. Refresh before changing the offer window.',409);
   const before=JSON.stringify([state.offersLocked,state.offerSchedule]);
   if(state.offerSchedule){
    delete state.offerSchedule.opensAt;
    if(!body.locked && Date.parse(state.offerSchedule.closesAt || '')<=Date.now())state.offerSchedule=null;
   }
   state.offersLocked=body.locked;
   if(before===JSON.stringify([state.offersLocked,state.offerSchedule]))return json({ok:true,state});
   // Change only the window on the latest snapshot. A concurrent offer save
   // either wins first and is retained on retry, or observes the closed window.
   const saved=await writeTransactionalState(env.LEAGUE_DB,state,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'offer-window'});
   return json({ok:true,state:saved});
  }catch(error){
   if(error.status===409 && attempt<15){await new Promise(resolve=>setTimeout(resolve,40+Math.random()*180));continue;}
   return fail(error.status===409?'The board is busy. Your draft is kept; retry saving.':'The offer window could not be saved. Your draft is kept; retry saving.',error.status || 503);
  }
 }
}
