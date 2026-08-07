import { getCurrentUser, isAdmin, json } from '../../_lib/auth.js';

function cleanTeam(team) {
  if (!team || !team.region) return null;
  return {
    region: String(team.region || '').trim(),
    nickname: String(team.nickname || team.name || '').trim(),
    abbrev: String(team.abbrev || '').trim(),
    displayName: String(team.displayName || `${team.region || ''}${team.nickname || team.name ? ` ${team.nickname || team.name}` : ''}`).trim(),
    primary: String(team.primary || (Array.isArray(team.colors) ? team.colors[0] : '') || '').trim(),
    secondary: String(team.secondary || (Array.isArray(team.colors) ? (team.colors[1] || team.colors[2]) : '') || '').trim(),
    logoUrl: String(team.logoUrl || team.imgURL || '').trim(),
  };
}

export async function onRequestPost({ request, env }) {
  const admin = await getCurrentUser(request, env);
  if (!admin || !isAdmin(env, admin.discordId)) {
    return json({ ok: false, error: 'Admin access required.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const teams = (Array.isArray(body.teams) ? body.teams : [])
    .map(cleanTeam)
    .filter(Boolean);
  if (!teams.length) return json({ ok: false, error: 'No teams found in that update.' }, { status: 400 });
  await env.AUTH_KV.put('teams:extra', JSON.stringify(teams));
  return json({ ok: true, count: teams.length });
}
