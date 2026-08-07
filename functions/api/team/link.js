import { getCurrentUser, json } from '../../_lib/auth.js';
import { findTeam, readTeamClaim, writeTeamClaim } from '../../_lib/teams-util.js';

export async function onRequestPost({ request, env }) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ ok: false, error: 'Discord login required.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const team = await findTeam(env, body.team);
  if (!team) return json({ ok: false, error: 'That team is not available.' }, { status: 400 });

  if (user.team && user.team !== team.region) {
    return json({ ok: false, error: `Your account is already linked to ${user.team}.` }, { status: 409 });
  }
  const claim = await readTeamClaim(env, team.region);
  if (claim && claim.discordId !== user.discordId) {
    return json({ ok: false, error: `${team.region} is already linked to another Discord account.` }, { status: 409 });
  }

  user.team = team.region;
  user.updatedAt = Date.now();
  await env.AUTH_KV.put(`discord:user:${user.discordId}`, JSON.stringify(user));
  await writeTeamClaim(env, team.region, user.discordId);
  return json({ ok: true, user });
}
