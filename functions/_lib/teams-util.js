import { TEAM_METADATA } from './teams.js';

const TEAM_KEY_ALIASES = {
  'alabama birmingham': 'uab',
  'texas christian': 'tcu',
  'california': 'cal',
  'brigham young': 'byu',
  'southern methodist': 'smu',
};

export function teamKey(value) {
  const key = String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return TEAM_KEY_ALIASES[key] || key;
}

export function isContractedTeam(value){
  const key=teamKey(value);
  if(!key)return false;
  const brand=TEAM_METADATA.find(t=>[t.region,t.abbrev,t.displayName].some(v=>teamKey(v)===key));
  return globalThis.NZCFLTeamStatus.isContracted(brand?.region || value);
}

export async function getAllTeams(env) {
  const extras = env && env.AUTH_KV ? await env.AUTH_KV.get('teams:extra', 'json') : null;
  const byKey = new Map();
  TEAM_METADATA.forEach((team) => byKey.set(teamKey(team.region), team));
  (Array.isArray(extras) ? extras : []).forEach((team) => {
    if (team && team.region) byKey.set(teamKey(team.region), team);
  });
  return Array.from(byKey.values()).sort((a, b) => a.region.localeCompare(b.region));
}

export async function findTeam(env, value, {coachable=false}={}) {
  const key = teamKey(value);
  if (!key) return null;
  const teams = await getAllTeams(env);
  return teams.find((team) => {
    if(coachable && isContractedTeam(team.region))return false;
    return [team.region, team.nickname, team.abbrev, team.displayName]
      .some((candidate) => teamKey(candidate) === key);
  }) || null;
}

export async function readTeamClaim(env, teamName) {
  return env.AUTH_KV.get(`team:${teamKey(teamName)}`, 'json');
}

export async function writeTeamClaim(env, teamName, discordId) {
  await env.AUTH_KV.put(`team:${teamKey(teamName)}`, JSON.stringify({ team: teamName, discordId }));
}

export async function deleteTeamClaim(env, teamName) {
  await env.AUTH_KV.delete(`team:${teamKey(teamName)}`);
}
