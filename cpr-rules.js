(function(root){
  const thresholds = Object.freeze({S:30,TE:30,QB:35,DL:35,LB:35,RB:37,CB:37,OL:37,WR:50,K:57,P:57});
  const normalize = value => String(value || '').trim().replace(/\s+/g,' ').toLowerCase();
  function qualify(player){ return Object.hasOwn(thresholds,player.position) && player.overall >= thresholds[player.position]; }
  function leaders(roster){
    const best = {};
    roster.forEach(p => { const old=best[p.position]; if (!old || p.overall>old.overall || (p.overall===old.overall && p.potential>old.potential)) best[p.position]=p; });
    return best;
  }
  function match(roster,input){
    const matches = roster.filter(p => normalize(p.name)===normalize(input.name) && p.position===String(input.position || '').toUpperCase() && Number(p.overall)===Number(input.overall) && Number(p.potential)===Number(input.potential));
    if (matches.length!==1) throw Error(matches.length ? 'Multiple CSV players match these details. Ask a commissioner to resolve the duplicate.' : 'No free agent in the uploaded CSV matches that name, position, overall and potential.');
    return matches[0];
  }
  function resolveOffer(roster,text,input = {}){
    const header = normalize(String(text || '').split(/\r?\n/).slice(0,5).join(' ').replace(/[*_`]/g,''));
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const name = normalize(input.name);
    const position = String(input.position || '').trim().toUpperCase();
    let matches = roster.filter(p => name ? normalize(p.name) === name : new RegExp('(?:^|[^a-z0-9])' + escape(normalize(p.name)) + '(?=$|[^a-z0-9])','i').test(header));
    if (position) matches = matches.filter(p=>p.position===position);
    if (matches.length > 1 && !position) {
      const positions = Object.keys(thresholds).filter(pos=>new RegExp('(?:^|[^a-z])' + pos + '(?:$|[^a-z])','i').test(header));
      if (positions.length === 1) matches=matches.filter(p=>p.position===positions[0]);
    }
    if (matches.length !== 1) throw Error(matches.length ? 'More than one player matches. Enter the player name and position below.' : 'No matching free agent found in the CSV. Enter the player name and position below.');
    return matches[0];
  }
  root.NZCFLCprRules = Object.freeze({thresholds,qualify,leaders,match,resolveOffer});
})(globalThis);
