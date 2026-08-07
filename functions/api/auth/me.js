import { accessLevel, canCommission, canModerate, getCurrentUser, json, readSession } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const session = await readSession(request, env);
  if (!session) return json({ authenticated: false });
  const user = await getCurrentUser(request, env);
  if (!user) return json({ authenticated: false });
  return json({
    authenticated: true,
    user: {
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: user.avatar || '',
      team: user.team || '',
      accessLevel: accessLevel(env, user),
      isAdmin: canModerate(env, user),
      isModerator: canModerate(env, user),
      isCommissioner: canCommission(env, user),
    },
  });
}
