import '../../../scholarship-history.js';
import {canModerate,getCurrentUser,json} from '../../_lib/auth.js';
export async function onRequestGet({request,env}){
  const user=await getCurrentUser(request,env);
  if(!canModerate(env,user)) return json({ok:false,error:'Moderator access required.'},{status:403});
  const id=new URL(request.url).searchParams.get('sheetId') || '';
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(id)) return json({ok:false,error:'Enter a valid Google Sheets link.'},{status:400});
  try {
    const sheets=await Promise.all(['SR','JR','SO','FR','HS'].map(async tab=>{
      const response=await fetch('https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=out:csv&headers=1&sheet='+tab,{signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw Error('Could not read '+tab+'. The sheet must allow link viewing.');
      return globalThis.NZCFLScholarshipHistory.parseSheet(await response.text(),tab);
    }));
    const season=sheets[4].season;
    if(!Number.isInteger(season)||season<1) throw Error('The HS tab must identify its class year in A1.');
    return json({ok:true,season,source:'https://docs.google.com/spreadsheets/d/'+id,players:sheets.flatMap(s=>s.players)});
  } catch(e){return json({ok:false,error:e.message},{status:400});}
}
