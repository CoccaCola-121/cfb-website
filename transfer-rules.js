// Shared by the browser and league-state endpoint so the same pitch rule applies.
(function(root){
  function linkTokens(text){
    const result=[],re=/\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+)\)/gi;
    let match;
    while((match=re.exec(String(text || '')))){
      try{const url=new URL(match[2]);if(!['https:','http:'].includes(url.protocol))continue;
        result.push({start:match.index,end:re.lastIndex,label:match[1],url:url.href});}catch{}
    }
    return result;
  }
  function withoutLinkUrls(text){
    let out='',cursor=0;
    for(const token of linkTokens(text)){out+=text.slice(cursor,token.start)+token.label;cursor=token.end;}
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
