# Secrets inventory

Every env var, where it is read, and what breaks without it. `.env` is
gitignored — this document is the only committed record. `src/server.js`
fails fast on the starred items at boot; the rest degrade silently, which
is exactly why they are listed here.

| Var | Read in | Missing/empty behavior |
|---|---|---|
| `JWT_SECRET`* (16+ chars) | `server.js`, `auth.service.js` | Refuse to boot. Rotation = global logout (all sessions invalid). |
| `PAYMENT_ENCRYPTION_KEY`* (64 hex) | `server.js`, `lib/crypto.js` | Refuse to boot. **Losing it permanently undecrypts every stored provider secret** — back it up off-host, off-database. Rotation requires re-entering all merchant keys. |
| `DATABASE_URL` | `server.js` (required), `db/pool.js` | Refuse to boot (since the Tier-4 hardening; previously lazy per-request failures). |
| `BASE_DOMAIN` | `tenant-resolver.js`, `auth.controller.js`, `domain.service.js`, `lib/*` (default `afrexpay.com`) | Subdomain math, cookie scope, DNS-proof set, QR/redirect URLs all derive from this. Wrong value = multi-tenant resolution breaks everywhere at once. |
| `PORT` | `server.js` (default 3000) | Wrong port = Caddy 502s. |
| `NODE_ENV` | `auth.controller.js` (Secure cookies), `tenant override` (dead), `lib/*` localhost bypasses | Anything but `production` weakens cookies and dev-only paths. Leave `production` on the VPS. |
| `ALLOW_TENANT_OVERRIDE` | `tenant-resolver.js` | Must be `true` only for local dev (`?tenant=` testing). Never true in production: any caller could act as any tenant. |
| `POSTGRES_USER/PASSWORD/DB` | `docker-compose.yml` only | DB container creds. Must match the `DATABASE_URL` the app uses. |
| `PG_POOL_MAX` | `db/pool.js` (default 20) | Ceiling on concurrent PG connections. |
| `PG_STATEMENT_TIMEOUT_MS` | `db/pool.js` (default 30000) | Runaway-query kill switch. |
| `PGSSL` | `db/pool.js` | Set `require` for managed Postgres with mandatory TLS. |
| `TENANT_CACHE_TTL_MS` | `tenant-resolver.js` (default 30000) | Stale-tenant window after config/theme/domain edits (invalidated eagerly on the common paths). |
| `ABANDONED_SWEEP_ENABLED` | `server.js` | `false` disables the hourly sweep. |
| `ABANDONED_ORDER_TTL_MINUTES` | `server.js`, reservation checkout | Pending-checkout age before cancel (default 1440). Shared by reservation freshness. |
| `MATRIX_HOMESERVER_URL` | `notify-matrix/matrix.service.js` (default localhost:8008) | Order notifications fail (logged, fire-and-forget — orders still succeed). |
| `MATRIX_ACCESS_TOKEN` | same | Same as above; without it, notify calls throw before any request. |
| `SMTP_HOST/PORT/USER/PASS/FROM` | `auth/reset-email.js` | No `SMTP_HOST` = dev-console links locally; in production the reset endpoint throws (caught → generic message, **no email sent**). App-password, not login password. |
| `PUBLIC_BASE_URL` | `payments/credentials.routes.js` | Only the webhook URL shown in the dashboard. Defaults to `https://<BASE_DOMAIN>`. |

## Rotation cheat-sheet

- `JWT_SECRET` → everyone logs in again. Safe anytime.
- `PAYMENT_ENCRYPTION_KEY` → **do not rotate** without re-entering every tenant's Stripe/PayPal keys (old ciphertext becomes unreadable).
- `MATRIX_ACCESS_TOKEN` / `SMTP_PASS` → update `.env`, `pm2 restart` (both read once at boot).
