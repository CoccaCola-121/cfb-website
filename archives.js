(()=>{
 const $=id=>document.getElementById(id),stage={hs:'High School',transfer:'Transfer',cpr:'CPR'};
 let archive=null,limit=40,requestNumber=0;
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;};
 function draw(){
  $('results').replaceChildren();if(!archive)return;
  const q=$('search').value.trim().toLowerCase();
  const rows=Object.values(archive.prospects).filter(p=>[p.name,p.position,p.commitTeam,...(archive.offers[p.id] || []).flatMap(o=>[o.team,o.coach,o.text])].join(' ').toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  $('status').textContent=rows.length+' players · Archived '+new Date(archive.savedAt).toLocaleDateString();
  for(const p of rows.slice(0,limit)){
   const card=node('article'),details=node('details'),summary=node('summary',p.name+' · '+(p.position || '')+' · '+(p.rating || '')+' · '+(p.commitTeam?'Committed: '+p.commitTeam:'Uncommitted'));
   details.append(summary);
   if(new URLSearchParams(location.search).get('player')===p.id)details.open=true;
   const link=node('a','Link to player');link.href='?cycle='+encodeURIComponent($('cycle').value)+'&player='+encodeURIComponent(p.id);const linkRow=node('p');linkRow.append(link);details.append(linkRow);
   for(const o of archive.offers[p.id] || []){
    const offer=node('article');offer.append(node('h3',o.team+(o.rescinded?' · Rescinded':'')),node('p',o.coach || ''),node('pre',o.text || ''));
    if(o.editHistory?.length){const history=node('details');history.append(node('summary','Edit history'));for(const entry of o.editHistory)history.append(node('p',(entry.editedAt?new Date(entry.editedAt).toLocaleString()+': ':'')+(entry.changes || []).join('; ')));offer.append(history);}
    details.append(offer);
   }
   card.append(details);$('results').append(card);
  }
  $('more').hidden=rows.length<=limit;
 }
 async function load(){
  const id=$('cycle').value,n=++requestNumber;archive=null;$('results').replaceChildren();$('download').disabled=true;$('more').hidden=true;
  if(!id)return;
  $('status').textContent='Loading archive…';
  try{const r=await fetch('/api/archives?id='+encodeURIComponent(id)),data=await r.json();if(!r.ok || !data.ok)throw Error(data.error);if(n!==requestNumber)return;archive=data;limit=40;
   const player=new URLSearchParams(location.search).get('player');if(player && archive.prospects[player])$('search').value=archive.prospects[player].name;
   history.replaceState(null,'','?cycle='+encodeURIComponent(id)+(player?'&player='+encodeURIComponent(player):''));$('download').disabled=false;draw();
  }catch(e){if(n===requestNumber)$('status').textContent=e.message || 'Archive unavailable.';}
 }
 $('cycle').onchange=()=>{$('search').value='';history.replaceState(null,'','?cycle='+encodeURIComponent($('cycle').value));load();};
 $('search').oninput=()=>{limit=40;draw();};$('more').onclick=()=>{limit+=40;draw();};
 $('download').onclick=()=>{if(!archive)return;const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'})),a=node('a');a.href=url;a.download=$('cycle').value+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 fetch('/api/archives').then(r=>r.json()).then(data=>{if(!data.ok)throw Error(data.error);for(const row of data.archives){const option=node('option',row.season+' · '+stage[row.stage]);option.value=row.id;$('cycle').append(option);}const selected=new URLSearchParams(location.search).get('cycle');if(selected){$('cycle').value=selected;load();}else $('status').textContent=data.archives.length?'Choose a cycle to browse.':'No cycles archived yet.';}).catch(e=>$('status').textContent=e.message);
})();
