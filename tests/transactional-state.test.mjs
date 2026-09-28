import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTransactionalState,readTransactionalState,writeTransactionalState,StateConflict} from '../functions/_lib/transactional-state.js';
import {onRequestPost as submit} from '../functions/api/offers/submit.js';
import {signSession} from '../functions/_lib/auth.js';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};}});
 return {prepare:statement,async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close();}};
}
test('D1 atomic version checks reject a stale writer without damaging large unicode snapshots',async()=>{
 const db=database();
 const seed={updatedAt:1,padding:'x'.repeat(47970)+'👑'.repeat(50000),offers:[]};
 await Promise.all([initializeTransactionalState(db,seed),initializeTransactionalState(db,seed)]);
 const a=await readTransactionalState(db),b=await readTransactionalState(db);
 assert.equal(a.padding,seed.padding);
 a.offers.push('first');await writeTransactionalState(db,a,a);
 b.offers.push('stale');await assert.rejects(()=>writeTransactionalState(db,b,b),StateConflict);
 assert.deepEqual((await readTransactionalState(db)).offers,['first']);
 db.close();
});
test('120 simultaneous coaches submit without lost or duplicated offers; closed requests are rejected',async()=>{
 const db=database();
 const player={id:'r1',rank:1,name:'Test Player',position:'P',overall:60,potential:75,rating:'60/75',offerMode:'pitch'};
 const seed={updatedAt:1,recruitingStage:'cpr',offersLocked:false,wave1Released:true,fullRoster:[player],prospects:{r1:player},threads:[{id:'t',title:'Player',prospectIds:['r1']}],released:{1:true},offersByProspect:{},scholarshipHistory:{padding:'x'.repeat(2400000)}};
 await initializeTransactionalState(db,seed);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async key=>key.startsWith('discord:user:')?{discordId:key.split(':').at(-1),team:'Team '+key.split(':').at(-1),username:'Coach'}:null}};
 const requests=await Promise.all(Array.from({length:120},async(_,i)=>({cookie:'nzcfl_session='+await signSession(env,{discordId:String(i)}),body:{requestId:'request-'+i,prospectId:'r1',text:'Scholarship\nA test pitch.',promises:[]}})));
 const run=item=>submit({env,waitUntil(){},request:new Request('https://test/api/offers/submit',{method:'POST',headers:{cookie:item.cookie,'content-type':'application/json'},body:JSON.stringify(item.body)})});
 const start=Date.now();
 const responses=await Promise.all(requests.map(run));
 for(const response of responses)assert.equal(response.status,200,await response.text());
 const state=await readTransactionalState(db);
 assert.equal(state.offersByProspect.r1.length,120);
 assert.equal(new Set(state.offersByProspect.r1.map(o=>o.team)).size,120);
 assert.equal(state.scholarshipHistory.padding.length,2400000);
 assert.equal((await run(requests[0])).status,200);
 assert.equal((await readTransactionalState(db)).offersByProspect.r1.length,120);
 state.offersLocked=true;await writeTransactionalState(db,state,state);
 const closed={...requests[0],body:{...requests[0].body,requestId:'another-request'}};
 // Same-team duplicate is denied; a new coach is denied by the close rule.
 assert.equal((await run(closed)).status,409);
 const fresh={cookie:'nzcfl_session='+await signSession(env,{discordId:'new'}),body:{...requests[0].body,requestId:'new-request'}};
 assert.equal((await run(fresh)).status,403);
 console.log('Local SQL burst: 120 coaches, 2.4 MB snapshot, '+(Date.now()-start)+' ms; zero offers lost.');
 db.close();
});
