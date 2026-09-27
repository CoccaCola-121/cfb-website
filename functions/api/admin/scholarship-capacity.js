import '../../../scholarship-history.js';
import '../../../auto-commits.js';
import {canModerate,getCurrentUser,json} from '../../_lib/auth.js';
export async function onRequestGet({request,env}){
  const user=await getCurrentUser(request,env);
  if(!canModerate(env,user))return json({ok:false,error:'Moderator access required.'},{status:403});
  const params=new URL(request.url).searchParams;
  const id=params.get('sheetId') || '',gid=params.get('gid') || '1039825625';
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(id) || !/^\d+$/.test(gid))return json({ok:false,error:'Enter a valid Google Sheets link.'},{status:400});
  try {
    const response=await fetch('https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=out:csv&headers=1&gid='+gid,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Could not read scholarship counts. The sheet must allow link viewing.');
    const teams=globalThis.NZCFLAutoCommits.parseCapacitySheet(await response.text());
    return json({ok:true,teams,source:'https://docs.google.com/spreadsheets/d/'+id+'/edit?gid='+gid});
  }catch(e){return json({ok:false,error:e.message},{status:400});}
}
