import '../../../offer-amendments.js';
import '../../../offer-window.js';
import {getCurrentUser,json} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
export async function onRequestPost({request,env,waitUntil}){
 try {
  const user=await getCurrentUser(request,env);
  if(!user?.team)return json({ok:false,error:'Sign in with your linked team.'},{status:401});
  const body=await request.json();
  const state=await readLeagueState(env);
  const p=state?.prospects?.[body.prospectId];
  const offer=state?.offersByProspect?.[body.prospectId]?.find(o=>o.id===body.offerId);
  if(!p || !offer || teamKey(offer.team)!==teamKey(user.team))return json({ok:false,error:'Offer not found for your team.'},{status:403});
  if(offer.rescinded || p.commitTeam || globalThis.NZCFLOfferWindow.locked(state))return json({ok:false,error:'This offer can no longer be changed.'},{status:409});
  if(offer.text!==body.expectedText)return json({ok:false,error:'This offer changed. Refresh it before trying again.'},{status:409});
  offer.text=globalThis.NZCFLOfferAmendments.amend(offer.text,body.action,offer.team,p);
  if(body.action==='upgrade')offer.offerType='scholarship';
  offer.updatedAt=Date.now();
  const saved=await writeLeagueState(env,state);
  queueLeagueBackup(env,saved,waitUntil,{source:'offer-amendment'});
  return json({ok:true,state:saved});
 }catch(error){return json({ok:false,error:error.message || 'Could not update the offer.'},{status:400});}
}
