import '../../../transfer-rules.js';
import '../../../offer-amendments.js';
import '../../../offer-window.js';
import '../../../cpr-rules.js';
import '../../../walkon-limit.js';
import '../../../auto-commits.js';
import { json } from '../../_lib/auth.js';
import { queueLeagueBackup } from '../../_lib/backup.js';
import { readLeagueState, writeLeagueState } from '../../_lib/league-state.js';

export async function onRequestGet({ env }) {
  try { const state = await readLeagueState(env); return json({ ok: true, state: state || null }); }
  catch { return json({ok:false,error:'The board is temporarily busy. Please retry shortly.'},{status:503}); }
}

export async function onRequestPut({ request, env, waitUntil }) {
 try {
  const body = await request.json().catch(() => ({}));
  const incoming = body.state || body;
  const previous = await readLeagueState(env);
  if (Object.prototype.hasOwnProperty.call(body,'expectedUpdatedAt') && (previous && previous.updatedAt || null) !== body.expectedUpdatedAt) return json({ok:false,error:'The league changed before saving. Your draft is intact; try Save again.'},{status:409});
  // Preserve new settings when an older open browser tab submits its existing payload.
  for (const field of ['scholarshipCapacity','bucksRemaining']) {
    if (!Object.prototype.hasOwnProperty.call(incoming,field) && previous && Object.prototype.hasOwnProperty.call(previous,field)) incoming[field]=previous[field];
  }
  if (incoming.recruitingStage === 'cpr') {
    const roster = incoming.fullRoster || [];
    const leaders = globalThis.NZCFLCprRules.leaders(roster);
    const matchPlayer = globalThis.NZCFLCprRules.createMatcher(roster);
    for (const [id,p] of Object.entries(incoming.prospects || {})) {
      try {
        const row = matchPlayer(p);
        if (id !== 'r' + row.rank) throw Error('Player ID must match the uploaded CSV.');
        p.offerMode = leaders[row.position] === row ? 'pitch' : 'values';
      } catch(error) { return json({ok:false,error:error.message},{status:400}); }
    }
  }
  const capacityError = globalThis.NZCFLAutoCommits.validate(incoming);
  if (capacityError) return json({ok:false,error:capacityError},{status:400});
  const scheduleError = globalThis.NZCFLOfferWindow.validate(incoming.offerSchedule);
  if (scheduleError) return json({ok:false,error:scheduleError},{status:400});
  for (const [pid, offers] of Object.entries(incoming.offersByProspect || {})) {
    const prospect = (incoming.prospects || {})[pid];
    for (const offer of (Array.isArray(offers) ? offers : [])) {
      const old = ((previous && previous.offersByProspect || {})[pid] || []).find(item => item.id === offer.id);
      if (!old && !offer.rescinded && previous && globalThis.NZCFLOfferWindow.locked(previous)) return json({ok:false,error:'Offers are locked.'},{status:403});
      if (!old && !offer.rescinded) {
        const capError = globalThis.NZCFLWalkonLimit.error(incoming, prospect, offer);
        if (capError) return json({ok:false,error:capError},{status:400});
      }
      if (old && incoming.recruitingStage !== 'hs') {
        if (old.text !== offer.text && !globalThis.NZCFLOfferAmendments.allowed(old.text,offer.text,old.team,prospect)) return json({ok:false,error:'Only adding an offer header or upgrading a walk-on to scholarship is allowed. Pitch text cannot be edited.'},{status:400});
        if (old.offerType === 'scholarship') offer.offerType='scholarship';
      }
      if (old && old.text === offer.text) continue;
      const error = globalThis.NZCFLTransferRules.pitchLimitError(offer.text, prospect, incoming.recruitingStage);
      if (error) return json({ ok: false, error }, { status: 400 });
    }
  }
  for (const item of (incoming.unmatched || [])) {
    const old = (previous && previous.unmatched || []).find(old => old.id === item.id);
    if (!old && previous && globalThis.NZCFLOfferWindow.locked(previous)) return json({ok:false,error:'Offers are locked.'},{status:403});
    if (old && old.offerText === item.offerText) continue;
    const error = globalThis.NZCFLTransferRules.pitchLimitError(item.offerText, null, incoming.recruitingStage);
    if (error) return json({ ok: false, error }, { status: 400 });
  }
  const state = await writeLeagueState(env, incoming);
  queueLeagueBackup(env, state, waitUntil, { source: 'league-state-save' });
  return json({ ok: true, state });
 }catch(error){ return json({ok:false,error:'The board could not save yet. Your draft is preserved; please retry shortly.'},{status:503}); }
}
