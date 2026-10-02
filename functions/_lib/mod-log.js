import {teamKey,readTeamClaim} from './teams-util.js';
import {readLeagueState} from './league-state.js';
export async function ensureModLog(env){
 if(!env.LEAGUE_DB)throw Error('Moderation logging requires the league database.');
 await env.LEAGUE_DB.prepare('CREATE TABLE IF NOT EXISTS moderation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL)').run();
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const show=v=>v==null?'none':typeof v==='object'?JSON.stringify(v):String(v);
function changes(before,after,path='',out=[]){
 if(same(before,after))return out;
 if(before && after && typeof before==='object' && typeof after==='object' && !Array.isArray(before) && !Array.isArray(after)){
  for(const key of new Set([...Object.keys(before),...Object.keys(after)]))changes(before[key],after[key],path?path+'.'+key:key,out);
 }else out.push(path+': '+show(before)+' → '+show(after));
 return out;
}
export async function describeModeration(env,path,body,user){
 if(path==='/api/league/state'){
  const before=await readLeagueState(env) || {},after=body.state || body,out=[];
  if(Object.hasOwn(body,'expectedUpdatedAt') && body.expectedUpdatedAt!==(before.updatedAt || null))return null;
  for(const field of Object.keys(after)){
   if(['updatedAt','removedPlayers'].includes(field) || same(before[field],after[field]))continue;
   if(field==='conditionalRescinds' && user?.team && same((before[field] || []).filter(r=>teamKey(r.team)!==teamKey(user.team)),(after[field] || []).filter(r=>teamKey(r.team)!==teamKey(user.team))))continue;
   if(field==='prospects'){
    for(const id of new Set([...Object.keys(before.prospects || {}),...Object.keys(after.prospects || {})])){
     const a=before.prospects?.[id],b=after.prospects?.[id],name=b?.name || a?.name || id;
     if(!b)out.push('Removed player: '+name);else if(!a)out.push('Added player: '+name);
     else changes(a,b,name,out);
    }
   }else if(field==='offersByProspect'){
    for(const id of new Set([...Object.keys(before[field] || {}),...Object.keys(after[field] || {})])){
     const old=before[field]?.[id] || [],next=after[field]?.[id] || [],name=after.prospects?.[id]?.name || before.prospects?.[id]?.name || id;
     for(const o of old){const n=next.find(x=>x.id===o.id);
      if(n && user?.team && teamKey(o.team)===teamKey(user.team) && teamKey(n.team)===teamKey(user.team) && Object.keys({...o,...n}).filter(k=>!same(o[k],n[k])).every(k=>['rescinded','rescindedAt','rescindReason','conditionalRescindRuleId','visits','text','editHistory','updatedAt'].includes(k)))continue;
if(!n)out.push('Deleted offer: '+o.team+' → '+name);else if(!same(o,n))out.push('Changed offer: '+o.team+' → '+name+' ('+Object.keys({...o,...n}).filter(k=>!same(o[k],n[k])).join(', ')+')');}
     for(const n of next)if(!old.some(o=>o.id===n.id) && (!user?.team || teamKey(n.team)!==teamKey(user.team)))out.push('Added offer: '+n.team+' → '+name);
    }
   }else if(['fullRoster','scholarshipHistory','threads','unmatched'].includes(field))out.push('Updated '+field+' ('+(Array.isArray(after[field])?after[field].length+' entries':'data replaced')+')');
   else changes(before[field],after[field],field,out);
  }
  const readable=readableLogDetails(out);
  return readable.length ? {action:'Updated league settings',details:readable} : null;
 }
 if(path==='/api/players/remove'){
  const state=await readLeagueState(env),p=state?.prospects?.[body.prospectId];
  return {action:'Removed player thread',details:[p?`${p.name} · ${p.position} (${body.prospectId})`:String(body.prospectId)]};
 }
 if(path==='/api/admin/team-branding'){
  const before=await env.AUTH_KV.get('teams:extra','json') || [],after=body.teams || [],out=[];
  for(const t of before)if(!after.some(n=>n.region===t.region))out.push('Removed team: '+t.region);
  for(const t of after){const old=before.find(n=>n.region===t.region);if(!old)out.push('Added team: '+t.region);else changes(old,t,t.region,out);}
  return {action:'Published team changes',details:out};
 }
 const names={'archive-cycle':'Archived recruiting cycle','paste-commits':'Imported pasted commitments','unlink':'Removed coach from team','switch-team':'Changed coach team','access-level':'Changed account access','backup':'Requested backup','discord':'Synced Discord commitments'};
 const action=names[path.split('/').pop()] || 'Moderation action';
 const details=[];
 if(path.endsWith('/paste-commits'))details.push(String(body.text || '').slice(0,100000));
 if(!body.discordId && body.team && path.endsWith('/unlink'))body.discordId=(await readTeamClaim(env,body.team))?.discordId;
 if(body.discordId){const u=await env.AUTH_KV.get('discord:user:'+body.discordId,'json');details.push('Coach: '+(u?.displayName || u?.username || body.discordId)+' ('+body.discordId+')');if(u?.team)details.push('Previous team: '+u.team);if(path.endsWith('access-level'))details.push('Previous access: '+(u?.accessLevel || 'coach'));}
 for(const key of ['team','accessLevel'])if(body[key])details.push(key+': '+String(body[key]));
 return {action,details};
}

export function ownConditionalLogDetail(detail,team){
 if(!team || !detail.startsWith('conditionalRescinds: '))return false;
 const text=detail.slice('conditionalRescinds: '.length);
 for(let i=text.indexOf(' → ');i>=0;i=text.indexOf(' → ',i+3)){
  try{
   const parse=s=>s==='none'?[]:JSON.parse(s);
   const before=parse(text.slice(0,i)),after=parse(text.slice(i+3));
   if(!Array.isArray(before) || !Array.isArray(after))continue;
   return same(before.filter(r=>teamKey(r.team)!==teamKey(team)),after.filter(r=>teamKey(r.team)!==teamKey(team)));
  }catch{}
 }
 return false;
}

export function readableLogDetails(details){
 const out=[];
 for(const detail of details){
  if(/^(?:commitUpdatedAt|discordCommitUpdatedAt|updatedAt|manualCommitOverrides[.:])/.test(detail))continue;
  const commit=detail.match(/^(.+)\.commitTeam: (.*?) → (.*)$/);
  if(commit){const [,name,old,team]=commit;out.push(team && team!=='none' ? name+' committed to '+team+(old && old!=='none'?' (previously '+old+')':'') : 'Cleared '+name+'’s commitment'+(old && old!=='none'?' to '+old:''));continue;}
  if(/\.(?:commitType|commitSource|updatedAt|lastTriggeredAt|lastMatchedCommitCount|lastRescindedCount)(?:[.:])/.test(detail))continue;
  let text=detail.replace(/\bcommitSheetUrl\b/g,'Commit sheet link').replace(/\boffersLocked: false → true/g,'Closed offers').replace(/\boffersLocked: true → false/g,'Opened offers').replace(/\bfullRoster\b/g,'player roster').replace(/\bscholarshipHistory\b/g,'scholarship history').replace(/\bconditionalRescinds\b/g,'conditional rescind rules').replace(/\bscholarshipCapacity\b/g,'scholarship limits').replace(/\bbucksRemaining\b/g,'Bucks spots remaining').replace(/\baccessLevel\b/g,'Access').replace(/\brecruitingStage\b/g,'Recruiting stage');
  if(text.includes('{') || text.includes('[')){const label=text.split(':')[0].replace(/([a-z])([A-Z])/g,'$1 $2');text='Updated '+label+'.';}
  out.push(text);
 }
 return [...new Set(out)];
}
