# RecruitHQ Backup Setup

RecruitHQ stores live league state in Cloudflare KV. This backup system copies that state to GitHub as two overwritten files:

- `backups/recruithq-latest.json` - full restore snapshot
- `backups/recruithq-latest.csv` - human-readable offers export

The files overwrite themselves, so the repo does not fill up with daily/hourly copies.

## GitHub Token

Create a fine-grained GitHub personal access token:

1. GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Choose the `cfb-website` repo
3. Give it `Contents: Read and write`
4. Copy the token

## Cloudflare Pages Variables

Add these to the production environment variables for the Pages project:

```text
BACKUP_GITHUB_TOKEN=your GitHub token
BACKUP_GITHUB_REPO=CoccaCola-121/cfb-website
BACKUP_GITHUB_BRANCH=main
BACKUP_GITHUB_PATH=backups/recruithq-latest
BACKUP_MIN_INTERVAL_SECONDS=60
```

`BACKUP_MIN_INTERVAL_SECONDS` keeps normal saves from hammering GitHub. The Settings button ignores this and forces a backup.

## How It Runs

Backups are attempted after:

- normal league-state saves
- live Discord commit pushes
- manual commit pushes
- clicking `Run backup now` in Settings

Settings also has a backup status card for moderators and commissioners.
