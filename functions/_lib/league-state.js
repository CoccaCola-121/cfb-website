import {applyRemovedPlayers} from './removed-players.js';
import {readTransactionalState,initializeTransactionalState,writeTransactionalState} from './transactional-state.js';
import '../../cpr-rules.js';
import '../../walkon-limit.js';
import '../../transfer-rules.js';
import { teamKey } from './teams-util.js';

export const STATE_KEY = 'league:state';

const STATE_FIELDS = [
  'removedPlayers',
  'fullRoster',
  'scholarshipHistory',
  'scholarshipSource',
  'scholarshipCapacity',
  'bucksRemaining',
  'recruitingStage',
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
  'commitSeasonEnded',
  'defaultClassLoaded',
  'offersLocked',
  'offerSchedule',
  'dangerApprovals',
  'conditionalRescinds',
  'manualCommitOverrides',
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
  let state;
  if(env.LEAGUE_DB){
    state=await readTransactionalState(env.LEAGUE_DB);
    if(!state){
      const legacy=await env.AUTH_KV.get(STATE_KEY,'json');
      if(legacy)state=await initializeTransactionalState(env.LEAGUE_DB,legacy);
    }
  } else state=(await env.AUTH_KV.get(STATE_KEY,'json')) || null;
  return state ? globalThis.NZCFLTransferRules.cleanCommitOverrides(state) : null;
}

export async function writeLeagueState(env, state, previous = state) {
  applyRemovedPlayers(state);
  globalThis.NZCFLWalkonLimit.apply(state);
  const clean = sanitizeState(globalThis.NZCFLTransferRules.cleanCommitOverrides(state || {}));
  if(env.LEAGUE_DB)return writeTransactionalState(env.LEAGUE_DB,clean,previous);
  await env.AUTH_KV.put(STATE_KEY, JSON.stringify(clean));
  return clean;
}

export async function purgeOffersForTeam(env, teamName) {
  const targetKey = teamKey(teamName);
  if (!targetKey) return { state: null, purgedOffers: 0 };
  const state = await readLeagueState(env);
  if (!state || !state.offersByProspect) return { state, purgedOffers: 0 };
  const nextOffers = {};
  let purgedOffers = 0;
  Object.keys(state.offersByProspect || {}).forEach((pid) => {
    const offers = Array.isArray(state.offersByProspect[pid]) ? state.offersByProspect[pid] : [];
    const kept = offers.filter((offer) => {
      const purge = offer && teamKey(offer.team) === targetKey;
      if (purge) purgedOffers++;
      return !purge;
    });
    if (kept.length) nextOffers[pid] = kept;
  });
  if (!purgedOffers) return { state, purgedOffers: 0 };
  const clean = await writeLeagueState(env, {
    ...state,
    offersByProspect: nextOffers,
    teamOfferPurgedAt: Date.now(),
  },state);
  return { state: clean, purgedOffers };
}
