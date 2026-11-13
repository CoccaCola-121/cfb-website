import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import '../archive-season.js';
import {writeArchive,archivePayload} from '../functions/_lib/archives.js';
import {initializeTransactionalState,readTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPost} from '../functions/api/admin/archive-cycle.js';
import {onRequestGet} from '../functions/api/archives.js';
import {signSession} from '../functions/_lib/auth.js';
import {classKey} from '../functions/_lib/removed-players.js';
const seasons=globalThis.NZCFLArchiveSeason;

function database(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const run=(q,args)=>{const r=sql.prepare(q).run(...args);return {meta:{changes:r.changes}};};
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};},async first(){return sql.prepare(query).get(...args);},async run(){return run(query,args);}});
 const db={prepare:statement,batches:[],beforeBatch:null,async batch(statements){
  const bytes=Buffer.byteLength(JSON.stringify(statements));assert.ok(bytes<=2_000_000,'Archive request exceeds the database limit: '+bytes);
  db.batches.push({bytes,queries:statements.map(s=>s.query)});await db.beforeBatch?.(statements);
  sql.exec('BEGIN');try{const result=statements.map(s=>run(s.query,s.args));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}
 }};return db;
}
const uploading=rows=>rows.some(s=>s.query.startsWith('INSERT INTO recruiting_archive_uploads'));
const publishing=rows=>rows.some(s=>s.query.startsWith('DELETE FROM recruiting_archive_chunks'));
const read=async(db,id)=>{
 const response=await onRequestGet({env:{LEAGUE_DB:db},request:new Request('https://test/api/archives?id='+id)});
 return {status:response.status,data:await response.json()};
};
const pending=async db=>(await db.prepare('SELECT COUNT(*) AS n FROM recruiting_archive_uploads').first()).n;

test('archive season uses roster metadata anywhere, requires an explicit season when absent, and rejects conflicts',()=>{
 const missing={fullRoster:[{name:'CSV player'}]};assert.equal(seasons.suggested(missing),'');assert.throws(()=>seasons.resolve(missing),/Enter the recruiting season/);
 assert.equal(seasons.resolve(missing,'2064'),2064);
 for(const input of ['2064.5',2064.5,1899,10000,true,{},'2064 HS','2e3'])assert.throws(()=>seasons.resolve(missing,input),/whole-number/);
 const known={fullRoster:[{}, {metadataSeason:2064},{season:'2064'}]};assert.equal(seasons.suggested(known),2064);assert.equal(seasons.resolve(known),2064);
 assert.throws(()=>seasons.resolve(known,2065),/must match/);
 assert.throws(()=>seasons.resolve({fullRoster:[{season:2063},{season:2064}]},2064),/conflicting seasons/);
});

test('commissioner can archive a seasonless HS class without modifying the live board',async t=>{
 const db=database(t),seed={updatedAt:10,recruitingStage:'hs',fullRoster:[{name:'Recruit',rank:501}],prospects:{r501:{id:'r501',name:'Recruit',position:'QB',rank:501}},offersByProspect:{r501:[{team:'Alabama',text:'Scholarship\nOriginal pitch',promises:[{text:'Start as a junior'}]}]}};
 await initializeTransactionalState(db,seed);
 let role='commissioner';const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async()=>({discordId:'admin',accessLevel:role})}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'admin'});
 const request=body=>new Request('https://test/api/admin/archive-cycle',{method:'POST',headers:{cookie},body:JSON.stringify(body)});
 const body={expectedUpdatedAt:10,classKey:classKey(seed),season:2064};
 const missing=await onRequestPost({env,request:request({...body,season:undefined})});assert.equal(missing.status,400);assert.match((await missing.json()).error,/Enter the recruiting season/);
 assert.equal((await onRequestPost({env,request:request({...body,expectedUpdatedAt:9})})).status,409);
 assert.equal((await onRequestPost({env,request:request({...body,classKey:'other class'})})).status,409);
 role='coach';assert.equal((await onRequestPost({env,request:request(body)})).status,403);role='commissioner';
 const response=await onRequestPost({env,request:request(body)});assert.equal(response.status,200);assert.equal((await response.json()).id,'2064-hs');
 const archived=await read(db,'2064-hs');assert.equal(archived.status,200);assert.deepEqual(archived.data.offers,JSON.parse(JSON.stringify(archivePayload(seed).offers)));
 assert.deepEqual(await readTransactionalState(db),seed);assert.equal(await pending(db),0);
});

test('17 MB archives publish complete snapshots in bounded writes while preserving the previous archive',async t=>{
 const db=database(t),old={prospects:{p:{name:'Old'}},offers:{}};
 await writeArchive(db,{season:2064,stage:'hs',sourceVersion:1,payload:old});
 const payload={prospects:{p:{name:'Recruit'}},offers:{p:Array.from({length:170},(_,i)=>({team:'Team '+i,text:'é🏈"\n'.repeat(10000)}))}};
 assert.ok(Buffer.byteLength(JSON.stringify(payload))>17_000_000);
 let batches=0;db.beforeBatch=async rows=>{if(uploading(rows)){batches++;const current=await read(db,'2064-hs');assert.deepEqual(current.data.prospects,old.prospects);assert.deepEqual(current.data.offers,old.offers);}};
 await writeArchive(db,{season:2064,stage:'hs',sourceVersion:2,payload});assert.ok(batches>5);
 const saved=await read(db,'2064-hs');assert.deepEqual(saved.data.prospects,payload.prospects);assert.deepEqual(saved.data.offers,payload.offers);assert.equal(await pending(db),0);
});

test('interrupted and incomplete uploads preserve an existing archive and leave no partial new archive',async t=>{
 const db=database(t),old={prospects:{p:{name:'Old'}},offers:{}};
 await writeArchive(db,{season:2064,stage:'hs',sourceVersion:1,payload:old});
 const payload={prospects:{},offers:{text:'x'.repeat(4_000_000)}};
 for(const season of [2064,2065]){
  let uploads=0;db.beforeBatch=async rows=>{if(uploading(rows) && ++uploads===2)throw Error('Connection interrupted');};
  await assert.rejects(writeArchive(db,{season,stage:'hs',sourceVersion:2,payload}),/interrupted/);
  assert.deepEqual((await read(db,'2064-hs')).data.prospects,old.prospects);assert.equal((await read(db,'2065-hs')).status,404);assert.equal(await pending(db),0);
 }
 db.beforeBatch=async rows=>{if(publishing(rows))await db.prepare('DELETE FROM recruiting_archive_uploads WHERE part=0').run();};
 await assert.rejects(writeArchive(db,{season:2064,stage:'hs',sourceVersion:2,payload}),/could not be published/);
 assert.deepEqual((await read(db,'2064-hs')).data.prospects,old.prospects);assert.equal(await pending(db),0);
});

test('a newer archive that publishes during an older upload cannot be overwritten',async t=>{
 const db=database(t);let race=true;
 const winner={prospects:{p:{name:'Newer'}},offers:{}};
 db.beforeBatch=async rows=>{if(race && publishing(rows)){race=false;await writeArchive(db,{season:2064,stage:'hs',sourceVersion:3,payload:winner});}};
 await assert.rejects(writeArchive(db,{season:2064,stage:'hs',sourceVersion:2,payload:{prospects:{},offers:{text:'x'.repeat(3_000_000)}}}),/could not be published/);
 assert.deepEqual((await read(db,'2064-hs')).data.prospects,winner.prospects);assert.equal(await pending(db),0);
 await assert.rejects(writeArchive(db,{season:2064,stage:'hs',sourceVersion:1,payload:winner}),/newer archive/);
});

test('archive retention keeps all stages of the latest 20 seasons and removes old chunks',async t=>{
 const db=database(t),payload={prospects:{},offers:{}};
 for(let season=2040;season<=2060;season++)await writeArchive(db,{season,stage:'hs',sourceVersion:season,payload});
 await writeArchive(db,{season:2060,stage:'cpr',sourceVersion:2060,payload});
 const rows=await db.prepare('SELECT id,season FROM recruiting_archives ORDER BY season').all();assert.equal(rows.results.length,21);assert.equal(rows.results[0].season,2041);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM recruiting_archive_chunks WHERE archive_id='2040-hs'").first()).n,0);
 assert.equal((await read(db,'2060-cpr')).status,200);
});
