import test from 'node:test';
import assert from 'node:assert/strict';
import '../cpr-rules.js';
import '../scholarship-history.js';
import '../offer-window.js';
import '../auto-commits.js';
import {sanitizeState} from '../functions/_lib/league-state.js';
const A=globalThis.NZCFLAutoCommits;
function state(){return {recruitingStage:'cpr',offersLocked:true,prospects:{},offersByProspect:{},bucksRemaining:{alpha:0,beta:0},scholarshipCapacity:{stage:'cpr',teams:{alpha:{team:'Alpha',open:1},beta:{team:'Beta',open:2}}}};}
function player(s,id,overall,offers,extra={}){s.prospects[id]={id,name:id,position:'QB',overall,potential:60,...extra};s.offersByProspect[id]=offers.map(([team,type='scholarship'],i)=>({id:id+'-'+i,team,text:type==='scholarship'?'Scholarship':'Walk-On'}));}

test('capacity CSV reads E, ignores footer legends, preserves negatives, and rejects bad counts',()=>{
 const csv=',Division,SoS,Scholarships Available,Total Scholarships Remaining (includes Seniors)\nAlpha,SEC,1,20,-1\nBeta,SEC,1,99,4\n\nRedshirted Player,,,22,16.5';
 assert.equal(A.parseCapacitySheet(csv).alpha.open,-1);
 assert.equal(A.parseCapacitySheet(csv).beta.open,4);
 assert.throws(()=>A.parseCapacitySheet(csv.replace('20,-1','20,#REF!')),/Alpha/);
 assert.throws(()=>A.parseCapacitySheet('x,y,z,a,b'),/Column E/);
});
test('Bucks remaining determines 36–39 ceiling and subtracts current commitments',()=>{
 const s=state();s.scholarshipCapacity.teams.alpha.open=0;
 for(let left=0;left<=3;left++){s.bucksRemaining.alpha=left;assert.equal(A.remaining(s,'Alpha','scholarship'),left);}
 player(s,'won',50,[['Alpha']],{commitTeam:'Alpha'});
 assert.equal(A.remaining(s,'Alpha','scholarship'),2);
 s.scholarshipCapacity.teams.alpha.open=-1;
 assert.equal(A.remaining(s,'Alpha','scholarship'),1);
 s.bucksRemaining.alpha=0;assert.equal(A.remaining(s,'Alpha','scholarship'),0);
});
test('lowest overall wins scarce spot and exhausted team creates a cascading auto',()=>{
 const s=state();player(s,'High',55,[['Alpha']]);player(s,'Low',45,[['Alpha']]);player(s,'Cascade',50,[['Alpha'],['Beta']]);
 const before=JSON.stringify(s),result=A.preview(s,'scholarship');
 assert.deepEqual(result.commits.map(p=>[p.name,p.team]),[['Low','Alpha'],['Cascade','Beta']]);
 assert.equal(result.rescinds.length,2);
 assert.equal(JSON.stringify(s),before,'Preview cannot mutate offers or commits');
 A.apply(s,'scholarship');assert.equal(s.prospects.Low.commitTeam,'Alpha');assert.equal(s.prospects.Cascade.commitTeam,'Beta');
 assert.equal(s.offersByProspect.High[0].rescinded,true);assert.equal(s.offersByProspect.High[0].text,'Scholarship');
 assert.equal(A.preview(s,'scholarship').commits.length,0);
});
test('ties sort by lower potential then name, regardless of insertion order',()=>{
 const s=state();player(s,'Zed',45,[['Alpha']],{potential:50});player(s,'Able',45,[['Alpha']],{potential:50});player(s,'Better',45,[['Alpha']],{potential:60});
 assert.equal(A.preview(s,'scholarship').commits[0].name,'Able');
});
test('one scholarship offer beats multiple walk-on offers; duplicate team offers count once',()=>{
 const s=state();s.scholarshipCapacity.teams.alpha.open=5;
 player(s,'Low',30,[['Alpha'],['Beta','walkon'],['Alpha']]);
 assert.equal(A.preview(s,'scholarship').commits[0].team,'Alpha');
 assert.match(A.preview(s,'walkon').errors[0],/scholarship autos/);
});
test('two scholarship offers remain contested and exclude walk-on autos',()=>{
 const s=state();player(s,'Low',30,[['Alpha'],['Beta'],['Alpha','walkon']]);
 assert.equal(A.preview(s,'scholarship').contested,1);assert.equal(A.preview(s,'walkon').commits.length,0);
 s.offersByProspect.Low[1].rescinded=true;
 assert.equal(A.preview(s,'scholarship').commits[0].team,'Alpha');
});
test('rescinded scholarship allows natural walk-on to revert after cap pass',()=>{
 const s=state();s.scholarshipCapacity.teams.alpha.open=0;player(s,'Low',30,[['Alpha'],['Beta','walkon']]);
 const schol=A.apply(s,'scholarship');assert.equal(schol.commits.length,0);assert.equal(schol.rescinds.length,1);
 assert.equal(A.preview(s,'walkon').commits[0].team,'Beta');
});
test('scholarship-only recruits never become walk-on autos',()=>{
 for(const extra of [{overall:45},{overall:30,everScholarship:true},{overall:30,offerMode:'pitch'}]){
   const s=state();player(s,'Only',30,[['Beta','walkon']],extra);assert.equal(A.preview(s,'walkon').commits.length,0);
 }
});
test('walk-on processing respects existing commits and cascades at 15',()=>{
 const s=state();
 for(let i=0;i<14;i++)player(s,'won'+i,30,[['Alpha','walkon']],{commitTeam:'Alpha'});
 player(s,'Higher',33,[['Alpha','walkon']]);player(s,'Lower',29,[['Alpha','walkon']]);player(s,'Both',34,[['Alpha','walkon'],['Beta','walkon']]);
 const result=A.apply(s,'walkon');assert.deepEqual(result.commits.map(p=>[p.name,p.team]),[['Lower','Alpha'],['Both','Beta']]);
 assert.equal(A.counts(s).walkon.alpha,15);assert.equal(s.offersByProspect.Higher[0].rescinded,true);
});
test('conditional rescinds are included before later projected winners',()=>{
 const s=state();s.scholarshipCapacity.teams.alpha.open=5;
 player(s,'First',45,[['Alpha']]);player(s,'Second',46,[['Alpha']]);player(s,'Both',47,[['Alpha'],['Beta']]);
 s.conditionalRescinds=[{enabled:true,team:'Alpha',count:1,positions:['QB'],stars:'',scholarship:'scholarship'}];
 const result=A.preview(s,'scholarship');assert.deepEqual(result.commits.map(p=>p.name),['First','Both']);assert.equal(result.commits[1].team,'Beta');
});
test('capacity missing, open offers, and missing overall cannot silently produce autos',()=>{
 const s=state();player(s,'Unknown',45,[['Missing']]);assert.match(A.preview(s,'scholarship').errors[0],/Missing/);
 s.offersLocked=false;assert.match(A.preview(s,'scholarship').errors[0],/Close offers/);
 s.offersLocked=true;s.scholarshipCapacity.stage='hs';assert.match(A.preview(s,'scholarship').errors[0],/this class/);
 const bad=state();player(bad,'No rating',undefined,[['Alpha']]);assert.match(A.preview(bad,'scholarship').errors[0],/Missing overall/);
});
test('capacity and Bucks allowances persist in league state, invalid allowances are rejected',()=>{
 const s=state();assert.deepEqual(sanitizeState(s).scholarshipCapacity,s.scholarshipCapacity);assert.deepEqual(sanitizeState(s).bucksRemaining,s.bucksRemaining);
 s.bucksRemaining.alpha=4;assert.match(A.validate(s),/0 to 3/);
});
