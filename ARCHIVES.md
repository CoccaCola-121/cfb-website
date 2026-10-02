# Recruiting archives

Uses the existing `LEAGUE_DB` D1 binding. No additional Cloudflare service, secret, bucket, or subscription is required. The first commissioner archive action creates the two archive tables automatically.

After deployment, open Settings → Commit Tracking → Cycle archive → Archive current cycle. Archive the completed cycle again to capture final results. View public history at `/archives.html`. The normal confirmed reset flow archives first and stops if archiving fails; direct CSV replacement is not automatically archived, so archive before uploading a replacement roster.

The roster must include its season. Each season has separate HS, transfer, and CPR snapshots. Archiving the same cycle replaces its snapshot. The latest 20 season numbers are retained; older seasons are removed automatically. Each cycle is limited to 20 MB of JSON, keeping payload storage at most approximately 1.2 GB, plus database overhead. D1 allowance is shared with live data and logs; review D1 storage/usage periodically. This does not guarantee a fixed total bill under unlimited traffic.

Snapshots include player identity, team commitment, offer text, coach names recorded on offers, promises, rescinds, and edit history. They omit account records, authentication data, pending moderation approvals, and roster imports. Archives are public/read-only; only commissioners can create/update snapshots. Player links remain valid until their season is removed. Downloads remain available for permanent offline retention.

No existing live offers or commitments are changed by archiving. Rescinds and commitments do not run against archived snapshots.
