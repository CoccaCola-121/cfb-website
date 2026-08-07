const SESSION_COOKIE = 'nzcfl_session';
const STATE_COOKIE = 'nzcfl_oauth_state';

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeJson(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeJson(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(padded))));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export async function signSession(env, payload) {
  const body = encodeJson({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}

export async function readSession(request, env) {
  const value = parseCookies(request)[SESSION_COOKIE];
  if (!value || !env.SESSION_SECRET) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(env.SESSION_SECRET, body);
  if (sig !== expected) return null;
  const session = decodeJson(body);
  if (!session.exp || session.exp < Date.now()) return null;
  return session;
}

export function sessionCookie(value) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function stateCookie(value) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
}

export function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readOauthState(request) {
  return parseCookies(request)[STATE_COOKIE] || '';
}

export function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing environment: ${missing.join(', ')}`);
}

export async function getCurrentUser(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.discordId || !env.AUTH_KV) return null;
  const user = await env.AUTH_KV.get(`discord:user:${session.discordId}`, 'json');
  if (!user) return null;
  return user;
}

export function isAdmin(env, discordId) {
  return String(env.ADMIN_DISCORD_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(String(discordId || ''));
}
