#!/bin/sh
# scripts/ci.sh — the whole gate in one provider-agnostic script.
# Needs only: sh, git, node 22, npm (+ docker or podman for the compose
# validation step, skipped with a notice if neither exists).
# Every CI provider just calls this file; see docs/ci-porting.md.
set -eu

npm ci
npm test

for f in $(git ls-files 'src/**/*.js' 'admin/js/**/*.js' 'public/js/**/*.js'); do
  node --check "$f" || exit 1
done
echo "syntax OK"

missing=0
for d in themes/*/; do
  if [ ! -f "${d}css/style.css" ]; then echo "Missing ${d}css/style.css"; missing=1; fi
done
if [ "$missing" -ne 0 ]; then echo "run ./scripts/build-themes.sh, then commit the result"; exit 1; fi

./scripts/build-themes.sh --check

if command -v docker >/dev/null 2>&1; then
  docker compose config > /dev/null && echo "compose OK (docker)"
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
  podman compose -f docker-compose.yml config > /dev/null && echo "compose OK (podman)"
elif command -v podman-compose >/dev/null 2>&1; then
  podman-compose -f docker-compose.yml config > /dev/null && echo "compose OK (podman-compose)"
else
  echo "NOTE: no docker/podman found — skipping compose validation"
fi

echo "CI GREEN"
