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
export async function onRequestGet({request, env}) {
  try {
    const ctx = await context(request,env);
    if (ctx.error) return ctx.error;
    const ids = present(await env.AUTH_KV.get(ctx.key,'json'),ctx.state);
    return json({ok:true,ids},{headers:cacheHeaders});
  } catch(error) { return json({ok:false,error:'Could not load your team watchlist.'},{status:503,headers:cacheHeaders}); }
}
export async function onRequestPost({request,env}) {
  try {
    const ctx = await context(request,env);
    if (ctx.error) return ctx.error;
    const body = await request.json().catch(()=>({}));
    if (body.action === 'clear') {
      await env.AUTH_KV.put(ctx.key,JSON.stringify([]));
      return json({ok:true,ids:[]},{headers:cacheHeaders});
    }
    if (body.action === 'add-many') {
      if (!Array.isArray(body.ids) || body.ids.length > 5000 || body.ids.some(id => typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(ctx.state.prospects || {},id)))
        return json({ok:false,error:'Select valid players from the current board.'},{status:400,headers:cacheHeaders});
      const existing = present(await env.AUTH_KV.get(ctx.key,'json'),ctx.state);
      const next = [...new Set([...existing,...body.ids])];
      await env.AUTH_KV.put(ctx.key,JSON.stringify(next));
      return json({ok:true,ids:next},{headers:cacheHeaders});
    }
    if(typeof body.prospectId !== 'string' || !Object.prototype.hasOwnProperty.call(ctx.state.prospects || {},body.prospectId) || typeof body.flagged !== 'boolean')
      return json({ok:false,error:'Select a valid player and flag state.'},{status:400,headers:cacheHeaders});
    const ids = present(await env.AUTH_KV.get(ctx.key,'json'),ctx.state);
    const next = body.flagged ? [...new Set([...ids,body.prospectId])] : ids.filter(id=>id!==body.prospectId);
    await env.AUTH_KV.put(ctx.key,JSON.stringify(next));
    return json({ok:true,ids:next},{headers:cacheHeaders});
  } catch(error) { return json({ok:false,error:'Could not save your team watchlist. Try again.'},{status:503,headers:cacheHeaders}); }
}
