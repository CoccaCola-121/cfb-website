import { canModerate, getCurrentUser, json } from '../../_lib/auth.js';
import { findTeam, readTeamClaim, teamKey, writeTeamClaim } from '../../_lib/teams-util.js';

// Account recovery only: never read or write league state, offers or commitments.
export async function onRequestPost({ request, env }) {
  const admin = await getCurrentUser(request, env);
  if (!admin || !canModerate(env, admin)) return json({ ok: false, error: 'Moderator access required.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const discordId = String(body.discordId || '').trim();
  const previousDiscordId = String(body.previousDiscordId || '').trim();
  const team = await findTeam(env, body.team);
  if (!team || !/^\d{17,20}$/.test(discordId) || !/^\d{17,20}$/.test(previousDiscordId) || discordId === previousDiscordId) {
    return json({ ok: false, error: 'Enter the new Discord user ID and the currently linked account.' }, { status: 400 });
  }
  const claim = await readTeamClaim(env, team.region);
  const oldKey = `discord:user:${previousDiscordId}`, newKey = `discord:user:${discordId}`;
  const oldUser = await env.AUTH_KV.get(oldKey, 'json');
  const newUser = await env.AUTH_KV.get(newKey, 'json');
  if (claim?.discordId === discordId && newUser?.team === team.region && !oldUser?.team) return json({ ok: true });
  if (claim?.discordId !== previousDiscordId || !oldUser || (oldUser.team && teamKey(oldUser.team) !== teamKey(team.region))) {
    return json({ ok: false, error: 'The linked coach has changed. Refresh Teams before trying again.' }, { status: 409 });
  }
  if (newUser?.team && teamKey(newUser.team) !== teamKey(team.region)) {
    return json({ ok: false, error: 'The new account already coaches another team.' }, { status: 409 });
  }
  const now = Date.now();
  // Keep a recovery record before changing any account. Existing roles stay with
  // their original account; a newly registered replacement has coach access only.
  await env.AUTH_KV.put(`account-replacement:${teamKey(team.region)}:${previousDiscordId}:${discordId}`, JSON.stringify({
    team: team.region, previousDiscordId, discordId, actor: admin.discordId, at: now, oldUser, newUser, claim,
  }));
  await env.AUTH_KV.put(newKey, JSON.stringify({ ...(newUser || { discordId, displayName: oldUser.displayName || oldUser.username || '', accessLevel: 'coach', createdAt: now }), team: team.region, updatedAt: now }));
  await env.AUTH_KV.put(oldKey, JSON.stringify({ ...oldUser, team: '', updatedAt: now }));
  await writeTeamClaim(env, team.region, discordId);
  return json({ ok: true, team: team.region, discordId });
}
