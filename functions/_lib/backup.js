export const BACKUP_STATUS_KEY = 'backup:latest';

function configured(env) {
  return !!(env && env.BACKUP_GITHUB_TOKEN && env.BACKUP_GITHUB_REPO);
}

function backupBasePath(env) {
  return String(env.BACKUP_GITHUB_PATH || 'backups/recruithq-latest')
    .trim()
    .replace(/^\/+|\/+$/g, '') || 'backups/recruithq-latest';
}

function backupBranch(env) {
  return String(env.BACKUP_GITHUB_BRANCH || 'main').trim() || 'main';
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function firstNumber(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : '';
}

function offerType(offer) {
  const text = String((offer && offer.text) || '').toLowerCase();
  if (/\bwalk\s*-?\s*on\b|\bwo\b/.test(text)) return 'walk-on';
  return 'scholarship';
}

function normalizeVisits(visits) {
  visits = visits && typeof visits === 'object' ? visits : {};
  return {
    coach: !!visits.coach,
    campus: !!visits.campus,
    campusLabel: String(visits.campusLabel || '').trim(),
  };
}

function promiseRows(offer) {
  const promises = Array.isArray(offer && offer.promises) ? offer.promises : [];
  return promises.slice(0, 3).map((promise) => ({
    title: String((promise && (promise.title || promise.category)) || '').trim(),
    text: String((promise && promise.text) || promise || '').trim(),
  }));
}

export function buildOffersCsv(state, now = new Date()) {
  const headers = [
    'exported_at',
    'prospect_id',
    'rank',
    'name',
    'position',
    'overall',
    'potential',
    'hometown',
    'legacy_school',
    'commit_team',
    'offer_team',
    'status',
    'offer_type',
    'coach_visit',
    'campus_visit',
    'campus_visit_label',
    'rescinded_at',
    'rescind_reason',
    'promise_1_title',
    'promise_1',
    'promise_2_title',
    'promise_2',
    'promise_3_title',
    'promise_3',
    'offer_text',
  ];
  const rows = [headers];
  const prospects = state.prospects || {};
  const offersByProspect = state.offersByProspect || {};
  Object.keys(offersByProspect).forEach((pid) => {
    const prospect = prospects[pid] || {};
    (offersByProspect[pid] || []).forEach((offer) => {
      if (!offer) return;
      const visits = normalizeVisits(offer.visits);
      const promises = promiseRows(offer);
      const status = offer.rescinded ? 'rescinded' : (prospect.commitTeam ? 'committed' : 'active');
      rows.push([
        now.toISOString(),
        pid,
        prospect.rank || '',
        prospect.name || '',
        prospect.position || '',
        firstNumber(prospect.rating),
        String(prospect.rating || '').split('/')[1] || '',
        prospect.hometown || '',
        prospect.legacySchool || '',
        prospect.commitTeam || '',
        offer.team || '',
        status,
        offerType(offer),
        visits.coach ? 'yes' : '',
        visits.campus ? 'yes' : '',
        visits.campusLabel,
        offer.rescindedAt ? new Date(offer.rescindedAt).toISOString() : '',
        offer.rescindReason || '',
        promises[0] ? promises[0].title : '',
        promises[0] ? promises[0].text : '',
        promises[1] ? promises[1].title : '',
        promises[1] ? promises[1].text : '',
        promises[2] ? promises[2].title : '',
        promises[2] ? promises[2].text : '',
        offer.text || '',
      ]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function toBase64(text) {
  let binary = '';
  new Uint8Array(new TextEncoder().encode(text)).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function githubRequest(env, path, init = {}) {
  const { query = '', ...fetchInit } = init;
  const res = await fetch(`https://api.github.com/repos/${env.BACKUP_GITHUB_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}${query}`, {
    ...fetchInit,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.BACKUP_GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'nzcfl-recruithq-backup',
      ...(fetchInit.headers || {}),
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub backup failed (${res.status}) for ${path}: ${text.slice(0, 240)}`);
  }
  return res;
}

async function putGithubFile(env, path, content, message) {
  const branch = backupBranch(env);
  const getRes = await githubRequest(env, path, { method: 'GET', query: `?ref=${encodeURIComponent(branch)}` });
  let sha = '';
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha || '';
  }
  const body = {
    message,
    branch,
    content: toBase64(content),
    ...(sha ? { sha } : {}),
  };
  const putRes = await githubRequest(env, path, { method: 'PUT', body: JSON.stringify(body) });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    throw new Error(`GitHub backup failed (${putRes.status}) for ${path}: ${text.slice(0, 240)}`);
  }
  return putRes.json();
}

async function writeBackupStatus(env, status) {
  if (!env.AUTH_KV) return status;
  await env.AUTH_KV.put(BACKUP_STATUS_KEY, JSON.stringify({ ...status, checkedAt: Date.now() }));
  return status;
}

export async function readBackupStatus(env) {
  const status = env.AUTH_KV ? await env.AUTH_KV.get(BACKUP_STATUS_KEY, 'json') : null;
  return {
    configured: configured(env),
    repo: env.BACKUP_GITHUB_REPO || '',
    branch: backupBranch(env),
    path: backupBasePath(env),
    ...(status || {}),
  };
}

export async function runLeagueBackup(env, state, options = {}) {
  if (!configured(env)) {
    return writeBackupStatus(env, {
      configured: false,
      ok: false,
      skipped: true,
      error: 'GitHub backup is not configured.',
    });
  }

  const now = new Date();
  const prior = env.AUTH_KV ? await env.AUTH_KV.get(BACKUP_STATUS_KEY, 'json') : null;
  const minSeconds = Math.max(0, Number(env.BACKUP_MIN_INTERVAL_SECONDS || 60) || 0);
  if (!options.force && prior && prior.ok && prior.completedAt && Date.now() - Number(prior.completedAt) < minSeconds * 1000) {
    return { ...prior, configured: true, skipped: true };
  }

  const base = backupBasePath(env);
  const jsonPath = `${base}.json`;
  const csvPath = `${base}.csv`;
  const snapshot = {
    exportedAt: now.toISOString(),
    source: options.source || 'league-state-save',
    state,
  };
  const jsonText = JSON.stringify(snapshot, null, 2);
  const csvText = buildOffersCsv(state, now);
  const message = `Update RecruitHQ backup (${now.toISOString()})`;

  try {
    await putGithubFile(env, jsonPath, jsonText, message);
    await putGithubFile(env, csvPath, csvText, message);
    return writeBackupStatus(env, {
      configured: true,
      ok: true,
      skipped: false,
      completedAt: Date.now(),
      exportedAt: now.toISOString(),
      repo: env.BACKUP_GITHUB_REPO,
      branch: backupBranch(env),
      jsonPath,
      csvPath,
      source: options.source || 'league-state-save',
      offerRows: Math.max(0, csvText.split('\n').length - 1),
    });
  } catch (error) {
    return writeBackupStatus(env, {
      configured: true,
      ok: false,
      skipped: false,
      completedAt: Date.now(),
      repo: env.BACKUP_GITHUB_REPO,
      branch: backupBranch(env),
      jsonPath,
      csvPath,
      error: error.message || 'Backup failed.',
      source: options.source || 'league-state-save',
    });
  }
}

export function queueLeagueBackup(env, state, waitUntil, options = {}) {
  const task = runLeagueBackup(env, state, options);
  if (waitUntil) waitUntil(task);
  return task.catch(() => null);
}
