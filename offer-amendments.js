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
  root.NZCFLOfferAmendments={header,amend,allowed};
})(globalThis);
