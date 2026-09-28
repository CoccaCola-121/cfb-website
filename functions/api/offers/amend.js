import '../../../offer-amendments.js';
import '../../../offer-window.js';
import {getCurrentUser,json} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {queueLeagueBackup} from '../../_lib/backup.js';

// Replace only the two recognized header lines. Keep all other characters,
// including line endings, blank lines and the original pitch, unchanged.
function editOfferHeader(text, headerLine){
  const original=String(text || '');
  const h=globalThis.NZCFLOfferAmendments.header(original);
  if(h.offerLine<0 || h.typeLine<=h.offerLine)throw Error('This offer does not have an editable two-line header.');
  const line=String(headerLine || '').trim();
  if(line.length>120 || !/^.{1,120}\boffers?\s+\S.+$/i.test(line) || /[\r\n]/.test(line))throw Error('Enter a valid one-line offer header.');
  const matches=[...original.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(match=>match[0].length);
  if(!matches[h.offerLine] || !matches[h.typeLine])throw Error('Could not locate the offer header.');
  const oldHeader=h.lines[h.offerLine];
  let output=original;
  [[h.offerLine,line]].forEach(([index,replacement])=>{
    const match=matches[index];
    const lineEnd=match[0].replace(/(?:\r\n|\n|\r)$/,'');
    const start=match.index;
    output=output.slice(0,start)+replacement+output.slice(start+lineEnd.length);
  });
  return {text:output, oldHeader, newHeader:line};
}

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
  let changes;
  if(body.action==='edit-header'){
    const edit=editOfferHeader(offer.text,body.headerLine);
    if(edit.text===offer.text)return json({ok:false,error:'No header changes to save.'},{status:400});
    offer.text=edit.text;
    changes=['Offer header corrected: '+edit.oldHeader+' → '+edit.newHeader];
  } else {
    offer.text=globalThis.NZCFLOfferAmendments.amend(offer.text,body.action,offer.team,p);
    if(body.action==='upgrade')offer.offerType='scholarship';
    changes=[body.action==='upgrade'?'Offer type: Walk-On → Scholarship':'Added offer header. Pitch unchanged.'];
  }
  offer.updatedAt=Date.now();
  offer.editHistory=[...(offer.editHistory || []),{
    id:'eh_'+crypto.randomUUID(), editedAt:offer.updatedAt, editor:user.team,
    changes
  }].slice(-20);
  const saved=await writeLeagueState(env,state);
  queueLeagueBackup(env,saved,waitUntil,{source:'offer-amendment'});
  return json({ok:true,state:saved});
 }catch(error){return json({ok:false,error:error.message || 'Could not update the offer.'},{status:error.status || 400});}
}
