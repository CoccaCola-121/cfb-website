importScripts('/cpr-rules.js','/offer-window.js','/auto-commits.js');
self.onmessage=function(event){
 const {signature,state}=event.data;
 try{
  state.offersLocked=true;
  const offers=[];
  for(const kind of state.recruitingStage==='transfer'?['scholarship']:['scholarship','walkon']){
   const result=NZCFLAutoCommits.apply(state,kind);
   result.commits.forEach(row=>offers.push(row.prospectId+':'+row.offerId));
  }
  self.postMessage({signature,offers,unavailable:false});
 }catch{self.postMessage({signature,offers:[],unavailable:true});}
};
