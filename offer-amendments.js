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
  function insertVisit(text,phrase){
    text=String(text || '');
    const h=header(text),lines=text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [];
    const offset=lines.slice(0,h.end).reduce((n,line)=>n+line.length,0);
    const prefix=text.slice(0,offset).trimEnd(),body=text.slice(offset);
    return (prefix?prefix+'\n\n':'')+phrase+'\n\n'+body;
  }
  function visitChanges(before={},after={}){
    const result=[],oldCampus=!!(before.campus || before.school),campus=!!(after.campus || after.school);
    const oldLabel=String(before.campusLabel || before.schoolLabel || '').trim(),label=String(after.campusLabel || after.schoolLabel || '').trim();
    if(!!before.coach!==!!after.coach)result.push(after.coach?'Added coach visit.':'Removed coach visit.');
    if(!oldCampus && campus)result.push('Added campus visit'+(label?': '+label:'')+'.');
    else if(oldCampus && !campus)result.push('Removed campus visit.');
    else if(campus && oldLabel!==label)result.push('Changed campus visit from '+(oldLabel || 'unspecified week')+' to '+(label || 'unspecified week')+'.');
    return result;
  }
  function readableEditChange(change){
    if(typeof change!=='string')return 'Offer updated.';
    if(!change.startsWith('Visits updated: '))return change;
    try{
      const v=JSON.parse(change.slice('Visits updated: '.length));
      const parts=[];
      if(v.coach)parts.push('coach visit');
      if(v.campus || v.school)parts.push('campus visit'+(v.campusLabel || v.schoolLabel?': '+(v.campusLabel || v.schoolLabel):''));
      return parts.length?'Visits saved: '+parts.join('; ')+'.':'No visits selected.';
    }catch{return 'Visits updated.';}
  }
  function canFixVisitPlacement(o,p,stage){
    return stage==='hs' && o?.id==='o_959185641613164604_f9308476-6e7f-47ac-8465-861a9e89ba5a' &&
      o.team==='Northwestern' && p?.id==='r59' && p.name==='Brian Koger' &&
      !o.rescinded && !p.commitTeam && !o.visitPlacementFixedAt && !!o.visits?.campus;
  }
  function fixVisitPlacement(o,p,stage){
    if(!canFixVisitPlacement(o,p,stage))throw Error('This offer is not eligible for this formatting correction.');
    const phrase='Campus Visit '+o.visits.campusLabel;
    const lines=o.text.split(/\r?\n/),matches=lines.map((line,i)=>line.trim()===phrase?i:-1).filter(i=>i>=0);
    if(matches.length!==1)throw Error('The visit text changed. Please ask a commissioner to review it.');
    // Replace only the misplaced visit line with a paragraph break. No pitch words change.
    lines[matches[0]]='';
    return insertVisit(lines.join('\n'),phrase);
  }
  root.NZCFLOfferAmendments={header,amend,allowed,canAddMissingPitch,addMissingPitch,insertVisit,visitChanges,readableEditChange,canFixVisitPlacement,fixVisitPlacement};
})(globalThis);
