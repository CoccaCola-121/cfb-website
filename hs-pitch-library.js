(function(root){
 const fields=[
  {key:'location',label:'Location'}, {key:'winning',label:'Winning'},
  {key:'playingTime',label:'Playing Time'}, {key:'coach',label:'Coach'},
  {key:'proPotential',label:'Pro Potential'}, {key:'prestige',label:'Prestige'},
  {key:'education',label:'Education'}, {key:'campus',label:'Campus'},
  {key:'tradition',label:'Tradition'}
 ];
 const normalize=value=>String(value || '').replace(/[^a-z]/gi,'').toLowerCase();
 const canWalkon=p=>Number(p?.rank)>500;
 function findPlayer(prospects,name,position=''){
  const key=value=>String(value || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
  if(!key(name))throw Error('Enter the player’s full name.');
  const matches=Object.values(prospects || {}).filter(p=>key(p.name)===key(name) && (!position.trim() || key(p.position)===key(position)));
  if(!matches.length)throw Error('No player found. Check the full name'+(position?' and position':'')+' and try again.');
  if(matches.length>1)throw Error('More than one player has that name'+(position?' and position. Open the correct player’s page to build their offer.':'. Try again or use position when available.'));
  if(matches[0].commitTeam)throw Error('This player has already committed.');
  return matches[0];
 }
 function clean(input){
  const paragraphs={},choices={},seen=new Set();
  for(const field of fields){
   const text=input?.paragraphs?.[field.key] ?? '';
   if(typeof text!=='string' || text.length>12000)throw Error('Each value paragraph must be under 12,000 characters.');
   paragraphs[field.key]=text.trim();
   const rows=input?.choices?.[field.key] || [];
   if(!Array.isArray(rows))throw Error('Invalid saved dropdowns.');
   choices[field.key]=rows.map(row=>{
    if(!/^c[0-9]+$/.test(row?.id || '') || seen.has(row.id))throw Error('Invalid dropdown identifier.');
    seen.add(row.id);
    if(!Array.isArray(row.options) || row.options.some(v=>typeof v!=='string' || v.length>12000))throw Error('Use one wording option per line.');
    const options=[...new Set(row.options.map(v=>v.trim()).filter(Boolean))];
    if(!options.length)throw Error('Add at least one option to each dropdown.');
    return {id:row.id,options};
   }).filter(row=>text.includes(token(row.id)));
  }
  if(JSON.stringify(choices).length>200000)throw Error('Saved dropdown wording is too large. Shorten some options before saving.');
  return {paragraphs,choices};
 }
 function token(id){return '{{Dropdown '+id.slice(1)+'}}';}
 function addChoice(input,key,start,end,id){
  const library=clean(input),text=input?.paragraphs?.[key];
  if(typeof text!=='string' || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end>text.length || start>=end || !text.slice(start,end).trim())throw Error('Highlight the words you want to turn into a dropdown first.');
  if([...text.matchAll(/\{\{Dropdown [0-9]+\}\}/g)].some(m=>start<m.index+m[0].length && end>m.index))throw Error('Select ordinary text, not an existing dropdown marker.');
  // Keep the surrounding spaces outside the replacement.
  while(/\s/.test(text[start]))start++;
  while(/\s/.test(text[end-1]))end--;
  library.paragraphs[key]=text.slice(0,start)+token(id)+text.slice(end);
  library.choices[key].push({id,options:[text.slice(start,end)]});
  return clean(library);
 }
 function resolveParagraph(library,key,selected={}){
  return library.paragraphs[key].replace(/\{\{Dropdown ([0-9]+)\}\}/g,(_,number)=>{
   const id='c'+number;
   const row=library.choices[key].find(c=>c.id===id);
   if(!row)throw Error('A dropdown is missing its options. Fix it in your pitch library.');
   if(!row.options.includes(selected[id]))throw Error('Choose wording for every dropdown before building the offer.');
   return selected[id];
  });
 }
 function stripHeading(text,field){
  const lines=String(text || '').trim().split(/\r?\n/);
  if(normalize(lines[0])===normalize(field.label))lines.shift();
  return lines.join('\n').trim();
 }
 function importRows(rows,current){
  const library=clean(current),seen=new Set();
  for(const row of rows){
   const field=fields.find(f=>normalize(row[0])===normalize(f.label));
   if(!field)continue;
   if(seen.has(field.key))throw Error('The CSV has more than one '+field.label+' row. Keep one paragraph per value.');
   const body=stripHeading(row[1],field);
   if(!body)continue;
   library.paragraphs[field.key]=body;library.choices[field.key]=[];seen.add(field.key);
  }
  if(!seen.size)throw Error('No value paragraphs found. Use value names in column A and paragraphs in column B.');
  return {library:clean(library),count:seen.size};
 }
 function topValues(prospect){
  // Use the same order as the player value chips to break equal-weight ties.
  return fields.filter(f=>{
   const v=prospect?.values?.[f.key];
   return v!==null && v!==undefined && String(v).trim()!=='' && Number.isFinite(Number(v));
  }).sort((a,b)=>Number(prospect.values[b.key])-Number(prospect.values[a.key])).slice(0,3);
 }
 function visitLines(visits={}){
  const lines=[];
  if(visits.coach)lines.push('Coach Visit');
  if(visits.campus){
   const week=String(visits.week || '').trim(),opponent=String(visits.opponent || '').trim();
   if(!/^[1-9][0-9]?$/.test(week))throw Error('Enter a campus visit week between 1 and 99.');
   if(opponent.length>120 || /[\r\n]/.test(opponent))throw Error('Enter the opponent on one line.');
   lines.push('Campus Visit Week '+Number(week)+(opponent?' vs. '+opponent:''));
  }
  return lines;
 }
 function build(team,prospect,input,type,selected={},visits={}){
  if(!team || !prospect?.name || !prospect.rank)throw Error('Choose a High School player first.');
  if(type!=='scholarship' && type!=='walkon')throw Error('Choose Scholarship or Walk-On.');
  if(type==='walkon' && !canWalkon(prospect))throw Error('High School recruits ranked 1–500 require a scholarship offer.');
  const values=topValues(prospect),library=clean(input);
  if(values.length!==3)throw Error('This player does not have three values yet. Paste an offer or wait for their values.');
  const missing=values.filter(f=>!stripHeading(library.paragraphs[f.key],f));
  if(missing.length)throw Error('Save a paragraph for '+missing.map(f=>f.label).join(', ')+' in My Offers first.');
  const home=prospect.homestate || prospect.hometown || '';
  const header=team+' offers #'+prospect.rank+' '+prospect.name+(prospect.rating?' '+prospect.rating:'')+(prospect.position?' '+prospect.position:'')+(home?' from '+home:'');
  const text=[header,type==='scholarship'?'Scholarship':'Walk-On',...visitLines(visits),...values.map(f=>f.label+':\n'+stripHeading(resolveParagraph(library,f.key,selected),f))].join('\n\n');
  return {text,values};
 }
 root.NZCFLHSPitchLibrary=Object.freeze({fields,clean,importRows,topValues,build,findPlayer,canWalkon,token,addChoice,visitLines});
})(globalThis);
