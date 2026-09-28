import test from 'node:test';
import assert from 'node:assert/strict';
import '../offer-amendments.js';
import {onRequestPost} from '../functions/api/offers/amend.js';
import {signSession} from '../functions/_lib/auth.js';
const A=globalThis.NZCFLOfferAmendments,p={id:'r1',name:'James Brooks',position:'DL'};
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
