import test from 'node:test';
import assert from 'node:assert/strict';
import '../hs-pitch-library.js';
import '../cpr-rules.js';
import '../walkon-limit.js';
import {onRequestGet,onRequestPost} from '../functions/api/hs-pitch-library.js';
import {signSession} from '../functions/_lib/auth.js';
const L=globalThis.NZCFLHSPitchLibrary;
const p={rank:1,name:'Caspian Maction',position:'DL',rating:'54/90',homestate:'Pennsylvania',values:{proPotential:1,winning:.8,coach:.6,location:.1}};
const library={paragraphs:{proPotential:'I promise you will be drafted.',winning:'I promise two winning seasons.',coach:'I promise to coach you throughout your career.'}};

test('selected phrases become saved dropdowns and resolve to exact wording',()=>{
 let input={paragraphs:{playingTime:'  I promise you will start by your (freshman, sophomore, junior) year. ',proPotential:'I promise you will be drafted in the first x rounds of the draft.',location:'I promise we will win a game in your home state or an adjacent state.'}};
 for(const [key,phrase,id,options] of [
  ['playingTime','(freshman, sophomore, junior)','c1',['freshman','sophomore','junior']],
  ['proPotential','x rounds','c2',['round','two rounds','three rounds']],
  ['location','home state or an adjacent state','c3',['home state or an adjacent state','home state']]
 ]){
  const start=input.paragraphs[key].indexOf(phrase);
  input=L.addChoice(input,key,start,start+phrase.length,id);
  input.choices[key][0].options=options;
 }
 const player={...p,values:{playingTime:1,proPotential:.8,location:.6}};
 assert.throws(()=>L.build('Michigan State',player,input,'scholarship'),/Choose wording/);
 const saved=JSON.parse(JSON.stringify(L.clean(input)));
 const result=L.build('Michigan State',player,saved,'scholarship',{c1:'junior',c2:'round',c3:'home state'}).text;
 assert.match(result,/your junior year/);assert.match(result,/first round of the draft/);
 assert.match(result,/in your home state\./);assert.doesNotMatch(result,/Dropdown|adjacent/);
 assert.throws(()=>L.build('Michigan State',player,saved,'scholarship',{c1:'made up',c2:'round',c3:'home state'}),/Choose wording/);
 assert.throws(()=>L.addChoice(saved,'location',0,0,'c4'),/Highlight/);
 const at=saved.paragraphs.location.indexOf('{{');
 assert.throws(()=>L.addChoice(saved,'location',at+1,at+5,'c4'),/existing dropdown/);
 let duplicate={paragraphs:{coach:'year and year'}};
 duplicate=L.addChoice(duplicate,'coach',9,13,'c1');
 assert.equal(duplicate.paragraphs.coach,'year and {{Dropdown 1}}');
 saved.choices.location[0].options=Array.from({length:100},(_,i)=>'option '+i);
 assert.equal(L.clean(saved).choices.location[0].options.length,100);
 const imported=L.importRows([['Location','A new location paragraph.']],saved).library;
 assert.deepEqual(imported.choices.location,[]);assert.equal(imported.choices.playingTime.length,1);
});

test('HS builder assembles the top three values and an editable offer header',()=>{
 const withVisits=L.build('Michigan State',p,library,'scholarship',{}, {coach:true,campus:true,week:'4',opponent:'Ohio State'}).text;
 assert.match(withVisits,/Scholarship\n\nCoach Visit\n\nCampus Visit Week 4 vs\. Ohio State\n\nPro Potential:/);
 assert.deepEqual(L.visitLines({campus:true,week:2}),['Campus Visit Week 2']);
 assert.throws(()=>L.visitLines({campus:true}),/week/);
 assert.throws(()=>L.visitLines({campus:true,week:4,opponent:'Team\nInjected text'}),/one line/);
 for(const type of ['scholarship','walkon']){
  const player={...p,rank:type==='walkon'?501:1};
  const result=L.build('Michigan State',player,library,type);
  assert.equal(result.text,'Michigan State offers #'+player.rank+' Caspian Maction 54/90 DL from Pennsylvania\n\n'+(type==='scholarship'?'Scholarship':'Walk-On')+'\n\nPro Potential:\n'+library.paragraphs.proPotential+'\n\nWinning:\n'+library.paragraphs.winning+'\n\nCoach:\n'+library.paragraphs.coach);
 }
 assert.deepEqual(L.topValues({values:{coach:.5,playingTime:.5,location:1,winning:.5}}).map(f=>f.key),['location','winning','playingTime']);
 assert.throws(()=>L.build('Michigan State',{...p,values:{location:null,coach:'',winning:undefined}},library,'scholarship'),/three values/);
 assert.throws(()=>L.build('Michigan State',p,{paragraphs:{}},'scholarship'),/Pro Potential, Winning, Coach/);
 assert.throws(()=>L.build('Michigan State',p,library,'other'),/Scholarship or Walk-On/);
});

test('CSV import accepts sheet labels, strips existing section headings, and retains other paragraphs',()=>{
 const result=L.importRows([['Pennsylvania'],['ProPotential','\nPro Potential:\nDraft paragraph, with commas.\n'],['Playing Time','Playing Time:\nA role.']],library);
 assert.equal(result.count,2);
 assert.equal(result.library.paragraphs.proPotential,'Draft paragraph, with commas.');
 assert.equal(result.library.paragraphs.winning,library.paragraphs.winning);
 assert.equal(result.library.paragraphs.playingTime,'A role.');
 assert.throws(()=>L.importRows([['x','bad']],{}),/No value paragraphs/);
 assert.throws(()=>L.importRows([['Coach','a'],['Coach','b']],{}),/more than one/);
 assert.throws(()=>L.clean({paragraphs:{coach:'x'.repeat(12001)}}),/12,000/);
 assert.throws(()=>L.clean({paragraphs:{coach:{}}}),/12,000/);
 assert.equal(L.build('Michigan State',p,{paragraphs:{...library.paragraphs,coach:'Coach:\nMy coach pitch.'}},'scholarship').text.split('Coach:').length,2);
});

test('pitch storage is private by coach/team, version checked, and unavailable anonymously',async()=>{
 const rows=new Map(),users=new Map([['a',{discordId:'a',team:'Michigan State'}],['b',{discordId:'b',team:'Michigan State'}]]);
 const env={SESSION_SECRET:'test',AUTH_KV:{get:async key=>users.get(key.replace('discord:user:',''))},LEAGUE_DB:{prepare(sql){
  return {bind(...args){this.args=args;return this;},async first(){return rows.get(this.args[0]) || null;},async run(){
   if(sql.startsWith('CREATE'))return {};
   if(sql.startsWith('INSERT')){if(!rows.has(this.args[0]))rows.set(this.args[0],{content:this.args[1],version:0});return {};}
   const [content,key,version]=this.args,row=rows.get(key);
   if(row?.version!==version)return {meta:{changes:0}};
   rows.set(key,{content,version:version+1});return {meta:{changes:1}};
  }};
 }}};
 const call=async(user,body)=>{
  const cookie=user?'nzcfl_session='+await signSession(env,{discordId:user}):'';
  return (body?onRequestPost:onRequestGet)({env,request:new Request('https://test/api/hs-pitch-library',{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
 };
 assert.equal((await call(null)).status,401);
 const save=await call('a',{library,version:0,key:'b:michiganstate'});
 assert.equal(save.status,200);
 assert.match(save.headers.get('cache-control'),/private, no-store/);
 assert.equal((await (await call('a')).json()).library.paragraphs.coach,library.paragraphs.coach);
 assert.equal((await (await call('b')).json()).library.paragraphs.coach,'');
 const start=library.paragraphs.proPotential.indexOf('drafted');
 const withChoices=L.addChoice(library,'proPotential',start,start+7,'c1');
 withChoices.choices.proPotential[0].options=['drafted','a first-round pick'];
 assert.equal((await call('a',{library:withChoices,version:1})).status,200);
 assert.deepEqual((await (await call('a')).json()).library.choices.proPotential[0].options,['drafted','a first-round pick']);
 assert.equal((await call('a',{library:{paragraphs:{}},version:0})).status,409);
 assert.equal((await call('a',{library,version:-1})).status,400);
 env.recruitingStage='cpr';
 assert.equal((await (await call('a')).json()).library.paragraphs.coach,library.paragraphs.coach);
 env.recruitingStage='hs';
 assert.equal((await (await call('a')).json()).library.paragraphs.coach,library.paragraphs.coach);
 users.get('a').team='Nebraska';
 assert.equal((await (await call('a')).json()).library.paragraphs.coach,'');
});

 test('name lookup rejects spelling errors and duplicates and allows position disambiguation',()=>{
  const players={r1:{id:'r1',name:'John Smith',position:'WR'},r2:{id:'r2',name:'John Smith',position:'DL'}};
  assert.throws(()=>L.findPlayer(players,'Jon Smith'),/No player/);
  assert.throws(()=>L.findPlayer(players,'John Smith'),/More than one/);
  assert.equal(L.findPlayer(players,'  JOHN   SMITH ','wr').id,'r1');
  assert.throws(()=>L.findPlayer(players,'John Smith','QB'),/No player/);
  assert.throws(()=>L.build('Michigan State',p,library,'walkon'),/1–500/);
  assert.throws(()=>L.build('Michigan State',{...p,rank:500},library,'walkon'),/1–500/);
  for(const rank of [1,500])assert.match(globalThis.NZCFLWalkonLimit.error({recruitingStage:'hs'},{rank},{team:'Army',text:'Walk-On'}),/1–500/);
  assert.equal(globalThis.NZCFLWalkonLimit.error({recruitingStage:'hs'},{rank:501},{team:'Army',text:'Walk-On'}),'');
  assert.equal(globalThis.NZCFLWalkonLimit.error({recruitingStage:'hs'},{rank:1},{team:'Army',text:'Scholarship'}),'');
  assert.equal(globalThis.NZCFLWalkonLimit.error({recruitingStage:'cpr'},{rank:1},{team:'Army',text:'Walk-On'}),'');
 });
