import {getCurrentUser,json} from '../_lib/auth.js';
import {teamKey} from '../_lib/teams-util.js';
import {readLeagueState} from '../_lib/league-state.js';

// Private to the authenticated coach's linked team; never part of public league state.
// Lists are scoped to the current recruiting stage and class identity so recycled
// prospect IDs in a new class do not inherit another class's flags.
const cacheHeaders = {'cache-control':'private, no-store'};
function namespace(team, state) {
  const first = state.fullRoster?.[0] || {};
  const last = state.fullRoster?.at(-1) || {};
  const classId = [state.recruitingStage || 'hs', state.fullRoster?.length || 0,
    first.metadataSeason || first.season || '', first.name || '', last.name || ''].join('|');
  return 'team-watchlist:v1:' + encodeURIComponent(teamKey(team)) + ':' + encodeURIComponent(classId);
}
async function context(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user?.team || !teamKey(user.team)) return {error:json({ok:false,error:'Sign in with a linked team.'},{status:401,headers:cacheHeaders})};
  if (!env.AUTH_KV) return {error:json({ok:false,error:'Watchlist storage is unavailable.'},{status:503,headers:cacheHeaders})};
  const state = await readLeagueState(env);
  if (!state) return {error:json({ok:false,error:'The recruiting board is unavailable.'},{status:503,headers:cacheHeaders})};
  return {state, key:namespace(user.team,state)};
}
function present(ids, state) {
  return [...new Set(Array.isArray(ids) ? ids : [])].filter(id =>
    typeof id === 'string' && Object.prototype.hasOwnProperty.call(state.prospects || {},id));
}
async function stored(ctx,env){
  if(!env.LEAGUE_DB)throw Error('D1 is required for watchlist saves.');
  await env.LEAGUE_DB.prepare('CREATE TABLE IF NOT EXISTS private_watchlists (key TEXT PRIMARY KEY, ids TEXT NOT NULL, version INTEGER NOT NULL)').run();
  let row=await env.LEAGUE_DB.prepare('SELECT ids,version FROM private_watchlists WHERE key=?').bind(ctx.key).first();
  if(!row){
    const ids=present(await env.AUTH_KV.get(ctx.key,'json'),ctx.state);
    await env.LEAGUE_DB.prepare('INSERT OR IGNORE INTO private_watchlists(key,ids,version) VALUES(?,?,0)').bind(ctx.key,JSON.stringify(ids)).run();
    row=await env.LEAGUE_DB.prepare('SELECT ids,version FROM private_watchlists WHERE key=?').bind(ctx.key).first();
  }
  return row;
}
export async function onRequestGet({request,env}){
 try{
  const ctx=await context(request,env);if(ctx.error)return ctx.error;
  const row=await stored(ctx,env);
  return json({ok:true,ids:present(JSON.parse(row.ids),ctx.state),version:row.version},{headers:cacheHeaders});
 }catch{return json({ok:false,error:'Could not load your team watchlist.'},{status:503,headers:cacheHeaders});}
}
export async function onRequestPost({request,env}){
 try{
  const ctx=await context(request,env);if(ctx.error)return ctx.error;
  const body=await request.json().catch(()=>({}));
  const valid=id=>typeof id==='string' && Object.prototype.hasOwnProperty.call(ctx.state.prospects || {},id);
  if(body.action!=='clear' && (body.action==='add-many' ? !Array.isArray(body.ids) || body.ids.length>5000 || !body.ids.every(valid) : !valid(body.prospectId) || typeof body.flagged!=='boolean'))return json({ok:false,error:'Select valid players and an action.'},{status:400,headers:cacheHeaders});
  let row=await stored(ctx,env);
  for(let attempt=0;attempt<8;attempt++){
    const ids=present(JSON.parse(row.ids),ctx.state);
    const next=body.action==='clear'?[]:body.action==='add-many'?[...new Set([...ids,...body.ids])]:body.flagged?[...new Set([...ids,body.prospectId])]:ids.filter(id=>id!==body.prospectId);
    const result=await env.LEAGUE_DB.prepare('UPDATE private_watchlists SET ids=?,version=version+1 WHERE key=? AND version=?').bind(JSON.stringify(next),ctx.key,row.version).run();
    if(result.meta.changes)return json({ok:true,ids:next,version:row.version+1},{headers:cacheHeaders});
    row=await env.LEAGUE_DB.prepare('SELECT ids,version FROM private_watchlists WHERE key=?').bind(ctx.key).first();
  }
  return json({ok:false,error:'Watchlist changed elsewhere. Please retry.'},{status:409,headers:cacheHeaders});
 }catch{return json({ok:false,error:'Could not save your team watchlist. Try again.'},{status:503,headers:cacheHeaders});}
}
