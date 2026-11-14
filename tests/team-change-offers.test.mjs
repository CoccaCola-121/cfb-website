import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {rescindOffersForTeams} from '../functions/_lib/league-state.js';
import {initializeTransactionalState,readTransactionalState,writeTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPost as link} from '../functions/api/team/link.js';
import {onRequestPost as switchTeam} from '../functions/api/admin/switch-team.js';
import {onRequestPost as unlink} from '../functions/api/admin/unlink.js';
import {signSession} from '../functions/_lib/auth.js';
import {archivePayload} from '../functions/_lib/archives.js';

function fixture(){
 const state={updatedAt:1,recruitingStage:'hs',prospects:{},offersByProspect:{},fullRoster:[]};
 for(const [id,commitTeam,rescinded] of [['r161','North Texas',false],['r315','North Texas',false],['r368','North Texas',true],['otherCommit','UCLA',false],['pending','',false],['oldRescind','',true]]){
  state.prospects[id]={id,name:id,rank:100,commitTeam,position:'CB'};
  state.offersByProspect[id]=['North Texas','UCLA'].map(team=>({id:team+':'+id,team,coach:'Previous coach',text:'Scholarship\n\nI promise you will start as a junior.',promises:[{title:'Playing Time',text:'I promise you will start as a junior.'}],visits:{campus:true,campusLabel:'Week 4'},editHistory:[{changes:['Original pitch.']}],...(rescinded?{rescinded:true,rescindedAt:9,rescindReason:'Existing rescind'}:{})}));
 }
 return state;
}
function kvFixture(){
 const state=fixture(),data=new Map([['league:state',state],['discord:user:admin',{discordId:'admin',accessLevel:'commissioner'}],['discord:user:old',{discordId:'old',team:'North Texas'}],['discord:user:new',{discordId:'new',team:''}],['team:north texas',{team:'North Texas',discordId:'old'}]]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async key=>structuredClone(data.get(key)||null),put:async(key,value)=>data.set(key,JSON.parse(value)),delete:async key=>data.delete(key)}};
 const call=async(handler,body,user='admin')=>handler({env,waitUntil(){},request:new Request('https://test/action',{method:'POST',headers:{'content-type':'application/json',cookie:'nzcfl_session='+await signSession(env,{discordId:user})},body:JSON.stringify(body)})});
 return {state,data,env,call};
}

test('coaching changes preserve committed offers, promises, visits and history; only active uncommitted offers are rescinded',async()=>{
 const f=kvFixture(),before=structuredClone(f.state);
 const result=await rescindOffersForTeams(f.env,[' north TEXAS ','North Texas']);
 assert.equal(result.rescindedOffers,1);
 for(const [id,offers] of Object.entries(before.offersByProspect)){
  assert.equal(result.state.offersByProspect[id].length,offers.length);
  assert.deepEqual(result.state.offersByProspect[id][1],offers[1]);
  if(id==='pending')assert.deepEqual(result.state.offersByProspect[id][0],{...offers[0],rescinded:true,rescindedAt:result.state.offersByProspect[id][0].rescindedAt,rescindReason:'Rescinded after coaching change.'});
  else assert.deepEqual(result.state.offersByProspect[id][0],offers[0]);
 }
 assert.deepEqual(result.state.prospects,before.prospects);
 assert.deepEqual(archivePayload(result.state).offers.r161[0].promises,before.offersByProspect.r161[0].promises);
 const retry=await rescindOffersForTeams(f.env,['North Texas']);assert.equal(retry.rescindedOffers,0);assert.equal(retry.state.updatedAt,result.state.updatedAt);
});

test('invalid offers and offers without a matching player remain on record',async()=>{
 const f=kvFixture();f.state.recruitingStage='transfer';f.state.offersByProspect.pending[0].text='Walk-On';
 f.state.offersByProspect.missing=[{id:'orphan',team:'North Texas',text:'Scholarship'}];
 const before=structuredClone(f.state);
 assert.equal((await rescindOffersForTeams(f.env,['North Texas'])).rescindedOffers,0);
 assert.deepEqual(f.data.get('league:state'),before);
});

test('vacating and subsequently claiming a team keep every original offer and all commitments',async()=>{
 const f=kvFixture();
 const response=await f.call(unlink,{discordId:'old'});assert.equal(response.status,200);assert.equal((await response.json()).rescindedOffers,1);
 assert.equal(f.data.get('discord:user:old').team,'');assert(!f.data.has('team:north texas'));
 const after=structuredClone(f.data.get('league:state'));
 const claim=await f.call(link,{team:'North Texas'},'new');assert.equal(claim.status,200);assert.equal((await claim.json()).rescindedOffers,0);
 assert.equal(f.data.get('team:north texas').discordId,'new');assert.deepEqual(f.data.get('league:state'),after);
 assert.deepEqual(after.offersByProspect.r161,f.state.offersByProspect.r161);
 assert.deepEqual(after.offersByProspect.r315,f.state.offersByProspect.r315);
 assert.deepEqual(after.offersByProspect.r368,f.state.offersByProspect.r368);
});

for(const handler of [link,switchTeam])test(handler===link?'self-service takeover rescinds without deleting':'admin takeover rescinds without deleting',async()=>{
 const f=kvFixture();f.data.delete('team:north texas');
 const response=await f.call(handler,{team:'North Texas',discordId:'new'},handler===link?'new':'admin');
 assert.equal(response.status,200);assert.equal((await response.json()).rescindedOffers,1);
 const saved=f.data.get('league:state');assert.equal(Object.values(saved.offersByProspect).flat().length,Object.values(f.state.offersByProspect).flat().length);
 for(const id of ['r161','r315','r368','otherCommit'])assert.deepEqual(saved.offersByProspect[id],f.state.offersByProspect[id]);
 const retry=await f.call(handler,{team:'North Texas',discordId:'new'},handler===link?'new':'admin');assert.equal(retry.status,200);assert.equal((await retry.json()).rescindedOffers,0);
});

test('moving coaches rescinds both vacated and newly taken-over teams, preserving all commits',async()=>{
 const f=kvFixture(),response=await f.call(switchTeam,{discordId:'old',team:'UCLA'});
 assert.equal(response.status,200);assert.equal((await response.json()).rescindedOffers,2);
 assert.equal(f.data.get('discord:user:old').team,'UCLA');assert(!f.data.has('team:north texas'));assert.equal(f.data.get('team:ucla').discordId,'old');
 const saved=f.data.get('league:state');assert(saved.offersByProspect.pending.every(o=>o.rescinded));
 for(const id of ['r161','r315','r368','otherCommit'])assert.deepEqual(saved.offersByProspect[id],f.state.offersByProspect[id]);
});

test('failed offer saves leave account assignments untouched; unauthorized and claimed-team requests cannot rescind',async()=>{
 for(const handler of [link,switchTeam,unlink]){
  const f=kvFixture();if(handler!==unlink)f.data.delete('team:north texas');
  const before=structuredClone(f.data);
  f.env.AUTH_KV.put=async(key)=>{if(key==='league:state')throw Error('Database unavailable');throw Error('Account must not be written');};
  const response=await f.call(handler,{team:'North Texas',discordId:handler===unlink?'old':'new'},handler===link?'new':'admin');
  assert.equal(response.status,503);assert.deepEqual(f.data,before);
 }
 const f=kvFixture(),before=structuredClone(f.data);
 assert.equal((await f.call(unlink,{discordId:'old'},'new')).status,403);
 assert.equal((await f.call(switchTeam,{team:'North Texas',discordId:'new'},'new')).status,403);
 assert.equal((await f.call(link,{team:'North Texas'},'new')).status,409);
 assert.deepEqual(f.data,before);
});

test('a commitment racing with a coaching change is preserved by the transactional retry',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};}});
 const db={prepare:statement,beforeBatch:null,async batch(statements){await db.beforeBatch?.();sql.exec('BEGIN');try{const out=statements.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const state=fixture();await initializeTransactionalState(db,state);
 db.beforeBatch=async()=>{db.beforeBatch=null;const latest=await readTransactionalState(db);latest.prospects.pending.commitTeam='North Texas';await writeTransactionalState(db,latest,latest);};
 const result=await rescindOffersForTeams({LEAGUE_DB:db},['North Texas']);
 assert.equal(result.rescindedOffers,0);assert.equal(result.state.prospects.pending.commitTeam,'North Texas');
 assert.deepEqual(result.state.offersByProspect,state.offersByProspect);
 assert.deepEqual(await readTransactionalState(db),result.state);
});
