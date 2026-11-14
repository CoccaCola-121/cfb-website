(function(root){
 function valid(value){return /^\d{4}$/.test(String(value ?? '').trim()) && Number(value)>=1900 && Number(value)<=9999;}
 function seasons(state){return [...new Set((state.fullRoster || []).flatMap(p=>[p.metadataSeason,p.season]).filter(valid).map(Number))];}
 function suggested(state){const years=seasons(state);return years.length===1?years[0]:'';}
 function resolve(state,input){
  const years=seasons(state),provided=input!=null && String(input).trim()!=='';
  if(years.length>1)throw Error('The uploaded roster has conflicting seasons. Check the class before archiving.');
  if(!provided && years.length===1)return years[0];
  if(!provided)throw Error('Enter the recruiting season before archiving.');
  if(!valid(input))throw Error('Enter a whole-number recruiting season from 1900 to 9999.');
  const season=Number(input);
  if(years.length && years[0]!==season)throw Error('Archive season must match the uploaded roster season ('+years[0]+').');
  return season;
 }
 root.NZCFLArchiveSeason={suggested,resolve};
})(globalThis);
