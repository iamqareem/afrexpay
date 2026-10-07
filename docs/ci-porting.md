# CI porting contract (leaving GitHub without rewriting logic)

All CI logic lives in `scripts/ci.sh` (+ `scripts/build-themes.sh`),
which assume only: POSIX `sh`, `git`, Node 22, `npm`, and optionally
`docker`/`podman` (compose validation skips gracefully without either).
A provider's workflow file is therefore a ~15-line runner, never logic.
If GitHub ever gates compute, porting = rewriting the runner below.

## What a runner must provide

1. A Linux checkout of the repo at the PR/push ref.
2. Node 22 + npm (or just run the repo's pinned toolchain your way —
   `scripts/ci.sh` calls `npm ci` itself).
3. Execute `./scripts/ci.sh`, fail the pipeline on non-zero exit.

That is the entire contract. No secrets, no caches required for
correctness, no GitHub expressions, no service containers (tests are
DB-free by design).

## Reference A — Forgejo Actions (self-hostable, free)

`.forgejo/workflows/ci.yaml` (Gitea/Forgejo Actions syntax — same shape
as the GitHub file, different directory):

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: ./scripts/ci.sh
```

## Reference B — GitLab CI

```yaml
stages: [test]
ci:
  stage: test
  image: node:22
  script:
    - apt-get update && apt-get install -y git
    - ./scripts/ci.sh
```

## Deliberately NOT in CI

- No auto-deploy, no images, no registry (stripped by decision).
- No secrets in any runner.
- Humans deploy from `docs/runbook-deploy.md`; CI stays advisory
  red/green only.
