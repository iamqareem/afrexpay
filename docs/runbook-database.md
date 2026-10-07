# Database runbook (by hand)

Postgres runs in podman (`docker-compose.yml`, db service only, data in
`./data/postgres` on the host). `<pg>` below means your psql path, e.g.
`podman exec <pg-container> psql -U <user> -d <db>`.

## Backup (do this before every deploy that includes a migration)

```bash
# schema + data
podman exec <pg-container> pg_dump -U <user> <db> > backup-$(date +%F).sql
# merchant uploads live on host disk, not in Postgres:
tar -czf media-$(date +%F).tar.gz data/media
```

Back up `./data` (postgres + media) and you have the whole platform.

## Restore

```bash
# fresh database, then:
podman exec -i <pg-container> psql -U <user> -d <freshdb> < backup-YYYY-MM-DD.sql
tar -xzf media-YYYY-MM-DD.tar.gz   # into the repo root (restores data/media)
```

## Migrations

- Forward: `npm run migrate:up` (order = filename timestamps; skipped
  ones stay skipped via `pgmigrations`).
- New: `npm run migrate:create some-description`, then write `up`/`down`.
- Back one step: `npm run migrate:down`.
- Inspect state: `SELECT name, run_on FROM pgmigrations ORDER BY run_on;`

### What `down` does NOT undo (known gaps, fix the data by hand)

- `1789709203218` down restores the *full* unique index — fine — but any
  `failed`-suffixed references created while it was up stay as-is
  (harmless; they are audit rows).
- `1789709203213` down drops the `*_not_empty` checks but does not
  restore the original `provider IN ('stripe','paypal')` checks.
- `1789709203217` down recreates `resource_services` without its index.
- `1789709203216` down lacks `IF EXISTS` (retrying a partial rollback
  aborts instead of continuing).
- `1751500000000` down leaves the `pgcrypto`/`btree_gist` extensions
  installed (harmless).

## The two dup-check queries (pre-migration, see also runbook-deploy)

```sql
SELECT provider, provider_reference FROM payments
WHERE status = 'succeeded' GROUP BY 1, 2 HAVING count(*) > 1;
SELECT LOWER(email), count(*) FROM users GROUP BY 1 HAVING count(*)>1;
```

## Useful inspections

```sql
-- tenants and their verticals/themes
SELECT t.subdomain, t.status, t.custom_domain, t.custom_domain_verified_at,
       sc.config->>'vertical' AS vertical, sc.theme_slug
FROM tenants t LEFT JOIN store_configs sc ON sc.tenant_id = t.id;
-- stuck money: paid webhooks that matched nothing stay pending
SELECT id, tenant_id, payment_status, created_at FROM orders
WHERE payment_status = 'pending' ORDER BY created_at DESC LIMIT 20;
```
