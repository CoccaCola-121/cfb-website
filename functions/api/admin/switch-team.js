import { canModerate, getCurrentUser, json } from '../../_lib/auth.js';
import { deleteTeamClaim, findTeam, readTeamClaim, writeTeamClaim } from '../../_lib/teams-util.js';

export async function onRequestPost({ request, env }) {
  const admin = await getCurrentUser(request, env);
  if (!admin || !canModerate(env, admin)) {
    return json({ ok: false, error: 'Moderator access required.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const discordId = String(body.discordId || '').trim();
  const team = await findTeam(env, body.team);
  if (!discordId) return json({ ok: false, error: 'Enter a Discord ID.' }, { status: 400 });
  if (!team) return json({ ok: false, error: 'That team is not available.' }, { status: 400 });

  const userKey = `discord:user:${discordId}`;
  const user = await env.AUTH_KV.get(userKey, 'json');
  if (!user) return json({ ok: false, error: 'No linked account found for that Discord ID.' }, { status: 404 });

  const claim = await readTeamClaim(env, team.region);
  if (claim && claim.discordId !== discordId) {
    return json({ ok: false, error: `${team.region} is already linked to another Discord account.` }, { status: 409 });
  }

  if (user.team && user.team !== team.region) await deleteTeamClaim(env, user.team);
  user.team = team.region;
  user.updatedAt = Date.now();
  await env.AUTH_KV.put(userKey, JSON.stringify(user));
  await writeTeamClaim(env, team.region, discordId);
  return json({ ok: true, user });
}
