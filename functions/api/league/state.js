import { json } from '../../_lib/auth.js';

const STATE_KEY = 'league:state';
const STATE_FIELDS = [
  'fullRoster',
  'released',
  'wave1Released',
  'wave2Released',
  'prospects',
  'threads',
  'offersByProspect',
  'unmatched',
  'teams',
  'teamBranding',
  'commitSheetUrl',
  'commitUpdatedAt',
  'defaultClassLoaded',
  'offersLocked',
];

function sanitizeState(input) {
  const state = {};
  STATE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) state[field] = input[field];
  });
  state.updatedAt = Date.now();
  return state;
}

export async function onRequestGet({ env }) {
  const state = await env.AUTH_KV.get(STATE_KEY, 'json');
  return json({ ok: true, state: state || null });
}

export async function onRequestPut({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const state = sanitizeState(body.state || body);
  await env.AUTH_KV.put(STATE_KEY, JSON.stringify(state));
  return json({ ok: true, state });
}
