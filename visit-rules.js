(function(root){
 const current=state=>Number.isInteger(state?.currentWeek) && state.currentWeek>=1?state.currentWeek:1;
 function label(value){return String(value || '').trim().replace(/^:\s*/,'').replace(/\s+/g,' ').toLowerCase();}
 function week(value){const m=label(value).match(/^(?:week\s*)?(\d{1,2})(?:\s|$)/);return m?Number(m[1]):null;}
 function error(state,next,previous){
  if((state?.recruitingStage || 'hs')!=='hs')return '';
  const fromText=offer=>{const m=String(offer?.text || offer?.offerText || '').match(/(?:campus|school)\s+visit\s*([^\n\r]*)/i);return m?label(m[1]):'';};
  const fromData=offer=>offer?.visits?.campus?label(offer.visits.campusLabel):'';
  for(const read of [fromText,fromData]){
   const before=read(previous),after=read(next);
   if(before===after)continue;
   if(before && week(before)!==null && week(before)<current(state))return 'Week '+week(before)+' campus visits are locked. The current week is '+current(state)+'.';
   if(after && (week(after)===null || week(after)<1 || week(after)>99))return 'Enter a valid campus visit week.';
   if(after && week(after)<current(state))return 'Campus visits must be in week '+current(state)+' or later.';
  }
  return '';
 }
 root.NZCFLVisitRules=Object.freeze({current,week,error});
})(globalThis);
