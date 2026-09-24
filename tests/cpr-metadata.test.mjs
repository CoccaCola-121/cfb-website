import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCprMetadata,playerMetadata} from '../cpr-metadata.mjs';
test('bot-compatible grade rules and team history skip unknown eligibility',()=>{
  const teams=new Map([[1,{region:'Alabama'}],[2,{region:'Army'}]]);
  assert.deepEqual(playerMetadata({age:21,tid:-1,statsTids:[1,1],transactions:[{tid:2},{tid:-1}]},2067,teams).previousTeams,[]);
  assert.equal(playerMetadata({age:21},2067,teams).grade,'JR');
  assert.equal(playerMetadata({age:21},2067,teams).yearsLeft,2);
  assert.equal(playerMetadata({born:{year:2045},injuries:[{type:'Redshirt'}]},2067,teams).grade,'RS JR');
  assert.equal(playerMetadata({age:23,injuries:[{type:'Redshirt'}]},2067,teams).yearsLeft,1);
  assert.equal(playerMetadata({age:25},2067,teams).yearsLeft,null);
  assert.equal(playerMetadata({},2067,teams).grade,'');
});
test('export import only enriches unique matching free agents',()=>{
  const player={pid:10,firstName:'John',lastName:'Smith',tid:-1,age:20,ratings:[{pos:'S',ovr:29,pot:50}],statsTids:[1]};
  const data={gameAttributes:{season:2067},teams:[{tid:1,region:'Army'}],players:[player]};
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
  p.transactions.push({season:2066,phase:1,tid:1});
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

test('a gap in the immediately previous season leaves previous team blank',()=>{
  const teams=new Map([[1,{region:'Stanford'}]]);
  const p={tid:-1,statsTids:[1],stats:[{season:2061,tid:1}],transactions:[{season:2061,tid:1}]};
  assert.equal(playerMetadata(p,2063,teams).previousTeam,'');
  assert.deepEqual(playerMetadata(p,2063,teams).previousTeams,[]);
  p.stats.push({season:2062,tid:1});
  assert.equal(playerMetadata(p,2063,teams).previousTeam,'Stanford');
});

test('CSV identity can match a still-rostered export player like Ben Hale',()=>{
  const result=extractCprMetadata({gameAttributes:{season:2063},teams:[{tid:25,region:'Michigan State'}],players:[{firstName:'Ben',lastName:'Hale',tid:25,born:{year:2042},yearsFreeAgent:0,stats:[{season:2062,tid:25}],ratings:[{pos:'QB',ovr:40,pot:59}]}]},[{rank:1,name:'Ben Hale',position:'QB',overall:40,potential:59}]);
  assert.equal(result.matches[0].grade,'JR');
  assert.equal(result.matches[0].yearsLeft,2);
  assert.equal(result.matches[0].previousTeam,'Michigan State');
});
test('free agent tenure distinguishes missing stats from a missed recruiting cycle',()=>{
  const teams=new Map([[92,{region:'Princeton'}],[56,{region:'Stanford'}]]);
  assert.equal(playerMetadata({tid:-1,yearsFreeAgent:1,stats:[{season:2061,tid:92}]},2063,teams).previousTeam,'Princeton');
  assert.equal(playerMetadata({tid:-1,yearsFreeAgent:2,stats:[{season:2060,tid:56}]},2063,teams).previousTeam,'');
});
