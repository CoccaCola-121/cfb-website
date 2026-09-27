(function(root){
  const thresholds = Object.freeze({S:30,TE:30,QB:35,DL:35,LB:35,RB:37,CB:37,OL:37,WR:50,K:57,P:57});
  const scholarshipCutoffs = Object.freeze({K:65,P:65,WR:54,LB:50,OL:50,DL:50,RB:47,CB:47,QB:45,S:45,TE:45});
  function scholarshipRecruit(player, offers = []){
    const overall = player.overall == null ? Number(String(player.rating || '').split('/')[0]) : Number(player.overall);
    return offers.some(offer=>!offer.rescinded && scholarshipOffer(offer)) || player.everScholarship === true || player.offerMode === 'pitch' || (Object.hasOwn(scholarshipCutoffs,player.position) && overall >= scholarshipCutoffs[player.position]);
  }
  function scholarshipOffer(offer){
    if (offer.offerType === 'scholarship') return true;
    if (offer.offerType === 'walkon') return false;
    const header=String(offer.text || '').trim().split(/\r?\n/).slice(0,5);
    return header.some(line=>/^(?:scholarship|scholarship offer)\s*[.!:]?$/i.test(line.replace(/[*_`]/g,'').trim()) || /\boffers?\b.*\bscholarship\b/i.test(line));
  }
  const normalize = value => String(value || '').trim().replace(/\s+/g,' ').toLowerCase();
  function qualify(player){ return player.everScholarship === true || (Object.hasOwn(thresholds,player.position) && player.overall >= thresholds[player.position]); }
  function leaders(roster){
    const best = {};
    roster.forEach(p => { const old=best[p.position]; if (!old || p.overall>old.overall || (p.overall===old.overall && p.potential>old.potential)) best[p.position]=p; });
    return best;
  }
  function playerKey(input){
    return JSON.stringify([normalize(input.name),String(input.position || '').toUpperCase(),Number(input.overall),Number(input.potential)]);
  }
  function createMatcher(roster){
    const index = new Map();
    roster.forEach(p=>{const key=playerKey(p); const rows=index.get(key) || []; rows.push(p); index.set(key,rows);});
    return input=>{
      const matches=index.get(playerKey(input)) || [];
      if (matches.length!==1) throw Error(matches.length ? 'Multiple CSV players match these details. Ask a commissioner to resolve the duplicate.' : 'No free agent in the uploaded CSV matches that name, position, overall and potential.');
      return matches[0];
    };
  }
  function match(roster,input){ return createMatcher(roster)(input); }
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
  root.NZCFLCprRules = Object.freeze({thresholds,scholarshipCutoffs,scholarshipRecruit,scholarshipOffer,qualify,leaders,match,createMatcher,resolveOffer});
})(globalThis);
