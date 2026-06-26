# CI Speed Draft

This draft keeps the hosted GitHub CI path as the source of truth while making three changes:

- hosted CI uses a shallow checkout and skips Bun setup/install when no package checks are needed;
- the same scoped check runner can be used locally with `bun run ci:preflight -- --base origin/main`;
- contract checks are split into fast compile/test checks and the forced storage-layout check.

## Self-hosted runner

To run CI on a warm local machine, register a GitHub Actions self-hosted runner with labels such as:

```text
self-hosted, macOS, veydrift
```

Then set the repository variable:

```text
VEYDRIFT_LOCAL_CI_RUNNER_LABELS=["self-hosted","macOS","veydrift"]
```

When the variable is unset, CI keeps using `ubuntu-latest`.

The draft only routes PRs authored by `backmeupplz` to the self-hosted runner. Other PRs
and all `push` events keep using GitHub-hosted `ubuntu-latest`.

## Storage Layout Gate

`packages/contracts` now has:

- `bun run check:fast`: `forge fmt --check`, `forge build --sizes`, and `forge build`;
- `bun run check:storage`: forced storage-layout build plus layout comparison;
- `bun run check`: both checks, preserving the old local full check behavior.

PR CI runs `check:storage` only when storage-relevant files changed:

- `packages/contracts/src/*.sol`;
- `packages/contracts/foundry.toml`;
- `packages/contracts/package.json`;
- `packages/contracts/storage-layout/**`;
- `packages/contracts/scripts/check-storage-layout.mjs`;
- `packages/contracts/scripts/regen-storage-layout.mjs`;
- repo-wide CI/package lock changes.

Contract tests still run for any `packages/contracts/**` change.
