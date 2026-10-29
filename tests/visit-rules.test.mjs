import test from 'node:test';
import assert from 'node:assert/strict';
import '../visit-rules.js';
import {sanitizeState} from '../functions/_lib/league-state.js';
import {coachStateError} from '../functions/_lib/state-access.js';
import {onRequestPut} from '../functions/api/league/state.js';
import {signSession} from '../functions/_lib/auth.js';
const R=globalThis.NZCFLVisitRules;
const offer=week=>({id:'o1',team:'Army',text:'Army offers #1 Test Player\nScholarship\nCampus Visit Week '+week+' vs. Navy\nPitch.',visits:{campus:true,campusLabel:'Week '+week+' vs. Navy'}});
test('generic visits parse without consuming pitch lines and preserve scheduled week restrictions',()=>{
 for(const ending of ['\n\nTradition:\nOriginal pitch.','\r\nCampus:\r\nOriginal pitch.','\nCoach Visit\nPitch.','']){
  const text='Army offers #1 Test Player\nScholarship\nCampus Visit'+ending;
  assert.deepEqual(R.campusFromText(text),{campus:true,campusLabel:''});
  assert.equal(R.error({currentWeek:12},{text,visits:{campus:true,campusLabel:''}}),'');
 }
 assert.deepEqual(R.campusFromText('School Visit (1/17)\nWinning:\nPitch.'),{campus:true,campusLabel:''});
 for(const [input,expected] of [['',''],['12','Week 12'],['Week 12','Week 12'],['week 12 vs ohio state','Week 12 vs. Ohio State'],['vs. USC','vs. USC']]){
  assert.deepEqual(R.normalizeCampusLabel(input),{ok:true,value:expected});
 }
 const generic={text:'Campus Visit\n\nPitch.',visits:{campus:true,campusLabel:''}};
 assert.equal(R.error({currentWeek:12},generic,offer(12)),'');
 assert.match(R.error({currentWeek:12},generic,offer(11)),/locked/);
 assert.equal(R.error({currentWeek:12},offer(12),generic),'');
 assert.match(R.error({currentWeek:12},offer(11),generic),/12 or later/);
 for(const value of ['Week','0','Week 100','12.5','12vs. USC','vs.','Week 12\nPitch']){
  assert.equal(R.normalizeCampusLabel(value).ok,false,value);
 }
});
test('current week rejects past additions and edits but preserves historical visits',()=>{
 const state={recruitingStage:'hs',currentWeek:2};
 assert.match(R.error(state,offer(1)),/week 2 or later/);
 assert.equal(R.error(state,offer(2)),'');assert.equal(R.error(state,offer(12)),'');
 assert.equal(R.error(state,offer(1),offer(1)),'');
 assert.match(R.error(state,offer(3),offer(1)),/locked/);
 assert.match(R.error(state,offer(1),offer(3)),/week 2 or later/);
 assert.match(R.error(state,{...offer(1),text:offer(1).text.replace('Navy','Rice')},offer(1)),/locked/);
 assert.match(R.error(state,{...offer(1),visits:{campus:true,campusLabel:'Week 4'}},offer(1)),/locked/);
 assert.equal(R.error(state,{...offer(1),text:offer(1).text+'\nCoach Visit',visits:{...offer(1).visits,coach:true}},offer(1)),'');
 assert.equal(R.error({recruitingStage:'cpr',currentWeek:12},offer(1)),'');
 assert.equal(R.current({}),1);assert.equal(sanitizeState({currentWeek:12}).currentWeek,12);
 assert.match(coachStateError({currentWeek:2},{currentWeek:1},{team:'Army'}),/cannot change league settings/);
});
test('state save enforces past-visit locks even for moderators',async()=>{
 const state={recruitingStage:'hs',currentWeek:2,prospects:{r1:{id:'r1',rank:1,name:'Test Player'}},offersByProspect:{r1:[offer(1)]},conditionalRescinds:[]};
 const data=new Map([['league:state',state],['discord:user:mod',{discordId:'mod',team:'Army',accessLevel:'moderator'}]]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async k=>structuredClone(data.get(k)||null),put:async(k,v)=>data.set(k,JSON.parse(v))}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'mod'});
 const incoming=structuredClone(state);incoming.offersByProspect.r1=[offer(3)];
 const response=await onRequestPut({env,request:new Request('https://test/api/league/state',{method:'PUT',headers:{cookie},body:JSON.stringify({state:incoming})}),waitUntil(){}});
 assert.equal(response.status,400);assert.match((await response.json()).error,/locked/);
 assert.equal(data.get('league:state').offersByProspect.r1[0].visits.campusLabel,'Week 1 vs. Navy');
 const settings=structuredClone(state);settings.currentWeek=12;
 const saved=await onRequestPut({env,request:new Request('https://test/api/league/state',{method:'PUT',headers:{cookie},body:JSON.stringify({state:settings})}),waitUntil(){}});
 assert.equal(saved.status,200);assert.equal((await saved.json()).state.currentWeek,12);
});
