import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIVE_TEAMS, TEAM_METADATA} from '../functions/_lib/teams.js';
import {findTeam, getAllTeams, isContractedTeam} from '../functions/_lib/teams-util.js';
import {signSession} from '../functions/_lib/auth.js';
import {onRequestGet as teams} from '../functions/api/teams.js';
import {onRequestGet as me} from '../functions/api/auth/me.js';
import {onRequestPost as link} from '../functions/api/team/link.js';
import {onRequestPost as switchTeam} from '../functions/api/admin/switch-team.js';
import {onRequestPost as replaceAccount} from '../functions/api/admin/replace-account.js';
import {onRequestPost as submit} from '../functions/api/offers/submit.js';
import {onRequestPost as highSchool} from '../functions/api/offers/high-school.js';
import {onRequestPost as bulk} from '../functions/api/offers/bulk.js';
import {onRequestPost as rescind} from '../functions/api/offers/rescind.js';
import {onRequestPut as saveState} from '../functions/api/league/state.js';

const contracted=['San Jose State','Toledo','Tulsa','Nevada','North Dakota State','South Dakota State','Florida Atlantic','Southern Mississippi','Grambling State','Arkansas State','UNLV','Louisiana Tech','Tulane','Wyoming','Ohio','San Diego State','Yale','Harvard','Princeton','Fresno State'];
function fixture(){
 const data=new Map([
  ['discord:user:admin',{discordId:'admin',accessLevel:'commissioner'}],
  ['discord:user:old',{discordId:'old',team:'Toledo',accessLevel:'coach'}],
  ['discord:user:staying',{discordId:'staying',team:'Northern Illinois',accessLevel:'coach'}],
  ['team:toledo',{team:'Toledo',discordId:'old'}],
  ['team:northern illinois',{team:'Northern Illinois',discordId:'staying'}],
  ['league:state',{updatedAt:1,recruitingStage:'hs',prospects:{r1:{id:'r1',name:'Committed Player',rank:104,commitTeam:'Toledo'}},offersByProspect:{r1:[{id:'o1',team:'Toledo',text:'Scholarship',promises:[{text:'Start as a junior.'}]}]},fullRoster:[]}],
 ]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async key=>structuredClone(data.get(key) ?? null),put:async(key,value)=>data.set(key,JSON.parse(value)),delete:async key=>data.delete(key),list:async({prefix})=>({list_complete:true,keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})}};
 const call=async(handler,body,user='old',method=body===undefined?'GET':'POST')=>handler({env,waitUntil(){},request:new Request('https://test/action',{method,headers:{'content-type':'application/json',cookie:'nzcfl_session='+await signSession(env,{discordId:user})},...(body===undefined?{}:{body:JSON.stringify(body)})})});
 return {data,env,call};
}

test('exactly 20 teams are contracted; Northern Illinois stays and every historical brand remains resolvable',async()=>{
 assert.deepEqual([...globalThis.NZCFLTeamStatus.contracted].sort(),[...contracted].sort());
 assert.equal(ACTIVE_TEAMS.length,100);assert.equal(TEAM_METADATA.length,120);
 assert.equal((await getAllTeams({})).length,120);
 for(const name of contracted){
  const brand=await findTeam({},name);
  assert.ok(brand?.logoUrl,name);
  assert.ok(!ACTIVE_TEAMS.includes(brand),name);
  for(const alias of [name,brand.abbrev,brand.displayName]){
   assert.ok(isContractedTeam(alias),alias);
   assert.equal((await findTeam({},alias)).region,name);
   assert.equal(await findTeam({},alias,{coachable:true}),null);
  }
 }
 assert.equal(isContractedTeam('Northern Illinois'),false);
 assert.equal(isContractedTeam(''),false);
 assert.equal((await findTeam({},'NIU',{coachable:true})).region,'Northern Illinois');
});

test('Teams API omits contracted claims and fallback accounts but retains imported historical branding without changing records',async()=>{
 const f=fixture();
 for(const team of contracted)f.data.set('discord:user:'+team,{discordId:team,team});
 f.data.set('teams:extra',[{...TEAM_METADATA.find(t=>t.region==='Toledo'),logoUrl:'/historical-toledo.svg'}]);
 const before=structuredClone(f.data),response=await f.call(teams),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.teams.length,100);assert.equal(body.historicalTeams.length,20);
 assert.deepEqual(Object.keys(body.links),['northern illinois']);
 assert.deepEqual(body.claimedTeams,['northern illinois']);
 for(const team of contracted){assert.ok(!body.teams.some(t=>t.region===team));assert.ok(body.historicalTeams.some(t=>t.region===team));}
 assert.equal(body.historicalTeams.find(t=>t.region==='Toledo').logoUrl,'/historical-toledo.svg');
 assert.deepEqual(f.data,before);
});

test('self-link, moderator reassignment, and account replacement cannot assign any contracted team or its abbreviation',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 for(const team of contracted){
  const brand=await findTeam(f.env,team);
  for(const alias of [team,brand.abbrev])for(const handler of [link,switchTeam,replaceAccount]){
   const response=await f.call(handler,{team:alias,discordId:'123456789012345678',previousDiscordId:'223456789012345678'},handler===link?'old':'admin');
   assert.equal(response.status,400,team);
  }
 }
 assert.deepEqual(f.data,before);
 const response=await f.call(link,{team:'NIU'},'staying');
 assert.equal(response.status,200);assert.equal((await response.json()).user.team,'Northern Illinois');
 assert.deepEqual(f.data.get('league:state'),before.get('league:state'));
});

test('existing sessions lose contracted coaching access without deleting accounts, commitments, or promises',async()=>{
 const f=fixture();
 for(const team of contracted){
  f.data.set('discord:user:old',{discordId:'old',team,accessLevel:'coach'});
  const before=structuredClone(f.data),session=await (await f.call(me)).json();
  assert.equal(session.authenticated,true);assert.equal(session.user.team,'');assert.equal(session.user.accessLevel,'coach');
  f.env.LEAGUE_DB={prepare(){throw Error('A contracted coach must not reach the database.');}};
  for(const handler of [submit,highSchool,bulk,rescind])assert.equal((await f.call(handler,{})).status,401);
  delete f.env.LEAGUE_DB;
  assert.equal((await f.call(saveState,{state:structuredClone(f.data.get('league:state'))},'old','PUT')).status,403);
  assert.deepEqual(f.data,before,team);
 }
 const session=await (await f.call(me,undefined,'staying')).json();
 assert.equal(session.user.team,'Northern Illinois');
 f.data.set('discord:user:admin',{discordId:'admin',team:'Toledo',accessLevel:'commissioner'});
 const admin=await (await f.call(me,undefined,'admin')).json();
 assert.equal(admin.user.team,'');assert.equal(admin.user.isCommissioner,true);
});
