import { applyDiscordCommits } from '../functions/api/commits/discord.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferLines } from '../transfer-import.mjs';
import '../transfer-rules.js';
import { onRequestPut } from '../functions/api/league/state.js';
const { pitchWordCount, pitchLimitError } = globalThis.NZCFLTransferRules;
const lines = [
  ['C.J. Lawson WR UAB 57/78 SR 1 year left- Two 10+ win seasons','bold'],
  ['C.J. wants to win.','regular'],
  ['Alani Williams Baylor LB 42/61 JR 2 years left- Start as','bold'],
  ['Freshman','bold'],
  ['Alani wants a plan.','regular'],
  ['Lamar Ekwonu QB Notre Dame 37/57 2 years left- Stay','bold'],
  ['Lamar wants encouragement.','regular'],
  ['Eric Hughes TE Stanford SO 41/65 3 years left- Stay','bold'],
  ['Eric wants a role.','regular'],
  ['Zach Hughes QB Missouri 56/80 SR 1 year left- EE Rules','bold'],
  ['Zach wants a fresh start.','bold']
].map(([text,font]) => ({text,font}));

test('PDF header variations preserve exact source order, eligibility, and prompts', () => {
  const rows = parseTransferLines(lines, ['Baylor']);
  assert.deepEqual(rows.map(p=>p.transferFrom), ['UAB','Baylor','Notre Dame','Stanford','Missouri']);
  assert.equal(rows[0].name, 'C.J. Lawson');
  assert.equal(rows[1].position, 'LB');
  assert.equal(rows[1].brokenPromise, 'Start as Freshman');
  assert.equal(rows[1].prompt, 'Alani wants a plan.');
  assert.equal(rows[2].grade, '');
  assert.equal(rows[2].yearsLeft, 2);
  assert.equal(rows[3].grade, 'SO');
  assert.equal(rows[4].prompt, 'Zach wants a fresh start.');
  assert.equal(rows[4].sourceOrder, 4);
  assert.deepEqual(rows[0].values, {});
});

test('invalid or empty PDF extraction cannot silently replace a class', () => {
  assert.throws(()=>parseTransferLines([],[]), /No transfer players/);
  assert.throws(()=>parseTransferLines([{text:'John Smith QB UAB 45/60 SR 1 year left- Stay',font:'bold'}]), /Missing prompt/);
  assert.throws(()=>parseTransferLines([{text:'John Smith UAB 45/60 SR 1 year left- Stay',font:'bold'}]), /Position could not/);
});

test('800-word boundary excludes only an actual standalone offer header', () => {
  const prospect = {name:'John Smith',rank:1,transferFrom:'UAB'};
  assert.equal(pitchWordCount('Michigan State offers John Smith\n' + 'word '.repeat(800), prospect), 800);
  assert.equal(pitchLimitError('Michigan State offers John Smith\n' + 'word '.repeat(800), prospect, 'transfer'), '');
  assert.match(pitchLimitError('word '.repeat(801), prospect, 'transfer'), /801 words/);
  assert.equal(pitchWordCount('I offer you a home\nword', prospect), 6);
  assert.ok(pitchWordCount('Michigan State offers John Smith and here is my pitch\n' + 'word '.repeat(800), prospect) > 800);
  assert.equal(pitchLimitError('word '.repeat(900), {}, 'hs'), '');
});

test('server rejects an oversized new transfer pitch without writing league data', async () => {
  let writes = 0;
  const env = {AUTH_KV:{get:async()=>null,put:async()=>{writes++;}}};
  const state = {recruitingStage:'transfer', prospects:{r1:{name:'John Smith',transferFrom:'UAB'}},offersByProspect:{r1:[{id:'o1',text:'word '.repeat(801)}]}};
  const response = await onRequestPut({env, request: new Request('https://example.test/api/league/state',{method:'PUT',body:JSON.stringify({state})})});
  assert.equal(response.status,400);
  assert.equal(writes,0);
  assert.match((await response.json()).error,/801 words/);
});

test('server accepts exactly 800 words plus header and unchanged historical pitches', async () => {
  const old = {recruitingStage:'transfer', prospects:{r1:{name:'John Smith',rank:1}},offersByProspect:{r1:[{id:'old',text:'word '.repeat(900)}]}};
  let stored;
  const env = {AUTH_KV:{get:async()=>old,put:async(key,value)=>{if(key === 'league:state') stored=JSON.parse(value);}}};
  const incoming = structuredClone(old);
  incoming.offersByProspect.r1.push({id:'new',text:'Michigan State offers John Smith\n'+'word '.repeat(800)});
  const response = await onRequestPut({env, request:new Request('https://example.test/api/league/state',{method:'PUT',body:JSON.stringify({state:incoming})}),waitUntil(){}});
  assert.equal(response.status,200);
  assert.equal(stored.offersByProspect.r1.length,2);
});


test('Discord transfer commits match player names and reject older-season messages', () => {
  const state={recruitingStage:'transfer',threads:[{createdAt:2000}],prospects:{r42:{id:'r42',name:'Marquis Small'}},manualCommitOverrides:{r42:{team:'Michigan State'}}};
  applyDiscordCommits(state,[{prospectId:'r42',name:'Other Player',team:'Michigan State',timestamp:new Date(3000).toISOString()}]);
  assert.equal(state.prospects.r42.commitTeam,undefined);
  applyDiscordCommits(state,[{prospectId:'r42',name:'Marquis Small',team:'Michigan State',timestamp:new Date(1000).toISOString()}]);
  assert.equal(state.prospects.r42.commitTeam,undefined);
  applyDiscordCommits(state,[{prospectId:'r900',name:'Marquis Small',team:'Michigan State',timestamp:new Date(3000).toISOString()}]);
  assert.equal(state.prospects.r42.commitTeam,'Michigan State');
});

test('capitalized wrapped promise lines stay in the bold header until paragraph gap', () => {
  const rows = parseTransferLines([
    {text:'Raymond Molinari LB Appalachian State 47/63 SR 1 year left- Beat JMU and',font:'bold',height:12,y:700,page:1},
    {text:'Georgia State yearly',font:'bold',height:12,y:686,page:1},
    {text:'Raymond started his career as a happy man.',font:'regular',height:12,y:672,page:1},
    {text:'Mike Milburn OL Appalachian State 42/58 SR 1 year left- Beat JMU and Georgia',font:'bold',height:12,y:630,page:1},
    {text:'State yearly',font:'bold',height:12,y:616,page:1},
    {text:'A new paragraph can also be bold.',font:'bold',height:12,y:588,page:1},
    {text:'Continue the pitch here.',font:'regular',height:12,y:574,page:1},
  ]);
  assert.equal(rows[0].brokenPromise,'Beat JMU and Georgia State yearly');
  assert.equal(rows[0].prompt,'Raymond started his career as a happy man.');
  assert.equal(rows[1].brokenPromise,'Beat JMU and Georgia State yearly');
  assert.equal(rows[1].prompt,'A new paragraph can also be bold. Continue the pitch here.');
});

test('PDF headers accept dotted mixed-case grades and normalize slider grades', () => {
  for (const [input, expected] of [['So.','SO'],['Jr.','JR'],['RS So.','RS SO'],['RSSr.','RS SR']]) {
    const [row] = parseTransferLines([{text:`Jake Hollis DL Alabama 41/65 ${input} 3 years left- Coach won’t leave`,font:'bold'}, {text:'Jake wants a fresh start.',font:'regular'}]);
    assert.equal(row.grade,expected);
    assert.equal(row.brokenPromise,'Coach won’t leave');
    assert.equal(row.yearsLeft,3);
  }
});

test('transfer Discord announcements resolve bold role mentions and numeric team IDs without ranks', async () => {
  const {parseDiscordCommits} = await import('../functions/api/commits/discord.js');
  for (const destination of ['**<@&361568281456410624>**', '**(361568281456410624)**']) {
    const commits = await parseDiscordCommits({}, [{id:'new', timestamp:'2026-09-14T12:00:00Z',content:`Coastal Carolina transfer Brandon Closs commits to ${destination}`}]);
    assert.equal(commits[0].name,'Brandon Closs');
    assert.equal(commits[0].team,'Louisville');
    const state = {recruitingStage:'transfer',threads:[{createdAt:Date.parse('2026-09-13')}],prospects:{r7:{id:'r7',name:'Brandon Closs',transferFrom:'Coastal Carolina'}}};
    assert.equal(applyDiscordCommits(state,commits).updated,1);
    state.recruitingStage = 'hs';
    state.prospects.r7.commitTeam = '';
    assert.equal(applyDiscordCommits(state,commits).updated,0);
  }
});

test('a standalone Scholarship line is part of a valid offer header only', () => {
  const p = {name:'Bob Jones'};
  assert.equal(pitchWordCount('Michigan State offers Bob Jones\nScholarship\nHello Bob',p),2);
  assert.equal(pitchWordCount('Michigan State offers Bob Jones\n\nScholarship\nHello Bob',p),2);
  assert.equal(pitchWordCount('Scholarship\nHello Bob',p),3);
  assert.equal(pitchWordCount('Michigan State offers Bob Jones\nScholarship players matter',p),3);
});

test('CPR pitch limit applies per-position leaders on the server even if incoming mode is wrong', async () => {
  const row={rank:1,name:'Top QB',position:'QB',overall:40,potential:60};
  const state={recruitingStage:'cpr',fullRoster:[row],prospects:{r1:{...row,id:'r1',offerMode:'values'}},offersByProspect:{r1:[{id:'o1',text:'word '.repeat(801)}]}};
  let writes=0;
  const env={AUTH_KV:{get:async()=>null,put:async()=>{writes++;}}};
  const response=await onRequestPut({env,request:new Request('https://test/api/league/state',{method:'PUT',body:JSON.stringify({state})})});
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/801 words/);
  assert.equal(writes,0);
});
test('CPR rejects player threads that do not match the CSV', async () => {
  const state={recruitingStage:'cpr',fullRoster:[{rank:1,name:'Low Safety',position:'S',overall:29,potential:45}],prospects:{r1:{name:'Low Safety',position:'S',overall:30,potential:45}}};
  const env={AUTH_KV:{get:async()=>null,put:async()=>{throw Error('Must not write');}}};
  const response=await onRequestPut({env,request:new Request('https://test/api/league/state',{method:'PUT',body:JSON.stringify({state})})});
  assert.equal(response.status,400);
});

test('CPR header matching uses whole names and optional position to resolve ambiguity', async () => {
  await import('../cpr-rules.js');
  const {resolveOffer}=globalThis.NZCFLCprRules;
  const roster=[{name:'John Jones',position:'S'},{name:'John Joneson',position:'QB'},{name:'John Jones',position:'LB'}];
  assert.equal(resolveOffer(roster,'Army offers John Joneson').position,'QB');
  assert.equal(resolveOffer(roster,'Army offers John Jones (LB)').position,'LB');
  assert.equal(resolveOffer(roster,'My free write',{name:'John Jones',position:'S'}).position,'S');
  assert.throws(()=>resolveOffer(roster,'Army offers John Jones'),/More than one/);
});
