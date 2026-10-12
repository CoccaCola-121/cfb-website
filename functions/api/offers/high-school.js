import '../../../auto-commits.js';
import '../../../offer-window.js';
import '../../../walkon-limit.js';
import '../../../transfer-rules.js';
import {json,getCurrentUser} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';

// Apply one offer to the latest transactional board, never a browser's snapshot.
export async function onRequestPost({request,env,waitUntil}){
 const receivedAt=Date.now();
 if(!env.LEAGUE_DB)return json({ok:false,error:'Transactional storage is required for this endpoint.'},{status:503});
 const user=await getCurrentUser(request,env);
 if(!user?.team)return json({ok:false,error:'Sign in with your linked team.'},{status:401});
 const body=await request.json().catch(()=>({}));
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || '') || typeof body.text!=='string' || !body.text.trim() || body.text.length>100000)return json({ok:false,error:'Enter a valid offer.'},{status:400});
 const id='o_'+user.discordId+'_'+body.requestId;
 for(let attempt=0;attempt<20;attempt++){
  try{
   const state=await readLeagueState(env);
   if(state?.recruitingStage!=='hs')return json({ok:false,error:'The High School recruiting board is no longer active.'},{status:400});
   // Recover an uncertain response even if offers have closed since the original save.
   const prior=Object.entries(state.offersByProspect || {}).flatMap(([pid,offers])=>offers.filter(o=>o.id===id && teamKey(o.team)===teamKey(user.team)).map(offer=>({pid,offer}))).at(0);
   const unmatchedPrior=(state.unmatched || []).find(o=>o.id===id && teamKey(o.team)===teamKey(user.team));
   if(prior)return json({ok:true,prospectId:prior.pid,offer:prior.offer});
   if(unmatchedPrior)return json({ok:true,unmatched:unmatchedPrior});
   if(globalThis.NZCFLOfferWindow.locked(state,receivedAt))return json({ok:false,error:'Offers are locked.'},{status:403});
   const pid=body.prospectId || null,p=pid && state.prospects?.[pid];
   if(pid && !p)return json({ok:false,error:'This player is no longer on the board.'},{status:400});
   if(p?.commitTeam)return json({ok:false,error:'This player has committed.'},{status:400});
   if(p && (state.offersByProspect?.[pid] || []).some(o=>teamKey(o.team)===teamKey(user.team)))return json({ok:false,error:'Your team already offered this player.'},{status:400});
   const error=globalThis.NZCFLTransferRules.pitchLimitError(body.text,p,'hs') || (p && globalThis.NZCFLWalkonLimit.error(state,p,{team:user.team,text:body.text}));
   if(error)return json({ok:false,error},{status:400});
   // Derive visits from text; do not trust a caller to omit them to bypass limits.
   const campus=body.text.match(/(?:campus|school)\s+visit\s*([^\n\r]*)/i);
   const visits={coach:/coach\s+visit/i.test(body.text),campus:!!campus,campusLabel:campus?(campus[1] || '').replace(/\(\s*\d+\s*\/\s*17\s*\)/i,'').trim():''};
   if(visits.campus){
    const label=visits.campusLabel.replace(/^:\s*/,'').replace(/\s+/g,' ').replace(/\bvs\.?\s*/i,'vs. ');
    const match=label.match(/^(?:Week\s*)?(\d{1,2})(?:\s+vs\.\s+(.+))?$/i);
    if(!match)return json({ok:false,error:'Enter the campus visit week, e.g. Week 4. Opponent is optional.'},{status:400});
    visits.campusLabel='Week '+Number(match[1])+(match[2]?' vs. '+match[2]:'');
   }
   const own=Object.values(state.offersByProspect || {}).flat().filter(o=>teamKey(o.team)===teamKey(user.team));
   if(p && visits.coach && own.filter(o=>o.visits?.coach).length>=10)return json({ok:false,error:'Coach visit limit already reached (10/10).'},{status:400});
   if(p && visits.campus && own.filter(o=>o.visits?.campus).length>=17)return json({ok:false,error:'Campus visit limit already reached (17/17).'},{status:400});
   const promises=(Array.isArray(body.promises)?body.promises:[]).slice(0,3).map((v,i)=>({id:id+'_pr'+i,text:String(v?.text || ''),title:String(v?.title || v?.category || 'other'),category:String(v?.category || v?.title || 'other')}));
   const offer={id,requestId:body.requestId,team:user.team,coach:user.displayName || user.username || '',text:body.text,promises,visits,createdAt:receivedAt};
   let unmatched;
   if(p){state.offersByProspect ||= {};state.offersByProspect[pid]=[...(state.offersByProspect[pid] || []),offer];}
   else{unmatched={id,requestId:body.requestId,team:user.team,coach:offer.coach,offerText:body.text,promises,visits,createdAt:receivedAt};state.unmatched=[...(state.unmatched || []),unmatched];}
   const saved=await writeLeagueState(env,state,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'hs-offer-submit'});
   // Other background operations can alter offers. Return the saved record.
   return json(unmatched?{ok:true,unmatched:saved.unmatched.find(o=>o.id===id)}:{ok:true,prospectId:pid,offer:saved.offersByProspect[pid].find(o=>o.id===id)});
  }catch(error){
   if(error.status===409 && attempt<19){await new Promise(resolve=>setTimeout(resolve,10+Math.random()*70));continue;}
   return json({ok:false,error:'The server could not confirm your offer. Your draft is saved; check My Offers before retrying.'},{status:503});
  }
 }
}
