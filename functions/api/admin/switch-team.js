import { canModerate, getCurrentUser, json } from '../../_lib/auth.js';
import { queueLeagueBackup } from '../../_lib/backup.js';
import { rescindOffersForTeams } from '../../_lib/league-state.js';
import { deleteTeamClaim, findTeam, readTeamClaim, writeTeamClaim, teamKey } from '../../_lib/teams-util.js';

export async function onRequestPost({ request, env, waitUntil }) {
  const admin = await getCurrentUser(request, env);
  if (!admin || !canModerate(env, admin)) {
    return json({ ok: false, error: 'Moderator access required.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const discordId = String(body.discordId || '').trim();
  const team = await findTeam(env, body.team, {coachable:true});
  if (!discordId) return json({ ok: false, error: 'Enter a Discord ID.' }, { status: 400 });
  if (!team) return json({ ok: false, error: 'That team is not available.' }, { status: 400 });

  const userKey = `discord:user:${discordId}`;
  const user = await env.AUTH_KV.get(userKey, 'json');
  if (!user) return json({ ok: false, error: 'No linked account found for that Discord ID.' }, { status: 404 });

  const claim = await readTeamClaim(env, team.region);
  if (claim && claim.discordId !== discordId) {
    return json({ ok: false, error: `${team.region} is already linked to another Discord account.` }, { status: 409 });
  }
  const takeover = !claim;
  const vacated=user.team && teamKey(user.team)!==teamKey(team.region) ? user.team : '';
  let rescinds;
  try{rescinds=await rescindOffersForTeams(env,[vacated,...(takeover?[team.region]:[])]);}
  catch{return json({ok:false,error:'The coaching change could not be saved. No accounts were moved; please retry.'},{status:503});}

  if (user.team && user.team !== team.region) await deleteTeamClaim(env, user.team);
  user.team = team.region;
  user.updatedAt = Date.now();
  await env.AUTH_KV.put(userKey, JSON.stringify(user));
  await writeTeamClaim(env, team.region, discordId);
  if (rescinds.rescindedOffers) queueLeagueBackup(env, rescinds.state, waitUntil, { source: 'coach-team-change' });
  return json({ ok: true, user, rescindedOffers: rescinds.rescindedOffers });
}
