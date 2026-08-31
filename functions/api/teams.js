import { accessLevel, canCommission, canModerate, getCurrentUser, json } from '../_lib/auth.js';
import { getAllTeams, teamKey } from '../_lib/teams-util.js';

async function listAllKeys(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.AUTH_KV.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

function linkRow(env, row) {
  return {
    team: row.team,
    discordId: row.discordId,
    displayName: row.displayName || row.username || '',
    username: row.username || '',
    avatar: row.avatar || '',
    accessLevel: accessLevel(env, row),
    isModerator: canModerate(env, row),
    isCommissioner: canCommission(env, row),
  };
}

export async function onRequestGet({ request, env }) {
  const user = await getCurrentUser(request, env);
  const teamKeys = await listAllKeys(env, 'team:');
  const links = {};
  for (const key of teamKeys) {
    const row = await env.AUTH_KV.get(key.name, 'json');
    if (!row || !row.team || !row.discordId) continue;
    const linkedUser = await env.AUTH_KV.get(`discord:user:${row.discordId}`, 'json');
    links[teamKey(row.team)] = linkRow(env, {
      team: row.team,
      discordId: row.discordId,
      displayName: linkedUser ? (linkedUser.displayName || linkedUser.username || '') : '',
      username: linkedUser ? (linkedUser.username || '') : '',
      avatar: linkedUser ? (linkedUser.avatar || '') : '',
      accessLevel: linkedUser ? linkedUser.accessLevel : '',
      role: linkedUser ? linkedUser.role : '',
    });
  }
  const userKeys = await listAllKeys(env, 'discord:user:');
  for (const key of userKeys) {
    const row = await env.AUTH_KV.get(key.name, 'json');
    if (!row || !row.team || !row.discordId) continue;
    const keyName = teamKey(row.team);
    if (!links[keyName]) links[keyName] = linkRow(env, row);
  }
  const claimed = Object.keys(links).filter((key) => {
    return !user || links[key].discordId !== user.discordId;
  });
  return json({
    teams: await getAllTeams(env),
    claimedTeams: claimed,
    links,
  });
}
