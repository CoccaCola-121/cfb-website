const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function run(state){
 let result,parses=0;
 const context=vm.createContext({});context.self=context;
 context.importScripts=(...paths)=>paths.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context));
 context.postMessage=data=>{result=JSON.parse(JSON.stringify(data));};
 vm.runInContext(fs.readFileSync(path.join(root,'auto-preview-worker.js'),'utf8'),context);
 const original=context.NZCFLCprRules;
 context.NZCFLCprRules={...original,scholarshipOffer(offer){parses++;return original.scholarshipOffer(offer);}};
 context.event={data:{signature:'test',state}};
 vm.runInContext('self.onmessage(event)',context,{timeout:10000});
 assert.equal(result.signature,'test');return {result,parses};
}
function board(){return {recruitingStage:'hs',prospects:{},offersByProspect:{},scholarshipCapacity:{stage:'hs',sourceColumn:'D',teams:{alpha:{open:1},beta:{open:10}}},bucksRemaining:{alpha:0,beta:0}};}
function player(state,id,overall,teams){state.prospects[id]={id,name:id,rank:501,position:'QB',overall,potential:60};state.offersByProspect[id]=teams.map(team=>({id:id+'-'+team,team,text:'Scholarship'}));}

test('worker badges exclude contested and cascading winners and respect capacity',()=>{
 const state=board();player(state,'low',30,['Alpha']);player(state,'high',40,['Alpha']);player(state,'cascade',50,['Alpha','Beta']);
 const {result}=run(state);assert.equal(result.unavailable,false);assert.deepEqual(result.offers,['low:low-Alpha']);
 assert.equal(state.prospects.cascade.commitTeam,'Beta');assert.equal(state.prospects.high.commitTeam,undefined);
});

test('worker reports the actual validation failure',()=>{
 const state=board();delete state.scholarshipCapacity;player(state,'p',30,['Alpha']);
 const {result}=run(state);assert.equal(result.unavailable,true);assert.deepEqual(result.offers,[]);assert.match(result.error,/Read scholarship counts/);
});

test('10,168 offers and 32 conditional rules finish within the preview budget without repeated pitch parsing',()=>{
 const state=board();state.scholarshipCapacity.teams={};state.bucksRemaining={};state.conditionalRescinds=[];
 for(let t=0;t<120;t++){state.scholarshipCapacity.teams['team '+t]={open:10};state.bucksRemaining['team '+t]=0;}
 for(let i=0;i<2046;i++){
  const id='r'+i;state.prospects[id]={id,name:'Player '+i,rank:i+1,position:i%2?'QB':'WR',overall:20+i%60,potential:80};
  state.offersByProspect[id]=Array.from({length:i<62?4:5},(_,j)=>({id:id+'-'+j,team:'Team '+((i+j)%120),text:j===0?'Scholarship':'Walk-On'}));
 }
 for(let i=0;i<32;i++)state.conditionalRescinds.push({id:'rule'+i,team:'Team '+i,enabled:true,count:4,positions:['QB'],stars:'',scholarship:'scholarship',excludeIds:['r'+i]});
 assert.equal(Object.values(state.offersByProspect).flat().length,10168);
 const {result,parses}=run(state);assert.equal(result.unavailable,false,result.error);assert.ok(result.offers.length>100);
 assert.ok(parses<60000,'Offer types should be parsed once per simulation pass, got '+parses);
 const counts={};for(const p of Object.values(state.prospects))if(p.commitTeam){const k=p.commitTeam+':'+p.commitType;counts[k]=(counts[k]||0)+1;assert.ok(counts[k]<=(p.commitType==='scholarship'?10:15));}
});
