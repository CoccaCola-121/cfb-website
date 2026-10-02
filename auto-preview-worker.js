importScripts('/cpr-rules.js','/offer-window.js','/auto-commits.js');
self.onmessage=function(event){
 const {signature,state}=event.data;
 try{
  state.offersLocked=true;
  // A current-auto badge must not assume competing offers will be rescinded later.
  const uncontested=new Set();
  for(const [id,p] of Object.entries(state.prospects || {})){
   if(p.commitTeam)continue;
   const active=(state.offersByProspect?.[id] || []).filter(o=>!o.rescinded && !NZCFLAutoCommits.invalidOffer(state,p,o));
   const scholarships=active.filter(o=>NZCFLAutoCommits.offerKind(state,p,o)==='scholarship');
   const eligible=scholarships.length?scholarships:active;
   if(new Set(eligible.map(o=>NZCFLAutoCommits.key(o.team))).size===1)eligible.forEach(o=>uncontested.add(id+':'+o.id));
  }
  const offers=[];
  for(const kind of state.recruitingStage==='transfer'?['scholarship']:['scholarship','walkon']){
   const result=NZCFLAutoCommits.apply(state,kind);
   result.commits.forEach(row=>{const key=row.prospectId+':'+row.offerId;if(uncontested.has(key))offers.push(key);});
  }
  self.postMessage({signature,offers,unavailable:false});
 }catch{self.postMessage({signature,offers:[],unavailable:true});}
};
