#!/bin/sh
# scripts/build-themes.sh — build every theme that has a build:css script.
#   ./scripts/build-themes.sh          rebuild in place
#   ./scripts/build-themes.sh --check rebuild in place, then fail if any
#                              committed css/style.css differs (stale build)
# NOTE: --check intentionally dirties the tree on a dev machine — that diff
# is the signal (commit it). In CI the checkout is disposable.
set -eu

mode="${1:-build}"
for d in themes/*/; do
  # Build script names differ per theme (most use build:css; automobile
  # also has a plain unminified build). Prefer build:css — the committed
  # bundles are minified — and fall back to build so no theme is skipped.
  script="build"
  if [ -f "$d/package.json" ] && grep -q '"build:css"' "$d/package.json"; then
    script="build:css"
  fi
  if [ -f "$d/package.json" ] && grep -q "\"$script\"" "$d/package.json"; then
    echo "building $(basename "$d") (npm run $script)..."
    (cd "$d" && npm ci --no-audit --no-fund && npm run "$script")
  fi
done

if [ "$mode" = "--check" ]; then
  if git diff --quiet -- 'themes/*/css/style.css'; then
    echo "theme CSS fresh"
  else
    echo "STALE theme CSS — rebuild and commit it:"
    git status --short -- 'themes/*/css/style.css'
    exit 1
  fi
fi
