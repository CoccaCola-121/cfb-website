import test from 'node:test';
import assert from 'node:assert/strict';
import '../hs-pitch-library.js';
import {onRequestGet,onRequestPost} from '../functions/api/hs-pitch-library.js';
import {signSession} from '../functions/_lib/auth.js';
const L=globalThis.NZCFLHSPitchLibrary;
const p={rank:1,name:'Caspian Maction',position:'DL',rating:'54/90',homestate:'Pennsylvania',values:{proPotential:1,winning:.8,coach:.6,location:.1}};
const library={paragraphs:{proPotential:'I promise you will be drafted.',winning:'I promise two winning seasons.',coach:'I promise to coach you throughout your career.'}};

test('HS builder assembles the top three values and an editable offer header',()=>{
 for(const type of ['scholarship','walkon']){
  const result=L.build('Michigan State',p,library,type);
  assert.equal(result.text,'Michigan State offers #1 Caspian Maction 54/90 DL from Pennsylvania\n\n'+(type==='scholarship'?'Scholarship':'Walk-On')+'\n\nPro Potential:\n'+library.paragraphs.proPotential+'\n\nWinning:\n'+library.paragraphs.winning+'\n\nCoach:\n'+library.paragraphs.coach);
 }
 assert.deepEqual(L.topValues({values:{coach:.5,playingTime:.5,location:1,winning:.5}}).map(f=>f.key),['location','winning','playingTime']);
 assert.throws(()=>L.build('Michigan State',{...p,values:{location:null,coach:'',winning:undefined}},library,'scholarship'),/three values/);
 assert.throws(()=>L.build('Michigan State',p,{paragraphs:{}},'walkon'),/Pro Potential, Winning, Coach/);
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
 assert.equal((await call('a',{library:{paragraphs:{}},version:0})).status,409);
 assert.equal((await call('a',{library,version:-1})).status,400);
 users.get('a').team='Nebraska';
 assert.equal((await (await call('a')).json()).library.paragraphs.coach,'');
});
