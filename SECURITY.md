# Security

## Reporting

Report privately through
[GitHub's advisory form](https://github.com/ovurrsl/plugin-warehouse/security/advisories/new).
Please do not open a public issue first.

## What the threat model actually is

This package ships **TypeScript source** and is installed directly from git into
someone else's editor build, where the host transpiles it. There is no published
artefact to tamper with and no install script — but it also means anything this
code does at module scope runs inside the consuming application.

That shapes what is worth reporting:

- **Module-scope side effects.** The manifest barrel (`src/index.ts`) is
  imported eagerly during the host's server prerender. Anything reachable from
  it that touches `document`, `window`, the network, or the filesystem is a bug
  and potentially worse than a bug.
- **Supply chain.** Workflow actions are pinned to full commit SHAs rather than
  tags, because a tag can be moved by whoever controls the action's repository.
  An unpinned action in a pull request is worth flagging.
- **Host store writes.** The plugin writes to the host scene through the
  documented `SceneApi` / `useScene` surface only. A write that reaches around
  it is in scope.

## Not in scope

Rendering artefacts, wrong dimensions, and capacity figures that disagree with a
catalogue. Those are ordinary bugs — please
[open an issue](https://github.com/ovurrsl/plugin-warehouse/issues/new/choose)
with the node settings, which is what makes them reproducible.

## Supported versions

Pre-1.0. Fixes land on `main`; there are no maintained release branches. Pin a
commit SHA in your host's dependency and move it deliberately.
