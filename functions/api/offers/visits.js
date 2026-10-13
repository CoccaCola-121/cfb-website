import '../../../auto-commits.js';
import '../../../offer-amendments.js';
import '../../../visit-rules.js';
import '../../../offer-window.js';
import '../../../transfer-rules.js';
import {getCurrentUser,json} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
function normalizeVisits(v){return {coach:!!v?.coach,campus:!!v?.campus,campusLabel:String(v?.campusLabel || '').trim()};}
function campusVisitPhrase(v){return v.campus?'Campus Visit'+(v.campusLabel?' '+v.campusLabel:''):'';}
function titleCaseTeamName(name){
  return String(name || '').trim().split(/\s+/).map(function(part){
    if (/^[A-Z0-9&.-]{2,}$/.test(part)) return part;
    return part.split('-').map(function(piece){
      return piece ? piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase() : piece;
    }).join('-');
  }).join(' ');
}

function normalizeCampusVisitLabel(label){
  let raw = String(label || '').trim().replace(/\s+/g, ' ');
  raw = raw.replace(/^:\s*/, '');
  raw = raw.replace(/^week\b/i, 'Week');
  raw = raw.replace(/\bvs\.?/i, 'vs.');
  raw = raw.replace(/\s+vs\.\s+/i, ' vs. ');
  const match = raw.match(/^(?:Week\s*)?(\d{1,2})(?:\s+vs\.\s+(.+))?$/i);
  if (!match) return { ok: false, value: raw };
  return { ok: true, value: 'Week ' + parseInt(match[1], 10) + (match[2] ? ' vs. ' + titleCaseTeamName(match[2]) : '') };
}

function syncCampusVisitText(text, visits){
  let out = String(text || '');
  const phrase = campusVisitPhrase(visits);
  const campusRe = /(?:Campus|School)\s+Visit[\s\S]*?(?=\s+(?:Campus|Prestige|Education|Playing Time|Tradition|Coach|Pro Potential):|\n|$)/i;
  if (campusRe.test(out)){
    out = phrase ? out.replace(campusRe, phrase) : out.replace(campusRe, '').replace(/[ \t]{2,}/g, ' ');
  } else if (phrase) {
    out = NZCFLOfferAmendments.insertVisit(out,phrase);
  }
  return out.trim();
}

function syncCoachVisitText(text, visits){
  let out = String(text || '');
  visits = normalizeVisits(visits);
  const coachRe = /Coach\s+Visit(?:\s*\(\s*\d+\s*\/\s*10\s*\))?/i;
  if (coachRe.test(out)){
    out = visits.coach ? out.replace(coachRe, 'Coach Visit') : out.replace(coachRe, '').replace(/[ \t]{2,}/g, ' ');
  } else if (visits.coach) {
    out = NZCFLOfferAmendments.insertVisit(out,'Coach Visit');
  }
  return out.trim();
}


export async function onRequestPost({request,env,waitUntil}){
 if(!env.LEAGUE_DB)return json({ok:false,error:'Transactional league storage is required for visit saves.'},{status:503});
 const user=await getCurrentUser(request,env);
 if(!user?.team)return json({ok:false,error:'Sign in with your linked team.'},{status:401});
 const body=await request.json().catch(()=>({}));
 if(typeof body.prospectId!=='string' || typeof body.offerId!=='string' || !body.visits || typeof body.visits.coach!=='boolean' || typeof body.visits.campus!=='boolean' || typeof body.visits.campusLabel!=='string')return json({ok:false,error:'Invalid visit update.'},{status:400});
 for(let attempt=0;attempt<20;attempt++){
  try{
   const state=await readLeagueState(env),p=state?.prospects?.[body.prospectId];
   const offer=state?.offersByProspect?.[body.prospectId]?.find(o=>o.id===body.offerId);
   if(state?.recruitingStage!=='hs' || !p || !offer || teamKey(offer.team)!==teamKey(user.team))return json({ok:false,error:'Offer not found for your team.'},{status:403});
   const old=normalizeVisits(offer.visits),next=normalizeVisits(body.visits);
   next.coach=old.coach || next.coach;next.campus=old.campus || next.campus;
   if(next.campus){const normalized=normalizeCampusVisitLabel(next.campusLabel || old.campusLabel);if(!normalized.ok)return json({ok:false,error:'Enter the campus visit week, e.g. Week 4. Opponent is optional.'},{status:400});next.campusLabel=normalized.value;}else next.campusLabel='';
   // An identical retry succeeds without another write or history entry.
   if(JSON.stringify(old)===JSON.stringify(next))return json({ok:true,prospectId:body.prospectId,offer});
   if(offer.rescinded || p.commitTeam || globalThis.NZCFLOfferWindow.locked(state))return json({ok:false,error:'This offer can no longer be changed.'},{status:403});
   // Changes to this campus visit by another tab need review; unrelated board
   // changes are handled by the transaction retry below.
   const expected=normalizeVisits(body.expectedVisits);
   if(old.campus && expected.campus && old.campusLabel!==expected.campusLabel)return json({ok:false,error:'This campus visit changed in another tab. Reopen the editor to review it.'},{status:400});
   const nextText=syncCoachVisitText(syncCampusVisitText(offer.text,next),next);
   const error=globalThis.NZCFLVisitRules.error(state,{text:nextText,visits:next},offer) || globalThis.NZCFLTransferRules.pitchLimitError(nextText,p,'hs');
   if(error)return json({ok:false,error},{status:400});
   const own=Object.values(state.offersByProspect || {}).flat().filter(o=>teamKey(o.team)===teamKey(user.team));
   if(!old.coach && next.coach && own.filter(o=>o.visits?.coach).length>=10)return json({ok:false,error:'Coach visit limit already reached (10/10).'},{status:400});
   if(!old.campus && next.campus && own.filter(o=>o.visits?.campus).length>=17)return json({ok:false,error:'Campus visit limit already reached (17/17).'},{status:400});
   const changes=[];
   if(!old.coach && next.coach)changes.push('Added coach visit');
   if(!old.campus && next.campus)changes.push('Added campus visit: '+next.campusLabel);
   else if(old.campusLabel!==next.campusLabel)changes.push('Updated campus visit: '+old.campusLabel+' -> '+next.campusLabel);
   offer.text=nextText;offer.visits=next;offer.updatedAt=Date.now();
   offer.editHistory=[...(offer.editHistory || []),{id:'eh_'+crypto.randomUUID(),editedAt:offer.updatedAt,editor:user.team,changes}].slice(-20);
   const saved=await writeLeagueState(env,state,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'offer-visits'});
   return json({ok:true,prospectId:body.prospectId,offer:saved.offersByProspect[body.prospectId].find(o=>o.id===body.offerId)});
  }catch(error){
   if(error.status===409 && attempt<19){await new Promise(resolve=>setTimeout(resolve,10+Math.random()*70));continue;}
   return json({ok:false,error:'The server could not confirm the visit save. Your selections are still here; retry shortly.'},{status:503});
  }
 }
}
