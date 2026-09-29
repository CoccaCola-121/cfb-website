import {teamKey} from './teams-util.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const visitBody=text=>String(text || '').replace(/(?:Campus|School)\s+Visit[^\n]*?(?=\s+(?:Campus|Prestige|Education|Playing Time|Tradition|Coach|Pro Potential):|\n|$)/ig,'').replace(/Coach\s+Visit(?:\s*\(\s*\d+\s*\/\s*10\s*\))?/ig,'').replace(/\s+/g,' ').trim();
export function coachStateError(previous,incoming,user){
 if(!previous || !user.team)return 'A linked team is required.';
 const own=o=>teamKey(o?.team)===teamKey(user.team);
 const mutable=new Set(['offersByProspect','unmatched','conditionalRescinds','updatedAt']);
 for(const key of new Set([...Object.keys(previous),...Object.keys(incoming)])){
  if(!mutable.has(key) && !same(previous[key],incoming[key]))return 'Coaches cannot change league settings or player records. Refresh the board.';
 }
 for(const key of ['unmatched','conditionalRescinds']){
  const before=previous[key] || [],after=incoming[key] || [];
  if(!Array.isArray(after) || !same(before.filter(o=>!own(o)),after.filter(o=>!own(o))))return 'You may only change records for your team.';
 }
 for(const pid of new Set([...Object.keys(previous.offersByProspect || {}),...Object.keys(incoming.offersByProspect || {})])){
  const before=previous.offersByProspect?.[pid] || [],after=incoming.offersByProspect?.[pid] || [];
  if(!Array.isArray(after) || !same(before.filter(o=>!own(o)),after.filter(o=>!own(o))))return 'You may only change your own offers.';
  for(const old of before.filter(own)){
   const next=after.find(o=>o.id===old.id);
   if(!next || !own(next))return 'Existing offers cannot be deleted.';
   if(same(old,next))continue;
   if(old.rescinded || previous.prospects?.[pid]?.commitTeam)return 'This offer can no longer be changed.';
   const fields=new Set(['rescinded','rescindedAt','rescindReason','visits','text','editHistory','updatedAt']);
   for(const key of new Set([...Object.keys(old),...Object.keys(next)]))if(!fields.has(key) && !same(old[key],next[key]))return 'Use the offer amendment controls to change this offer.';
   if(old.text!==next.text && !(previous.recruitingStage==='hs' && visitBody(old.text)===visitBody(next.text)))return 'Pitch text cannot be edited. Use the header or upgrade controls.';
   if(previous.recruitingStage!=='hs' && !same(old.visits,next.visits))return 'Visits are only available in high school recruiting.';
   if((old.text!==next.text || !same(old.visits,next.visits)) && globalThis.NZCFLOfferWindow.locked(previous))return 'Offers are locked.';
   next.editHistory=old.editHistory || [];
   if(!same(old.visits,next.visits))next.editHistory=[...next.editHistory,{id:'eh_'+crypto.randomUUID(),editedAt:Date.now(),editor:user.team,changes:['Visits updated: '+JSON.stringify(next.visits)]}].slice(-20);
   if(old.visits?.coach && !next.visits?.coach || old.visits?.campus && !next.visits?.campus)return 'Visits cannot be removed.';
  }
  if(after.filter(own).length>1)return 'Only one offer per team and player is allowed.';
  const seen=new Set();
  for(const offer of after){
   if(!offer || typeof offer.id!=='string' || seen.has(offer.id))return 'Invalid or duplicate offer.';
   seen.add(offer.id);
   if(!before.some(o=>o.id===offer.id)){
    if(!own(offer) || !previous.prospects?.[pid] || previous.prospects[pid].commitTeam || before.some(own))return 'This player cannot receive another offer from your team.';
    if(typeof offer.text!=='string' || !offer.text.trim())return 'Enter an offer.';
   }
  }
 }
 return '';
}
