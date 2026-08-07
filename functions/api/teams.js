import { accessLevel, canCommission, canModerate, getCurrentUser, json } from '../_lib/auth.js';
import { getAllTeams, teamKey } from '../_lib/teams-util.js';

export async function onRequestGet({ request, env }) {
  const user = await getCurrentUser(request, env);
  const list = await env.AUTH_KV.list({ prefix: 'team:' });
  const claimed = [];
  const links = {};
  for (const key of list.keys) {
    const row = await env.AUTH_KV.get(key.name, 'json');
    if (!row || !row.team || !row.discordId) continue;
    const linkedUser = await env.AUTH_KV.get(`discord:user:${row.discordId}`, 'json');
    links[teamKey(row.team)] = {
      team: row.team,
      discordId: row.discordId,
      displayName: linkedUser ? (linkedUser.displayName || linkedUser.username || '') : '',
      username: linkedUser ? (linkedUser.username || '') : '',
      avatar: linkedUser ? (linkedUser.avatar || '') : '',
      accessLevel: accessLevel(env, linkedUser),
      isModerator: canModerate(env, linkedUser),
      isCommissioner: canCommission(env, linkedUser),
    };
    if (!user || row.discordId !== user.discordId) claimed.push(teamKey(row.team));
  }
  return json({
    teams: await getAllTeams(env),
    claimedTeams: claimed,
    links,
  });
}
