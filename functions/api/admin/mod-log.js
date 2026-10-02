import {getCurrentUser,canModerate,json} from '../../_lib/auth.js';
import {teamKey} from '../../_lib/teams-util.js';
import {ensureModLog,ownConditionalLogDetail,readableLogDetails} from '../../_lib/mod-log.js';
export async function onRequestGet({request,env}){
 const user=await getCurrentUser(request,env);
 if(!user || !canModerate(env,user))return json({ok:false,error:'Moderator access required.'},{status:403});
 try{
  await ensureModLog(env);
  const cursor=Number(new URL(request.url).searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const result=await env.LEAGUE_DB.prepare('SELECT * FROM moderation_log WHERE id < ? ORDER BY id DESC LIMIT 51').bind(cursor).all();
  const rows=result.results || [],entries=rows.slice(0,50).map(r=>({...r,actor:JSON.parse(r.actor),details:JSON.parse(r.details)}));
  for(const entry of entries)if(entry.action==='Published league changes')entry.details=entry.details.filter(detail=>!ownConditionalLogDetail(detail,entry.actor.team));
  // Hide old entries that only recorded the actor rescinding their own offers.
  const visible=entries.filter(entry=>!(entry.action==='Published league changes' && !entry.details.length)).filter(entry=>!(entry.status==='completed' && entry.action==='Published league changes' && entry.actor.team && entry.details.length && entry.details.every(detail=>{
   const match=detail.match(/^Changed offer: (.+?) → .+ \(([^)]+)\)$/);
   return match && teamKey(match[1])===teamKey(entry.actor.team) && match[2].split(', ').every(field=>['rescinded','rescindedAt','rescindReason','conditionalRescindRuleId'].includes(field));
  })));
  const readable=visible.filter(entry=>entry.action!=='League save attempt').map(entry=>({...entry,action:entry.action==='Published league changes'?'Updated league settings':entry.action,details:readableLogDetails(entry.details)}));
  return json({ok:true,entries:readable,next:rows.length>50?entries.at(-1).id:null},{headers:{'cache-control':'private, no-store'}});
 }catch{return json({ok:false,error:'Could not load the moderation log.'},{status:503});}
}
