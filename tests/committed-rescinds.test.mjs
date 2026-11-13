import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTransactionalState,readTransactionalState,writeTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPost as rescind} from '../functions/api/offers/rescind.js';
import {onRequestPut as save} from '../functions/api/league/state.js';
import {signSession} from '../functions/_lib/auth.js';
import {classKey} from '../functions/_lib/removed-players.js';

async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};}});
 const db={prepare:statement,beforeBatch:null,async batch(statements){
  await db.beforeBatch?.();
  sql.exec('BEGIN');try{const result=statements.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}
 }};
 const seed={updatedAt:1,recruitingStage:'hs',fullRoster:[],conditionalRescinds:[],removedPlayers:{},prospects:{},offersByProspect:{}};
 for(const [id,commitTeam] of [['r104','UCLA'],['r2',''],['r3',''],['r4','USC']]){
  seed.prospects[id]={id,rank:Number(id.slice(1)),name:id==='r104'?'C.J. Mabry':id,position:'CB',commitTeam};
  seed.offersByProspect[id]=[{id:'o-'+id,team:'UCLA',text:'Scholarship\nI promise a starting role.',promises:[{text:'I promise a starting role.'}],visits:{campus:true,campusLabel:'Week 1'}}];
 }
 await initializeTransactionalState(db,seed);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async key=>key.startsWith('discord:user:')?{discordId:key.split(':').at(-1),team:key.endsWith(':other')?'Alabama':'UCLA',accessLevel:key.split(':').at(-1)}:null}};
 async function request(handler,body,user='coach'){
  const cookie='nzcfl_session='+await signSession(env,{discordId:user});
  return handler({env,waitUntil(){},request:new Request('https://test/api/'+(handler===save?'league/state':'offers/rescind'),{method:handler===save?'PUT':'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)})});
 }
 return {db,seed,request,body:(ids,extra={})=>({classKey:classKey(seed),offers:ids.map(prospectId=>({prospectId,offerId:'o-'+prospectId})),...extra})};
}

test('mass rescinds skip commitments to any team, preserve their offers, and retry without changes',async t=>{
 const f=await fixture(t),body=f.body(['r104','r2','r4','r104']);
 const response=await f.request(rescind,body);assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.count,1);assert.equal(data.skippedCommitted,2);
 for(const id of ['r104','r4','r3'])assert.deepEqual(data.state.offersByProspect[id],f.seed.offersByProspect[id]);
 assert.equal(data.state.offersByProspect.r2[0].rescindReason,'Mass rescind');
 const retry=await (await f.request(rescind,body)).json();assert.equal(retry.count,0);assert.equal(retry.skippedCommitted,2);
 assert.equal(retry.state.updatedAt,data.state.updatedAt);
});

test('single rescinds reject commits, one-item mass rescinds skip them, and ownership/class checks remain enforced',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request(rescind,f.body(['r104']))).status,409);
 const skipped=await (await f.request(rescind,f.body(['r104'],{mass:true}))).json();assert.equal(skipped.count,0);assert.equal(skipped.skippedCommitted,1);
 assert.equal((await f.request(rescind,f.body(['r2'],{classKey:'old class'}))).status,409);
 assert.equal((await f.request(rescind,f.body(['r2','r3']),'other')).status,409);
 assert.deepEqual(await readTransactionalState(f.db),f.seed);
});

test('a commitment arriving during a mass-rescind save wins the race and is protected on retry',async t=>{
 const f=await fixture(t);
 f.db.beforeBatch=async()=>{
  f.db.beforeBatch=null;
  const committed=await readTransactionalState(f.db);
  committed.prospects.r2.commitTeam='UCLA';committed.prospects.r2.commitSource={type:'discord',messageId:'new-commit'};
  await writeTransactionalState(f.db,committed,committed);
 };
 const response=await f.request(rescind,f.body(['r2','r3']));assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.count,1);assert.equal(data.skippedCommitted,1);
 assert.equal(data.state.prospects.r2.commitTeam,'UCLA');assert.equal(data.state.prospects.r2.commitSource.messageId,'new-commit');
 assert.deepEqual(data.state.offersByProspect.r2,f.seed.offersByProspect.r2);
 assert.equal(data.state.offersByProspect.r3[0].rescinded,true);
 assert.deepEqual(await readTransactionalState(f.db),data.state);
});

test('legacy board saves cannot rescind commits, including moderator and commissioner saves',async t=>{
 const f=await fixture(t);
 for(const user of ['coach','moderator','commissioner']){
  const incoming=structuredClone(f.seed);incoming.offersByProspect.r104[0].rescinded=true;incoming.offersByProspect.r104[0].rescindReason='Mass rescind';
  const response=await f.request(save,{state:incoming,expectedUpdatedAt:1},user);
  assert.equal(response.status,user==='coach'?403:409,await response.text());
 }
 for(const clearCommit of [false,true]){
  const incoming=structuredClone(f.seed),id=clearCommit?'r104':'r2';
  incoming.prospects[id].commitTeam=clearCommit?'':'UCLA';incoming.offersByProspect[id][0].rescinded=true;
  assert.equal((await f.request(save,{state:incoming,expectedUpdatedAt:1},'commissioner')).status,409);
 }
 assert.deepEqual(await readTransactionalState(f.db),f.seed);
});
