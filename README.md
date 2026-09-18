# afrexpay platform

## Overview

This project is a multi-tenant storefront backend built with **Node.js**, **Express**, and **PostgreSQL**. It is containerized using **Docker** and orchestrated with **Docker Compose**. The platform includes:
- A single Node.js process serving both the admin dashboard and tenant storefronts.
- Database migrations managed by `node-pg-migrate`.
- A theme system for customizable storefront UI.
- Polymorphic media handling with tenant‑scoped storage.
- Authentication via JWT cookies.
- Integration with **Stripe** for payments and **Matrix** for notifications.
- Support for three verticals: **products**, **services (bookings)**, and **listings**.

Multi-tenant storefront backend. One Node process, one Postgres database,
merchants resolved by subdomain on every request — no restart needed to add
a new store.

## Layout

```
afrexpay/
  docker-compose.yml     # app + Postgres, everything wired together
  Dockerfile
  docker-entrypoint.sh    # runs migrations, then starts the server
  migrations/               # node-pg-migrate — the single source of truth for schema
  data/                    # created on first run — Postgres data + media, all here
    postgres/
    media/<tenant_id>/      # tenant-scoped product photos
  themes/
    hangtag/                # product-catalog storefront theme
    electronics/            # tech & gadgets storefront theme
    yeezy/                  # streetwear & footwear storefront theme
    backmarket/             # refurbished-goods storefront theme
    automobile/             # auto & parts storefront theme
    booking-slots/           # service/booking storefront theme
    resort/                 # hotel & recreation booking theme
    listing-grid/             # real estate storefront theme
    new-listings/           # modern component-based listing theme
  admin/                   # merchant dashboard — one universal UI, no theme system needed
    index.html
    css/style.css            # hand-written, no build step (unlike themes, there's only one admin UI)
    js/app.js                 # Alpine.js component: login, config, products/services/listings, orders/bookings/inquiries
    js/alpine.min.js           # vendored from npm, not a CDN script tag
  public/                  # base-domain marketing + signup page (afrexpay.com, no subdomain)
    index.html
    reset.html                # password reset landing page
    css/style.css
    js/signup.js
    js/reset.js
  src/
    server.js              # entry point only
    app.js                 # route map — every module mounted here, read this first
    verticals.js             # small explicit registry of business shapes — see "Verticals" below
    lib/crypto.js             # AES-256-GCM encryption for payment credentials at rest
    db/pool.js                # shared Postgres connection pool
    middleware/
      tenant-resolver.js    # Host header -> subdomain -> tenant row, on every request
      theme-server.js         # picks the right theme bundle per tenant, serves it
      media-server.js          # tenant-scoped photo serving
      auth-required.js          # guards merchant-only routes
    modules/
      auth/                  # signup, login, JWT issuing, cross-subdomain cookie scoping, password reset
      store-config/           # brand copy, colors, hero text, vertical, theme selection (jsonb payload)
      products/                # catalog CRUD, tenant-scoped
      orders/                   # order placement, stock decrement, tenant-scoped
      services/                  # bookable service CRUD + weekly hours/exceptions + slot computation
      bookings/                  # booking creation (DB exclusion constraint prevents double-booking), status updates
      listings/                   # real estate listing CRUD, tenant-scoped
      inquiries/                   # lead capture on a listing — no exclusion constraint, nothing scarce to reserve
      media/                     # photo upload, tenant-scoped storage, polymorphic entity linking
      notify-matrix/              # order/booking/inquiry notifications, room creation + invite flow
      payments/                    # Stripe provider, encrypted credential storage, webhook handling
```

Each backend module is `routes.js` (wiring) → `controller.js` (HTTP concerns) →
`service.js` (logic, talks to Postgres). The storefront and admin are both
plain static bundles the same server serves — no separate frontend deploy,
no CORS to manage.

### Signup flow

`afrexpay.com` (the base domain, no subdomain) serves a marketing page with a
signup form. On success, the merchant is handed a link to
`<their-subdomain>.afrexpay.com/admin`. This surfaced a real bug worth
knowing about: the session cookie is set during signup, on the base domain,
but needs to work on the merchant's own subdomain afterward — a host-only
cookie set on `afrexpay.com` is never sent to `256-merch.afrexpay.com`. The
fix is scoping the cookie to `.afrexpay.com` (via `BASE_DOMAIN` in `.env`),
which is what actually lets a merchant sign up and land in a working
dashboard in one flow.

**Local dev caveat:** browsers don't reliably support cookie scoping across
bare `localhost` subdomains the same way. For local testing that exercises
the full signup → dashboard flow, add entries to `/etc/hosts` for a fake
domain (e.g. `afrexpay.local` and `256-merch.afrexpay.local`) rather than
relying on `localhost` subdomains directly.

## Password reset

The admin login screen has a "Forgot password?" link. `POST
/api/auth/request-password-reset` always returns the same generic message
whether or not the email is registered — this is deliberate, so the
endpoint can't be used to discover which emails have accounts. If SMTP is
configured (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` in `.env`), the
reset link is emailed via `nodemailer`; otherwise it's logged to the
console, which is enough for local dev and testing without needing real
mail credentials. Reset tokens are single-use, expire after 1 hour, and
only their SHA-256 hash is stored — a database leak alone can't be used to
reset anyone's password. Rate-limited: 5 reset requests per hour per IP.

## Platform UI — admin dashboard & public pages

`admin/` and `public/` (marketing/signup/reset — the platform's own
surfaces, not merchant storefronts) share one visual language: strict
monochrome — black, white, and grayscale only, no hue anywhere. Status is
carried by fill weight and shape (solid / outline / dashed badges), never
by color. Both surfaces follow the OS theme on first load
(`prefers-color-scheme`, applied pre-paint so there's no flash) with a
manual sun/moon override persisted in `localStorage` under the shared
`afrexpay-theme` key — one choice follows the merchant from landing page
to dashboard. **Deliberately not applied to storefront themes** — those
already have their own working per-merchant accent-color system (the
curated color-pair picker); applying a fixed platform palette there would
silently break that feature. Saved merchant brand colors are data and are
never touched by the monochrome conversion.

`public/css/style.css` used to be a byte-for-byte copy of
`admin/css/style.css` with a `.hero` block added — the merchant-facing
marketing/signup page was wearing the same dark internal-dashboard skin as
the admin panel. It's now its own file sharing only the base tokens, with
a real hero section, a 3-column value-proposition grid, and the signup
form as a secondary element below the pitch rather than the whole page.

`admin/index.html` had 57 inline `style=""` attributes (verified by count,
not estimated) — repeated flex/grid patterns (photo manager grids, form
layouts, spacing) done ad hoc per element instead of as reusable classes.
Reduced to 3: two genuine one-off styles not worth a shared class, and one
that's correctly dynamic (the color-swatch picker's per-pair gradient,
computed in Alpine, not a static value — that one *should* stay inline).
New reusable classes: `.field-grid` (2-column settings forms, 1-column on
mobile — renamed from the old underused `.grid-2`), `.photo-grid` /
`.photo-thumb` (used identically across the Products, Services, and
Listings photo managers — previously three separate copies of the same
inline styles), `.cluster` / `.stack` (the flex-wrap-plus-gap and
vertical-spacing patterns repeated throughout), plus a small set of named
single-purpose utilities (`.hint`, `.success-text`, `.full-width`, etc.)
added only for patterns actually found repeated via `grep`, not
speculatively.

Verified against a running server, not just visual inspection: new CSS
tokens present and the old dark palette genuinely absent from the served
files, tag balance intact after the HTML restructuring, and the full
functional path (signup → login → product creation → photo upload through
the restructured photo manager) still works end to end.

## Color palette & theme picker

Store Settings no longer has raw hex color inputs — merchants pick from six
curated monochrome accent-color pairs instead (Black/White through Smoke/Snow),
so it's not possible to accidentally pick two colors that clash or are hard
to read. The same tab has a theme picker (buttons for
every theme in `themes/`, built from the same startup whitelist that
`theme-server.js` already validates against) — switching is instant, no
rebuild needed, since theme switching is just changing which folder
`theme-server.js` serves from.

## Photo uploads

See "Media — fully polymorphic" below for the full picture — upload
validation (JPEG/PNG/WebP only, real magic-byte checking, 2MB max, SVG
deliberately excluded), the dashboard's photo manager UI (upload / delete /
reorder, identical across Products, Services, and Listings), and how a
photo links to whichever entity it belongs to.

## Signup safety

- **Reserved subdomains** (`www`, `admin`, `api`, `mail`, etc. — see the list
  in `auth.controller.js`) are blocked at signup.
- **Rate limiting**: 10 login attempts per 15 minutes, 5 signups per hour, per
  IP. In-memory store — fine for one process; if this ever runs as multiple
  instances behind a load balancer, swap in a shared store (Redis) or accept
  that the limit becomes "N per instance."  `trust proxy` is set in `app.js`
  so this reads the real client IP through Caddy rather than rate-limiting
  every merchant behind the proxy as a single visitor.

## Matrix order notifications

Set `MATRIX_HOMESERVER_URL` (e.g. `http://localhost:8008` for a local Synapse
container) and `MATRIX_ACCESS_TOKEN` (a bot account's access token) in `.env`.

**Merchants never see or handle a room ID.** The dashboard's notifications
panel asks for one thing: their own Matrix ID (`@theirname:matrix.org`, from
Element or any Matrix homeserver). `POST /api/matrix/connect` handles the
rest — first connection creates a private room via the bot and invites that
ID in the same call; a later reconnect (or inviting a second person, e.g.
staff) just invites into the existing room instead of creating a duplicate.
The merchant accepts the invite in whatever Matrix client they installed,
and that's the entire setup.

**One-time setup this app doesn't do for you:** the bot account itself needs
to exist and have a valid access token before any of this works — that's a
Synapse-side account creation step, done once, outside the app.

Sending order notifications is fire-and-forget: if Matrix is down or
unconfigured, the order still succeeds and saves normally — failures are
logged to the console, never surfaced to the customer or the merchant's
order flow.

**Tested** against a mock homeserver standing in for Synapse: malformed
Matrix IDs are rejected, first connect sends a spec-correct `createRoom`
call with the invite bundled in, a second connect correctly invites into the
existing room rather than creating a new one, and order messages render
with real customer/item/total data (plain text + HTML). Not tested against
a real Synapse instance in this environment.

## Tenant resolution — the engine every request goes through

`src/middleware/tenant-resolver.js` runs before every route in the app
(storefront, admin, every API endpoint), so it's the one place request
volume translates directly into database load. Two things worth knowing:

**No dev-specific hardcodes.** `extractSubdomain` only ever knows about
`BASE_DOMAIN` — no `.localhost` special-casing, no assumptions about your
local setup. Local subdomain testing goes through real DNS (a local
bind9/Unbound resolver, or hosts-file entries) pointed at whatever
`BASE_DOMAIN` is set to for that environment, or through the `?tenant=`
query override for quick single-request testing without touching DNS at
all. This used to have a `.endsWith(".localhost")` carve-out from an
earlier debugging session — removed once local DNS resolution became
something infrastructure handles, not something the app should assume.

**In-process TTL cache.** Positive lookups (a real tenant) are cached for
`TENANT_CACHE_TTL_MS` (default 30s, configurable in `.env`); unknown
subdomains are cached "not found" for a short 5s window, capped at 5,000
entries with oldest-first eviction so probing many nonexistent subdomains
can't grow the cache unbounded. Cache entries are invalidated immediately
(not left to expire) whenever something that's cached could go stale:
config edits and theme changes (`config.routes.js`), and a fresh signup
clearing any prior negative-cache entry for that exact subdomain
(`auth.controller.js`) — tested directly: probing a subdomain that doesn't
exist yet, then signing up with that exact name within the negative
cache's TTL window, resolves correctly on the very next request rather
than waiting out the cache.

**Caddy vs. pm2 — which one actually matters here.** Caddy reverse-proxying
in front of this app is a non-issue for the cache: it passes the original
`Host` header straight through unmodified, and doesn't cache or duplicate
anything the tenant resolver depends on. `pm2` is the one that matters,
specifically **fork mode vs. cluster mode**:

- **Fork mode (1 instance)** — the setup this app ships with
  (`ecosystem.config.js`, `instances: 1`, verified with a real `pm2 start`).
  One process, one cache, exactly what was tested above.
- **Cluster mode (N instances)** — pm2 would run N separate Node processes
  behind the same port, each with its own independent cache. A merchant's
  config/theme edit would only invalidate the cache in whichever worker
  happened to handle that specific PATCH request — the other workers keep
  serving their own stale copy until their own TTL naturally expires.

This app is Postgres-bound, not CPU-bound — every route is I/O-heavy, not
compute-heavy — so a single fork-mode process doesn't leave real
performance on the table the way it would for a CPU-bound workload.
`ecosystem.config.js` pins `instances: 1` deliberately, not by omission. If
cluster mode is ever genuinely needed later, move the tenant cache to a
shared store (Redis) first — otherwise cluster mode trades a scaling
problem this app doesn't have yet for a real consistency bug.

This is a single-process, in-memory cache — correct and sufficient for one
running instance. If this app is ever horizontally scaled behind a load
balancer, this becomes "cached per instance," the same caveat the rate
limiter already carries; a shared cache (Redis) would be the upgrade at
that point, not before it's a real need.

## Migrations

Schema changes go through `node-pg-migrate`. As of this pass, the previous
5 incremental migrations were **consolidated into one** (`migrations/1751500000000_initial-schema.js`)
— nothing is in production yet, so there was no live data to migrate around
and no value in preserving the incremental history. The old `db/schema.sql`
(a stale historical artifact from before migrations existed at all) was
removed entirely; the single migration is now the only source of truth.

Once real merchant data exists, go back to incremental migrations for any
further schema change — `npm run migrate:create some-description` scaffolds
a new one. Consolidating again after that point would mean writing a data
migration, not just a schema one, which is a different and riskier kind of
change.

```bash
npm run migrate:up      # apply pending migrations
npm run migrate:down    # roll back the most recent one
npm run migrate:create some-description   # scaffold a new migration file
```

The Docker image runs migrations automatically on every container start
(`docker-entrypoint.sh`, before the server boots) — safe to leave running
across deploys, since already-applied migrations are tracked in a
`pgmigrations` table and skipped on subsequent runs.

## Services & bookings — a second business vertical

Two clients asked for booking-based storefronts (salon-style appointments)
rather than a product catalog, so this is now a **parallel domain**
alongside products/orders, not a repurposing of those tables. A tenant
declares which one they are via `config.vertical` (`"products"` or
`"services"`, defaulting to `"products"` for every tenant that existed
before this was added) — the dashboard shows different tabs accordingly,
and the storefront needs a compatible theme (see below).

New tables: `services` (name, duration, price — the services equivalent of
`products`), `availability_windows` (recurring weekly hours),
`availability_exceptions` (one-off blackout days or extra hours), and
`bookings` (a reserved time slot, replacing `orders` for a service tenant).

**The core guarantee — enforced by Postgres, not application code:**
`bookings.time_range` is a `tstzrange` with a `GIST` exclusion constraint,
so the database itself refuses two overlapping, non-cancelled bookings for
the same tenant. A conflicting booking attempt fails with Postgres error
code `23P01`, which `booking.service.js` catches and turns into a clean
409 response — the application never computes or trusts its own
"is this slot free" check to prevent a double-booking, it just relies on
the constraint. Tested directly against Postgres (not just through the
API): an overlapping insert is rejected, an adjacent slot (starting exactly
when another ends) succeeds correctly since the range is half-open, and
cancelling a booking correctly frees its slot for rebooking.

Multi-staff/multi-resource booking (so two different staff can be booked
into the same time slot) isn't built — the exclusion constraint currently
scopes conflicts per-tenant, not per-resource. Extending it is a small
change (add a `resource_id` column to the `EXCLUDE` clause) whenever that's
actually needed.

**Storefront theme**: `themes/booking-slots/` is a second theme, structurally
different from `hangtag` (service picker → date/slot picker → booking form,
not a product grid + cart). A tenant on the services vertical should be
switched to it via the dashboard's theme picker (Store Settings tab) — theme
selection isn't automatic based on vertical, it's still a manual choice, same
as it is for the products vertical.

**Matrix notifications** are reused as-is for bookings — from the merchant's
side, "someone booked a slot" and "someone placed an order" are both just
"something needs my attention," so no separate integration was built.

## Verticals — the registry, not a plugin system

Three known business shapes exist: `products`, `services`, `listings`. This
is deliberately a small, explicit lookup table (`src/verticals.js`), not a
dynamic plugin loader. A real plugin system — arbitrary code registering
itself by name — is the right tool when the set of extensions is open-ended
or third-party. Ours isn't: it's a short, known list, so a tenant's
`config.vertical` value is validated against this registry the same way
`theme_slug` is validated against the on-disk theme whitelist — checked
against a known set before it ever decides what runs, never resolved
dynamically from the string itself.

Each entry declares its `dashboardTabs` and `compatibleThemes`. The admin
dashboard no longer hardcodes tab visibility as boolean flags (the old
`showsProducts`/`showsServices` pair, which wouldn't have scaled past a
third vertical) — it fetches this registry and renders tabs from it via a
`tabVisible(tabName)` helper. Adding a fourth vertical later means one entry
here, one tab section in `admin/index.html`, and one theme — not touching
tab-visibility logic anywhere.

Switching a tenant's vertical mid-session (Store Settings → save) loads the
newly-visible tabs' data immediately, so a merchant who flips from products
to listings doesn't see empty tabs until a page refresh happens to trigger
a reload.

## Media — fully polymorphic, no per-vertical special case

Every photo, for every vertical, links the same way: `entity_type` +
`entity_id` on the `media` table, with a `CHECK` constraint restricting
`entity_type` to `product`/`service`/`listing`/`unassigned` at the database
layer, not just validated in application code. There is no `image_path`
column anywhere in the schema and no `product_id` shorthand on media —
products, services, and listings are all "just an entity" to the media
system, one code path regardless of which vertical a tenant is on.

This wasn't the original shape. Products came first and got a dedicated
`image_path` column; when services and listings were added, media became
polymorphic for them but products kept its special case, plus a
backward-compatible `productId` shorthand on uploads to avoid breaking the
existing dashboard. That accumulated real debt — two ways to link a photo
to an entity, extra branches in `media.routes.js`, a theme
(`hangtag`) reading a column no other theme had. Since nothing was in
production yet, the cleanest fix was removing the special case entirely
rather than maintaining it indefinitely: `product.image_path` is gone,
`media.product_id` is gone, and every theme (`hangtag`, `booking-slots`,
`listing-grid`) fetches its photos identically via
`GET /api/media/for/:entityType/:entityId`. The admin dashboard's Products,
Services, and Listings tabs all use the same photo manager component shape
(upload / delete / reorder), not three slightly-different implementations.

Tested end to end after the change: uploading a product photo via the new
`entityType=product` works; the old `productId` shorthand is now correctly
rejected (`entityType and entityId are required`) rather than silently
accepted, confirming the compatibility shim is actually gone, not just
unused; photos are retrievable through the generalized endpoint for all
three verticals; cross-tenant upload attempts 404 for every entity type;
and an unrecognized `entity_type` is rejected by the application layer,
with the database `CHECK` constraint verified directly (outside the app,
via raw SQL) as the backstop if anything ever bypassed it.

## Payments — Stripe, all three verticals (pay-now is additive)

**Scope of this pass**: Stripe only. Listings deposit first, then pay-now
for product orders and service bookings on the same abstraction. PayPal
extends the same provider shape later — not built yet.

**Model: bring-your-own-keys, not Stripe Connect.** Each tenant pastes
their own Stripe account's keys into their dashboard's Payments tab; this
platform calls their account directly on their behalf. Simpler to ship
than Connect (no OAuth onboarding flow, no Stripe Platform approval to
wait on), correct for a handful of merchants each with their own account.
Connect is the right upgrade once there are enough tenants that "one
platform-level webhook secret" beats "N merchants' worth of individually
configured webhooks" — a deliberate future decision, not a compromise
being lived with by accident.

**A deposit is not an inquiry with a price bolted on.** `listing_reservations`
is its own table, separate from `inquiries` — an inquiry is a lead with no
money involved; a reservation is a paid hold, closer in shape to a booking.
Overloading `inquiries` with optional payment fields would have mixed two
different meanings into rows whose behavior depends on which columns
happen to be populated — the same reasoning that already kept services out
of `products` and kept media polymorphic instead of per-vertical.
`listings.deposit_amount_minor` is nullable and additive: a listing with
none set behaves exactly as it always has (plain inquiry form only).

**Encryption at rest.** `payment_credentials` stores live financial
secrets — a materially higher-stakes column than anything else in this
schema. `src/lib/crypto.js` (AES-256-GCM) encrypts the secret key and
webhook secret before they ever reach Postgres, using a server-side master
key (`PAYMENT_ENCRYPTION_KEY`, .env only, never the database). Verified
directly, not assumed: round-trips correctly, a tampered ciphertext is
rejected (GCM's auth tag), a wrong key is rejected — and confirmed via a
raw `psql` query that the actual DB column never contains plaintext.

**Checkout uses Stripe's hosted Checkout Session (redirect flow), never
Stripe Elements embedded in our own page.** This is a load-bearing design
choice, not a style preference: card data never touches this codebase or
server at all, which keeps the whole platform out of PCI SAQ D scope
entirely. Building a raw card-number form here would be a real compliance
mistake, not just more work.

**Webhook correctness — the highest-stakes code in this feature, tested
accordingly:**
- Mounted with its own `express.raw()` middleware, **before**
  `app.use(express.json())` in `app.js` — Stripe's signature verification
  needs the exact raw bytes sent, and the global JSON parser running first
  would silently break every signature check in a way that looks like "the
  webhook secret must be wrong" when the real cause is body-parsing order.
  This is a common, easy-to-miss mistake in Stripe integrations generally.
- The webhook URL is scoped per tenant
  (`/api/payments/stripe/webhook/:tenantId`) — since this is
  bring-your-own-keys, each tenant has their *own* webhook signing secret,
  so the handler needs to know which tenant's secret to verify against
  before trusting anything in the request body. Each merchant pastes their
  own exact URL (shown in their dashboard, server-computed) into their own
  Stripe dashboard.
- **Idempotent by construction**: `payments.provider_reference` is
  `UNIQUE`, and `markReservationPaid` only updates a reservation that's
  still `pending` — Stripe does not guarantee exactly-once webhook
  delivery. Tested directly: delivering the identical signed webhook twice
  results in exactly one `payments` row and one status transition, not two.
- Tested against the real running HTTP endpoint (not just the signing
  logic in isolation): a correctly-signed webhook marks the reservation
  paid and creates the ledger row; a tampered/wrong signature is rejected
  with 400; an unknown tenant ID returns the same generic error a
  configured-but-different tenant would (doesn't leak which tenant IDs
  exist); a duplicate delivery is a no-op, confirmed via `SELECT count(*)`.

**What could not be tested in this environment**: the actual live network
call to Stripe's API (`api.stripe.com` isn't in this sandbox's network
allowlist) — confirmed this is an environment restriction, not a code bug
(the rejection message is a proxy policy message, not a Stripe API
response), and confirmed the request is correctly constructed and that
errors are caught and returned cleanly rather than crashing. The actual
checkout-session-creation round-trip needs verifying against real Stripe
test-mode keys in a real environment before going live.

**Uganda + Stripe**: worth knowing before relying on this — Uganda is not
on Stripe's list of directly-supported merchant countries (nor covered by
Stripe's African "extended network" via Paystack, which covers Ghana,
Kenya, Nigeria, South Africa, and Côte d'Ivoire). A Ugandan business
typically needs an entity registered in a supported country (a common
path: a US LLC + EIN + US bank account) to open a Stripe account at all.
This is the merchant's business/legal decision, not something the
integration code can route around — confirm the client's Stripe account
actually exists and works before assuming this feature is ready to use.

**Dashboard**: a Payments tab (visible regardless of vertical — Stripe
setup was never listings-specific) for entering keys and seeing the
webhook URL to paste into Stripe; a Reservations tab (listings vertical
only) showing each reservation's payment status; Orders and Bookings tabs
now show a `payment_status` badge alongside their existing status, so a
merchant can tell `unpaid` / `pending` / `paid` apart at a glance.

**Storefront** (`listing-grid` theme): a listing with a deposit configured
shows a "Pay deposit to reserve" panel instead of (visually: alongside) the
plain inquiry form. Submitting creates a pending reservation, then redirects
to Stripe's hosted checkout page; Stripe redirects back to the same listing
with a query param that shows a confirmation banner. That banner is pure
UX feedback — the reservation's real `payment_status` is only ever set
server-side by the webhook, never by the client-side redirect, so a
customer closing the tab mid-checkout can't fake a confirmed reservation.

**Pay-now on products** (all five product themes: `hangtag`,
`electronics`, `yeezy`, `backmarket`, `automobile`): the cash flow is
untouched — checkout still `POST`s `/api/orders` and shows the order
confirmation. The confirmation now also offers "Pay now with card", which
`POST`s `/api/orders/:id/checkout` and redirects to Stripe's hosted page;
Stripe redirects back to the same storefront with `?order=<id>&paid=1`,
which reopens the confirmation with a "Payment received ✓" banner. Same
rule as deposits: the banner is UX only, `payment_status` is webhook-set.

**Pay-now on bookings** (`booking-slots` theme): same additive shape —
booking is created and holds its slot as before, then the confirmation
step offers "Pay now with card" via `POST /api/bookings/:id/checkout`,
with the same redirect-back banner pattern (`?booking=<id>&paid=1`).
The 409 double-booking path is unchanged and still refreshes the slot list.

**Known limitation, accepted (not overlooked):** stock is decremented at
order creation and the booking row holds its slot at creation — both
*before* payment. A customer who closes the Stripe tab mid-checkout leaves
an `unpaid` order / `pending` booking behind, and the merchant follows up
or cancels (cancelling a booking frees its slot by design, since the
exclusion constraint ignores `cancelled`). The admin `payment_status`
badges are the mitigation for v1; restoring stock on abandoned checkout
is an explicit later step, not part of this build.

**What still needs verifying against real Stripe test-mode keys** (same
environment caveat as before — `api.stripe.com` isn't reachable from this
sandbox): the checkout-session round-trip for orders/bookings, duplicate
webhook delivery staying a single `payments` row, and the no-keys error
path showing inline without breaking the underlying cash order/booking.

## Real estate listings — a third vertical

Neither of the existing verticals fit: it's not stock-tracked goods, and
it's not time-slot bookings either (a listing isn't "consumed" by an
inquiry the way a slot is consumed by a booking). It's catalog + lead
capture — browse listings, submit interest, merchant follows up — so it's
built as its own parallel domain, following the same pattern as services:

- `listings` — title, description, sale/rent, price, bedrooms/bathrooms/area,
  location, status (active/pending/sold/rented/off_market)
- `inquiries` — name, phone, message, tied to a listing. No exclusion
  constraint here, unlike bookings — nothing scarce is being reserved, an
  inquiry is just a message, so this is much simpler than the bookings table.

Inquiry submission is public (no customer account needed — same
"lead capture, not a transaction" reasoning as bookings and orders not
requiring a customer login either) and fires the same Matrix notifier as
orders and bookings — from the merchant's side, "someone wants a callback"
is the same kind of event as "someone placed an order."

New theme: `themes/listing-grid/` — a grid of listings → detail view with
photos → inquiry form, structurally different from both `hangtag` (product
grid + cart) and `booking-slots` (service picker + calendar).

**Media**: listings use the same fully-polymorphic `media` table as every
other vertical — see "Media — fully polymorphic" above for the full
picture (there's no product-specific special case left to describe
separately). The dashboard's photo manager (shown while editing a listing)
supports upload, delete, and reordering: `DELETE /api/media/:id` removes
both the DB row and the file on disk, tenant-scoped so a merchant can't
delete another tenant's photo by guessing an id; `PUT /api/media/order`
takes a full ordered list of media ids (same full-replace pattern as
availability windows — reordering is one action, not N edits). Tested
directly: reversing a 3-photo order updates `sort_order` correctly,
deleting the middle one leaves the other two with their order intact, and
the deleted file is confirmed gone from disk, not just the database row.

**No customer accounts were added.** An inquiry, a booking, and an order
all work the same way today: no login, just a form. That's a deliberate
choice, not a gap — this matches how WhatsApp-order businesses actually
operate, and a "call me back" inquiry doesn't need an account any more than
a booking does. The codebase is organized cleanly enough to add a parallel
`customers` table and its own JWT scope later if a real use case demands
it, but nothing here was built speculatively in that direction.

## Security hardening pass

A few things worth knowing that were tightened up after review:

- **Cookie-based auth, not CSRF tokens**: the session is a JWT in an
  `httpOnly`, `SameSite=Lax` cookie. Every mutating endpoint is POST/PATCH/
  DELETE, never GET, and `Lax` cookies aren't sent on cross-site POSTs — that
  closes the standard CSRF vector without adding a token. `httpOnly` is what
  protects the token from theft via XSS, which is the more likely risk here
  than CSRF.
- **Media uploads**: SVG is not accepted (it can carry an embedded `<script>`,
  a real stored-XSS vector when served back same-origin). JPEG/PNG/WebP are
  verified by actual file bytes (magic numbers), not just the client-supplied
  `Content-Type` header, which is trivially spoofable. A `productId` passed
  with an upload is verified to belong to the requesting tenant before
  anything is linked.
- **Theme serving**: `theme_slug` is checked against an explicit whitelist
  built from what's actually on disk at startup, not just "does this path
  exist" — closes a path-traversal risk before it's exploitable (there's no
  endpoint yet that lets a merchant set their own `theme_slug`, but there
  will be, and this means that feature won't reopen the hole).
- **Order locking**: when an order has multiple items, product rows are
  locked in a consistent order (sorted by `productId`) across every
  transaction — prevents two concurrent orders touching the same products in
  reversed order from deadlocking each other.
- **Matrix requests** have an 8-second timeout. Without it, a hung homeserver
  wouldn't just leak a background promise for order notifications —
  `/api/matrix/connect` awaits the Matrix call directly in the request
  handler, so it would hang that HTTP response open indefinitely.
- `JWT_SECRET` is validated at startup (must be set, 16+ characters) — fails
  loudly and immediately rather than surfacing as a cryptic error the first
  time someone tries to log in.
- `helmet` is enabled for standard security headers (frame options, no-sniff,
  HSTS, referrer policy). Its default Content-Security-Policy is
  **deliberately disabled**: Alpine.js evaluates expressions via
  `new Function()`, which needs `unsafe-eval`, and both the admin and public
  pages use inline `style=""` attributes, which need `unsafe-inline`.
  Helmet's strict default would have silently broken the dashboard rather
  than raising an obvious error — worth knowing if you tighten this later.
- `morgan` logs every request to the console (dev-formatted locally,
  combined-format under `NODE_ENV=production`).
- A centralized error handler is the last thing mounted in `app.js` — always
  returns a plain `{ error }` JSON body, never a stack trace, whatever the
  underlying cause.
- The Postgres pool now has explicit limits (`max` connections, idle/connection
  timeouts) instead of relying on implicit `pg` defaults.

## Adding a new theme

Copy `themes/hangtag/` to `themes/<new-slug>/`, redesign `index.html` +
`src/input.css` however you like, run `npm run build:css` inside that folder.
Any tenant's `theme_slug` in `store_configs` can then point at it — the
`theme-server` middleware picks it up automatically, no code change needed.

## Running it

```bash
cp .env.example .env      # edit POSTGRES_PASSWORD and JWT_SECRET for real use
docker compose up -d
```

First boot creates `./data/postgres` — delete it to reset from scratch.
Migrations run automatically on container start (`docker-entrypoint.sh`,
before the server boots), so a fresh volume gets the full schema applied
with no manual step. `./data/media` is mounted into the app container for
merchant photo uploads (until/unless that moves to object storage — same
volume mount idea either way).

**Note on this delivery:** tested directly against a real local Postgres
instance — signup, login, cross-tenant auth isolation, product CRUD, order
placement with stock decrement (including a rollback check on an oversell
attempt), theme-aware storefront serving, tenant-scoped media isolation, the
full admin dashboard flow, base-domain signup with the cross-subdomain
cookie fix, and photo upload (including rejecting oversized/wrong-type files)
all passed. The `docker-compose.yml` itself is syntax-validated but wasn't
run end-to-end in this environment (no container runtime available here) —
run `docker compose up` and check `docker compose logs app` on first deploy
to catch anything environment-specific.

## Local dev without Docker

```bash
npm install
createdb afrexpay_dev
cp .env.example .env   # set DATABASE_URL to your local Postgres
export DATABASE_URL=postgres://<user>:<pass>@localhost:5432/afrexpay_dev
npm run migrate:up
npm run dev
```

Subdomains don't exist on localhost, so either:
- send a real `Host` header: `curl -H "Host: 256-merch.afrexpay.com" localhost:3000/api/products`
- or append `?tenant=256-merch` to any request — the resolver checks this first

## Pipeline & releases

`main` is the deployable branch. Every push and pull request runs
`.github/workflows/ci.yml`: install (`npm ci`), full test suite
(`npm test` — DB-free by design, no Postgres service needed), syntax check
of all backend entry points, and a `docker build` smoke test so a broken
Dockerfile can't merge silently.

Releases are tags (`v1.2.3`). Pushing a tag runs
`.github/workflows/release.yml`, which builds the image and publishes it to
GitHub Container Registry as `ghcr.io/<owner>/afrexpay:<tag>` (plus
`latest` for tags on the default branch). Deploy = pull the tag and
`docker compose up -d`. The image ships migrations and runs them at boot
(`docker-entrypoint.sh`), so a fresh tag against an old volume migrates
itself forward with no manual step.

Versioning is `\(MAJOR\).\(MINOR\).\(PATCH\)`: breaking API change, new
endpoint/feature, fix. The `version` in `package.json` moves with the tag.

## API surface

- `POST /api/auth/signup` — creates tenant + owner user + empty config row, sets session cookie
- `POST /api/auth/login` / `POST /api/auth/logout`
- `GET /api/config` — public, `{ config, theme_slug }` for the resolved tenant
- `PATCH /api/config` — merchant-only, partial jsonb merge
- `GET /api/products` — public catalog, accepts `?search=&limit=&offset=&dir=` (search covers SKU, name, category)
- `POST /api/products` / `PATCH /api/products/:id` / `DELETE /api/products/:id` — merchant-only (delete is a soft-deactivate)
- `POST /api/orders` — public, re-validates price/size/stock server-side, decrements stock transactionally
- `POST /api/orders/:id/checkout` — public, creates a Stripe Checkout session for an existing order, returns the redirect URL
- `GET /api/orders` — merchant-only, that tenant's orders (includes `payment_status`); accepts `?search=&status=&limit=&offset=&dir=` (`status` in `pending|confirmed|fulfilled|cancelled`, matching the `order_status` enum)
- `PATCH /api/orders/:id` — merchant-only fulfil/cancel, `{ status }` from the same enum; 404 for other tenants' orders. The payment webhook remains the only writer of `payment_status`
- `POST /api/media` — merchant-only, multipart upload, links to a product if `productId` is given
- `POST /api/matrix/connect` — merchant-only, `{ matrixUserId }` → creates/reuses a room and invites them, no room ID ever handled client-side
- `POST /api/auth/request-password-reset` / `POST /api/auth/reset-password` — always returns a generic message regardless of whether the email exists
- `GET /api/config/themes` — merchant-only, list of installed theme slugs + current
- `PATCH /api/config/theme` — merchant-only, `{ themeSlug }`, validated against the on-disk whitelist
- `GET /api/services` — public list, accepts `?search=&limit=&offset=&dir=`; `POST` / `PATCH /:id` / `DELETE /:id` — merchant-only
- `GET /api/availability/windows` / `PUT /api/availability/windows` — merchant-only weekly hours (full replace, not patch)
- `GET /api/availability/exceptions` / `POST /api/availability/exceptions` / `DELETE /api/availability/exceptions/:id` — merchant-only blackout/extra-hours dates; list accepts `?status=open|blocked&limit=&offset=&dir=`
- `GET /api/availability/slots?serviceId=&date=` — public, computed free slots for a service on a date
- `POST /api/bookings` — public, relies on the DB exclusion constraint to prevent double-booking (returns 409 on conflict)
- `POST /api/bookings/:id/checkout` — public, creates a Stripe Checkout session for an existing booking, returns the redirect URL
- `GET /api/bookings` — merchant-only, accepts `?search=&status=&limit=&offset=&dir=`; `PATCH /api/bookings/:id` — merchant-only status update
- `GET /api/config/verticals` — merchant-only, the vertical registry (labels, tabs, compatible themes)
- `GET /api/listings` — public list, accepts `?search=&limit=&offset=&dir=`; `POST` / `PATCH /:id` / `DELETE /:id` — merchant-only
- `POST /api/inquiries` — public, no auth; `GET /api/inquiries` — merchant-only, accepts `?search=&limit=&offset=&dir=`
- `GET /api/media/for/:entityType/:entityId` — public, all photos for a listing (or any entity)
- `DELETE /api/media/:id` — merchant-only, tenant-scoped, removes DB row + file on disk
- `PUT /api/media/order` — merchant-only, `{ mediaIds: [...] }`, full-replace reorder
- `GET /api/payments/credentials/:provider` — merchant-only, never returns decrypted secrets, includes the server-computed webhook URL for Stripe
- `PUT /api/payments/credentials/:provider` — merchant-only, blank fields keep their existing stored value rather than being overwritten with empty
- `POST /api/listing-reservations` — public, creates a pending reservation for a listing that has a deposit configured
- `POST /api/listing-reservations/:id/checkout` — public, creates a Stripe Checkout session, returns the redirect URL
- `GET /api/listing-reservations` — merchant-only, all reservations with payment status, accepts `?search=&limit=&offset=&dir=`

List filtering contract (all eight list endpoints): `search` is a trimmed,
100-char-max multi-word match (every word must appear); `limit` defaults to
50 and clamps to 100; `offset` defaults to 0; `dir` is `asc`/`desc` with a
per-resource default (catalogs read oldest-first, feeds read newest-first).
Sort column is fixed per resource — direction is the only user input, so
there is no `ORDER BY` injection surface. Shared parsing lives in
`src/lib/list-query.js` and is covered by `tests/list-query.test.js`.
- `POST /api/payments/webhook/stripe/:tenantId` and `POST /api/payments/webhook/paypal/:tenantId` — unauthenticated by nature (the provider calls these directly), verified by per-tenant signature only; mounted before `express.json()` since they need raw request bytes. The dashboard shows these exact URLs per provider — if they ever drift from the mount in `src/app.js`, merchants paste a dead endpoint and payments silently never confirm
- `GET /` — storefront (on a subdomain) or marketing/signup page (on the base domain)
- `GET /admin` — merchant dashboard (same UI for every tenant)
- `GET /media/<filename>` — tenant-scoped product photos

## Not built yet, deliberately

- PayPal — shipped via the provider registry (`src/modules/payments/providers/`),
  same shape as Stripe; merchants pick a provider per checkout and the
  dashboard shows the correct per-provider webhook URL
- Abandoned-checkout stock restore — an `unpaid` order holds decremented
  stock and a `pending` booking holds its slot until the merchant cancels;
  acceptable for v1 (badges make it visible), needs a real policy before
  high-volume use
- Stripe Connect — the correct upgrade once there are enough tenants that
  a shared platform account beats bring-your-own-keys; deliberately not
  built for a first client
- Refunds — `payments.status` supports a `refunded` value in the schema,
  no endpoint or dashboard action triggers it yet
- Marketplace / QR discovery layer — schema supports adding this without rework
- Object storage for media (currently local disk under `data/media/` — fine
  at small scale, but a VPS disk failure would mean lost photos; swapping the
  `multer` disk storage engine for an S3-compatible one in `media.routes.js`
  is the upgrade path when that matters)
- Automated backups of `./data` (README mentions the approach, nothing runs it yet)
- CAPTCHA on signup — rate limiting (5 signups/hour/IP) covers most of the
  practical risk already; a real CAPTCHA means depending on a third-party
  service, worth adding only if actual spam shows up
- Multi-staff/multi-resource booking — the exclusion constraint scopes
  conflicts per-tenant, not per-resource; fine for a solo provider, needs a
  small schema extension (a `resource_id` column) for a multi-chair salon
- ~~No signup-time choice of vertical or theme~~ — shipped: the landing
  page wizard collects vertical + theme, `POST /api/auth/signup` validates
  them (`VALID_VERTICALS`, `isThemeCompatible`) and seeds `store_configs`
  with the choice, so a new tenant lands on their own theme immediately
- Online courses / digital-content sales — deliberately out of scope; it's
  neither of the three shapes this platform handles (physical goods,
  time-slot bookings, catalog + lead capture) and would need real
  content-delivery and access-control work of its own
- Customer accounts — orders, bookings, and inquiries are all anonymous
  lead/transaction capture today, no login required. Deliberate, not a gap;
  see "Real estate listings" above for the reasoning
