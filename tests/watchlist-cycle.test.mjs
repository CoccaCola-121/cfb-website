import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTransactionalState,readTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPut as save} from '../functions/api/league/state.js';
import {onRequestGet as get,onRequestPost as post} from '../functions/api/watchlist.js';
import {signSession} from '../functions/_lib/auth.js';

async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};},async first(){return sql.prepare(query).get(...args);},async run(){return {meta:sql.prepare(query).run(...args)};}});
 const db={prepare:statement,async batch(rows){sql.exec('BEGIN');try{const results=rows.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const p={id:'r1',rank:1,name:'Old recruit',position:'QB',season:2064};
 const seed={updatedAt:1,recruitingStage:'hs',fullRoster:[p],prospects:{r1:p},offersByProspect:{},removedPlayers:{}};
 await initializeTransactionalState(db,seed);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async key=>key.startsWith('discord:user:')?{discordId:key.split(':').at(-1),team:key.endsWith(':other')?'UCLA':'Michigan State',accessLevel:key.endsWith(':admin')?'commissioner':'coach'}:null}};
 const call=async(handler,body,user='coach',cycleKey)=>{
  const response=await handler({env,waitUntil(){},request:new Request('https://test/action'+(cycleKey===undefined?'':'?cycleKey='+encodeURIComponent(cycleKey)),{method:handler===get?'GET':handler===save?'PUT':'POST',headers:{cookie:'nzcfl_session='+await signSession(env,{discordId:user}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})});
  return {status:response.status,...await response.json()};
 };
 const update=async change=>{const state=await readTransactionalState(db);change(state);const result=await call(save,{state,expectedUpdatedAt:state.updatedAt},'admin');assert.equal(result.status,200,result.error);return result.state;};
 return {sql,db,env,call,update};
}

test('watchlists survive ordinary updates but start empty for every stage transition, even when returning to an earlier class',async t=>{
 const f=await fixture(t),initial=await f.call(get);
 assert.deepEqual(initial.ids,[]);
 assert.equal((await f.call(post,{cycleKey:initial.cycleKey,prospectId:'r1',flagged:true})).status,200);
 assert.deepEqual((await f.call(get)).ids,['r1']);assert.deepEqual((await f.call(get,undefined,'other')).ids,[]);
 await f.update(s=>{s.currentWeek=2;s.offersLocked=true;});
 assert.deepEqual((await f.call(get)).ids,['r1']);assert.equal((await f.call(get)).cycleKey,initial.cycleKey);
 const transfer=await f.update(s=>{s.recruitingStage='transfer';});assert.ok(transfer.watchlistCycleId);
 const next=await f.call(get);assert.deepEqual(next.ids,[]);assert.notEqual(next.cycleKey,initial.cycleKey);
 for(const body of [{prospectId:'r1',flagged:true},{action:'add-many',ids:['r1']},{action:'clear'}]){
  assert.equal((await f.call(post,{...body,cycleKey:initial.cycleKey})).status,409);
  assert.equal((await f.call(post,body)).status,409);
 }
 assert.equal((await f.call(get,undefined,'coach',initial.cycleKey)).status,409);
 await f.call(post,{cycleKey:next.cycleKey,prospectId:'r1',flagged:true});
 await f.update(s=>{delete s.watchlistCycleId;s.currentWeek=3;});
 assert.equal((await f.call(get)).cycleKey,next.cycleKey,'Older saves cannot erase the server-owned cycle token');
 assert.deepEqual((await f.call(get)).ids,['r1']);
 await f.update(s=>{s.recruitingStage='hs';});
 const returned=await f.call(get);assert.deepEqual(returned.ids,[]);assert.notEqual(returned.cycleKey,initial.cycleKey);
});

test('a new season or different recruits clear flags without losing them for offer updates or ordinary player metadata',async t=>{
 const f=await fixture(t);let current=await f.call(get);
 await f.call(post,{cycleKey:current.cycleKey,action:'add-many',ids:['r1']});
 await f.update(s=>{s.fullRoster[0].hometown='New spelling';s.prospects.r1.commitTeam='Michigan State';});
 assert.deepEqual((await f.call(get)).ids,['r1']);
 await f.update(s=>{s.fullRoster[0].season=2065;});
 current=await f.call(get);assert.deepEqual(current.ids,[]);
 await f.call(post,{cycleKey:current.cycleKey,prospectId:'r1',flagged:true});
 await f.update(s=>{s.fullRoster[0].name='New recruit';s.prospects.r1.name='New recruit';});
 assert.deepEqual((await f.call(get)).ids,[]);
 const before=await readTransactionalState(f.db);
 const forbidden=await f.call(save,{state:{...before,watchlistCycleId:'invented'},expectedUpdatedAt:before.updatedAt});
 assert.equal(forbidden.status,200,'An ordinary save ignores a forged cycle token');
 assert.equal(forbidden.state.watchlistCycleId,before.watchlistCycleId);
});
