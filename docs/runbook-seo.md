# SEO & discovery runbook (by hand)

Machines read every storefront: crawlers via sitemap + detail pages,
shopping assistants via feeds, `llms.txt`, and the agent API. This is the
checklist for keeping that surface truthful. Nothing here runs on a timer.

## After changing anything in `src/lib/seo.js`, `theme-server.js`, or `src/modules/discovery/`

```bash
npm test   # must stay green — seo/discovery tests pin titles, canonicals, feeds, mounts
```

## Verify one storefront live (needs its `Host:` header)

```bash
H="Host: <subdomain>.afrexpay.app" B=https://afrexpay.app
curl -s -H "$H" $B/robots.txt        # Allow: / + Sitemap: line, no HTML
curl -s -H "$H" $B/sitemap.xml       # valid XML, home + /p|/s|/l entries
curl -s -H "$H" $B/ | grep -o "<title>[^<]*</title>"
curl -s -H "$H" $B/p/<slug> | grep -o '"@type":"Product"'
curl -s -H "$H" $B/llms.txt | head -5
curl -s -H "$H" "$B/api/agent/v1/products?search=<word>" | head -c 200
```

Unknown slugs must 404 (`curl -o /dev/null -w "%{http_code}"`), never 200.
`/admin` responses must carry `X-Robots-Tag: noindex, nofollow`.

## Submitting a catalog to Google Merchant Center

1. Copy the store's CSV URL from the dashboard (Home → Search &
   discovery → Product feed (CSV)).
2. In Merchant Center → Products → Feeds, add a scheduled fetch with that
   URL. Price arrives as `<major> <CURRENCY>`; availability tracks live
   stock (`NULL` stock = untracked = in stock).
3. Products deactivated or set `off_market` drop out of the next fetch
   automatically — no manual removal step.

## Merchant-facing knobs (dashboard → Home → Search & discovery)

- Search title / description default to store name + tagline; blank =
  automatic, never empty.
- "Hide my store" sets `config.noindex` (meta robots + noindex sitemap
  entries stay listed — crawlers are asked, not forced).
- Copy buttons use the canonical store URL (custom domain when verified).

## Deploy note

Slugs arrived via migration `1791557487982_catalog-slugs` — the standard
`npm run migrate:up` before restart covers it. Rollback drops the columns;
detail URLs 404 until re-applied (sitemap falls back to home-only).
