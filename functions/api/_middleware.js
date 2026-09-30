import {getCurrentUser,canModerate,accessLevel,json} from '../_lib/auth.js';
import {ensureModLog,describeModeration} from '../_lib/mod-log.js';
export async function onRequest(context){
 const {request,env}=context,path=new URL(request.url).pathname;
 if(!['POST','PUT','PATCH','DELETE'].includes(request.method) || !(/^\/api\/admin\//.test(path) || ['/api/league/state','/api/players/remove','/api/commits/discord'].includes(path)))return context.next();
 // Explicit exception requested for the single identified test submission.
 if(path==='/api/admin/remove-kenny-test-offer')return context.next();
 const user=await getCurrentUser(request,env);
 if(!user || !canModerate(env,user))return context.next();
 let id;
 try{
  await ensureModLog(env);
  const body=await request.clone().json().catch(()=>({}));
  const entry=await describeModeration(env,path,body,user);
  if(!entry)return context.next();
  const actor={id:user.discordId,name:user.displayName || user.username || user.discordId,team:user.team,role:accessLevel(env,user)};
  const inserted=await env.LEAGUE_DB.prepare('INSERT INTO moderation_log (at,actor,action,details,status) VALUES (?,?,?,?,?)').bind(Date.now(),JSON.stringify(actor),entry.action,JSON.stringify(entry.details),'pending').run();
  id=inserted.meta.last_row_id;
 }catch{ return json({ok:false,error:'The moderation log is unavailable. No action was performed; please retry.'},{status:503}); }
 let response;
 try{response=await context.next();}catch(error){await finish('unknown');throw error;}
 let succeeded=response.ok,reason='';
 try{const result=await response.clone().json();if(result.ok===false || result.error)succeeded=false;if(!succeeded)reason=String(result.error || 'Request rejected').slice(0,1000);}catch{if(!succeeded)reason='HTTP '+response.status;}
 await finish(succeeded?'completed':'failed',reason);
 return response;
 async function finish(status,reason=''){
  const write=()=>reason ? env.LEAGUE_DB.prepare("UPDATE moderation_log SET status=?, details=json_insert(details,'$[#]',?) WHERE id=?").bind(status,'Failure reason: '+reason,id).run() : env.LEAGUE_DB.prepare('UPDATE moderation_log SET status=? WHERE id=?').bind(status,id).run();
  try{await write();}catch{context.waitUntil(write().catch(error=>console.error('Mod log status update failed',id,error)));}
 }
}
