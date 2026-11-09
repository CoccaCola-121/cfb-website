import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import '../scholarship-history.js';
import {initializeTransactionalState,readTransactionalState,writeTransactionalState,StateConflict} from '../functions/_lib/transactional-state.js';
import {onRequestPut} from '../functions/api/league/state.js';
import {onRequest as moderation} from '../functions/api/_middleware.js';
import {signSession} from '../functions/_lib/auth.js';

function database(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const run=(query,args)=>{const result=sql.prepare(query).run(...args);return {meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}};};
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return run(query,args);}});
 const db={prepare:statement,batches:[],beforeBatch:null,async batch(statements){
  const bytes=Buffer.byteLength(JSON.stringify(statements));
  assert.ok(bytes<=2_000_000,'Database request must stay bounded; got '+bytes+' bytes');
  db.batches.push({bytes,queries:statements.map(s=>s.query)});
  await db.beforeBatch?.(statements);
  sql.exec('BEGIN');try{const result=statements.map(s=>run(s.query,s.args));sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}
 }};
 return db;
}
const pending=db=>db.prepare('SELECT COUNT(*) AS n FROM league_pending_chunks').all().then(r=>r.results[0].n);
const uploading=statements=>statements.some(s=>s.query.startsWith('INSERT INTO league_pending_chunks'));
const publishing=statements=>statements.some(s=>s.query.startsWith('INSERT INTO league_chunks(part,content) SELECT part,content'));

test('18 MB board saves manual commitments and early declarees through moderation with bounded atomic writes',async t=>{
 const db=database(t),seed={updatedAt:1,recruitingStage:'hs',currentWeek:12,fullRoster:[],conditionalRescinds:[],prospects:{},offersByProspect:{},scholarshipCapacity:{stage:'hs',sourceColumn:'D',teams:{virginia:{team:'Virginia',open:0},ucla:{team:'UCLA',open:10}}},bucksRemaining:{virginia:0}};
 for(let n=1;n<=600;n++){
  const id='r'+n;seed.prospects[id]={id,name:'Player '+n,position:'QB',rank:n};
  seed.offersByProspect[id]=[{id:'offer-'+n,team:n===1?'Virginia':n===2?'UCLA':'Other Team',offerType:'scholarship',text:'Scholarship\n'+('Original pitch '+n+' — école 🏈. ').repeat(1000),visits:{coach:n===1,campus:false},promises:[{text:'Start as a junior'}],...(n===1?{rescinded:true,rescindReason:'Automatic rescind: scholarship cap reached.',rescindedAt:10}:{})}];
 }
 assert.ok(Buffer.byteLength(JSON.stringify(seed))>18_000_000);
 await initializeTransactionalState(db,seed);
 assert.deepEqual(await readTransactionalState(db),seed);
 const tasks=[],env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async key=>key==='discord:user:mod'?{discordId:'mod',team:'Virginia',accessLevel:'moderator'}:null,put:async()=>{}}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'mod'});
 const save=async state=>{
  const request=new Request('https://test/api/league/state',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({state,expectedUpdatedAt:state.updatedAt})});
  const context={env,request,waitUntil:task=>tasks.push(task)};
  const response=await moderation({...context,next:()=>onRequestPut(context)});
  const result=await response.json();assert.equal(response.status,200,result.error);
  return result.state;
 };
 const manual=structuredClone(seed);manual.prospects.r2.commitTeam='UCLA';
 manual.manualCommitOverrides={r2:{name:'Player 2',team:'UCLA',stage:'hs',updatedAt:20}};
 let observed=0;
 db.beforeBatch=async statements=>{if(uploading(statements)){observed++;assert.equal((await readTransactionalState(db)).prospects.r2.commitTeam,undefined);}};
 const committed=await save(manual);assert.ok(observed>1);assert.equal(committed.prospects.r2.commitTeam,'UCLA');
 assert.deepEqual(committed.offersByProspect,seed.offersByProspect);
 db.beforeBatch=null;
 const early=structuredClone(committed);
 globalThis.NZCFLAutoCommits.applyEarlyDeclarees(early,'A,B,C,D,E,F,G,Team,EEs\n,,,,,,,Virginia,3','entries.csv',30);
 const saved=await save(early);
 assert.equal(saved.scholarshipCapacity.earlyDeclarees.counts.virginia,3);
 assert.equal(saved.offersByProspect.r1[0].rescinded,false);
 assert.equal(saved.prospects.r2.commitTeam,'UCLA');
 assert.equal(saved.offersByProspect.r1[0].text,seed.offersByProspect.r1[0].text);
 assert.deepEqual(saved.offersByProspect.r1[0].visits,seed.offersByProspect.r1[0].visits);
 assert.deepEqual(saved.offersByProspect.r1[0].promises,seed.offersByProspect.r1[0].promises);
 assert.deepEqual(await readTransactionalState(db),saved);
 assert.equal(await pending(db),0);
 const logs=await db.prepare('SELECT status FROM moderation_log').all();assert.deepEqual(logs.results.map(r=>r.status),['completed','completed']);
 await Promise.all(tasks);
});

test('interrupted staging keeps the original board and a retry can publish a complete Unicode snapshot',async t=>{
 const db=database(t),seed={updatedAt:1,marker:'old',text:'é🏈'.repeat(900000)};
 await initializeTransactionalState(db,seed);
 const before=await readTransactionalState(db),next={...before,marker:'new value',text:'💙\"\n'.repeat(1000000)};
 let uploads=0;
 db.beforeBatch=async statements=>{if(uploading(statements) && ++uploads===2)throw Error('Simulated connection loss');};
 await assert.rejects(writeTransactionalState(db,next,before),/Simulated connection loss/);
 assert.deepEqual(await readTransactionalState(db),before);assert.equal(await pending(db),0);
 db.beforeBatch=null;
 await writeTransactionalState(db,next,before);
 assert.deepEqual(await readTransactionalState(db),next);assert.equal(await pending(db),0);
});

test('a concurrent save wins over staged stale data, and shrinking a board removes old chunks atomically',async t=>{
 const db=database(t);await initializeTransactionalState(db,{updatedAt:1,first:'old',text:'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(120000),tail:'before'});
 const before=await readTransactionalState(db),stale={...before,first:'longer value'};
 let race=true;
 db.beforeBatch=async statements=>{
  if(race && publishing(statements)){
   race=false;
   const current=await readTransactionalState(db);current.tail='winner';
   await writeTransactionalState(db,current,current);
  }
 };
 await assert.rejects(writeTransactionalState(db,stale,before),StateConflict);
 const latest=await readTransactionalState(db);assert.equal(latest.first,'old');assert.equal(latest.tail,'winner');assert.equal(await pending(db),0);
 db.beforeBatch=null;
 const small={first:'small',text:'é🏈'};await writeTransactionalState(db,small,latest);
 assert.deepEqual(await readTransactionalState(db),small);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM league_chunks').all()).results[0].n,1);
});

test('a missing staged chunk cannot publish and competing large initializations keep one complete snapshot',async t=>{
 const db=database(t),a={updatedAt:1,text:'a'.repeat(3_000_000)},b={updatedAt:2,text:'b'.repeat(3_000_000)};
 await Promise.all([initializeTransactionalState(db,a),initializeTransactionalState(db,b)]);
 const before=await readTransactionalState(db);assert.ok(before.text===a.text || before.text===b.text);
 db.beforeBatch=async statements=>{
  if(publishing(statements))await db.prepare('DELETE FROM league_pending_chunks WHERE part=(SELECT MIN(part) FROM league_pending_chunks)').run();
 };
 await assert.rejects(writeTransactionalState(db,{text:'c'.repeat(3_000_000)},before),StateConflict);
 assert.deepEqual(await readTransactionalState(db),before);assert.equal(await pending(db),0);
});

test('staging stops early when another writer changes the board during upload',async t=>{
 const db=database(t);await initializeTransactionalState(db,{updatedAt:1,text:'a'.repeat(8_000_000),tail:'before'});
 const before=await readTransactionalState(db);let uploads=0;
 db.beforeBatch=async statements=>{
  if(uploading(statements) && ++uploads===2){
   const current=await readTransactionalState(db);current.tail='winner';
   await writeTransactionalState(db,current,current);
  }
 };
 await assert.rejects(writeTransactionalState(db,{...before,text:'b'.repeat(8_000_000)},before),StateConflict);
 const saved=await readTransactionalState(db);
 assert.equal(uploads,2);assert.equal(saved.text,before.text);assert.equal(saved.tail,'winner');assert.equal(await pending(db),0);
});

test('an incomplete Settings request is rejected without changing the board',async t=>{
 const db=database(t);await initializeTransactionalState(db,{updatedAt:1,recruitingStage:'hs',prospects:{}});
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'mod',accessLevel:'commissioner'})}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'mod'}),before=await readTransactionalState(db);
 for(const body of ['{"state":','null','[]','{"state":null}']){
  const response=await onRequestPut({env,request:new Request('https://test/api/league/state',{method:'PUT',headers:{cookie},body})});
  assert.equal(response.status,400);assert.deepEqual(await readTransactionalState(db),before);
 }
});

test('closing a 10,168-offer board retries concurrent saves without losing offers or changing other settings',async t=>{
 const {onRequestPost:close}=await import('../functions/api/admin/offer-window.js');
 const {classKey}=await import('../functions/_lib/removed-players.js');
 const {sanitizeState}=await import('../functions/_lib/league-state.js');
 const db=database(t),seed=sanitizeState({recruitingStage:'hs',offersLocked:false,currentWeek:12,fullRoster:[],prospects:{},offersByProspect:{},scholarshipCapacity:{stage:'hs',sourceColumn:'D',teams:{}},conditionalRescinds:[]});
 for(let i=0;i<2046;i++)seed.prospects['r'+i]={id:'r'+i,name:'Player '+i,rank:i+1,position:'QB'};
 for(let i=0;i<10168;i++)(seed.offersByProspect['r'+(i%2046)] ||= []).push({id:'offer-'+i,team:'Team '+(i%120),text:'Scholarship\n'+('Original pitch. '.repeat(130))});
 assert.ok(Buffer.byteLength(JSON.stringify(seed))>20_000_000);
 await initializeTransactionalState(db,seed);db.batches=[];
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'mod',accessLevel:'moderator'}),put:async()=>{}}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'mod'}),tasks=[];
 let races=0,injecting=false;
 db.beforeBatch=async statements=>{
  if(!injecting && races<2 && statements.some(s=>s.query.startsWith('UPDATE league_head'))){
   injecting=true;const n=++races,latest=await readTransactionalState(db);
   latest.offersByProspect.r2045.push({id:'concurrent-'+n,team:'Coach '+n,text:'Walk-On'});
   latest.currentWeek=13;await writeTransactionalState(db,latest,latest);injecting=false;
  }
 };
 const request=()=>new Request('https://test/api/admin/offer-window',{method:'POST',headers:{cookie},body:JSON.stringify({locked:true,classKey:classKey(seed)})});
 const context={env,request:request(),waitUntil:task=>tasks.push(task)};
 const response=await moderation({...context,next:()=>close(context)}),result=await response.json();
 assert.equal(response.status,200,result.error);assert.equal(races,2);assert.equal(result.state.offersLocked,true);
 assert.equal(result.state.currentWeek,13);assert.equal(Object.values(result.state.offersByProspect).flat().length,10170);
 assert.deepEqual(result.state.prospects,seed.prospects);assert.deepEqual(result.state.scholarshipCapacity,seed.scholarshipCapacity);
 assert.deepEqual(result.state.offersByProspect.r2045.slice(0,-2),seed.offersByProspect.r2045);
 assert.ok(db.batches.every(b=>!b.queries.some(q=>q.startsWith('INSERT INTO league_pending_chunks'))),'A lock should only rewrite the changed tail chunks');
 const before=await readTransactionalState(db),batches=db.batches.length;
 assert.equal((await close({...context,request:request()})).status,200);assert.equal(db.batches.length,batches,'Retry after a lost response is idempotent');
 assert.deepEqual(await readTransactionalState(db),before);
 const logs=await db.prepare('SELECT action,status FROM moderation_log').all();assert.deepEqual(logs.results.map(r=>({...r})),[{action:'Closed offers',status:'completed'}]);
 await Promise.all(tasks);
});

test('offer-window commands enforce moderator access and class identity, and reopening clears a past schedule',async t=>{
 const {onRequestPost:change}=await import('../functions/api/admin/offer-window.js');
 const {onRequestPost:submit}=await import('../functions/api/offers/high-school.js');
 const {classKey}=await import('../functions/_lib/removed-players.js');
 const db=database(t),seed={updatedAt:1,recruitingStage:'hs',offersLocked:true,offerSchedule:{closesAt:'2026-01-01T00:00:00Z'},prospects:{r1:{id:'r1',name:'Player',rank:501}},offersByProspect:{},fullRoster:[]};
 await initializeTransactionalState(db,seed);
 let role='coach';
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'test',team:'UCLA',accessLevel:role}),put:async()=>{}}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'test'});
 const request=body=>new Request('https://test/api/admin/offer-window',{method:'POST',headers:{cookie},body:JSON.stringify(body)});
 const body={locked:false,classKey:classKey(seed)};
 assert.equal((await change({env,request:request(body)})).status,403);
 const rejected=await submit({env,request:request({requestId:'new-offer-1234',prospectId:'r1',text:'Walk-On'})});
 assert.equal(rejected.status,403);assert.match((await rejected.json()).error,/locked/);
 role='moderator';
 assert.equal((await change({env,request:request({...body,classKey:'wrong'})})).status,409);
 assert.equal((await change({env,request:request({...body,locked:'false'})})).status,400);
 assert.deepEqual(await readTransactionalState(db),seed);
 const opened=await change({env,request:request(body)});assert.equal(opened.status,200);
 const saved=(await opened.json()).state;assert.equal(saved.offersLocked,false);assert.equal(saved.offerSchedule,null);
 // A class switch that wins the first attempted close must not close the new class.
 let race=true;db.beforeBatch=async statements=>{if(race && statements.some(s=>s.query.startsWith('UPDATE league_head'))){race=false;const live=await readTransactionalState(db);live.recruitingStage='transfer';await writeTransactionalState(db,live,live);}};
 assert.equal((await change({env,request:request({...body,locked:true})})).status,409);
 assert.equal((await readTransactionalState(db)).offersLocked,false);
});
