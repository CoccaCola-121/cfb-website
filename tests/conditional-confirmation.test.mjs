import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTransactionalState,readTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPost} from '../functions/api/conditional-rescinds.js';
import {signSession} from '../functions/_lib/auth.js';
import {classKey} from '../functions/_lib/removed-players.js';
import {previewConditionalRule,applyConditionalRescinds} from '../functions/_lib/conditional-rescinds.js';
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
