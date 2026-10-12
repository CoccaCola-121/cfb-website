import '../../hs-pitch-library.js';
import {getCurrentUser,json} from '../_lib/auth.js';
import {teamKey} from '../_lib/teams-util.js';
const headers={'cache-control':'private, no-store'};
async function context(request,env){
 const user=await getCurrentUser(request,env);
 if(!user?.team)return null;
 if(!env.LEAGUE_DB)throw Error('Pitch storage is unavailable. Try again later.');
 await env.LEAGUE_DB.prepare('CREATE TABLE IF NOT EXISTS hs_pitch_libraries (key TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL)').run();
 // Deliberately independent of the season/active recruiting cycle.
 // A different coach or team gets a separate private library.
 return {key:user.discordId+':'+teamKey(user.team)};
}
export async function onRequestGet({request,env}){
 try{
  const ctx=await context(request,env);if(!ctx)return json({ok:false,error:'Sign in with a linked team.'},{status:401,headers});
  const row=await env.LEAGUE_DB.prepare('SELECT content,version FROM hs_pitch_libraries WHERE key=?').bind(ctx.key).first();
  return json({ok:true,library:row?JSON.parse(row.content):globalThis.NZCFLHSPitchLibrary.clean({}),version:row?.version || 0},{headers});
 }catch{return json({ok:false,error:'Could not load your pitches. Try again.'},{status:503,headers});}
}
export async function onRequestPost({request,env}){
 try{
  const ctx=await context(request,env);if(!ctx)return json({ok:false,error:'Sign in with a linked team.'},{status:401,headers});
  const body=await request.json(),library=globalThis.NZCFLHSPitchLibrary.clean(body.library);
  if(!Number.isSafeInteger(body.version) || body.version<0)return json({ok:false,error:'Reload your saved pitches before saving.'},{status:400,headers});
  await env.LEAGUE_DB.prepare('INSERT OR IGNORE INTO hs_pitch_libraries(key,content,version) VALUES(?,?,0)').bind(ctx.key,JSON.stringify(globalThis.NZCFLHSPitchLibrary.clean({}))).run();
  const result=await env.LEAGUE_DB.prepare('UPDATE hs_pitch_libraries SET content=?,version=version+1 WHERE key=? AND version=?').bind(JSON.stringify(library),ctx.key,body.version).run();
  if(!result.meta.changes)return json({ok:false,error:'Your pitches changed in another tab. Copy any unsaved edits, then reload your saved pitches.'},{status:409,headers});
  return json({ok:true,library,version:body.version+1},{headers});
 }catch(error){return json({ok:false,error:error.message || 'Could not save your pitches.'},{status:400,headers});}
}
