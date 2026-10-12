(function(root){
  // Only a standalone heading followed by list items overrides pitch prose.
  function extract(text){
    const lines=String(text || '').split(/\r?\n/);
    let result=[];
    for(let i=0;i<lines.length;i++){
      const heading=lines[i].trim().replace(/^#{1,6}\s+/, '').replace(/[*_]/g, '');
      if(!/^promises\s*:$/i.test(heading))continue;
      const items=[],seen=new Set();
      for(let j=i+1;j<lines.length;j++){
        if(!lines[j].trim())continue;
        const match=lines[j].match(/^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/);
        if(!match)break;
        const value=match[1].replace(/\*\*|__/g, '').trim();
        if(!value || seen.has(value.toLowerCase()))continue;
        seen.add(value.toLowerCase());
        items.push({text:value,title:'Promise',category:'other'});
      }
      if(items.length)result=items;
    }
    return result;
  }
  root.NZCFLPromiseLists=Object.freeze({extract});
})(globalThis);
