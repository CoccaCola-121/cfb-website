import {getCurrentUser,canCommission,json} from '../../_lib/auth.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';

// Explicitly requested one-off correction; accepts no arbitrary player or pitch input.
export async function onRequestPost({request,env,waitUntil}){
 const user=await getCurrentUser(request,env);
 if(!user || !canCommission(env,user))return json({ok:false,error:'Commissioner access required.'},{status:403});
 try{
  const state=await readLeagueState(env);
  const player=state?.prospects?.r127;
  const offer=state?.offersByProspect?.r127?.find(o=>o.id==='o_638767694988050432_fe7a8a75-d6dc-47dc-b2c9-384dae25732d' && o.team==='Michigan State');
  if(player?.name!=='Kenny Phillips' || player.position!=='OL' || !offer)return json({ok:false,error:'The original Kenny Phillips offer was not found.'},{status:409});
  const correctionId='kenny-phillips-msu-promises-2026-09-29';
  if(offer.editHistory?.some(h=>h.id===correctionId))return json({ok:true,message:'This correction was already applied.'});
  const replacements=[
   ['I promise that you will start by your (freshman, sophomore, junior) year.','I promise that you will start every game this year'],
   ['I promise, we’ll win a game in your home state or an adjacent state.','I promise, we’ll win a game in your adjacent state']
  ];
  for(const [before] of replacements){
   if(offer.text.split('**'+before+'**').length!==2 || (offer.promises || []).filter(p=>p.text===before).length!==1)return json({ok:false,error:'The promises have changed. No correction was applied.'},{status:409});
  }
  for(const [before,after] of replacements){
   offer.text=offer.text.replace('**'+before+'**','**'+after+'**');
   offer.promises.find(p=>p.text===before).text=after;
  }
  offer.updatedAt=Date.now();
  offer.editHistory=[...(offer.editHistory || []),{id:correctionId,editedAt:offer.updatedAt,editor:user.displayName || user.username || user.discordId,changes:replacements.map(([before,after])=>'Authorized promise correction: '+before+' → '+after)}];
  const saved=await writeLeagueState(env,state);
  queueLeagueBackup(env,saved,waitUntil,{source:'authorized-promise-correction'});
  return json({ok:true,message:'Both Kenny Phillips promises were corrected. The rest of the offer is unchanged.'});
 }catch(error){return json({ok:false,error:error.status===409?error.message:'Could not apply the correction. Please retry.'},{status:error.status || 503});}
}
