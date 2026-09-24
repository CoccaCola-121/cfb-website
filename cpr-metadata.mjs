// Mirrors cfb-bot/commands/playerpage.js grade and previous-team rules.
export function playerMetadata(player, season, teams) {
  const age = typeof player.age === 'number' ? player.age : (Number.isFinite(player.born?.year) ? season - player.born.year : null);
  const redshirt = (player.injuries || []).some(injury=>String(injury.type || '').toLowerCase()==='redshirt');
  let grade = '', yearsLeft = null;
  if (Number.isFinite(age)) {
    const year = age - (redshirt && age >= 20 ? 19 : 18);
    if (year >= 1 && year <= 4) { grade = (redshirt && age >= 20 ? 'RS ' : '') + ['FR','SO','JR','SR'][year-1]; yearsLeft=5-year; }
  }
  const tids = new Set();
  for (const tid of [...(player.statsTids || []),...(player.transactions || []).map(t=>t.tid)]) if (typeof tid === 'number' && tid>=0 && tid!==player.tid) tids.add(tid);
  const previousTeams = [...tids].map(tid=>teams.get(tid)?.region).filter(Boolean);
  return {grade,yearsLeft,previousTeams,metadataSeason:season,exportPlayerId:player.pid};
}
export function extractCprMetadata(data, roster){
  if (!Array.isArray(data.players) || !Array.isArray(data.teams)) throw Error('Choose a Football GM league export with players and teams.');
  const season = Number(data.gameAttributes?.season);
  if (!Number.isInteger(season) || season <= 0) throw Error('The export must include its current season.');
  const teams=new Map(data.teams.map(t=>[t.tid,t]));
  const normalize=s=>String(s || '').trim().replace(/\s+/g,' ').toLowerCase();
  const index=new Map();
  for (const p of data.players) {
    if (p.tid !== -1) continue;
    const rating=p.ratings?.[p.ratings.length-1];
    if (!rating) continue;
    const key=normalize(`${p.firstName || ''} ${p.lastName || ''}`)+'|'+rating.pos;
    if (!index.has(key)) index.set(key,[]);
    index.get(key).push({p,rating});
  }
  const matches=[]; const unmatched=[]; const ambiguous=[];
  for (const row of roster) {
    const candidates=(index.get(normalize(row.name)+'|'+row.position)||[]).filter(({rating})=>Number(rating.ovr)===Number(row.overall) && Number(rating.pot)===Number(row.potential));
    if (candidates.length!==1) { (candidates.length ? ambiguous : unmatched).push(row.name); continue; }
    matches.push({rank:row.rank,name:row.name,...playerMetadata(candidates[0].p,season,teams)});
  }
  return {season,matches,unmatched,ambiguous};
}
