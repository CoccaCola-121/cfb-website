import { randomState, requireEnv, setupErrorResponse, stateCookie } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  try {
    requireEnv(env, ['DISCORD_CLIENT_ID', 'SESSION_SECRET']);
    const url = new URL(request.url);
    const redirectUri = env.DISCORD_REDIRECT_URI || new URL('/api/auth/callback', url.origin).href;
    const state = randomState();
    const discord = new URL('https://discord.com/oauth2/authorize');
    discord.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
    discord.searchParams.set('redirect_uri', redirectUri);
    discord.searchParams.set('response_type', 'code');
    discord.searchParams.set('scope', 'identify');
    discord.searchParams.set('state', state);
    return new Response(null, {
      status: 302,
      headers: {
        location: discord.toString(),
        'set-cookie': stateCookie(state),
      },
    });
  } catch (error) {
    return setupErrorResponse(error);
  }
}
