# Discord Auth Setup

RecruitHQ now expects Discord login on the hosted Cloudflare Pages site.

## Discord Developer Portal

1. Create an application at `https://discord.com/developers/applications`.
2. Open OAuth2.
3. Add this redirect:
   `https://YOUR_SITE.pages.dev/api/auth/callback`
4. Copy the Client ID and Client Secret.

## Cloudflare Pages

Add these environment variables:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
  - Example: `https://YOUR_SITE.pages.dev/api/auth/callback`
- `SESSION_SECRET`
  - Use a long random string.
- `ADMIN_DISCORD_IDS`
  - Comma-separated Discord user IDs for admins.

Add a KV namespace binding:

- Binding name: `AUTH_KV`

`AUTH_KV` stores Discord account links, team claims, imported team updates, and shared league board state. Offers will not sync across coaches until this binding exists on Cloudflare Pages.

## Admin Tools

Admins can use Settings -> Admin Mode for:

- Unlinking a Discord account from a team.
- Moving a Discord account to another team.
- Importing a future team branding update.

The UI hides admin mode unless the signed-in Discord ID is in `ADMIN_DISCORD_IDS`.
