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
test('amend endpoint enforces ownership, keeps other offers and pitch text, and rejects downgrade',async()=>{
 const state={recruitingStage:'cpr',offersLocked:false,prospects:{r1:p},offersByProspect:{r1:[{id:'o1',team:'Delaware',text:'Delaware offers DL James Brooks\n\nWalk-On\n\nMy unchanged pitch.'},{id:'o2',team:'Alabama',text:'Scholarship'}]}};
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
 assert.equal((await run({prospectId:'r1',offerId:'o1',action:'downgrade',expectedText:saved.offersByProspect.r1[0].text})).status,400);
});

test('generated offer header including position is excluded from pitch word counts',()=>{
 const text=A.amend('This is my pitch.','header','Delaware',p);
 assert.equal(globalThis.NZCFLTransferRules.pitchWordCount(text,p),4);
});
