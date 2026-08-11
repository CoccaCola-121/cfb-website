# Discord Commit Tracking

RecruitHQ can pull commits from the official Discord commitment channel.

Recommended live setup: use the existing Railway Discord bot to push commitment messages to RecruitHQ as soon as they appear.

The Settings button still runs a manual Discord history scan if `DISCORD_BOT_TOKEN` is configured on Cloudflare. The Cron Worker is now optional fallback behavior, not the preferred live route.

## Cloudflare Pages Variables

Add these under Cloudflare Pages > your project > Settings > Environment variables.
Add them to Production. Add them to Preview too if you test preview deployments.

| Name | Type | Value |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Secret | Bot token from the Discord Developer Portal |
| `DISCORD_GUILD_ID` | Plaintext | Server ID |
| `DISCORD_COMMIT_CHANNEL_ID` | Plaintext | Commitment channel ID |
| `COMMIT_SYNC_SECRET` | Secret | Any long random password you create |
| `DISCORD_COMMIT_MESSAGE_LIMIT` | Plaintext, optional | Defaults to `1000`; max supported by RecruitHQ is `5000` |

After saving variables, redeploy the site.

For the Railway bot push setup, only `COMMIT_SYNC_SECRET` is required. `DISCORD_GUILD_ID` and `DISCORD_COMMIT_CHANNEL_ID` are strongly recommended because they let RecruitHQ reject messages from the wrong server/channel.

## Live Railway Bot Push

Add these Railway variables to the existing bot:

| Name | Value |
| --- | --- |
| `RECRUITHQ_SITE_URL` | `https://cfb-website.pages.dev` or your custom domain |
| `RECRUITHQ_COMMIT_SECRET` | Same exact value as the Pages `COMMIT_SYNC_SECRET` |
| `DISCORD_COMMIT_CHANNEL_ID` | Commitment channel ID |

Then add this listener to the bot:

```js
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (String(message.channelId) !== String(process.env.DISCORD_COMMIT_CHANNEL_ID)) return;

  const res = await fetch(`${process.env.RECRUITHQ_SITE_URL}/api/commits/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-commit-sync-secret': process.env.RECRUITHQ_COMMIT_SECRET,
    },
    body: JSON.stringify({
      message: {
        id: message.id,
        content: message.content,
        embeds: message.embeds?.map((embed) => embed.toJSON ? embed.toJSON() : embed) || [],
        timestamp: message.createdAt?.toISOString(),
        channel_id: message.channelId,
        guild_id: message.guildId,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  console.log('RecruitHQ commit push', data);
});
```

If the commitment bot edits messages after posting, add this too:

```js
client.on('messageUpdate', async (_oldMessage, newMessage) => {
  if (newMessage.partial) newMessage = await newMessage.fetch();
  client.emit('messageCreate', newMessage);
});
```

## Optional Near-Live Cron Worker

Cloudflare Pages Functions do not sit connected to Discord all day. The free-friendly version is a Cloudflare Worker Cron Trigger that calls RecruitHQ every minute.

Create a separate Worker in Cloudflare using `workers/commit-sync-cron.js`.

Add these Worker variables:

| Name | Type | Value |
| --- | --- | --- |
| `RECRUITHQ_SITE_URL` | Plaintext | `https://cfb-website.pages.dev` or your custom domain |
| `COMMIT_SYNC_SECRET` | Secret | Same exact value as the Pages `COMMIT_SYNC_SECRET` |

Then add a Cron Trigger:

```text
* * * * *
```

That runs once per minute. The site already polls league state while open, so users should see new commits shortly after the Cron run.

## Discord Bot Permissions

The bot must be in the server and able to read the commitment channel:

- View Channel
- Read Message History

It does not need to send messages.

## Message Formats Parsed

RecruitHQ only reads lines that look like commitment posts:

- `#142 Jeff Nixon (OL) commits to @Northwestern`
- `#1510 Darrien Marshall commits to Miami (WO)`
- Multiple commits in one message, one per line

Other recruiting-start/end messages are ignored because they do not match the commit format.
