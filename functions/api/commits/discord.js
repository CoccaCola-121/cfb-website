import { canModerate, getCurrentUser, json, requireEnv } from '../../_lib/auth.js';
import { applyConditionalRescinds } from '../../_lib/conditional-rescinds.js';
import { readLeagueState, writeLeagueState } from '../../_lib/league-state.js';
import { TEAM_ROLE_ALIASES, TEAM_ROLE_IDS } from '../../_lib/team-role-map.js';
import { findTeam } from '../../_lib/teams-util.js';

function cleanTeamText(value) {
  return String(value || '')
    .replace(/\(WO\)/gi, '')
    .replace(/\(edited\)/gi, '')
    .replace(/^@/, '')
    .trim();
}

function messageText(message) {
  const parts = [message.content || ''];
  (message.embeds || []).forEach((embed) => {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    (embed.fields || []).forEach((field) => {
      if (field.name) parts.push(field.name);
      if (field.value) parts.push(field.value);
    });
  });
  return parts.join('\n');
}

async function resolveTeam(env, rawTeam) {
  const roleMatch = String(rawTeam || '').match(/<@&(\d+)>/);
  if (roleMatch && TEAM_ROLE_IDS[roleMatch[1]]) return TEAM_ROLE_IDS[roleMatch[1]];

  const text = cleanTeamText(String(rawTeam || '').replace(/<@&\d+>/g, ''));
  if (!text) return '';

  const directAlias = TEAM_ROLE_ALIASES[text] || TEAM_ROLE_ALIASES[text.toUpperCase()];
  if (directAlias) return directAlias;

  const team = await findTeam(env, text);
  return team ? team.region : text;
}

async function parseCommitLine(env, line) {
  const match = String(line || '').match(/#\s*(\d+)\s+(.+?)\s+(?:\([^)]+\)\s+)?commits\s+to\s+(.+)$/i);
  if (!match) return null;
  const rank = Number(match[1]);
  const team = await resolveTeam(env, match[3]);
  if (!rank || !team) return null;
  return {
    rank,
    prospectId: `r${rank}`,
    name: match[2].trim(),
    team,
    sourceLine: String(line || '').trim(),
  };
}

export async function parseDiscordCommits(env, messages) {
  const commits = [];
  for (const message of messages) {
    const lines = messageText(message).split(/\n+/);
    for (const line of lines) {
      const commit = await parseCommitLine(env, line);
      if (commit) commits.push({ ...commit, messageId: message.id, timestamp: message.timestamp });
    }
  }
  return commits;
}

async function fetchDiscordMessages(env) {
  const channelId = env.DISCORD_COMMIT_CHANNEL_ID;
  const limit = Math.max(100, Math.min(Number(env.DISCORD_COMMIT_MESSAGE_LIMIT || 1000), 5000));
  const messages = [];
  let before = '';

  const channelRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!channelRes.ok) throw new Error(`Discord channel check failed (${channelRes.status}).`);
  const channel = await channelRes.json();
  if (String(channel.guild_id || '') !== String(env.DISCORD_GUILD_ID || '')) {
    throw new Error('Configured commit channel is not in the configured Discord guild.');
  }

  while (messages.length < limit) {
    const batchLimit = Math.min(100, limit - messages.length);
    const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
    url.searchParams.set('limit', String(batchLimit));
    if (before) url.searchParams.set('before', before);

    const res = await fetch(url.href, {
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Discord message fetch failed (${res.status}). ${text.slice(0, 180)}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    messages.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < batchLimit) break;
  }

  return messages;
}

export function applyDiscordCommits(state, commits) {
  const prospects = state.prospects || {};
  let updated = 0;
  let unchanged = 0;
  const unmatched = [];
  const seen = new Set();

  commits.forEach((commit) => {
    if (seen.has(commit.prospectId)) return;
    seen.add(commit.prospectId);
    const prospect = prospects[commit.prospectId];
    if (!prospect) {
      unmatched.push(commit);
      return;
    }
    if (prospect.commitTeam === commit.team) {
      unchanged++;
      return;
    }
    prospect.commitTeam = commit.team;
    updated++;
  });

  const conditionalRescinds = applyConditionalRescinds(state);
  state.prospects = prospects;
  state.commitUpdatedAt = Date.now();
  state.discordCommitUpdatedAt = state.commitUpdatedAt;
  state.discordCommitChannelId = state.discordCommitChannelId || '';
  return { updated, unchanged, unmatched, conditionalRescinds };
}

async function canRunCommitSync(request, env) {
  const secret = String(env.COMMIT_SYNC_SECRET || '').trim();
  const provided = String(request.headers.get('x-commit-sync-secret') || '').trim();
  if (secret && provided && secret === provided) return true;

  const user = await getCurrentUser(request, env);
  return canModerate(env, user);
}

export async function onRequestPost({ request, env }) {
  try {
    requireEnv(env, ['AUTH_KV', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_COMMIT_CHANNEL_ID']);
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!(await canRunCommitSync(request, env))) {
    return json({ ok: false, error: 'Moderator, commissioner, or commit sync secret required.' }, { status: 403 });
  }

  const state = await readLeagueState(env);
  if (!state || !state.prospects || !Object.keys(state.prospects).length) {
    return json({ ok: false, error: 'No class is loaded in league state yet.' }, { status: 409 });
  }

  try {
    const messages = await fetchDiscordMessages(env);
    const commits = await parseDiscordCommits(env, messages);
    const result = applyDiscordCommits(state, commits);
    state.discordCommitChannelId = env.DISCORD_COMMIT_CHANNEL_ID || '';
    await writeLeagueState(env, state);
    return json({
      ok: true,
      messagesRead: messages.length,
      commitsFound: commits.length,
      updated: result.updated,
      unchanged: result.unchanged,
      unmatched: result.unmatched.slice(0, 20),
      unmatchedCount: result.unmatched.length,
      conditionalRescinds: result.conditionalRescinds || [],
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Could not update commits from Discord.' }, { status: 500 });
  }
}
