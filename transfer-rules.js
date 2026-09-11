// Shared by the browser and league-state endpoint so the same pitch rule applies.
(function(root){
  function pitchWordCount(text, prospect){
    const lines = String(text || '').trim().split(/\r?\n/);
    const escape = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const name = escape(prospect && prospect.name);
    const rank = escape(prospect && prospect.rank);
    const target = [name, rank ? '#' + rank : ''].filter(Boolean).join('|');
    // Only a complete, standalone offer heading is exempt. Prose on that line counts.
    if (target && new RegExp('^(?:.{1,120}\\s+)?offers?\\s+(?:' + target + ')(?:\\s*\\((?:scholarship|walk[ -]?on)\\))?\\s*[:.!]?$', 'i').test(lines[0].trim())) lines.shift();
    return lines.join(' ').trim().split(/\s+/).filter(Boolean).length;
  }
  function pitchLimitError(text, prospect, stage){
    if (stage !== 'transfer' && !(prospect && prospect.transferFrom)) return '';
    const count = pitchWordCount(text, prospect);
    return count > 800 ? 'Transfer pitches allow 800 words, excluding a standalone offer header. This pitch has ' + count + ' words.' : '';
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
  root.NZCFLTransferRules = Object.freeze({ pitchWordCount, pitchLimitError, cleanCommitOverrides });
})(globalThis);
