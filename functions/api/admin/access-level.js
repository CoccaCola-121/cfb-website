import { accessLevel, canCommission, getCurrentUser, json } from '../../_lib/auth.js';

const VALID_LEVELS = new Set(['coach', 'moderator', 'commissioner']);

export async function onRequestPost({ request, env }) {
  const admin = await getCurrentUser(request, env);
  if (!admin || !canCommission(env, admin)) {
    return json({ ok: false, error: 'Commissioner access required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const discordId = String(body.discordId || '').trim();
  const nextLevel = String(body.accessLevel || '').toLowerCase().trim();
  if (!discordId) return json({ ok: false, error: 'Discord ID is required.' }, { status: 400 });
  if (!VALID_LEVELS.has(nextLevel)) return json({ ok: false, error: 'Choose coach, moderator, or commissioner.' }, { status: 400 });

  const userKey = `discord:user:${discordId}`;
  const user = await env.AUTH_KV.get(userKey, 'json');
  if (!user) return json({ ok: false, error: 'No linked account found for that Discord ID.' }, { status: 404 });

  user.accessLevel = nextLevel === 'coach' ? '' : nextLevel;
  user.updatedAt = Date.now();
  await env.AUTH_KV.put(userKey, JSON.stringify(user));

  return json({ ok: true, user: { ...user, accessLevel: accessLevel(env, user) } });
}
