import '../../../transfer-rules.js';
import '../../../offer-window.js';
import { json } from '../../_lib/auth.js';
import { queueLeagueBackup } from '../../_lib/backup.js';
import { readLeagueState, writeLeagueState } from '../../_lib/league-state.js';

export async function onRequestGet({ env }) {
  const state = await readLeagueState(env);
  return json({ ok: true, state: state || null });
}

export async function onRequestPut({ request, env, waitUntil }) {
  const body = await request.json().catch(() => ({}));
  const incoming = body.state || body;
  const previous = await readLeagueState(env);
  if (Object.prototype.hasOwnProperty.call(body,'expectedUpdatedAt') && (previous && previous.updatedAt || null) !== body.expectedUpdatedAt) return json({ok:false,error:'The league changed before saving. Your draft is intact; try Save again.'},{status:409});
  const scheduleError = globalThis.NZCFLOfferWindow.validate(incoming.offerSchedule);
  if (scheduleError) return json({ok:false,error:scheduleError},{status:400});
  for (const [pid, offers] of Object.entries(incoming.offersByProspect || {})) {
    const prospect = (incoming.prospects || {})[pid];
    for (const offer of (Array.isArray(offers) ? offers : [])) {
      const old = ((previous && previous.offersByProspect || {})[pid] || []).find(item => item.id === offer.id);
      if (!old && !offer.rescinded && previous && globalThis.NZCFLOfferWindow.locked(previous)) return json({ok:false,error:'Offers are locked.'},{status:403});
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
}
