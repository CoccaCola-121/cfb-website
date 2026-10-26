import test from 'node:test';
import assert from 'node:assert/strict';
import '../scholarship-history.js';
import '../cpr-rules.js';
import '../auto-commits.js';
import {onRequestPut} from '../functions/api/league/state.js';
import {signSession} from '../functions/_lib/auth.js';
const A=globalThis.NZCFLAutoCommits;
const csv=entries=>'QB-3,Team,Position,Age,OVR,POT,45,Team,EEs,,QB,Name\r\n'+entries.map(([team,n])=>'"Player, Jr.",Wisconsin,QB,22,69,91,,'+team+','+n+',,,Other player').join('\r\n');
function state(){
  return {updatedAt:1,recruitingStage:'hs',fullRoster:[],offersLocked:true,conditionalRescinds:[],prospects:{},offersByProspect:{},
    scholarshipCapacity:{stage:'hs',sourceColumn:'D',teams:{virginia:{team:'Virginia',open:-3},wisconsin:{team:'Wisconsin',open:1},tcu:{team:'TCU',open:0}}}};
}
function offer(s,id,extra={},player={}){
  s.prospects[id]={id,name:id,rank:10,position:'QB',overall:50,rating:'50/70',...player};
  const o={id:'o-'+id,team:'Virginia',text:'Scholarship\nAn original pitch.',promises:[{text:'Start as a junior'}],visits:{coach:true},...extra};
  s.offersByProspect[id]=[o];return o;
}
test('full sheet import reads only H:I, handles CSV quotes, aliases, BOM and blank summary rows',()=>{
  const s=state();
  const text='\uFEFF'+csv([[' Virginia ',5],['WISCONSIN',3],['Texas Christian',2]])+'\r\nAnother player,Ohio State,QB,22,63,83,,,,,,More data\r\n';
  assert.deepEqual(A.parseEarlyDeclarees(text,s),{virginia:5,wisconsin:3,tcu:2});
  const result=A.applyEarlyDeclarees(s,text,'Early Entries.csv',100);
  assert.equal(result.total,10);assert.equal(s.scholarshipCapacity.teams.virginia.open,-3);
  assert.equal(A.remaining(s,'Virginia','scholarship'),5);
  assert.equal(A.remaining(s,'Wisconsin','scholarship'),7);
  assert.equal(s.scholarshipCapacity.earlyDeclarees.fileName,'Early Entries.csv');
});
test('entire import is rejected without changes for bad headers, teams, duplicates, or counts',()=>{
  const s=state(),before=JSON.stringify(s);
  for(const text of ['Team,EEs\nVirginia,5',csv([]),csv([['Virginia',2],['Missing Team',1]]),csv([['Virginia',2],[' virginia ',3]]),...['','-1','1.5','#REF!','1e3','9007199254740992'].map(n=>csv([['Virginia',2],['Wisconsin',n]])),csv([['',2]])]){
    assert.throws(()=>A.applyEarlyDeclarees(s,text));assert.equal(JSON.stringify(s),before);
  }
  s.scholarshipCapacity.stage='cpr';assert.throws(()=>A.applyEarlyDeclarees(s,csv([['Virginia',1]])),/this class/);
});
test('Bucks cap restoration preserves pitches and restores only eligible automatic scholarship rescinds',()=>{
  const s=state();
  for(const id of ['cap','legacy','manual','conditional','committed','otherCycle'])offer(s,id);
  offer(s,'walkon',{text:'Walk-On'});offer(s,'otherTeam',{team:'TCU'});
  A.applyScholarshipCap(s,10);
  const get=id=>s.offersByProspect[id][0];
  const pitch=structuredClone(get('cap'));
  delete get('legacy').scholarshipCapRescind;
  get('manual').rescindReason='Rescinded by coach.';
  get('conditional').conditionalRescindRuleId='rule1';
  get('otherCycle').scholarshipCapRescind.stage='cpr';
  s.prospects.committed.commitTeam='Wisconsin';
  const protectedIds=['manual','conditional','committed','walkon','otherCycle','otherTeam'];
  const before=JSON.stringify(protectedIds.map(get));
  const result=A.applyEarlyDeclarees(s,csv([['Virginia',3]]),'entries.csv',20);
  assert.deepEqual(result.restored.map(o=>o.prospectId),['cap','legacy']);
  assert.equal(JSON.stringify(protectedIds.map(get)),before);
  assert.equal(get('cap').rescinded,false);assert.equal(get('cap').text,pitch.text);
  assert.deepEqual(get('cap').promises,pitch.promises);assert.deepEqual(get('cap').visits,pitch.visits);
  assert.deepEqual(get('cap').scholarshipCapHistory[0],{batchId:'hs:virginia:10',rescindedAt:10,reason:pitch.rescindReason,restoredAt:20});
});
test('repeat imports are idempotent; corrections replace totals and remove missing teams',()=>{
  const s=state();offer(s,'cap');A.applyScholarshipCap(s,10);
  const text=csv([['Virginia',3],['Wisconsin',2]]);
  A.applyEarlyDeclarees(s,text,'entries.csv',20);const before=JSON.stringify(s);
  assert.equal(A.applyEarlyDeclarees(s,text,'entries.csv',30).restored.length,0);
  assert.equal(JSON.stringify(s),before);
  A.applyEarlyDeclarees(s,csv([['Virginia',1]]),'corrected.csv',40);
  assert.equal(A.remaining(s,'Virginia','scholarship'),1);assert.equal(A.remaining(s,'Wisconsin','scholarship'),4);
  const corrected=A.applyEarlyDeclarees(s,csv([['Virginia',0]]),'corrected.csv',50);
  assert.equal(corrected.rescinded,1);assert.equal(s.offersByProspect.cap[0].rescinded,true);
});
test('departures must cover over-cap commitments and respect spent Bucks and included commits',()=>{
  const s=state();s.bucksRemaining={virginia:1};s.scholarshipCapacity.includedCommits={virginia:1};
  offer(s,'won',{}, {commitTeam:'Virginia',commitType:'scholarship'});offer(s,'cap');A.applyScholarshipCap(s,10);
  assert.equal(A.applyEarlyDeclarees(s,csv([['Virginia',2]])).restored.length,0);
  assert.equal(A.remaining(s,'Virginia','scholarship'),0);
  assert.equal(A.applyEarlyDeclarees(s,csv([['Virginia',3]])).restored.length,1);
  assert.equal(A.remaining(s,'Virginia','scholarship'),1);
  assert.equal(A.remaining(s,'Virginia','walkon'),15);
});
test('new scholarship spots participate in autos and keep existing commitments',()=>{
  const s=state();offer(s,'cap');A.applyScholarshipCap(s,10);
  A.applyEarlyDeclarees(s,csv([['Virginia',1]]));
  const result=A.apply(s,'scholarship');
  assert.equal(result.commits.length,1);assert.equal(s.prospects.cap.commitTeam,'Virginia');
  assert.equal(A.remaining(s,'Virginia','scholarship'),0);
  A.applyEarlyDeclarees(s,csv([['Virginia',0]]));
  assert.equal(s.prospects.cap.commitTeam,'Virginia');
});

async function server(s,level='moderator'){
  const data=new Map([['league:state',s],['discord:user:mod',{discordId:'mod',team:'Virginia',accessLevel:level}]]);
  const env={SESSION_SECRET:'test',AUTH_KV:{get:async k=>structuredClone(data.get(k)||null),put:async(k,v)=>data.set(k,JSON.parse(v))}};
  const cookie='nzcfl_session='+await signSession(env,{discordId:'mod'});
  return {data,save:incoming=>onRequestPut({env,waitUntil(){},request:new Request('https://test/api/league/state',{method:'PUT',headers:{cookie},body:JSON.stringify({state:incoming,expectedUpdatedAt:1})})})};
}
test('moderator settings save persists departures and restored offers with offers closed',async()=>{
  const s=state();offer(s,'cap');A.applyScholarshipCap(s,10);
  const {data,save}=await server(s),incoming=structuredClone(s);
  A.applyEarlyDeclarees(incoming,csv([['Virginia',2]]),'entries.csv',20);
  const response=await save(incoming);assert.equal(response.status,200,await response.clone().text());
  const saved=data.get('league:state');assert.equal(saved.scholarshipCapacity.earlyDeclarees.counts.virginia,2);
  assert.equal(saved.offersByProspect.cap[0].rescinded,false);assert.equal(A.remaining(saved,'Virginia','scholarship'),2);
});
test('server enforces conditional rules after restoration, validates counts, and rejects coach imports',async()=>{
  const s=state();offer(s,'cap');offer(s,'won',{}, {commitTeam:'Virginia',commitType:'scholarship'});
  s.conditionalRescinds=[{id:'rule',team:'Virginia',name:'Enough QBs',enabled:true,count:1,positions:['QB']}];
  A.applyScholarshipCap(s,10);
  const incoming=structuredClone(s);A.applyEarlyDeclarees(incoming,csv([['Virginia',3]]));
  const mod=await server(s),response=await mod.save(incoming);assert.equal(response.status,200);
  const saved=mod.data.get('league:state');assert.equal(saved.offersByProspect.cap[0].rescinded,true);
  assert.equal(saved.offersByProspect.cap[0].conditionalRescindRuleId,'rule');
  const coach=await server(s,'coach');assert.equal((await coach.save(incoming)).status,403);
  for(const counts of [{virginia:-1},{virginia:1.5},{unknown:2},[]]){
    const invalid=structuredClone(incoming);invalid.scholarshipCapacity.earlyDeclarees.counts=counts;
    const fresh=await server(s);assert.equal((await fresh.save(invalid)).status,400);
  }
});
