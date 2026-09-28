import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConditionalRescinds} from '../functions/_lib/conditional-rescinds.js';
import '../cpr-rules.js';
import '../offer-window.js';
import '../auto-commits.js';
const A=globalThis.NZCFLAutoCommits;
function fixture(mode,count=2){
 const s={recruitingStage:'cpr',offersLocked:true,prospects:{},offersByProspect:{},conditionalRescinds:[{id:'rule',enabled:true,team:'Alpha',count,positions:['P'],overallMode:mode,overallValue:'',stars:''}],bucksRemaining:{alpha:0},scholarshipCapacity:{stage:'cpr',teams:{alpha:{open:20}}}};
 for(const [id,ovr,committed] of [['win1',60,true],['win2',55,true],['low',54,false],['equal',55,false],['high',56,false]]){
  s.prospects[id]={id,name:id,position:'P',overall:ovr,potential:75,rating:ovr+'/75',commitTeam:committed?'Alpha':''};
  s.offersByProspect[id]=[{id:'offer-'+id,team:'Alpha',text:'Scholarship'}];
 }
 return s;
}
for(const mode of ['belowCommit','atMostCommit'])test(mode+' uses lowest matching commit for server and auto preview',()=>{
 const s=fixture(mode);
 const preview=A.preview(s,'scholarship');
 const result=applyConditionalRescinds(s);
 assert.equal(result[0].rescinded,mode==='belowCommit'?1:2);
 assert.equal(s.offersByProspect.low[0].rescinded,true);
 assert.equal(!!s.offersByProspect.equal[0].rescinded,mode==='atMostCommit');
 assert.equal(!!s.offersByProspect.high[0].rescinded,false);
 const rescinds=preview.rescinds.filter(r=>r.reason.startsWith('Conditional'));
 assert.deepEqual(rescinds.map(r=>r.prospectId).sort(),mode==='belowCommit'?['low']:['equal','low']);
 assert.equal(s.offersByProspect.low[0].text,'Scholarship');
});
test('relative rules wait for enough commits and refuse unknown overall',()=>{
 const s=fixture('belowCommit',3);
 assert.deepEqual(applyConditionalRescinds(s),[]);
 s.conditionalRescinds[0].count=2;s.prospects.win2.rating='';
 assert.deepEqual(applyConditionalRescinds(s),[]);
});

test('relative cutoff uses overall rather than potential regardless of commit order',()=>{
 assert.equal(A.rescindTargetRule({overallMode:'belowCommit'},[{overall:60,potential:75},{overall:55,potential:80}]).overallValue,55);
});
