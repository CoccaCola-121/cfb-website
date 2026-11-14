(function(root){
  function classId(state){
    const rows=state.fullRoster || [],first=rows[0] || {},last=rows.at(-1) || {};
    return [state.recruitingStage || 'hs',rows.length,first.metadataSeason || first.season || '',first.name || '',last.name || ''].join('|');
  }
  function key(state){return (state.watchlistCycleId ? state.watchlistCycleId+'|' : '')+classId(state);}
  function identity(state){return JSON.stringify([state.recruitingStage || 'hs',(state.fullRoster || []).map(p=>[p.rank,p.name,p.position,p.metadataSeason || p.season || ''])]);}
  root.NZCFLWatchlistScope={classId,key,identity};
})(globalThis);
