// Shared by the browser and league-state endpoint so the same pitch rule applies.
(function(root){
  function linkTokens(text){
    const result=[],re=/\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+)\)/gi;
    let match;
    while((match=re.exec(String(text || '')))){
      try{const url=new URL(match[2]);if(!['https:','http:'].includes(url.protocol))continue;
        result.push({start:match.index,end:re.lastIndex,label:match[1],url:url.href});}catch{}
    }
    const raw=String(text || '');
    const bare=/\b(?:https?:\/\/[^\s<>]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#][^\s<>]*)?)/gi;
    while((match=bare.exec(raw))){
      if(result.some(t=>match.index<t.end && bare.lastIndex>t.start))continue;
      if(match.index && /[\w@/.-]/.test(raw[match.index-1]))continue;
      let label=match[0].replace(/[.,!?;:'"*]+$/g,'');
      while(label.endsWith(')') && (label.match(/\)/g)||[]).length>(label.match(/\(/g)||[]).length)label=label.slice(0,-1);
      label=label.replace(/[\]}]+$/g,'');
      try{const url=new URL(/^https?:\/\//i.test(label)?label:'https://'+label);
        if(!['http:','https:'].includes(url.protocol))continue;
        result.push({start:match.index,end:match.index+label.length,label,url:url.href,bare:true});
      }catch{}
    }
    return result.sort((a,b)=>a.start-b.start);
  }
  function withoutLinkUrls(text){
    let out='',cursor=0;
    for(const token of linkTokens(text)){out+=text.slice(cursor,token.start)+(token.bare?'':token.label);cursor=token.end;}
    return (out+text.slice(cursor)).replace(/https?:\/\/[^\s<>]+/gi,'');
  }
  function pitchWordCount(text, prospect){
    const lines = String(text || '').trim().split(/\r?\n/);
    const escape = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const name = escape(prospect && prospect.name);
    const rank = escape(prospect && prospect.rank);
    const position = escape(prospect && prospect.position);
    const target = [name, rank ? '#' + rank : ''].filter(Boolean).join('|');
    // Only a complete, standalone offer heading is exempt. Prose on that line counts.
    if (target && new RegExp('^(?:.{1,120}\\s+)?offers?\\s+' + (position ? '(?:' + position + '\\s+)?' : '') + '(?:' + target + ')(?:\\s*\\((?:scholarship|walk[ -]?on)\\))?\\s*[:.!]?$', 'i').test(lines[0].trim())) {
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
      if (/^\s*scholarship\s*$/i.test(lines[0] || '')) lines.shift();
    }
    return withoutLinkUrls(lines.join(' ')).trim().split(/\s+/).filter(Boolean).length;
  }
  function pitchLimitError(text, prospect, stage){
    if (stage !== 'transfer' && !(prospect && prospect.transferFrom) && !(stage === 'cpr' && prospect && prospect.offerMode === 'pitch')) return '';
    const count = pitchWordCount(text, prospect);
    return count > 800 ? 'Pitch recruits allow 800 words, excluding a standalone offer header. This pitch has ' + count + ' words.' : '';
  }
  function cleanCommitOverrides(state){
    const overrides = state.manualCommitOverrides || {};
    for (const [id, override] of Object.entries(overrides)) {
      const p = (state.prospects || {})[id];
      const matches = p && override.name === p.name && override.stage === state.recruitingStage;
      if ((state.recruitingStage === 'transfer' || override.name) && !matches) {
        if (p && p.commitTeam === override.team && !p.commitSource) delete p.commitTeam;
        delete overrides[id];
      }
    }
    return state;
  }
  root.NZCFLTransferRules = Object.freeze({ linkTokens, pitchWordCount, pitchLimitError, cleanCommitOverrides });
})(globalThis);
