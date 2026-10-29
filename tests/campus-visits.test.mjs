import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTransactionalState,readTransactionalState} from '../functions/_lib/transactional-state.js';
import {onRequestPost as submit} from '../functions/api/offers/high-school.js';
import {onRequestPost as editVisits} from '../functions/api/offers/visits.js';
import {signSession} from '../functions/_lib/auth.js';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
 const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};}});
 return {prepare:statement,async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close();}};
}
const text=visit=>'Boston College offers #71 Brian Knowles\n\nScholarship\n\n'+visit+'\n\nTradition:\nThe original tradition pitch.\n\nCampus:\nThe original campus pitch.';
const state=()=>({updatedAt:1,recruitingStage:'hs',currentWeek:12,offersLocked:false,fullRoster:[],prospects:{r71:{id:'r71',rank:71,name:'Brian Knowles',position:'QB'}},offersByProspect:{},conditionalRescinds:[],unmatched:[]});
async function fixture(t,seed=state()){
 const db=database();t.after(()=>db.close());await initializeTransactionalState(db,seed);
 const env={LEAGUE_DB:db,SESSION_SECRET:'test',AUTH_KV:{get:async key=>key==='discord:user:coach'?{discordId:'coach',team:'Boston College'}:null}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'coach'});
 const call=(handler,body)=>handler({env,waitUntil(){},request:new Request('https://test/api/offers/'+(handler===submit?'high-school':'visits'),{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)})});
 return {read:()=>readTransactionalState(db),submit:(value,extra={})=>call(submit,{requestId:'test-request',prospectId:'r71',text:value,...extra}),edit:body=>call(editVisits,{prospectId:'r71',offerId:'o1',...body})};
}
test('HS submission accepts week 12, generic visits and optional opponent without losing pitch text',async t=>{
 for(const [visit,label] of [['Campus Visit Week 12','Week 12'],['Campus Visit',''],['School Visit (1/17)',''],['Campus Visit vs. USC','vs. USC'],['Campus Visit Week 12 vs. Navy','Week 12 vs. Navy']]){
  const f=await fixture(t),value=text(visit),response=await f.submit(value,{visits:{campus:false}});
  assert.equal(response.status,200,await response.clone().text());
  const offer=(await response.json()).offer;
  assert.equal(offer.visits.campus,true);assert.equal(offer.visits.campusLabel,label);assert.equal(offer.text,value);
  assert.equal((await f.submit(value)).status,200);
  assert.equal((await f.read()).offersByProspect.r71.length,1);
 }
});
test('generic visits still consume campus allowance; past or invalid scheduled weeks are rejected',async t=>{
 const full=state();full.offersByProspect.other=Array.from({length:17},(_,i)=>({id:'old-'+i,team:'Boston College',text:'Campus Visit',visits:{campus:true,campusLabel:''}}));
 const f=await fixture(t,full),denied=await f.submit(text('Campus Visit'));
 assert.equal(denied.status,400);assert.match((await denied.json()).error,/17\/17/);
 assert.equal((await f.read()).offersByProspect.r71,undefined);
 for(const label of ['Week 11','Week 0','Week 100','Week 12.5','Week banana']){
  const f=await fixture(t),response=await f.submit(text('Campus Visit '+label));
  assert.equal(response.status,400,label);assert.equal((await f.read()).offersByProspect.r71,undefined);
 }
});
test('pitchless HS walk-on drafts save without paragraphs or promises and remain retry safe',async t=>{
 const seed=state();seed.prospects.r71.rank=596;
 const f=await fixture(t,seed),value='Boston College offers Brian Knowles\nWalk-On';
 const response=await f.submit(value);assert.equal(response.status,200,await response.clone().text());
 const offer=(await response.json()).offer;
 assert.equal(offer.text,value);assert.deepEqual(offer.promises,[]);assert.deepEqual(offer.visits,{coach:false,campus:false,campusLabel:''});
 assert.equal((await f.submit(value)).status,200);assert.equal((await f.read()).offersByProspect.r71.length,1);
});
test('visit editor adds a generic visit, can schedule or clear a future week, and does not refund usage',async t=>{
 const seed=state();seed.offersByProspect.r71=[{id:'o1',team:'Boston College',text:text('').replace(/\n{3,}/g,'\n\n'),visits:{coach:false,campus:false,campusLabel:''}}];
 const f=await fixture(t,seed);
 let previous=seed.offersByProspect.r71[0].visits;
 for(const label of ['','Week 12','','vs. Navy']){
  const visits={coach:false,campus:true,campusLabel:label};
  const response=await f.edit({visits,expectedVisits:previous});assert.equal(response.status,200,await response.clone().text());
  const offer=(await response.json()).offer;
  assert.equal(offer.visits.campus,true);assert.equal(offer.visits.campusLabel,label);
  assert.equal((offer.text.match(/Campus Visit/g) || []).length,1);assert.ok(offer.text.endsWith('Campus:\nThe original campus pitch.'));
  previous=visits;
 }
 const saved=(await f.read()).offersByProspect.r71[0];assert.match(saved.editHistory[0].changes[0],/Added campus visit/);
});
test('generic edit respects visit cap, past-week lock and concurrent schedule updates',async t=>{
 for(const [oldLabel,expected,status] of [['Week 11','Week 11',400],['Week 12','Week 13',400],['Week 12','Week 12',200],['','',200]]){
  const seed=state();seed.offersByProspect.r71=[{id:'o1',team:'Boston College',text:text('Campus Visit'+(oldLabel?' '+oldLabel:'')),visits:{coach:false,campus:true,campusLabel:oldLabel}}];
  seed.offersByProspect.other=Array.from({length:16},(_,i)=>({id:'old-'+i,team:'Boston College',visits:{campus:true,campusLabel:''}}));
  const f=await fixture(t,seed),response=await f.edit({visits:{coach:false,campus:true,campusLabel:''},expectedVisits:{campus:true,campusLabel:expected}});
  assert.equal(response.status,status,await response.clone().text());
  const saved=(await f.read()).offersByProspect.r71[0];assert.equal(saved.visits.campus,true);assert.equal(saved.visits.campusLabel,status===200?'':oldLabel);
 }
 const seed=state();seed.offersByProspect.r71=[{id:'o1',team:'Boston College',text:text(''),visits:{}}];
 seed.offersByProspect.other=Array.from({length:17},(_,i)=>({id:'old-'+i,team:'Boston College',visits:{campus:true,campusLabel:''}}));
 const f=await fixture(t,seed),response=await f.edit({visits:{coach:false,campus:true,campusLabel:''},expectedVisits:{}});
 assert.equal(response.status,400);assert.match((await response.json()).error,/17\/17/);
});
