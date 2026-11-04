import test from 'node:test';
import assert from 'node:assert/strict';
import '../offer-amendments.js';
import {onRequestPost} from '../functions/api/offers/amend.js';
import {signSession} from '../functions/_lib/auth.js';
const A=globalThis.NZCFLOfferAmendments,p={id:'r1',name:'James Brooks',position:'DL'};
test('missing-number correction adds only the authoritative rank and preserves formatting, visits and pitch',()=>{
 const player={...p,rank:596};
 for(const prefix of ['', '\r\n']){
  const text=prefix+'**Delaware offers James Brooks 60/80 DL**\r\n\r\nWalk-On\r\n\r\nCampus Visit Week 12\r\nPitch about #1.\r\n';
  const expected=text.replace('offers James','offers #596 James');
  assert.equal(A.fixMissingNumber({text},player,'hs'),expected);
  assert.equal(A.missingNumberHeader({text:expected},player,'hs'),'');
 }
 for(const [text,rank,stage] of [['Delaware offers #596 James Brooks\nWalk-On',596,'hs'],['Delaware offers 596 James Brooks\nWalk-On',596,'hs'],['Delaware offers James Brooks\nScholarship',596,'hs'],['Delaware offers James Brooks\nWalk-On',500,'hs'],['Delaware offers James Brooks\nWalk-On',596,'cpr']]){
  assert.throws(()=>A.fixMissingNumber({text},{...player,rank},stage),/does not need/);
 }
});
test('number-only repairs work on closed offers, enforce ownership and stale text, and cannot change terms',async()=>{
 const player={...p,rank:596,commitTeam:'Delaware'},text='Delaware offers James Brooks\r\nWalk-On\r\n\r\nCampus Visit Week 12\r\nOriginal pitch.';
 const offer={id:'o1',team:'Delaware',text,visits:{campus:true,campusLabel:'Week 12'},promises:[{text:'Keep this promise.'}],createdAt:1};
 const state={recruitingStage:'hs',offersLocked:true,prospects:{r1:player},offersByProspect:{r1:[offer]}};
 const data=new Map([['league:state',state],['discord:user:coach',{discordId:'coach',team:'Delaware'}],['discord:user:other',{discordId:'other',team:'USC'}]]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async key=>structuredClone(data.get(key)||null),put:async(key,value)=>data.set(key,JSON.parse(value))}};
 const call=async(user,extra={})=>onRequestPost({env,waitUntil(){},request:new Request('https://test/api/offers/amend',{method:'POST',headers:{cookie:'nzcfl_session='+await signSession(env,{discordId:user}),'content-type':'application/json'},body:JSON.stringify({prospectId:'r1',offerId:'o1',expectedText:text,action:'fix-number',headerLine:'Injected replacement',pitch:'Injected pitch',...extra})})});
 assert.equal((await call('other')).status,403);
 assert.equal((await call('coach',{expectedText:'Old draft'})).status,409);
 assert.equal((await call('coach',{action:'edit-header'})).status,409);
 const response=await call('coach');assert.equal(response.status,200,await response.clone().text());
 const saved=(await response.json()).state.offersByProspect.r1[0];
 assert.equal(saved.text,text.replace('offers James','offers #596 James'));
 assert.deepEqual(saved.visits,offer.visits);assert.deepEqual(saved.promises,offer.promises);assert.equal(saved.createdAt,1);
 assert.equal(saved.editHistory.length,1);assert.match(saved.editHistory[0].changes[0],/#596/);
 assert.equal((await call('coach',{expectedText:saved.text})).status,400);
});
test('headers are only added; pitch text remains byte-for-byte unchanged',()=>{
 const pitch='Playing Time:\r\n\r\nI promise that you will start.\r\n';
 const result=A.amend(pitch,'header','Delaware',p);
 assert.equal(result,'Delaware offers DL James Brooks\nScholarship\n\n'+pitch);
 assert.equal(A.allowed(pitch,result,'Delaware',p),true);
 assert.equal(A.allowed(pitch,pitch+'New pitch sentence.','Delaware',p),false);
 assert.equal(A.amend('Scholarship\n\n'+pitch,'header','Delaware',p),'Delaware offers DL James Brooks\n\nScholarship\n\n'+pitch);
 assert.throws(()=>A.amend(result,'header','Delaware',p),/complete/);
});
test('upgrade changes only the standalone top offer type and never pitch wording',()=>{
 for(const spelling of ['Walk-On','walk on','Walkon','WO','**Walk-On**']){
  const text='Delaware offers DL James Brooks\r\n\r\n'+spelling+'\r\n\r\nWe support walk-on players.\r\n';
  const expected=text.replace(spelling,spelling.replace(/walk\s*-?\s*on|\bwo\b/i,'Scholarship'));
  assert.equal(A.amend(text,'upgrade','Delaware',p),expected);
  assert.throws(()=>A.amend(expected,'upgrade','Delaware',p),/Only walk-on/);
  assert.equal(A.allowed(expected,text,'Delaware',p),false);
 }
});
for(const stage of ['hs','cpr','transfer'])test(stage+' amendments preserve history, enforce ownership, and reject downgrade',async()=>{
 const state={recruitingStage:stage,offersLocked:false,prospects:{r1:p},offersByProspect:{r1:[{id:'o1',team:'Delaware',editHistory:[{id:'previous',editedAt:1,editor:'Delaware',changes:['Coach visit added']}],text:'Delaware offers DL James Brooks\n\nWalk-On\n\nMy unchanged pitch.'},{id:'o2',team:'Alabama',text:'Scholarship'}]}};
 const data=new Map([['league:state',state],['discord:user:coach',{discordId:'coach',team:'Delaware'}]]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async k=>structuredClone(data.get(k)||null),put:async(k,v)=>data.set(k,JSON.parse(v))}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'coach'});
 const run=body=>onRequestPost({env,waitUntil(){},request:new Request('https://test/api/offers/amend',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)})});
 assert.equal((await run({prospectId:'r1',offerId:'o2',action:'upgrade',expectedText:'Scholarship'})).status,403);
 const before=structuredClone(state.offersByProspect.r1);
 const response=await run({prospectId:'r1',offerId:'o1',action:'upgrade',expectedText:before[0].text});
 assert.equal(response.status,200);
 const saved=(await response.json()).state;
 assert.equal(saved.offersByProspect.r1[0].text,before[0].text.replace('Walk-On','Scholarship'));
 assert.deepEqual(saved.offersByProspect.r1[1],before[1]);
 const history=saved.offersByProspect.r1[0].editHistory;
 assert.equal(history.length,2);assert.deepEqual(history[0],before[0].editHistory[0]);
 assert.equal(history[1].editor,'Delaware');assert.ok(history[1].editedAt>1);
 assert.deepEqual(history[1].changes,['Offer type: Walk-On → Scholarship']);
 // A missing heading can be added separately and produces another history entry.
 const current=data.get('league:state');current.offersByProspect.r1[0].text='Scholarship\n\nOriginal pitch.';
 const added=await run({prospectId:'r1',offerId:'o1',action:'header',expectedText:current.offersByProspect.r1[0].text});
 assert.equal(added.status,200);
 const updated=(await added.json()).state.offersByProspect.r1[0];
 assert.equal(updated.editHistory.length,3);
 assert.deepEqual(updated.editHistory[2].changes,['Added offer header. Pitch unchanged.']);
 assert.ok(updated.text.endsWith('Original pitch.'));
 saved.offersByProspect.r1[0].text=updated.text;
 assert.equal((await run({prospectId:'r1',offerId:'o1',action:'downgrade',expectedText:saved.offersByProspect.r1[0].text})).status,400);
});

test('generated offer header including position is excluded from pitch word counts',()=>{
 const text=A.amend('This is my pitch.','header','Delaware',p);
 assert.equal(globalThis.NZCFLTransferRules.pitchWordCount(text,p),4);
});


test('USC correction is owner-only, one-time, and records the full original and revised pitch',async()=>{
 const p={id:'r32',name:'Reuben Rains',position:'RB'};
 const offer={id:'o_mwaji8b2',team:'USC',coach:'marthfromsmash',createdAt:1791760070800,text:'USC offers #32 Reuben Rains\n\nScholarship\n\nOriginal pitch.',visits:{coach:false,campus:false},editHistory:[]};
 const state={recruitingStage:'hs',prospects:{r32:p},offersByProspect:{r32:[offer]}};
 const data=new Map([['league:state',state],['discord:user:155841820696248320',{discordId:'155841820696248320',team:'USC'}],['discord:user:other',{discordId:'other',team:'USC'}]]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async k=>structuredClone(data.get(k)||null),put:async(k,v)=>data.set(k,JSON.parse(v))}};
 const run=async(id,expectedText=offer.text)=>onRequestPost({env,waitUntil(){},request:new Request('https://test/api/offers/amend',{method:'POST',headers:{cookie:'nzcfl_session='+await signSession(env,{discordId:id}),'content-type':'application/json'},body:JSON.stringify({action:'correct-body',prospectId:'r32',offerId:offer.id,expectedText,pitch:'I promise you will start two seasons.',promises:[]})})});
 assert.equal((await run('other')).status,403);
 const response=await run('155841820696248320');assert.equal(response.status,200);
 const saved=(await response.json()).state.offersByProspect.r32[0];
 assert.equal(saved.editHistory[0].beforeText,offer.text);
 assert.equal(saved.editHistory[0].afterText,saved.text);
 assert(saved.text.includes('Scholarship'));
 assert.equal((await run('155841820696248320',saved.text)).status,400);
 assert.equal(A.canCorrectBody({...offer,id:'other'},p,'hs'),false);
 assert.throws(()=>A.correctBody(offer,p,'hs','Campus Visit Week 1'),/only the pitch/);
});


test('scholarship detection ignores blank header spacing',async()=>{
 await import('../cpr-rules.js');
 assert.equal(globalThis.NZCFLCprRules.scholarshipOffer({text:'Montana offers #8 W. Hawkins\n\n\n\n\n\nScholarship\n\nPitch.'}),true);
 assert.equal(globalThis.NZCFLCprRules.scholarshipOffer({text:'Montana offers #8 W. Hawkins\nWalk-On\nMy pitch.'}),false);
});
