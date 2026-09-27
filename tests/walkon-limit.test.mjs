import test from 'node:test';
import assert from 'node:assert/strict';
import '../cpr-rules.js';
import '../walkon-limit.js';
const rules=globalThis.NZCFLWalkonLimit;
for(const stage of ['hs','cpr']) test(stage+' caps walk-on commitments at 15 without erasing offers',()=>{
 const state={recruitingStage:stage,prospects:{},offersByProspect:{}};
 for(let i=0;i<15;i++){
  state.prospects[i]={position:'QB',overall:30,commitTeam:i<14?'Michigan State':''};
  state.offersByProspect[i]=[{team:'Michigan State',text:'Walk-On'}];
 }
 state.prospects.pending={position:'QB',overall:30};
 state.offersByProspect.pending=[{team:'Michigan State',text:'Walk-On\nOriginal pitch',promises:[{text:'I promise a role.'}]},{team:'Alabama',text:'Walk-On'}];
 state.prospects.scholarship={position:'QB',overall:45};
 state.offersByProspect.scholarship=[{team:'Michigan State',text:'Scholarship'}];
 assert.equal(rules.apply(state),0);
 state.prospects[14].commitTeam='Michigan State';
 assert.equal(rules.apply(state,123),1);
 const offer=state.offersByProspect.pending[0];
 assert.equal(offer.text,'Walk-On\nOriginal pitch');assert.equal(offer.promises.length,1);
 assert.equal(offer.rescindedAt,123);assert.equal(state.offersByProspect.pending[1].rescinded,undefined);
 assert.equal(state.offersByProspect.scholarship[0].rescinded,undefined);
 assert.equal(rules.apply(state),0);
 assert.match(rules.error(state,state.prospects.pending,{team:'Michigan State',text:'Walk-On'}),/15 walk-on/);
 state.recruitingStage='transfer';assert.equal(rules.error(state,state.prospects.pending,{team:'Michigan State',text:'Walk-On'}),'');
});
test('a full CPR walk-on class can offer a scholarship and active promotions avoid auto rescind',()=>{
 const state={recruitingStage:'cpr',prospects:{},offersByProspect:{}};
 for(let i=0;i<15;i++){state.prospects[i]={id:String(i),position:'QB',overall:30,commitTeam:'Army'};state.offersByProspect[i]=[{team:'Army',text:'Walk-On'}];}
 const p={id:'target',position:'QB',overall:30};state.prospects.target=p;
 state.offersByProspect.target=[{team:'Alabama',text:'Scholarship'},{team:'Army',text:'Walk-On'}];
 assert.equal(rules.apply(state),0);
 assert.equal(rules.error(state,p,{team:'Army',text:'Scholarship'}),'');
 state.offersByProspect.target[0].rescinded=true;
 assert.equal(rules.apply(state),1);
 assert.equal(state.offersByProspect.target[1].rescinded,true);
});
