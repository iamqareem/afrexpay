# Deploy runbook (VPS, by hand, no CI required)

The app runs on the host under pm2; only Postgres runs containerized
(podman). A deploy is six steps. Do them in order, do not skip 3.

## 0. Preconditions

- On the VPS, in the repo dir, `git status --short` is clean (stash or
  commit anything local first).
- You know which commit you are deploying (`git log --oneline -1` locally
  vs on the VPS after pulling — they must match).

## 1. Pull

```bash
cd /path/to/afrexlab-platform
git pull origin main
git log --oneline -1   # must equal the commit you intend to deploy
```

## 2. Install

```bash
npm install --omit=dev
```

(There are no devDependencies; this is equivalent to `npm ci` without
needing a lockfile dance on the server.)

## 3. Pre-migration safety checks (do not skip)

Two migrations fail hard on pre-existing duplicate data. Run both; empty
results = safe. Replace the connection flags with your setup
(`podman exec <pg-container> psql -U <user> -d <db> -c "..."`):

```sql
-- blocks 1789709203218 (partial unique index on succeeded payments)
SELECT provider, provider_reference FROM payments
WHERE status = 'succeeded' GROUP BY 1, 2 HAVING count(*) > 1;

-- blocks 1789709203221 (case-insensitive email index)
SELECT LOWER(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
```

If either returns rows, dedupe first (merge/rename the losing rows by
hand — there is no automatic merge, deliberately).

## 4. Migrate

```bash
npm run migrate:up
```

- Applies every pending file in `migrations/` in timestamp order;
  already-applied ones are skipped via the `pgmigrations` table.
- Roll back one step with `npm run migrate:down` (see
  `docs/runbook-database.md` for what each down-migration does and does
  NOT restore).

## 5. Test + restart

```bash
npm test          # expect all green (currently 211); DB-free, safe anywhere
pm2 restart afrexpay
pm2 logs afrexpay --lines 30   # confirm clean boot, no crash loop
```

A pull alone changes nothing at runtime — pm2 keeps serving the old
bundle until restarted. Every "I deployed but nothing changed" incident
so far has been a missed restart.

## 6. Verify in the browser (hard-refresh first: Ctrl+Shift+R)

- Log in once (a fresh deploy that touched sessions forces one re-login
  by design).
- Home renders stats (no infinite skeleton, no error card).
- Every tab for the store's vertical renders; switch currency, save,
  create a row, confirm it renders in the new currency.
- Storefront loads on the subdomain.

## Triage table (from real outages)

| Symptom | Check | Cause so far (every time) |
|---|---|---|
| Home skeleton loops forever | `pm2 logs` → `relation "..." does not exist` | Migrations behind: code queries tables the DB lacks. Fix: step 3–4. |
| Logged out on every refresh | Same as above (`revoked_tokens` etc.) | Same fix. |
| Tabs missing + "Couldn't load" card, survives re-login | DevTools Network → `/api/config/verticals` status/body | 404 "No store found" = wrong host (IP/base domain, or proxy stripping `Host`). 401 = stale session, log in once. 500 = server, read `pm2 logs`. |
| Deployed but behavior unchanged | `git log` on VPS vs intended commit; `pm2 list` uptime | Forgot pull or forgot restart. |
| `migrate:up` fails mid-chain | The two dup-check queries above | Dedupe, re-run (applied files stay applied). |
