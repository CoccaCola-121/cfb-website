function teamKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function offerType(offer) {
  const text = String((offer && offer.text) || '').toLowerCase();
  if (/\bwalk\s*-?\s*on\b|\bwo\b/.test(text)) return 'walkon';
  return 'scholarship';
}

function overallValue(prospect) {
  const match = String((prospect && prospect.rating) || '').match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function starsForRank(rank) {
  const n = Number(rank);
  if (!n) return null;
  if (n <= 25) return 5;
  if (n <= 250) return 4;
  if (n <= 500) return 3;
  if (n <= 900) return 2;
  if (n <= 1700) return 1;
  return 0;
}

function ruleMatchesProspect(rule, prospect, offer) {
  if (!rule || !prospect) return false;
  const position = String(rule.position || '').trim().toUpperCase();
  if (position && String(prospect.position || '').trim().toUpperCase() !== position) return false;

  if (rule.stars !== '' && rule.stars != null) {
    const expectedStars = Number(rule.stars);
    if (Number.isFinite(expectedStars) && starsForRank(prospect.rank) !== expectedStars) return false;
  }

  const rankLimit = Number(rule.rankValue);
  if (Number.isFinite(rankLimit) && rankLimit > 0) {
    if (rule.rankMode === 'better') {
      if (Number(prospect.rank) > rankLimit) return false;
    } else if (rule.rankMode === 'worse') {
      if (Number(prospect.rank) <= rankLimit) return false;
    }
  }

  const overallLimit = Number(rule.overallValue);
  const overall = overallValue(prospect);
  if (Number.isFinite(overallLimit) && overallLimit > 0) {
    if (overall == null) return false;
    if (rule.overallMode === 'below') {
      if (overall >= overallLimit) return false;
    } else if (overall < overallLimit) {
      return false;
    }
  }

  const scholarship = String(rule.scholarship || '').trim().toLowerCase();
  if (scholarship && (!offer || offerType(offer) !== scholarship)) return false;

  return true;
}

function normalizedRules(state) {
  return Array.isArray(state && state.conditionalRescinds) ? state.conditionalRescinds : [];
}

function activeOfferForTeam(offers, team) {
  return (offers || []).find((offer) => offer && !offer.rescinded && teamKey(offer.team) === teamKey(team)) || null;
}

export function applyConditionalRescinds(state, options = {}) {
  const prospects = state.prospects || {};
  const offersByProspect = state.offersByProspect || {};
  const now = options.now || Date.now();
  const results = [];

  normalizedRules(state).forEach((rule) => {
    if (!rule || !rule.enabled || !rule.team) return;
    const threshold = Math.max(1, Number(rule.count) || 0);
    const team = rule.team;
    const matchingCommits = Object.keys(prospects).filter((pid) => {
      const prospect = prospects[pid];
      const offer = activeOfferForTeam(offersByProspect[pid], team);
      return prospect && teamKey(prospect.commitTeam) === teamKey(team) && ruleMatchesProspect(rule, prospect, offer);
    });

    if (matchingCommits.length < threshold) return;

    let rescinded = 0;
    const prospectOnlyRule = { ...rule, scholarship: '' };
    Object.keys(offersByProspect).forEach((pid) => {
      const prospect = prospects[pid];
      if (!prospect || prospect.commitTeam || !ruleMatchesProspect(prospectOnlyRule, prospect, null)) return;
      (offersByProspect[pid] || []).forEach((offer) => {
        if (!offer || offer.rescinded || teamKey(offer.team) !== teamKey(team)) return;
        if (!ruleMatchesProspect(rule, prospect, offer)) return;
        offer.rescinded = true;
        offer.text = 'rescinded';
        offer.promises = [];
        offer.rescindedAt = now;
        offer.rescindReason = `Conditional rescind: ${rule.name || 'rule met'}`;
        offer.conditionalRescindRuleId = rule.id || '';
        rescinded++;
      });
    });

    if (rescinded) {
      rule.lastTriggeredAt = now;
      rule.lastMatchedCommitCount = matchingCommits.length;
      rule.lastRescindedCount = rescinded;
      results.push({ ruleId: rule.id || '', team, matchedCommits: matchingCommits.length, rescinded });
    }
  });

  state.offersByProspect = offersByProspect;
  state.conditionalRescinds = normalizedRules(state);
  return results;
}
