# Theme CSS runbook (by hand)

Each theme ships **source** (`themes/<name>/src/input.css` + Tailwind
config) and a **built** bundle (`themes/<name>/css/style.css`) that the
server actually serves. The built file goes stale silently whenever the
source, the config, or the markup/JS class usage changes without a
rebuild — real example: listing-grid's dark/light toggle did nothing for
its entire life because the committed CSS predated the `[data-theme]`
block in its own source.

## Rule

Rebuild (and commit the result) after touching, in any theme:

- `src/*.css`, `tailwind.config.js`, or
- any class in `index.html` / `js/**` (added, removed, or renamed).

Logic/data fixes (fetch URLs, escaping, confirm flows) never need a
rebuild — they ship as runtime JS.

## Procedure (per theme)

```bash
cd themes/<name>
npm ci
npm run build:css   # or plain `build` if the theme has no build:css script
cd ../..
git status --short   # expect only themes/<name>/css/style.css changed
```

## Verify the rebuild did what you meant

```bash
# the feature you changed must be present in the output, e.g. themes:
grep -c "data-theme" themes/<name>/css/style.css
# spot-check a class you added/depend on:
grep -o "my-new-class[^ {]*" themes/<name>/css/style.css | head -2
```

Tailwind purges unused utilities by design: a big diff that is mostly
deletions is normal (dead utilities leaving). A diff that *loses* a class
your markup uses is a broken build — check the content globs in that
theme's `tailwind.config.js` (`index.html` + `js/**` must both be listed)
and whether the class is constructed dynamically in JS (string
concatenation), which static scanning cannot see.

## Staleness symptoms (how to recognize this outage)

- A toggle/switch that flips state (check DevTools: attribute changes)
  with zero visual effect → the CSS never learned the selector.
- Parts of a theme unstyled after a markup change → classes added to
  markup/JS but never rebuilt into the bundle.

`scripts/build-themes.sh --check` automates this detection in CI; this
document is the human procedure behind it.
