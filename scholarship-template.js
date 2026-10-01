(function(root){
 const labels=['Playing Time','Location','Coach'];
 function clean(input){
  const sections=labels.map((label,i)=>{
   const row=input?.sections?.[i] || {};
   if(typeof (row.body ?? '')!=='string' || String(row.body || '').length>20000)throw Error('Each template section must be under 20,000 characters.');
   const choices=Array.isArray(row.choices)?row.choices:[];
   if(choices.length>20 || choices.some(p=>typeof p!=='string' || p.length>1000))throw Error('Use up to 20 promise choices per value, under 1,000 characters each.');
   return {label,body:String(row.body || '').trim(),choices:[...new Set(choices.map(p=>p.trim()).filter(Boolean))]};
  });
  return {sections};
 }
 function build(team,p,input,selected=[]){
  const template=clean(input),promises=[];
  const sections=template.sections.map((row,i)=>{
   const selection=selected[i] ?? -1;
   if(!Number.isInteger(selection) || selection< -1 || selection>=row.choices.length)throw Error('Choose a saved promise or None.');
   const choice=selection>=0?row.choices[selection]:'';
   const content=[row.body,choice?'**'+choice.replace(/^\*+|\*+$/g,'')+'**':''].filter(Boolean).join('\n\n');
   if(choice)promises.push({text:choice.replace(/^\*+|\*+$/g,''),title:row.label,category:i===0?'playing_time':i===1?'location':'coach'});
   else {
    const bold=[...row.body.matchAll(/\*{1,2}([^*]+)\*{1,2}/g)].map(m=>m[1].trim()).filter(p=>/\bpromise\b/i.test(p));
    const explicit=row.body.match(/\b(?:I promise|We promise|Promise:)\s*[\s\S]*$/i);
    const promise=bold.at(-1) || explicit?.[0];
    if(promise)promises.push({text:promise,title:row.label,category:i===0?'playing_time':i===1?'location':'coach'});
   }
   return content?row.label+':\n'+content:'';
  }).filter(Boolean);
  return {text:team+' offers '+p.position+' '+p.name+'\n\nScholarship'+(sections.length?'\n\n'+sections.join('\n\n'):''),promises};
 }
 root.NZCFLScholarshipTemplate={labels,clean,build};
})(globalThis);
