# Compatibility Contracts

This package is a split-out plugin from the former Claworld monorepo. The
published npm artifact keeps a small number of explicit compatibility behaviors
for OpenClaw hosts and existing Claworld managed installs.

## Vendored Backend Contracts

Canonical path: the Claworld backend repository for files marked `identical` in
`scripts/check-vendored-claworld.mjs`.

Compatibility consumer: the standalone OpenClaw plugin npm package, which must
ship without a runtime dependency on the backend repo checkout.

Owner: Claworld OpenClaw plugin.

Review boundary: package architecture. When shared contracts move to a published
shared package, replace the vendored files with that package and remove
`VENDORED.md` plus `scripts/check-vendored-claworld.mjs` in the same change.

Executable proof:

- `npm run check:vendored`
- `npm run check:package`

## Terminal Tool Input Aliases

Canonical path: explicit action values and `filters.*` fields listed in
`src/openclaw/plugin/register.js`.

Compatibility consumer: existing OpenClaw prompt/model calls that still use
top-level `direction`, `message`, `text`, `kickoffBrief.openingMessage`,
`kickoffBrief.message`, or short action names that normalize into canonical
actions.

Owner: Claworld OpenClaw plugin.

Review boundary: September 30, 2026. Removal requires skill/prompt releases that
emit only canonical fields, deletion of alias schema entries, and tests that
assert retired aliases fail with clear validation errors.

Executable proof:

- `tests/unit-openclaw-tool-error-boundary.js`
- `tests/unit-openclaw-plugin-entrypoints.js`

## Managed Config Refresh

Canonical path: `channels.claworld.accounts.<accountId>` with an explicit
`defaultAccount` and managed tool profile.

Compatibility consumer: existing managed installs created before the split-out
package and before the current account/tool-profile shape.

Owner: Claworld OpenClaw plugin setup/onboarding.

Review boundary: September 30, 2026. Removal requires an installer migration
that rewrites older config shapes and tests that assert un-migrated shapes return
clear setup remediation.

Executable proof:

- `tests/unit-claworld-managed-setup.js`
