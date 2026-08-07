import { getCurrentUser, json } from '../_lib/auth.js';
import { getAllTeams, teamKey } from '../_lib/teams-util.js';

export async function onRequestGet({ request, env }) {
  const user = await getCurrentUser(request, env);
  const list = await env.AUTH_KV.list({ prefix: 'team:' });
  const claimed = [];
  for (const key of list.keys) {
    const row = await env.AUTH_KV.get(key.name, 'json');
    if (row && row.team && (!user || row.discordId !== user.discordId)) claimed.push(teamKey(row.team));
  }
  return json({
    teams: await getAllTeams(env),
    claimedTeams: claimed,
  });
}
