// Uses the bot grade rules and selects only the latest previous team.
export function playerMetadata(player, season, teams) {
  const age = typeof player.age === 'number' ? player.age : (Number.isFinite(player.born?.year) ? season - player.born.year : null);
  const redshirt = (player.injuries || []).some(injury=>String(injury.type || '').toLowerCase()==='redshirt');
  let grade = '', yearsLeft = null;
  if (Number.isFinite(age)) {
    const year = age - (redshirt && age >= 20 ? 19 : 18);
    if (year >= 1 && year <= 4) { grade = (redshirt && age >= 20 ? 'RS ' : '') + ['FR','SO','JR','SR'][year-1]; yearsLeft=5-year; }
  }
  // Use dated history, not a list of every team the player has visited.
  const history = [];
  for (const [index, record] of (player.stats || []).entries()) {
    if (Number.isFinite(record.season) && record.season <= season - 1) history.push({...record,order:index,source:0});
  }
  for (const [index, record] of (player.transactions || []).entries()) {
    if (Number.isFinite(record.season) && record.season <= season - 1) history.push({...record,order:index,source:1});
  }
  const valid = record => typeof record.tid === 'number' && record.tid >= 0 && teams.has(record.tid);
  history.sort((a,b)=>b.season-a.season || (b.phase ?? 0)-(a.phase ?? 0) || b.source-a.source || (b.eid ?? b.order)-(a.eid ?? a.order));
  // A season without stats need not mean a season without a roster spot.
  // One completed free-agent year is the current offseason cohort; two
  // or more means the player sat out the preceding recruiting cycle.
  const recentRoster = Number.isFinite(player.yearsFreeAgent) && player.yearsFreeAgent <= 1;
  const latest = history.find(record=>valid(record) && (record.season === season - 1 || recentRoster));
  const previousTeam = teams.get(latest?.tid)?.region || '';
  return {grade,yearsLeft,previousTeam,previousTeams:previousTeam ? [previousTeam] : [],metadataSeason:season,exportPlayerId:player.pid};
}
export function extractCprMetadata(data, roster){
  if (!Array.isArray(data.players) || !Array.isArray(data.teams)) throw Error('Choose a Football GM league export with players and teams.');
  const season = Number(data.gameAttributes?.season);
  if (!Number.isInteger(season) || season <= 0) throw Error('The export must include its current season.');
  const teams=new Map(data.teams.map(t=>[t.tid,t]));
  const normalize=s=>String(s || '').trim().replace(/\s+/g,' ').toLowerCase();
  const index=new Map();
  for (const p of data.players) {
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

export async function readLeagueExport(file){
  const signature = new Uint8Array(await file.slice(0,2).arrayBuffer());
  const gzip = signature[0] === 0x1f && signature[1] === 0x8b;
  const text = gzip ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text();
  try { return JSON.parse(text); } catch { throw Error('The file does not contain a valid league JSON export.'); }
}
