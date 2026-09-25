import test from 'node:test';
import assert from 'node:assert/strict';
import '../scholarship-history.js';
import '../cpr-rules.js';
import {sanitizeState} from '../functions/_lib/league-state.js';
const {parseSheet,apply}=globalThis.NZCFLScholarshipHistory;
const header='2064,Position,Player ID,Scholly offered?,On Scholly?,WO Upgrade,CPR\n';
test('sheet parsing uses player IDs and explicit scholarship evidence',()=>{
 const data=parseSheet(header+'"Jones, John",QB,12,TRUE,No,FALSE,FALSE\nA,TE,13,FALSE,No,FALSE,TRUE\nB,S,14,FALSE,No,TRUE,FALSE\nC,K,15,FALSE,Yes,FALSE,FALSE','HS');
 assert.equal(data.season,2064);
 assert.deepEqual(data.players.map(p=>p.everScholarship),[true,false,true,true]);
 assert.equal(data.players[0].name,'Jones, John');
 assert.throws(()=>parseSheet('<html>sign in</html>','SR'),/columns are missing/);
});
test('history stays positive after rating drops or missing and negative source rows',()=>{
 const roster=[{rank:1,name:'John',position:'QB',overall:20,exportPlayerId:12},{rank:2,name:'John',position:'QB',overall:20,exportPlayerId:99},{rank:3,name:'Unknown'}];
 const cards={r1:{name:'John'}};
 const snapshot={season:2064,source:'test',players:[{id:'12',name:'John',everScholarship:true}]};
 const result=apply(roster,cards,{},snapshot);
 assert.equal(result.matched,1);assert.equal(result.unmatched.length,2);
 assert.equal(cards.r1.everScholarship,true);
 assert.equal(globalThis.NZCFLCprRules.scholarshipRecruit(roster[0]),true);
 assert.equal(globalThis.NZCFLCprRules.scholarshipRecruit(roster[1]),false);
 const next=apply(roster,cards,result.ledger,{...snapshot,players:[{id:'12',everScholarship:false}]});
 assert.ok(next.ledger['12']);
 assert.ok(apply(roster,cards,next.ledger,{...snapshot,players:[]}).ledger['12']);
 const saved=sanitizeState({scholarshipHistory:next.ledger,scholarshipSource:{season:2064}});
 assert.ok(saved.scholarshipHistory['12']);assert.equal(saved.scholarshipSource.season,2064);
});
