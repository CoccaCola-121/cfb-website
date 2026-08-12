import { canModerate, getCurrentUser, json } from '../../_lib/auth.js';
import { readBackupStatus, runLeagueBackup } from '../../_lib/backup.js';
import { readLeagueState } from '../../_lib/league-state.js';

async function requireModerator(request, env) {
  const user = await getCurrentUser(request, env);
  return user && canModerate(env, user);
}

export async function onRequestGet({ request, env }) {
  if (!(await requireModerator(request, env))) {
    return json({ ok: false, error: 'Moderator access required.' }, { status: 403 });
  }
  return json({ ok: true, backup: await readBackupStatus(env) });
}

export async function onRequestPost({ request, env }) {
  if (!(await requireModerator(request, env))) {
    return json({ ok: false, error: 'Moderator access required.' }, { status: 403 });
  }
  const state = await readLeagueState(env);
  if (!state || !state.prospects || !Object.keys(state.prospects).length) {
    return json({ ok: false, error: 'No league state is loaded yet.' }, { status: 409 });
  }
  const result = await runLeagueBackup(env, state, { force: true, source: 'manual-backup' });
  return json({ ok: !!result.ok, backup: result }, { status: result.ok ? 200 : 500 });
}
