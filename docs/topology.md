# Topology (what runs where)

```
browser ──https──▶ Caddy (VPS system) ──http──▶ Node :3000 (pm2, 1 fork)
                                                    │
                                              podman: postgres:16
                                              127.0.0.1:5432, ./data/postgres
merchant uploads: ./data/media (host disk, served via /media)
```

## pm2 — one fork, on purpose

`ecosystem.config.js`: `instances: 1`, `exec_mode: "fork"`. The tenant
cache (`tenant-resolver.js`) and the abandoned-checkout timer
(`server.js`) are in-process: correct exactly once. Never scale past 1
(cluster mode) without moving the cache to Redis first — workers would
serve stale configs and run duplicate sweeps.

Useful: `pm2 list`, `pm2 logs afrexpay --lines 50`, `pm2 restart afrexpay`,
`pm2 env 0` (inspect the live env when behavior smells like config).

## podman Postgres

`docker-compose.yml` holds **only** the `db` service (there is no app
image anymore, by decision). Operate it with `podman compose` (or
`podman-compose`): `up -d`, `logs db`, `exec <name> pg_dump …`.
Data: `./data/postgres`. Media (not in the DB): `./data/media`.

## Caddy (system-level, not in this repo)

- Terminates TLS, reverse-proxies to the app preserving the original
  `Host` (tenant resolution depends on it — a proxy that rewrites Host
  breaks every store; the dashboard then shows "this address doesn't
  point at any store").
- `on_demand_tls` with the `ask` gate: before issuing a cert for an
  unknown hostname, Caddy calls `GET /api/domains/ask?domain=…`, which
  answers 200 only for verified custom domains (`domain.service.js`).
  Unverified or unknown hosts get no cert — that is the anti-abuse
  mechanism, not a bug.
- Trust: the app sets `trust proxy: 1` (single Caddy hop). If anything
  else ever sits in front, revisit this or IP-keyed rate limits become
  spoofable via `X-Forwarded-For`.

## Request path cheat-sheet

Static marketing (`public/`, base domain only) → tenant resolution →
`/admin` bundle → `/api/*` → `/media` → storefront themes. Webhooks
(`/api/payments/webhook/*`) and the Caddy ask endpoint sit *before*
JSON parsing/tenant resolution on purpose (raw bodies, no Host concept).
