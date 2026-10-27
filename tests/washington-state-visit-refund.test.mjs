import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {refundWashingtonStateCampusVisits} from '../functions/_lib/washington-state-visit-refund.js';
import {readLeagueState} from '../functions/_lib/league-state.js';
import {initializeTransactionalState,readTransactionalState,writeTransactionalState} from '../functions/_lib/transactional-state.js';

const targets=[
  ['r44','Kyle Mann','S','o_99927419539955712_7c17fb81-7d78-4f4a-af32-15babcdf4f0d',1793137052540],
  ['r33','Jacob Simone','RB','o_99927419539955712_81b95cc3-0fb1-4770-9eea-f3edf00482ab',1793136605801],
  ['r12','Jalen Carr','CB','o_99927419539955712_3585fbd7-23b3-4939-adc8-b9e8b3a57574',1793137355175],
];
function fixture(){
  const state={updatedAt:1,recruitingStage:'hs',currentWeek:12,prospects:{r1:{id:'r1',name:'Caspian Maction'}},offersByProspect:{other:Array.from({length:14},(_,i)=>({id:'other-'+i,team:'Washington State',visits:{campus:true}}))}};
  for(const [pid,name,position,id,updatedAt] of targets){
    state.prospects[pid]={id:pid,name,position,commitTeam:pid==='r33'?'UCLA':null};
    state.offersByProspect[pid]=[
      {id,team:'Washington State',updatedAt,offerType:'scholarship',promises:['Starter'],visits:{coach:pid==='r33',campus:true,campusLabel:'Week 12 vs. Washington'},text:'Washington State offers '+name+'\nScholarship\n\nCampus Visit Week 12 vs. Washington\n\n'+(pid==='r33'?'Coach Visit\n\n':'')+'Campus:\nOur  original pitch.\n',editHistory:[{id:'original-'+pid,changes:['Original edit.']}]},
      {id:'other-team-'+pid,team:'Oregon',visits:{campus:true},text:'Campus Visit Week 12'},
    ];
  }
  return state;
}
const usage=state=>Object.values(state.offersByProspect).flat().filter(o=>o.team==='Washington State' && o.visits?.campus).length;

test('approved refund returns exactly three campus visits and preserves all other offer data',()=>{
  const before=fixture(),snapshot=structuredClone(before),after=refundWashingtonStateCampusVisits(before,999);
  assert.equal(usage(before),17);assert.equal(usage(after),14);assert.deepEqual(before,snapshot);
  assert.deepEqual(after.prospects,before.prospects);
  assert.deepEqual(after.offersByProspect.other,before.offersByProspect.other);
  for(const [pid] of targets){
    const old=before.offersByProspect[pid][0],offer=after.offersByProspect[pid][0];
    assert.deepEqual(after.offersByProspect[pid][1],before.offersByProspect[pid][1]);
    assert.equal(offer.text,old.text.replace('Campus Visit Week 12 vs. Washington\n',''));
    assert.equal(offer.visits.coach,old.visits.coach);assert.equal(offer.visits.campus,false);assert.equal(offer.visits.campusLabel,'');
    assert.equal(offer.editHistory.length,old.editHistory.length+1);
    assert.match(offer.editHistory.at(-1).changes[0],/Approved refund/);
    for(const key of Object.keys(old).filter(k=>!['text','visits','updatedAt','editHistory'].includes(k)))assert.deepEqual(offer[key],old[key]);
  }
  assert.equal(refundWashingtonStateCampusVisits(after),null);
  // Reusing a visit later cannot trigger another refund, even with an old timestamp.
  for(const [pid] of targets)Object.assign(after.offersByProspect[pid][0],{visits:before.offersByProspect[pid][0].visits,updatedAt:before.offersByProspect[pid][0].updatedAt});
  assert.equal(refundWashingtonStateCampusVisits(after),null);
});

test('refund skips changed offers, identities, visit text, and unrelated recruiting cycles',()=>{
  for(const mutate of [s=>s.recruitingStage='cpr',s=>s.prospects.r1.name='Next class']){
    const state=fixture();mutate(state);assert.equal(refundWashingtonStateCampusVisits(state),null);
  }
  for(const mutate of [
    (o,p)=>p.name='Other player', (o,p)=>p.id='r999', (o,p)=>p.position='QB',
    o=>o.id='new-offer',o=>o.team='Washington',o=>o.updatedAt++,
    o=>o.visits.campus=false,o=>o.visits.campusLabel='Week 13',
    o=>o.text=o.text.replace('Campus Visit','School Visit'),
    o=>o.text+='Campus Visit Week 12 vs. Washington\n',
  ]){
    const state=fixture();mutate(state.offersByProspect.r44[0],state.prospects.r44);
    const before=structuredClone(state.offersByProspect.r44);
    const after=refundWashingtonStateCampusVisits(state);
    assert.deepEqual(after.offersByProspect.r44,before);
    assert.equal(after.offersByProspect.r33[0].visits.campus,false);
  }
});

function database(){
  const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../migrations/0001-league-storage.sql',import.meta.url),'utf8'));
  const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async all(){return {results:sql.prepare(query).all(...args)};}});
  return {prepare:statement,async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:sql.prepare(s.query).run(...s.args)}));sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close();}};
}

test('read migration persists the refund once and retries without overwriting a concurrent save',async t=>{
  const db=database();t.after(()=>db.close());await initializeTransactionalState(db,fixture());
  const batch=db.batch.bind(db);let competingSave=true,writes=0;
  db.batch=async statements=>{
    if(competingSave){
      competingSave=false;
      const latest=await readTransactionalState(db);latest.currentWeek=13;
      latest.offersByProspect.other.push({id:'concurrent-offer',team:'USC',text:'Preserve this pitch.'});
      await writeTransactionalState(db,latest,latest);
    }
    writes++;return batch(statements);
  };
  const saved=await readLeagueState({LEAGUE_DB:db});
  assert.equal(usage(saved),14);assert.equal(saved.currentWeek,13);
  assert.equal(saved.offersByProspect.other.at(-1).id,'concurrent-offer');
  assert.ok(saved.storageSnapshot);assert.deepEqual(await readTransactionalState(db),saved);
  const initialWrites=writes;assert.deepEqual(await readLeagueState({LEAGUE_DB:db}),saved);assert.equal(writes,initialWrites);
  assert.equal(saved.offersByProspect.r33[0].visits.coach,true);
});
