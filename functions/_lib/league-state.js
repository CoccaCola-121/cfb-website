export const STATE_KEY = 'league:state';

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
  'discordCommitUpdatedAt',
  'discordCommitChannelId',
  'defaultClassLoaded',
  'offersLocked',
  'dangerApprovals',
  'conditionalRescinds',
];

export function sanitizeState(input) {
  const state = {};
  STATE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) state[field] = input[field];
  });
  state.updatedAt = Date.now();
  return state;
}

export async function readLeagueState(env) {
  return (await env.AUTH_KV.get(STATE_KEY, 'json')) || null;
}

export async function writeLeagueState(env, state) {
  const clean = sanitizeState(state || {});
  await env.AUTH_KV.put(STATE_KEY, JSON.stringify(clean));
  return clean;
}
