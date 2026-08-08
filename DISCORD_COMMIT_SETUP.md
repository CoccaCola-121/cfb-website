# Discord Commit Tracking

RecruitHQ can pull commits from the official Discord commitment channel.

The button in Settings runs the sync manually. For near-live updates, add the small Cloudflare Cron Worker below so commits are pulled automatically.

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

## Near-Live Cron Worker

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
