(function(root){
 const current=state=>Number.isInteger(state?.currentWeek) && state.currentWeek>=1?state.currentWeek:1;
 function label(value){return String(value || '').trim().replace(/^:\s*/,'').replace(/\s+/g,' ').toLowerCase();}
 function week(value){const m=label(value).match(/^(?:week\s*)?(\d{1,2})(?:\s|$)/);return m?Number(m[1]):null;}
 function campusFromText(text){
  // Horizontal whitespace only: a generic visit must not consume the next pitch line.
  const match=String(text || '').match(/\b(?:campus|school)[ \t]+visit\b[ \t]*([^\n\r]*)/i);
  const value=match?match[1].replace(/\(\s*\d+\s*\/\s*17\s*\)/i,'').split(/\s+(?:(?:Location|Winning|Campus|Prestige|Education|Playing Time|Tradition|Coach|Pro Potential):|Coach\s+Visit\b)/i)[0].trim():'';
  return {campus:!!match,campusLabel:value};
 }
 function normalizeCampusLabel(value){
  const raw=String(value ?? '').trim().replace(/^:\s*/,'');
  if(/[\r\n]/.test(raw))return {ok:false,value:raw};
  const clean=raw.replace(/[ \t]+/g,' ');
  if(!clean)return {ok:true,value:''};
  const match=clean.match(/^(?:(?:Week\s*)?(\d{1,2})(?:\s+vs\.?\s+(.+))?|vs\.?\s+(.+))$/i);
  const opponentText=match?.[2] || match?.[3] || '';
  if(!match || match[1]!==undefined && (Number(match[1])<1 || Number(match[1])>99) || opponentText.length>120)return {ok:false,value:clean};
  const opponent=opponentText.split(/\s+/).map(part=>/^[A-Z0-9&.-]{2,}$/.test(part)?part:part.split('-').map(piece=>piece?piece[0].toUpperCase()+piece.slice(1).toLowerCase():piece).join('-')).join(' ');
  return {ok:true,value:[match[1]!==undefined?'Week '+Number(match[1]):'',opponent?'vs. '+opponent:''].filter(Boolean).join(' ')};
 }
 function error(state,next,previous){
  if((state?.recruitingStage || 'hs')!=='hs')return '';
  const fromText=offer=>label(campusFromText(offer?.text || offer?.offerText).campusLabel);
  const fromData=offer=>offer?.visits?.campus?label(offer.visits.campusLabel):'';
  for(const read of [fromText,fromData]){
   const before=read(previous),after=read(next);
   if(before===after)continue;
   if(before && week(before)!==null && week(before)<current(state))return 'Week '+week(before)+' campus visits are locked. The current week is '+current(state)+'.';
   if(after && !normalizeCampusLabel(after).ok)return 'Enter a campus visit week from 1 to 99, or leave it blank for a generic visit. Opponent is optional.';
   if(week(after)!==null && week(after)<current(state))return 'Campus visits must be in week '+current(state)+' or later.';
  }
  return '';
 }
 root.NZCFLVisitRules=Object.freeze({current,week,error,campusFromText,normalizeCampusLabel});
})(globalThis);
