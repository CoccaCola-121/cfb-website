import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCprMetadata,playerMetadata} from '../cpr-metadata.mjs';
test('bot-compatible grade rules and team history skip unknown eligibility',()=>{
  const teams=new Map([[1,{region:'Alabama'}],[2,{region:'Army'}]]);
  assert.deepEqual(playerMetadata({age:21,tid:-1,statsTids:[1,1],transactions:[{tid:2},{tid:-1}]},2067,teams).previousTeams,['Army']);
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

test('most recent dated team wins over old transaction and stats team order',()=>{
  const teams=new Map([[1,{region:'Alabama'}],[2,{region:'Army'}]]);
  const p={tid:-1,age:21,statsTids:[2,1],stats:[{season:2066,tid:2}],transactions:[{season:2064,tid:1}]};
  assert.equal(playerMetadata(p,2067,teams).previousTeam,'Army');
  p.transactions.push({season:2067,phase:1,tid:1});
  assert.equal(playerMetadata(p,2067,teams).previousTeam,'Alabama');
  assert.equal(playerMetadata({age:21},2067,teams).yearsLeft,2);
  assert.equal(playerMetadata({age:22,injuries:[{type:'redshirt'}]},2067,teams).yearsLeft,2);
  assert.equal(playerMetadata({age:22},2067,teams).yearsLeft,1);
  assert.equal(playerMetadata({age:23,injuries:[{type:'redshirt'}]},2067,teams).yearsLeft,1);
});
test('plain JSON and gzip exports decode identically',async()=>{
  const {readLeagueExport}=await import('../cpr-metadata.mjs');
  const {gzipSync}=await import('node:zlib');
  const text=JSON.stringify({gameAttributes:{season:2067},players:[],teams:[]});
  assert.deepEqual(await readLeagueExport(new Blob([text])),JSON.parse(text));
  assert.deepEqual(await readLeagueExport(new Blob([gzipSync(text)])),JSON.parse(text));
});
