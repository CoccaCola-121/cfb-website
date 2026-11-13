import {getCurrentUser,json} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {classKey} from '../../_lib/removed-players.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
export async function onRequestPost({request,env,waitUntil}){
 const user=await getCurrentUser(request,env);
 if(!user?.team)return json({ok:false,error:'Sign in with your linked team.'},{status:401});
 const body=await request.json().catch(()=>({}));
 if(!Array.isArray(body.offers) || !body.offers.length || body.offers.length>1500 || body.offers.some(o=>!o || typeof o.prospectId!=='string' || typeof o.offerId!=='string'))return json({ok:false,error:'Invalid rescind request.'},{status:400});
 const mass=body.mass===true || body.offers.length>1;
 for(let attempt=0;attempt<16;attempt++){
  try{
   const state=await readLeagueState(env);
   if(!state || body.classKey!==classKey(state))return json({ok:false,error:'The recruiting class changed. Refresh first.'},{status:409});
   let count=0;const skippedCommitted=new Set();
   for(const item of body.offers){
    const p=state.prospects?.[item.prospectId];
    const offer=(state.offersByProspect?.[item.prospectId] || []).find(o=>o.id===item.offerId && teamKey(o.team)===teamKey(user.team));
    if(!p || !offer)return json({ok:false,error:'An offer is no longer available for your team.'},{status:409});
    // Recheck the authoritative board on every retry: a selected player may
    // have committed after the coach opened the checklist.
    if(p.commitTeam){
     if(!mass)return json({ok:false,error:p.name+' has already committed. Refresh your selection.'},{status:409});
     skippedCommitted.add(item.prospectId);continue;
    }
    if(offer.rescinded)continue;
    offer.rescinded=true;offer.rescindedAt=Date.now();offer.rescindReason=mass?'Mass rescind':'Rescinded by coach';count++;
   }
   if(!count)return json({ok:true,state,count:0,skippedCommitted:skippedCommitted.size});
   const saved=await writeLeagueState(env,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'coach-rescind'});
   return json({ok:true,state:saved,count,skippedCommitted:skippedCommitted.size});
  }catch(error){
   if(error.status===409 && attempt<15){await new Promise(resolve=>setTimeout(resolve,40+Math.random()*180));continue;}
   return json({ok:false,error:'Rescind was not confirmed. Please retry.'},{status:error.status || 503});
  }
 }
}
