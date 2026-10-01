import '../../scholarship-template.js';
import {getCurrentUser,json} from '../_lib/auth.js';
import {teamKey} from '../_lib/teams-util.js';
const headers={'cache-control':'private, no-store'};
async function context(request,env){
 const user=await getCurrentUser(request,env);
 if(!user?.team || !env.LEAGUE_DB)return null;
 await env.LEAGUE_DB.prepare('CREATE TABLE IF NOT EXISTS scholarship_templates (key TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL)').run();
 return {key:user.discordId+':'+teamKey(user.team)};
}
export async function onRequestGet({request,env}){
 try{
  const ctx=await context(request,env);if(!ctx)return json({ok:false,error:'Sign in with a linked team.'},{status:401,headers});
  const row=await env.LEAGUE_DB.prepare('SELECT content,version FROM scholarship_templates WHERE key=?').bind(ctx.key).first();
  return json({ok:true,template:row?JSON.parse(row.content):globalThis.NZCFLScholarshipTemplate.clean({}),version:row?.version || 0},{headers});
 }catch{return json({ok:false,error:'Could not load your template.'},{status:503,headers});}
}
export async function onRequestPost({request,env}){
 try{
  const ctx=await context(request,env);if(!ctx)return json({ok:false,error:'Sign in with a linked team.'},{status:401,headers});
  const body=await request.json(),template=globalThis.NZCFLScholarshipTemplate.clean(body.template);
  if(!Number.isSafeInteger(body.version) || body.version<0)return json({ok:false,error:'Reload the template before saving.'},{status:400,headers});
  await env.LEAGUE_DB.prepare('INSERT OR IGNORE INTO scholarship_templates(key,content,version) VALUES(?,?,0)').bind(ctx.key,JSON.stringify(globalThis.NZCFLScholarshipTemplate.clean({}))).run();
  const result=await env.LEAGUE_DB.prepare('UPDATE scholarship_templates SET content=?,version=version+1 WHERE key=? AND version=?').bind(JSON.stringify(template),ctx.key,body.version).run();
  if(!result.meta.changes)return json({ok:false,error:'Template changed in another tab. Reload it before saving.'},{status:409,headers});
  return json({ok:true,template,version:body.version+1},{headers});
 }catch(error){return json({ok:false,error:error.message || 'Could not save template.'},{status:400,headers});}
}
