import { getCurrentUser, isAdmin, json } from '../../_lib/auth.js';
import { deleteTeamClaim, readTeamClaim, teamKey } from '../../_lib/teams-util.js';

async function findDiscordIdByTeam(env, team) {
  const claim = await readTeamClaim(env, team);
  return claim && claim.discordId ? claim.discordId : '';
}

export async function onRequestPost({ request, env }) {
  const admin = await getCurrentUser(request, env);
  if (!admin || !isAdmin(env, admin.discordId)) {
    return json({ ok: false, error: 'Admin access required.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const discordId = String(body.discordId || '').trim() || await findDiscordIdByTeam(env, body.team || '');
  if (!discordId) return json({ ok: false, error: 'Enter a Discord ID or linked team.' }, { status: 400 });

  const userKey = `discord:user:${discordId}`;
  const user = await env.AUTH_KV.get(userKey, 'json');
  if (!user) return json({ ok: false, error: 'No linked account found.' }, { status: 404 });

  const oldTeam = user.team;
  if (oldTeam) await deleteTeamClaim(env, oldTeam);
  user.team = '';
  user.updatedAt = Date.now();
  await env.AUTH_KV.put(userKey, JSON.stringify(user));

  if (body.team && teamKey(body.team) !== teamKey(oldTeam)) {
    await deleteTeamClaim(env, body.team);
  }

  return json({ ok: true, user });
}
