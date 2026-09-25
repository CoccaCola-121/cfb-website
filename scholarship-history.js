(function(root){
  const yes = value => /^(true|yes)$/i.test(String(value || '').trim());
  function parseCsv(text){
    const rows=[]; let row=[], field='', quoted=false;
    for(let i=0;i<text.length;i++) { const c=text[i]; if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}else if(c==='"') quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}else field+=c; }
    if(field||row.length){row.push(field);rows.push(row);} return rows;
  }
  function parseSheet(text,tab){
    const rows=parseCsv(text); const header=rows.shift() || [];
    const col=name=>header.findIndex(x=>String(x).trim().toLowerCase()===name.toLowerCase());
    const id=col('Player ID'), offered=col('Scholly offered?'), current=col('On Scholly?'), upgrade=col('WO Upgrade');
    if(id<0 || offered<0 || current<0) throw Error(tab+': scholarship columns are missing. Check sheet access and headers.');
    const players=rows.filter(r=>/^\d+$/.test(r[id] || '')).map(r=>({id:String(r[id]),name:r[0],position:r[col('Position')],everScholarship:yes(r[offered])||yes(r[current])||(upgrade>=0&&yes(r[upgrade])),tab}));
    return {season:tab==='HS'?Number(header[0]):null,players};
  }
  function apply(roster,prospects,history,snapshot){
    const ledger={...(history || {})};
    for(const p of snapshot.players){ if(p.everScholarship) ledger[p.id]={name:p.name,season:snapshot.season,source:snapshot.source}; }
    const indexed=new Set(snapshot.players.map(p=>p.id)); let matched=0; const unmatched=[];
    for(const p of roster){
      const id=String(p.exportPlayerId ?? '');
      if(!id || !indexed.has(id)) unmatched.push(p.name); else matched++;
      p.everScholarship=!!p.everScholarship || !!ledger[id];
      const card=prospects['r'+p.rank]; if(card && card.name===p.name) card.everScholarship=p.everScholarship;
    }
    return {ledger,matched,unmatched};
  }
  root.NZCFLScholarshipHistory={parseCsv,parseSheet,apply};
})(globalThis);
