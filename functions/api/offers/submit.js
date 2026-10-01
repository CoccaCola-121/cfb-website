import '../../../scholarship-template.js';
import {removedPlayer} from '../../_lib/removed-players.js';
import '../../../cpr-rules.js';
import '../../../offer-window.js';
import '../../../walkon-limit.js';
import '../../../transfer-rules.js';
import {json,getCurrentUser} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
export async function onRequestPost({request,env,waitUntil}){
 const receivedAt=Date.now();
 if(!env.LEAGUE_DB)return json({ok:false,error:'Transactional storage is not configured.'},{status:503});
 const user=await getCurrentUser(request,env);
 if(!user?.team)return json({ok:false,error:'Sign in with your linked team.'},{status:401});
 const body=await request.json().catch(()=>({}));
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || '') || typeof body.text!=='string' || !body.text.trim() || body.text.length>100000)return json({ok:false,error:'Enter a valid offer.'},{status:400});
 if(body.quick && !['walkon','scholarship'].includes(body.quickType || 'walkon'))return json({ok:false,error:'Invalid quick offer type.'},{status:400});
 for(let attempt=0;attempt<30;attempt++){
  try{
   const state=await readLeagueState(env);
   if(state?.recruitingStage!=='cpr')return json({ok:false,error:'The CPR board is no longer active.'},{status:409});
   const existingPlayer=state.prospects?.[body.prospectId];
   const row=existingPlayer || globalThis.NZCFLCprRules.resolveOffer(state.fullRoster,body.text,{name:body.name,position:body.position});
   if(removedPlayer(state,row))return json({ok:false,error:'This player was removed by a commissioner and cannot receive offers.'},{status:403});
   const pid='r'+row.rank;
   const offers=state.offersByProspect?.[pid] || [];
   const prior=offers.find(o=>teamKey(o.team)===teamKey(user.team));
   const result=o=>json({ok:true,offer:o,prospect:state.prospects[pid],thread:state.threads.find(t=>t.prospectIds.includes(pid))});
   if(prior){
    if(prior.requestId===body.requestId)return result(prior);
    return json({ok:false,error:'Your team already offered this player.'},{status:409});
   }
   if(globalThis.NZCFLOfferWindow.locked(state,receivedAt))return json({ok:false,error:'Offers are locked.'},{status:403});
   if(row.commitTeam)return json({ok:false,error:'This player is committed.'},{status:409});
   const mode=globalThis.NZCFLCprRules.leaders(state.fullRoster)[row.position];
   const isPitch=row.offerMode==='pitch' || mode?.rank===row.rank;
   const isScholarship=globalThis.NZCFLCprRules.scholarshipRecruit(row,offers);
   if(body.quick){
    if(!existingPlayer || isPitch)return json({ok:false,error:'This player is not eligible for a quick header-only offer.'},{status:409});
    if((body.quickType || 'walkon')==='scholarship' && !isScholarship)return json({ok:false,error:'This player is not classified as a scholarship recruit.'},{status:409});
    if((body.quickType || 'walkon')==='walkon' && isScholarship)return json({ok:false,error:'This player is not eligible for a quick walk-on offer.'},{status:409});
   }
   // The server, not the submitted browser text, decides exactly what a quick offer contains.
   const quickType=body.quickType || 'walkon';
   const templateOffer=body.quick && quickType==='scholarship' && body.template ? globalThis.NZCFLScholarshipTemplate.build(user.team,row,body.template,body.promiseChoices || []):null;
   const text=templateOffer?templateOffer.text:body.quick?user.team+' offers '+row.position+' '+row.name+'\n\n'+(quickType==='scholarship'?'Scholarship':'Walk-On'):body.text;
   const player=existingPlayer || {...row,id:pid,offerMode:mode?.rank===row.rank?'pitch':'values',coachCreated:true,stars:null};
   const offer={id:'o_'+user.discordId+'_'+body.requestId,requestId:body.requestId,team:user.team,coach:user.displayName || user.username || '',text,templatePromises:!!templateOffer,visits:{},promises:templateOffer?templateOffer.promises:body.quick?[]:(Array.isArray(body.promises)?body.promises.slice(0,3):[]),createdAt:receivedAt};
   if(body.quick)offer.offerType=quickType;
   const error=globalThis.NZCFLTransferRules.pitchLimitError(text,player,'cpr') || globalThis.NZCFLWalkonLimit.error(state,player,offer);
   if(error)return json({ok:false,error},{status:400});
   if(!existingPlayer){state.prospects[pid]=player;state.released[row.rank]=true;state.threads.push({id:'t_'+crypto.randomUUID(),title:row.name,prospectIds:[pid],stars:null,createdAt:receivedAt});}
   state.offersByProspect[pid]=[...offers,offer];
   const saved=await writeLeagueState(env,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'offer-submit'});
   return result(offer);
  }catch(error){
   if(error.status===409 && attempt<29){await new Promise(resolve=>setTimeout(resolve,20+Math.random()*180));continue;}
   return json({ok:false,error:error.status===409?'The board is busy. Your draft is saved; retry shortly.':error.message || 'Could not save offer.'},{status:error.status || 400});
  }
 }
}
