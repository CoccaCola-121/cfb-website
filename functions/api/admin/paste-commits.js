import {getCurrentUser,canModerate,json} from '../../_lib/auth.js';
import {readLeagueState,writeLeagueState} from '../../_lib/league-state.js';
import {classKey} from '../../_lib/removed-players.js';
import {findTeam} from '../../_lib/teams-util.js';
import {queueLeagueBackup} from '../../_lib/backup.js';
import {parseDiscordCommits,applyDiscordCommits} from '../commits/discord.js';
export async function onRequestPost({request,env,waitUntil}){
 const user=await getCurrentUser(request,env);
 if(!canModerate(env,user))return json({ok:false,error:'Moderator access required.'},{status:403});
 const body=await request.json().catch(()=>({}));
 if(typeof body.text!=='string' || !body.text.trim() || body.text.length>100000)return json({ok:false,error:'Paste commitments (up to 100,000 characters).'}, {status:400});
 try{
  const commits=await parseDiscordCommits(env,[{id:'paste_'+crypto.randomUUID(),content:body.text,timestamp:new Date().toISOString()}]);
  if(!commits.length)return json({ok:false,error:'No commitment lines recognized.'},{status:400});
  const teams=new Map();
  for(const c of commits){if(!teams.has(c.team))teams.set(c.team,await findTeam(env,c.team));}
  const valid=commits.filter(c=>teams.get(c.team)).map(c=>({...c,team:teams.get(c.team).region}));
  const unknown=commits.filter(c=>!teams.get(c.team));
  for(let attempt=0;attempt<16;attempt++){
   const state=await readLeagueState(env);
   if(!state || body.classKey!==classKey(state))return json({ok:false,error:'The class changed. Refresh before importing.'},{status:409});
   const applicable=valid.filter(c=>!c.stage || c.stage===state.recruitingStage);
   const result=applyDiscordCommits(state,applicable);
   const unmatched=[...unknown,...valid.filter(c=>c.stage && c.stage!==state.recruitingStage),...result.unmatched];
   try{
    const saved=await writeLeagueState(env,state);
    queueLeagueBackup(env,saved,waitUntil,{source:'pasted-commitments'});
    return json({ok:true,state:saved,updated:result.updated,unchanged:result.unchanged,unmatched:unmatched.map(c=>c.sourceLine),found:commits.length});
   }catch(error){if(error.status!==409 || attempt===15)throw error;await new Promise(resolve=>setTimeout(resolve,40+Math.random()*180));}
  }
 }catch(error){return json({ok:false,error:error.message || 'Import failed. Your pasted text is kept.'},{status:503});}
}
