// Commissioner-approved refund for these three October 2026 campus visits.
// Match the original saved offers exactly so later edits and recruiting cycles
// cannot be refunded. The caller persists this correction with a D1 version check.
const correctionId='washington-state-campus-refund-2026-10-27';
const label='Week 12 vs. Washington';
const targets=[
  {pid:'r44',name:'Kyle Mann',position:'S',id:'o_99927419539955712_7c17fb81-7d78-4f4a-af32-15babcdf4f0d',updatedAt:1793137052540},
  {pid:'r33',name:'Jacob Simone',position:'RB',id:'o_99927419539955712_81b95cc3-0fb1-4770-9eea-f3edf00482ab',updatedAt:1793136605801},
  {pid:'r12',name:'Jalen Carr',position:'CB',id:'o_99927419539955712_3585fbd7-23b3-4939-adc8-b9e8b3a57574',updatedAt:1793137355175},
];

export function refundWashingtonStateCampusVisits(state,now=Date.now()){
  if(state?.recruitingStage!=='hs' || state.prospects?.r1?.name!=='Caspian Maction')return null;
  let next=null;
  for(const target of targets){
    const player=state.prospects?.[target.pid];
    const offers=state.offersByProspect?.[target.pid] || [];
    const offer=offers.find(o=>o.id===target.id);
    if(player?.id!==target.pid || player.name!==target.name || player.position!==target.position ||
      !offer || offer.team!=='Washington State' || offer.updatedAt!==target.updatedAt ||
      !offer.visits?.campus || offer.visits.campusLabel!==label || offer.approvedCampusVisitRefund)continue;
    // Remove only the saved standalone visit line, preserving every pitch word,
    // coach visit, offer, promise, and commitment exactly as it was.
    const lines=String(offer.text || '').match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [];
    const matches=lines.filter(line=>line.trim()==='Campus Visit '+label);
    if(matches.length!==1)continue;
    const refunded={
      ...offer,
      text:lines.filter(line=>line.trim()!=='Campus Visit '+label).join(''),
      visits:{...offer.visits,campus:false,campusLabel:''},
      updatedAt:now,
      approvedCampusVisitRefund:{id:correctionId,at:now,previousCampusLabel:label},
      editHistory:[...(offer.editHistory || []),{
        id:correctionId+'-'+target.pid,editedAt:now,editor:'Commissioner-approved correction',
        changes:['Returned campus visit: '+label+'. Approved refund after the reported commitment-sync outage; one campus visit is available to reuse.'],
      }].slice(-20),
    };
    if(!next)next={...state,offersByProspect:{...state.offersByProspect}};
    next.offersByProspect[target.pid]=offers.map(o=>o===offer?refunded:o);
  }
  return next;
}
