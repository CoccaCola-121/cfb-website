import {applyConditionalRescinds} from './conditional-rescinds.js';
import {applyRemovedPlayers} from './removed-players.js';
import {readTransactionalState,initializeTransactionalState,writeTransactionalState} from './transactional-state.js';
import {repairHsCapacity} from './hs-capacity-repair.js';
import {refundWashingtonStateCampusVisits} from './washington-state-visit-refund.js';
import '../../cpr-rules.js';
import '../../walkon-limit.js';
import '../../transfer-rules.js';
import { teamKey } from './teams-util.js';

export const STATE_KEY = 'league:state';

const STATE_FIELDS = [
  'watchlistCycleId',
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
  'currentWeek',
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
    // Apply exact, approved HS data corrections once, using the same CAS protection
    // as offer saves. Re-read to retain storageSnapshot for the caller's next save.
    for(let attempt=0;attempt<3;attempt++){
      const repaired=repairHsCapacity(state) || refundWashingtonStateCampusVisits(state);
      if(!repaired)break;
      try{await writeTransactionalState(env.LEAGUE_DB,repaired,state);}
      catch(error){if(error.status!==409 || attempt===2)throw error;}
      state=await readTransactionalState(env.LEAGUE_DB);
    }
  } else state=(await env.AUTH_KV.get(STATE_KEY,'json')) || null;
  return state ? globalThis.NZCFLTransferRules.cleanCommitOverrides(state) : null;
}

export async function writeLeagueState(env, state, previous = state) {
  applyRemovedPlayers(state);
  globalThis.NZCFLWalkonLimit.apply(state);
  applyConditionalRescinds(state);
  globalThis.NZCFLAutoCommits.applyScholarshipCap(state);
  const clean = sanitizeState(globalThis.NZCFLTransferRules.cleanCommitOverrides(state || {}));
  if(env.LEAGUE_DB)return writeTransactionalState(env.LEAGUE_DB,clean,previous);
  await env.AUTH_KV.put(STATE_KEY, JSON.stringify(clean));
  return clean;
}

export async function rescindOffersForTeams(env, teamNames) {
  const targets = new Set(teamNames.map(teamKey).filter(Boolean));
  if (!targets.size) return { state: null, rescindedOffers: 0 };
  for(let attempt=0;attempt<16;attempt++){
    const state = await readLeagueState(env);
    if (!state) return { state, rescindedOffers: 0 };
    let rescindedOffers = 0;
    const now=Date.now();
    for(const [pid,offers] of Object.entries(state.offersByProspect || {})){
      const prospect=state.prospects?.[pid];
      // Preserve the full record for all commits, including commits to another
      // school. Recheck after conflicts so a concurrent commitment stays safe.
      if(!prospect || prospect.commitTeam)continue;
      for(const offer of offers){
        if(!offer || offer.rescinded || !targets.has(teamKey(offer.team)) || globalThis.NZCFLAutoCommits.invalidOffer(state,prospect,offer))continue;
        offer.rescinded=true;offer.rescindedAt=now;offer.rescindReason='Rescinded after coaching change.';
        rescindedOffers++;
      }
    }
    if(!rescindedOffers)return {state,rescindedOffers:0};
    try{return {state:await writeLeagueState(env,state),rescindedOffers};}
    catch(error){
      if(error.status!==409 || attempt===15)throw error;
      await new Promise(resolve=>setTimeout(resolve,40+Math.random()*180));
    }
  }
}
