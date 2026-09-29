import {getCurrentUser,canModerate,accessLevel,json} from '../_lib/auth.js';
import {ensureModLog,describeModeration} from '../_lib/mod-log.js';
export async function onRequest(context){
 const {request,env}=context,path=new URL(request.url).pathname;
 if(!['POST','PUT','PATCH','DELETE'].includes(request.method) || !(/^\/api\/admin\//.test(path) || ['/api/league/state','/api/players/remove','/api/commits/discord'].includes(path)))return context.next();
 const user=await getCurrentUser(request,env);
 if(!user || !canModerate(env,user))return context.next();
 let id;
 try{
  await ensureModLog(env);
  const body=await request.clone().json().catch(()=>({}));
  const entry=await describeModeration(env,path,body);
  const actor={id:user.discordId,name:user.displayName || user.username || user.discordId,team:user.team,role:accessLevel(env,user)};
  const inserted=await env.LEAGUE_DB.prepare('INSERT INTO moderation_log (at,actor,action,details,status) VALUES (?,?,?,?,?)').bind(Date.now(),JSON.stringify(actor),entry.action,JSON.stringify(entry.details),'pending').run();
  id=inserted.meta.last_row_id;
 }catch{ return json({ok:false,error:'The moderation log is unavailable. No action was performed; please retry.'},{status:503}); }
 let response;
 try{response=await context.next();}catch(error){await finish('unknown');throw error;}
 let succeeded=response.ok;
 if(succeeded){try{const result=await response.clone().json();if(result.ok===false || result.error)succeeded=false;}catch{}}
 await finish(succeeded?'completed':'failed');
 return response;
 async function finish(status){
  const write=()=>env.LEAGUE_DB.prepare('UPDATE moderation_log SET status=? WHERE id=?').bind(status,id).run();
  try{await write();}catch{context.waitUntil(write().catch(error=>console.error('Mod log status update failed',id,error)));}
 }
}
