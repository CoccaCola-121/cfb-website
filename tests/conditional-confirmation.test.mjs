import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTransactionalState,readTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPost} from '../functions/api/conditional-rescinds.js';
import {signSession} from '../functions/_lib/auth.js';
import {classKey} from '../functions/_lib/removed-players.js';
import {previewConditionalRule,applyConditionalRescinds} from '../functions/_lib/conditional-rescinds.js';
import '../offer-window.js';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};}});
 return {prepare:statement,async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close();}};
}

function fixture(){
 const state={recruitingStage:'hs',fullRoster:[],prospects:{},offersByProspect:{},conditionalRescinds:[],updatedAt:1};
 for(let i=0;i<40;i++){
  const p={id:'r'+i,name:'Player '+i,rank:40-i,position:'DL',rating:'50/70',commitTeam:i===0?'Alpha':''};
  state.prospects[p.id]=p;state.offersByProspect[p.id]=[{id:'o'+i,team:'Alpha',text:'Scholarship'}];
 }
 return state;
}
const rule=()=>({id:'custom-rule',team:'Alpha',enabled:true,count:1,positions:[],stars:'',scholarship:'',triggerIds:Array.from({length:40},(_,i)=>'r'+i),targetIds:Array.from({length:10},(_,i)=>'r'+(30+i))});
test('custom bottom ten targets ignore game ranking and accept overlapping triggers',()=>{
 const state=fixture(),r=rule();state.conditionalRescinds=[r];
 assert.equal(previewConditionalRule(state,r).targets.length,10);
 r.triggerIds=r.targetIds.slice();assert.equal(previewConditionalRule(state,r).met,false);
 state.prospects.r30.commitTeam='Alpha';
 assert.equal(previewConditionalRule(state,r).targets.length,9);
 applyConditionalRescinds(state);
 assert(!state.offersByProspect.r30[0].rescinded);
 assert(state.offersByProspect.r31[0].rescinded);
 assert(!state.offersByProspect.r29[0].rescinded);
});
for(const action of ['add','edit'])test(action+' requires explicit live confirmation before immediate rescinds',async()=>{
 const db=database(),state=fixture(),r=rule();
 if(action==='edit')state.conditionalRescinds=[{...r,count:2,createdAt:123}];
 await initializeTransactionalState(db,state);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'coach',team:'Alpha'})}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'coach'});
 const run=confirmImmediate=>onRequestPost({env,waitUntil(){},request:new Request('https://test/api/conditional-rescinds',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action,rule:r,classKey:classKey(state),expectedRuleVersion:123,confirmImmediate})})});
 let response=await run();assert.equal(response.status,409);let data=await response.json();
 assert.equal(data.needsConfirmation,true);assert.equal(data.preview.count,1);assert.equal(data.preview.targets.length,10);
 assert(!(await readTransactionalState(db)).offersByProspect.r31[0].rescinded);
 response=await run('outdated confirmation');assert.equal(response.status,409);
 response=await run(data.preview.token);assert.equal(response.status,200);
 const saved=await response.json();assert.equal(saved.rescinded,10);
 assert(saved.state.offersByProspect.r31[0].rescinded);assert(!saved.state.offersByProspect.r29[0].rescinded);
 db.close();
});

test('position rules keep exceptions without excluding their commitments from the trigger',()=>{
 const state=fixture();state.offersLocked=true;
 state.scholarshipCapacity={stage:'hs',sourceColumn:'D',teams:{alpha:{open:100}}};state.bucksRemaining={alpha:0};
 state.prospects.r2.position='QB';
 const r={...rule(),positions:['DL'],triggerIds:['r0'],targetIds:[],excludeIds:['r0','r1']};
 state.conditionalRescinds=[r];
 const preview=previewConditionalRule(state,r);
 assert.equal(preview.met,true);assert.equal(preview.count,1);assert.equal(preview.targets.length,37);
 assert(!preview.targets.some(o=>['r0','r1','r2'].includes(o.playerId)));
 const auto=globalThis.NZCFLAutoCommits.preview(state,'scholarship');
 assert.deepEqual(auto.errors,[]);
 assert.deepEqual(auto.rescinds.filter(o=>o.conditionalRescindRuleId===r.id).map(o=>o.prospectId).sort(),preview.targets.map(o=>o.playerId).sort());
 assert.equal(applyConditionalRescinds(state)[0].rescinded,37);
 for(const id of ['r0','r1','r2'])assert(!state.offersByProspect[id][0].rescinded);
 state.prospects.new={id:'new',name:'Later offer',position:'DL',rank:50,rating:'50/70'};
 state.offersByProspect.new=[{id:'new-offer',team:'Alpha',text:'Scholarship'}];
 assert.equal(applyConditionalRescinds(state)[0].rescinded,1);
 assert(!state.offersByProspect.r1[0].rescinded);
});

test('exceptions override explicit target lists and immediate confirmation excludes protected players',async()=>{
 const db=database(),state=fixture(),r={...rule(),excludeIds:['r31']};
 await initializeTransactionalState(db,state);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'coach',team:'Alpha'})}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'coach'});
 const run=body=>onRequestPost({env,waitUntil(){},request:new Request('https://test/api/conditional-rescinds',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({classKey:classKey(state),...body})})});
 try{
  let response=await run({action:'add',rule:r});assert.equal(response.status,409);
  const data=await response.json();assert.equal(data.preview.targets.length,9);assert(!data.preview.targets.some(p=>p.playerId==='r31'));
  response=await run({action:'add',rule:r,confirmImmediate:data.preview.token});assert.equal(response.status,200);
  let saved=(await response.json()).state;
  assert.deepEqual(saved.conditionalRescinds[0].excludeIds,['r31']);assert(!saved.offersByProspect.r31[0].rescinded);
  // An older tab omitting the field must not silently remove saved exceptions.
  const oldClientRule={...saved.conditionalRescinds[0],count:200};delete oldClientRule.excludeIds;
  response=await run({action:'edit',rule:oldClientRule,expectedRuleVersion:saved.conditionalRescinds[0].createdAt});assert.equal(response.status,200);
  saved=(await response.json()).state;assert.deepEqual(saved.conditionalRescinds[0].excludeIds,['r31']);
  response=await run({action:'edit',rule:{...saved.conditionalRescinds[0],excludeIds:[]},expectedRuleVersion:saved.conditionalRescinds[0].updatedAt});assert.equal(response.status,200);
  assert.deepEqual((await response.json()).state.conditionalRescinds[0].excludeIds,[]);
 }finally{db.close();}
});

test('exception lists reject unknown players, other teams only, malformed lists and unscoped rules',async()=>{
 const db=database(),state=fixture();state.offersByProspect.r5=[{id:'other',team:'Beta',text:'Scholarship'}];
 await initializeTransactionalState(db,state);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'coach',team:'Alpha'})}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'coach'});
 try{
  for(const patch of [{excludeIds:['missing']},{excludeIds:['r5']},{excludeIds:'r1'},{excludeIds:['r1'],triggerIds:[],targetIds:[]}]){
   const response=await onRequestPost({env,waitUntil(){},request:new Request('https://test/api/conditional-rescinds',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:'add',classKey:classKey(state),rule:{...rule(),triggerIds:['r0'],targetIds:['r1'],...patch}})})});
   assert.equal(response.status,400);assert.equal((await readTransactionalState(db)).conditionalRescinds.length,0);
  }
 }finally{db.close();}
});
