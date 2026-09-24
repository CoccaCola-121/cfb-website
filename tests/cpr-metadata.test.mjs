import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCprMetadata,playerMetadata} from '../cpr-metadata.mjs';
test('bot-compatible grade rules and team history skip unknown eligibility',()=>{
  const teams=new Map([[1,{region:'Alabama'}],[2,{region:'Army'}]]);
  assert.deepEqual(playerMetadata({age:21,tid:-1,statsTids:[1,1],transactions:[{tid:2},{tid:-1}]},2067,teams).previousTeams,['Alabama','Army']);
  assert.equal(playerMetadata({age:21},2067,teams).grade,'JR');
  assert.equal(playerMetadata({age:21},2067,teams).yearsLeft,2);
  assert.equal(playerMetadata({born:{year:2045},injuries:[{type:'Redshirt'}]},2067,teams).grade,'RS JR');
  assert.equal(playerMetadata({age:23,injuries:[{type:'Redshirt'}]},2067,teams).yearsLeft,1);
  assert.equal(playerMetadata({age:25},2067,teams).yearsLeft,null);
  assert.equal(playerMetadata({},2067,teams).grade,'');
});
test('export import only enriches unique matching free agents',()=>{
  const player={pid:10,firstName:'John',lastName:'Smith',tid:-1,age:20,ratings:[{pos:'S',ovr:29,pot:50}],statsTids:[1]};
  const data={gameAttributes:{season:2067},teams:[{tid:1,region:'Army'}],players:[player,{...player,tid:1}]};
  const roster=[{rank:1,name:'John Smith',position:'S',overall:29,potential:50},{rank:2,name:'Other',position:'QB',overall:50,potential:60}];
  const result=extractCprMetadata(data,roster);
  assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].grade,'SO');
  assert.equal(result.matches[0].yearsLeft,3);
  assert.deepEqual(result.unmatched,['Other']);
  data.players.push({...player,pid:11});
  assert.deepEqual(extractCprMetadata(data,roster).ambiguous,['John Smith']);
  assert.throws(()=>extractCprMetadata({},roster),/league export/);
});
