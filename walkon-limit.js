(function(root){
 const key=value=>String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
 const enabled=state=>['hs','cpr'].includes(state.recruitingStage || 'hs');
 function isWalkon(state,p,offer){
   if(state.recruitingStage==='cpr') return !root.NZCFLCprRules.scholarshipRecruit(p);
   return /\bwalk\s*-?\s*on\b|\bwo\b/i.test(String(offer?.text || ''));
 }
 function counts(state){
   const result={}; if(!enabled(state))return result;
   for(const [id,p] of Object.entries(state.prospects || {})){
     if(!p.commitTeam)continue;
     const offer=(state.offersByProspect?.[id] || []).find(o=>!o.rescinded && key(o.team)===key(p.commitTeam));
     if((offer || state.recruitingStage==='cpr') && isWalkon(state,p,offer)) result[key(p.commitTeam)]=(result[key(p.commitTeam)] || 0)+1;
   }
   return result;
 }
 function error(state,p,offer){
   return enabled(state) && p && isWalkon(state,p,offer) && (counts(state)[key(offer.team)] || 0)>=15 ? 'This team has reached its 15 walk-on commitment limit.' : '';
 }
 function apply(state,now=Date.now()){
   const totals=counts(state);let changed=0;
   for(const [id,offers] of Object.entries(state.offersByProspect || {})){
     const p=state.prospects?.[id];if(!p || p.commitTeam)continue;
     for(const o of offers){if(!o.rescinded && (totals[key(o.team)] || 0)>=15 && isWalkon(state,p,o)){
       o.rescinded=true;o.rescindedAt=now;o.rescindReason='Automatic rescind: 15 walk-on commitments reached.';changed++;
     }}
   }
   return changed;
 }
 root.NZCFLWalkonLimit={counts,error,apply};
})(globalThis);
