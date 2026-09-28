# Enable transactional recruiting storage

The existing AUTH_KV binding stays in place for Discord accounts and team claims. LEAGUE_DB replaces the single shared KV board record. Without LEAGUE_DB, the site still uses KV and is not ready for a coordinated closing rush.

## Cloudflare activation

1. Create a D1 database named `recruithq-league` in Cloudflare's Storage & databases → D1.
2. Run these statements in its Console (also in migrations/0001-league-storage.sql):

```sql
CREATE TABLE IF NOT EXISTS league_head (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS league_chunks (part INTEGER PRIMARY KEY, content TEXT NOT NULL);
```

3. Choose a quiet migration window. In website Settings, manually lock offers and save. Ask moderators to avoid changes during the switch. Wait for in-flight submissions to finish. Download `/api/league/state` as the pre-migration backup, recording its offer count. Keep the existing scheduled-close value.
4. In Workers & Pages → cfb-website → Settings → Bindings, add a **D1 database** binding named **LEAGUE_DB**, selecting `recruithq-league`. Do not remove AUTH_KV. Bind production only; preview deployments must use a separate database.
5. Redeploy the latest production deployment. The first board read copies the current KV board into D1 atomically and only once. KV is left untouched as the migration backup. Subsequent league reads/writes use D1; an unavailable D1 database fails closed rather than reverting to stale KV.
6. Open `/api/league/state`. Confirm `storage` is `d1`, offers are still locked, and every pre-migration offer ID and body is present. If anything differs, keep offers locked and investigate. Do not remove LEAGUE_DB as a rollback after new writes: that would resurrect the old KV snapshot.
7. Refresh your browser, manually reopen offers, and save. Coaches should refresh their tabs. CPR submissions now send compact authenticated requests to `/api/offers/submit`, with stable request IDs, transactional conflict recovery, and server-side deadline validation. Existing old tabs without version protection are refused and told to refresh.

Do not seed or load-test the live class. Test Cloudflare response times using a separate preview database/class first. The local SQLite test covers 120 concurrent coaches and a 2.4 MB state, no lost/duplicated offers, stale-writer rejection, and closed-offer rejection; its timing is not a production throughput guarantee. Cloudflare plan request/CPU/database limits still apply.

## Integrity and operations

- D1 batch transactions update only changed 192K-character chunks and compare versions atomically. Chunk boundaries preserve Unicode surrogate pairs. Two writers cannot overwrite one another silently.
- Same-request retries return the existing offer. Scheduled cutoff eligibility is checked against server receipt time, so an already-arrived request does not become late while retrying a database conflict.
- State endpoints and legacy actions use version checks. A conflict remains visible rather than silently publishing stale data.
- Keep backups configured. After migration, back up D1 through the existing backup button; it reads the active storage backend.
- `node --test tests/transactional-state.test.mjs` runs the isolated SQL concurrency test. `node --test --test-concurrency=1 tests/*.test.*` runs all checks.

Cloudflare references:
- https://developers.cloudflare.com/pages/functions/bindings/#d1-databases
- https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
- https://developers.cloudflare.com/kv/api/write-key-value-pairs/
