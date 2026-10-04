import {getCurrentUser,json} from '../_lib/auth.js';
import {teamKey} from '../_lib/teams-util.js';
import {readLeagueState,writeLeagueState} from '../_lib/league-state.js';
import {classKey} from '../_lib/removed-players.js';
import {applyConditionalRescinds} from '../_lib/conditional-rescinds.js';
import {queueLeagueBackup} from '../_lib/backup.js';
const fail=(error,status=400)=>json({ok:false,error},{status});
function cleanRule(input,user,state,old){
 const positions=[...new Set(input.positions || [])];
 if(!Array.isArray(input.positions) || positions.some(p=>!['QB','RB','WR','TE','OL','DL','LB','CB','S','K','P'].includes(p)))throw Error('Choose valid positions.');
 if(!Number.isInteger(input.count) || input.count<1 || input.count>200)throw Error('Choose between 1 and 200 commitments.');
 if(!['','scholarship','walkon'].includes(input.scholarship || ''))throw Error('Invalid scholarship filter.');
 if(!['','below','atMost','atLeast','belowCommit','atMostCommit'].includes(input.overallMode || ''))throw Error('Invalid overall filter.');
 for(const field of ['overallValue','rankValue','stars'])if(input[field]!=='' && input[field]!=null && (!Number.isFinite(Number(input[field])) || Number(input[field])<0))throw Error('Invalid rule filter.');
 const ids=field=>{
  const values=input[field] || [];if(!Array.isArray(values) || values.length>1500)throw Error('Invalid player list.');
  if(values.some(id=>!(old?.[field] || []).includes(id) && (!state.prospects?.[id] || !(state.offersByProspect?.[id] || []).some(o=>!o.rescinded && teamKey(o.team)===teamKey(user.team)))))throw Error('Choose players with active offers from your team.');
  return [...new Set(values)];
 };
 const triggerIds=ids('triggerIds'),targetIds=ids('targetIds');
 if(!positions.length && !input.overallValue && !['belowCommit','atMostCommit'].includes(input.overallMode) && !input.scholarship && (input.stars==='' || input.stars==null) && !(triggerIds.length && targetIds.length))throw Error('Choose filters or both custom player lists.');
 return {id:input.id,team:user.team,enabled:true,count:input.count,positions,position:'',stars:input.stars ?? '',rankMode:input.rankMode || '',rankValue:input.rankValue || '',overallMode:input.overallMode || 'atLeast',overallValue:input.overallValue || '',scholarship:input.scholarship || '',triggerIds,targetIds,name:String(input.name || 'Conditional rule').slice(0,1000),createdAt:Date.now()};
}
export async function onRequestPost({request,env,waitUntil}){
 const user=await getCurrentUser(request,env);
 if(!user?.team)return fail('Sign in with a linked team.',401);
 if(!env.LEAGUE_DB)return fail('The league database is unavailable.',503);
 const body=await request.json().catch(()=>({})),id=body.action!=='delete'?body.rule?.id:body.id;
 if(!['add','edit','delete'].includes(body.action) || !/^[a-zA-Z0-9_-]{8,100}$/.test(id || ''))return fail('Invalid rule request.');
 for(let attempt=0;attempt<16;attempt++){
  try{
   const state=await readLeagueState(env);
   if(!state || body.classKey!==classKey(state))return fail('The recruiting class changed. Refresh before saving a rule.',409);
   const rules=state.conditionalRescinds || [],old=rules.find(r=>r.id===id);
   if(old && teamKey(old.team)!==teamKey(user.team))return fail('You may only change your own rules.',403);
   if(body.action==='delete'){
    if(!old)return json({ok:true,state,rescinded:0});
    state.conditionalRescinds=rules.filter(r=>r.id!==id);
   }else if(body.action==='edit'){
    if(!old)return fail('This rule was deleted. Refresh your rules.',409);
    if((old.updatedAt || old.createdAt)!==body.expectedRuleVersion)return fail('This rule changed in another tab. Reopen it before editing.',400);
    state.conditionalRescinds=rules.map(r=>r.id===id?{...cleanRule(body.rule,user,state,old),createdAt:old.createdAt,updatedAt:Date.now()}:r);
   }else{
    if(old)return json({ok:true,state,rescinded:0});
    if(rules.filter(r=>teamKey(r.team)===teamKey(user.team)).length>=200)return fail('Remove unused rules before adding more.');
    state.conditionalRescinds=[...rules,cleanRule(body.rule,user,state)];
   }
   const results=body.action!=='delete'?applyConditionalRescinds(state,{onlyRuleId:id}):[];
   const saved=await writeLeagueState(env,state);
   queueLeagueBackup(env,saved,waitUntil,{source:'conditional-rule-'+body.action});
   return json({ok:true,state:saved,rescinded:results.reduce((sum,r)=>sum+r.rescinded,0)});
  }catch(error){
   if(error.status===409 && attempt<15){await new Promise(resolve=>setTimeout(resolve,40+Math.random()*180));continue;}
   return fail(error.status===409?'The board is busy. Your rule draft is kept; retry saving.':error.message || 'Rule could not be saved.',error.status || 400);
  }
 }
}
