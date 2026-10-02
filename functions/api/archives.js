import {json} from '../_lib/auth.js';
export async function onRequestGet({request,env}){
 try{
  const id=new URL(request.url).searchParams.get('id');
  if(id){
   if(!/^\d{4}-(hs|cpr|transfer)$/.test(id))return json({ok:false,error:'Invalid archive.'},{status:400});
   const rows=await env.LEAGUE_DB.prepare('SELECT a.season,a.stage,a.saved_at,c.content FROM recruiting_archives a JOIN recruiting_archive_chunks c ON c.archive_id=a.id WHERE a.id=? ORDER BY c.part').bind(id).all();
   if(!rows.results?.length)return json({ok:false,error:'Archive not found.'},{status:404});
   const first=rows.results[0];return json({ok:true,season:first.season,stage:first.stage,savedAt:first.saved_at,...JSON.parse(rows.results.map(r=>r.content).join(''))},{headers:{'cache-control':'public, max-age=60'}});
  }
  const rows=await env.LEAGUE_DB.prepare('SELECT id,season,stage,saved_at,bytes FROM recruiting_archives ORDER BY season DESC,stage').all();
  return json({ok:true,retention:20,archives:rows.results},{headers:{'cache-control':'public, max-age=60'}});
 }catch(error){if(String(error.message).includes('no such table'))return json({ok:true,retention:20,archives:[]});return json({ok:false,error:'Archives are temporarily unavailable.'},{status:503});}
}
