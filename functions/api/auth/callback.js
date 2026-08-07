import {
  clearStateCookie,
  readOauthState,
  requireEnv,
  sessionCookie,
  setupErrorResponse,
  signSession,
} from '../../_lib/auth.js';

async function exchangeCode(request, env, code) {
  const url = new URL(request.url);
  const redirectUri = env.DISCORD_REDIRECT_URI || new URL('/api/auth/callback', url.origin).href;
  const body = new URLSearchParams();
  body.set('client_id', env.DISCORD_CLIENT_ID);
  body.set('client_secret', env.DISCORD_CLIENT_SECRET);
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) throw new Error('Discord token exchange failed.');
  return tokenRes.json();
}

async function fetchDiscordUser(token) {
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw new Error('Could not read Discord user.');
  return userRes.json();
}

export async function onRequestGet({ request, env }) {
  try {
    requireEnv(env, ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET', 'AUTH_KV']);
  } catch (error) {
    return setupErrorResponse(error);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  if (error === 'consent_required' || error === 'interaction_required') {
    return new Response(null, {
      status: 302,
      headers: { location: '/api/auth/discord?consent=1' },
    });
  }
  const cookieState = readOauthState(request);
  if (!code || !state || !cookieState || state !== cookieState) {
    return new Response('Discord login could not be verified.', { status: 400 });
  }

  try {
    const token = await exchangeCode(request, env, code);
    const discord = await fetchDiscordUser(token.access_token);
    const key = `discord:user:${discord.id}`;
    const existing = await env.AUTH_KV.get(key, 'json');
    const user = {
      discordId: discord.id,
      username: discord.global_name || discord.username,
      displayName: discord.global_name || discord.username,
      avatar: discord.avatar || '',
      team: existing && existing.team ? existing.team : '',
      createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    await env.AUTH_KV.put(key, JSON.stringify(user));
    const session = await signSession(env, {
      discordId: user.discordId,
      username: user.username,
    });
    const headers = new Headers({ location: '/' });
    headers.append('set-cookie', sessionCookie(session));
    headers.append('set-cookie', clearStateCookie());
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    return new Response(error.message || 'Discord login failed.', {
      status: 500,
      headers: { 'set-cookie': clearStateCookie() },
    });
  }
}
