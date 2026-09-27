import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as callback} from '../functions/api/auth/callback.js';
import {onRequestGet as me} from '../functions/api/auth/me.js';
import {onRequestPost as logout} from '../functions/api/auth/logout.js';
import {onRequestPost as assignRole} from '../functions/api/admin/access-level.js';
import {signSession} from '../functions/_lib/auth.js';
function setup(existing){
 const data=new Map([['discord:user:owner',{discordId:'owner'}]]);
 if(existing)data.set('discord:user:coach',existing);
 const env={DISCORD_CLIENT_ID:'test-client',DISCORD_CLIENT_SECRET:'test-secret',SESSION_SECRET:'test-signing-secret',ADMIN_DISCORD_IDS:'owner',AUTH_KV:{get:async key=>structuredClone(data.get(key) || null),put:async(key,value)=>data.set(key,JSON.parse(value))}};
 return {env,data};
}
async function login(t,env){
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify(String(url).endsWith('/token')?{access_token:'test-token'}:{id:'coach',username:'new-name',global_name:'Updated Coach',avatar:'new-avatar',accessLevel:'commissioner',role:'commissioner'}),{status:200,headers:{'content-type':'application/json'}}));
 const response=await callback({env,request:new Request('https://test/api/auth/callback?code=test-code&state=test-state',{headers:{cookie:'nzcfl_oauth_state=test-state'}})});
 assert.equal(response.status,302);
 const cookie=response.headers.getSetCookie().find(value=>value.startsWith('nzcfl_session=')).split(';')[0];
 const profile=await me({env,request:new Request('https://test/api/auth/me',{headers:{cookie}})});
 return (await profile.json()).user;
}
for(const level of ['commissioner','moderator'])test('assigned '+level+' survives logout and Discord login',async t=>{
 const {env,data}=setup({discordId:'coach',team:'Alabama',createdAt:123,username:'Old Coach'});
 const ownerSession=await signSession(env,{discordId:'owner'});
 const grant=await assignRole({env,request:new Request('https://test/api/admin/access-level',{method:'POST',headers:{cookie:'nzcfl_session='+ownerSession,'content-type':'application/json'},body:JSON.stringify({discordId:'coach',accessLevel:level})})});
 assert.equal(grant.status,200);
 await logout();
 const user=await login(t,env);
 assert.equal(user.accessLevel,level);assert.equal(user.isModerator,true);assert.equal(user.isCommissioner,level==='commissioner');
 assert.equal(user.team,'Alabama');assert.equal(user.username,'Updated Coach');assert.equal(user.avatar,'new-avatar');assert.equal(data.get('discord:user:coach').createdAt,123);
});
test('legacy assigned roles survive login',async t=>{
 const {env}=setup({discordId:'coach',role:'moderator'});
 assert.equal((await login(t,env)).accessLevel,'moderator');
});
test('demotion remains coach after login even with a previous legacy role',async t=>{
 const {env,data}=setup({discordId:'coach',role:'commissioner',accessLevel:'commissioner'});
 const ownerSession=await signSession(env,{discordId:'owner'});
 const response=await assignRole({env,request:new Request('https://test/api/admin/access-level',{method:'POST',headers:{cookie:'nzcfl_session='+ownerSession,'content-type':'application/json'},body:JSON.stringify({discordId:'coach',accessLevel:'coach'})})});
 assert.equal(response.status,200);assert.equal(data.get('discord:user:coach').role,undefined);
 assert.equal((await login(t,env)).accessLevel,'coach');
});
test('new accounts default to coach; Discord profile cannot grant a site role',async t=>{
 const {env}=setup();assert.equal((await login(t,env)).accessLevel,'coach');
});
