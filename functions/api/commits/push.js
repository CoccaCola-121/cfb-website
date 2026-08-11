import { json, requireEnv } from '../../_lib/auth.js';
import { readLeagueState, writeLeagueState } from '../../_lib/league-state.js';
import { applyDiscordCommits, parseDiscordCommits } from './discord.js';

function hasValidSecret(request, env) {
  const secret = String(env.COMMIT_SYNC_SECRET || '').trim();
  const provided = String(request.headers.get('x-commit-sync-secret') || '').trim();
  return !!(secret && provided && secret === provided);
}

function normalizeMessage(body) {
  const message = body.message && typeof body.message === 'object' ? body.message : body;
  return {
    id: String(message.id || body.messageId || Date.now()),
    content: String(message.content || body.content || ''),
    embeds: Array.isArray(message.embeds) ? message.embeds : [],
    timestamp: message.timestamp || body.timestamp || new Date().toISOString(),
    channel_id: message.channel_id || body.channelId || '',
    guild_id: message.guild_id || body.guildId || '',
  };
}

export async function onRequestPost({ request, env }) {
  try {
    requireEnv(env, ['AUTH_KV', 'COMMIT_SYNC_SECRET']);
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!hasValidSecret(request, env)) {
    return json({ ok: false, error: 'Commit sync secret required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const message = normalizeMessage(body);

  if (env.DISCORD_GUILD_ID && message.guild_id && String(message.guild_id) !== String(env.DISCORD_GUILD_ID)) {
    return json({ ok: false, error: 'Ignored message from another Discord guild.' }, { status: 202 });
  }
  if (env.DISCORD_COMMIT_CHANNEL_ID && message.channel_id && String(message.channel_id) !== String(env.DISCORD_COMMIT_CHANNEL_ID)) {
    return json({ ok: false, error: 'Ignored message from another Discord channel.' }, { status: 202 });
  }

  const state = await readLeagueState(env);
  if (!state || !state.prospects || !Object.keys(state.prospects).length) {
    return json({ ok: false, error: 'No class is loaded in league state yet.' }, { status: 409 });
  }

  const commits = await parseDiscordCommits(env, [message]);
  if (!commits.length) {
    return json({ ok: true, commitsFound: 0, updated: 0, unchanged: 0, unmatchedCount: 0 });
  }

  const result = applyDiscordCommits(state, commits);
  state.discordCommitChannelId = env.DISCORD_COMMIT_CHANNEL_ID || message.channel_id || '';
  await writeLeagueState(env, state);

  return json({
    ok: true,
    commitsFound: commits.length,
    updated: result.updated,
    unchanged: result.unchanged,
    unmatched: result.unmatched.slice(0, 20),
    unmatchedCount: result.unmatched.length,
  });
}
