export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCommitSync(env).then((result) => {
      console.log('commit sync result', JSON.stringify(result));
    }).catch((error) => {
      console.error('commit sync failed', error && error.message ? error.message : error);
    }));
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/run') return new Response('Not found', { status: 404 });
    const result = await runCommitSync(env);
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};

async function runCommitSync(env) {
  const siteUrl = String(env.RECRUITHQ_SITE_URL || '').replace(/\/+$/, '');
  const secret = String(env.COMMIT_SYNC_SECRET || '');
  if (!siteUrl || !secret) return { ok: false, error: 'Missing RECRUITHQ_SITE_URL or COMMIT_SYNC_SECRET.' };

  const res = await fetch(`${siteUrl}/api/commits/discord`, {
    method: 'POST',
    headers: { 'x-commit-sync-secret': secret },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok, status: res.status, ...data };
}
