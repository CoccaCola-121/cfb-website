(function(root){
  const clean=line=>String(line).replace(/[*_`]/g,'').trim();
  function header(text){
    const lines=String(text || '').split(/\r?\n/);
    let end=0, offerLine=-1, typeLine=-1, type='';
    for(let i=0;i<lines.length;i++){
      const line=clean(lines[i]);
      if(!line){end=i+1;continue;}
      if(offerLine<0 && /^.{1,120}\boffers?\s+\S.+$/i.test(line)){offerLine=i;end=i+1;continue;}
      if(typeLine<0 && /^(?:scholarship(?: offer)?|walk\s*-?\s*on(?: offer)?|wo)\s*[.!:]?$/i.test(line)){
        typeLine=i;type=/^scholarship/i.test(line)?'scholarship':'walkon';end=i+1;continue;
      }
      break;
    }
    return {lines,end,offerLine,typeLine,type};
  }
  function amend(text,action,team,p){
    text=String(text || '');const h=header(text);
    if(action==='header'){
      // Only prepend missing header lines; preserve the original text byte for byte.
      if(h.offerLine>=0 && h.typeLine>=0) throw Error('This offer already has a complete header.');
      if(h.offerLine<0) return team+' offers '+p.position+' '+p.name+'\n'+(h.typeLine<0?'Scholarship\n':'')+'\n'+text;
      const match=text.match(/^[\s\S]*?\boffers?[^\r\n]*(?:\r?\n|$)/i);
      if(!match) throw Error('Could not identify the offer header.');
      return text.slice(0,match[0].length)+'\nScholarship\n'+text.slice(match[0].length);
    }
    if(action==='upgrade'){
      if(!h.type) return amend(text,'header',team,p);
      if(h.type!=='walkon') throw Error('Only walk-on offers can be upgraded.');
      let index=0;
      const lines=text.match(/[^\n]*(?:\n|$)/g) || [];
      return lines.map(line=>index++===h.typeLine ? line.replace(/walk\s*-?\s*on|\bwo\b/i,'Scholarship') : line).join('');
    }
    throw Error('Unknown offer change.');
  }
  function allowed(before,after,team,p){
    return ['header','upgrade'].some(action=>{try{return amend(before,action,team,p)===after;}catch{return false;}});
  }
  // Commissioner-approved exception for Montana's accidentally empty HS offer.
  // Existing pitches and all other offers retain their normal editing rules.
  function canAddMissingPitch(offer,p,stage){
    if(stage!=='hs' || offer?.id!=='o_4hmajnpk' || offer.team!=='Montana' ||
      offer.createdAt!==1791745926950 || p?.id!=='r197' || p.name!=='Sam Faraimo' ||
      offer.rescinded || p.commitTeam || offer.pitchCompletedAt)return false;
    const h=header(offer.text);
    return h.offerLine>=0 && h.end===h.lines.length;
  }
  function addMissingPitch(offer,p,stage,body){
    if(!canAddMissingPitch(offer,p,stage))throw Error('This offer is not approved for a missing-pitch correction.');
    if(typeof body!=='string' || !body.trim() || body.length>100000)throw Error('Paste the missing pitch.');
    const h=header(body);
    if(h.offerLine>=0)throw Error('The offer header is already saved. Paste only the missing text below it.');
    if(h.end===h.lines.length)throw Error('Add the pitch below the offer type.');
    const old=header(offer.text);
    if(h.type && old.type && h.type!==old.type)throw Error('Use the upgrade button to change the offer type.');
    if(/\b(?:coach|campus|school)\s+visit\b/i.test(body))throw Error('Add visits using Edit visits after saving your pitch.');
    return offer.text+'\n\n'+body.trim();
  }
  root.NZCFLOfferAmendments={header,amend,allowed,canAddMissingPitch,addMissingPitch};
})(globalThis);
