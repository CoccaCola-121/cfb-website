import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/admin/replace-account.js';
import {signSession} from '../functions/_lib/auth.js';
const oldId='1448143910596509761', newId='1551110872624144447';
async function setup(){
 const state={offersByProspect:{p:[{team:'Rutgers',id:'offer',text:'Original pitch'}]},prospects:{p:{committedTo:'Rutgers'}}};
 const data=new Map([['discord:user:admin',{discordId:'admin'}],['discord:user:'+oldId,{discordId:oldId,team:'Rutgers',displayName:'maxmaxxing',accessLevel:'coach'}],['team:rutgers',{team:'Rutgers',discordId:oldId}],['league:state',state]]);
 const writes=[];
 const env={SESSION_SECRET:'test',ADMIN_DISCORD_IDS:'admin',AUTH_KV:{get:async k=>structuredClone(data.get(k)||null),put:async(k,v)=>{writes.push(k);data.set(k,JSON.parse(v));}}};
 const cookie='nzcfl_session='+await signSession(env,{discordId:'admin'});
 const call=(body={},auth=true)=>onRequestPost({env,request:new Request('https://test/api/admin/replace-account',{method:'POST',headers:{cookie:auth?cookie:'','content-type':'application/json'},body:JSON.stringify({team:'Rutgers',previousDiscordId:oldId,discordId:newId,...body})})});
 return {data,writes,call,state};
}
test('Rutgers replacement preserves every offer and commit and revokes old team association',async()=>{
 const {data,writes,call,state}=await setup();
 assert.equal((await call()).status,200);
 assert.equal(data.get('team:rutgers').discordId,newId);
 assert.equal(data.get('discord:user:'+newId).team,'Rutgers');
 assert.equal(data.get('discord:user:'+oldId).team,'');
 assert.deepEqual(data.get('league:state'),state);
 assert.ok(writes.every(k=>k.startsWith('discord:user:')||k.startsWith('account-replacement:')||k==='team:rutgers'));
 assert.equal((await call()).status,200); // Retry after a lost response is harmless.
});
test('replacement preserves new profile and does not transfer old elevated roles',async()=>{
 const {data,call}=await setup();data.get('discord:user:'+oldId).accessLevel='commissioner';
 data.set('discord:user:'+newId,{discordId:newId,username:'new-name',avatar:'avatar',accessLevel:'coach'});
 assert.equal((await call()).status,200);
 assert.equal(data.get('discord:user:'+newId).username,'new-name');assert.equal(data.get('discord:user:'+newId).accessLevel,'coach');
});
for(const scenario of ['unauthorized','stale owner','other team'])test(scenario+' cannot replace account',async()=>{
 const {data,writes,call}=await setup();
 if(scenario==='stale owner')data.set('team:rutgers',{team:'Rutgers',discordId:'someone-else'});
 if(scenario==='other team')data.set('discord:user:'+newId,{discordId:newId,team:'USC'});
 assert.equal((await call({},scenario!=='unauthorized')).status,scenario==='unauthorized'?403:409);
 assert.equal(writes.length,0);
});
