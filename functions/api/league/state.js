import { json } from '../../_lib/auth.js';
import { readLeagueState, writeLeagueState } from '../../_lib/league-state.js';

export async function onRequestGet({ env }) {
  const state = await readLeagueState(env);
  return json({ ok: true, state: state || null });
}

export async function onRequestPut({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const state = await writeLeagueState(env, body.state || body);
  return json({ ok: true, state });
}
