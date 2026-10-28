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
