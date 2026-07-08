# Vendored Claworld Backend Modules

The OpenClaw plugin was split out of the former monorepo. A small set of backend
contract modules is vendored into this package so the published plugin remains a
self-contained npm artifact.

Canonical source for identical files is the Claworld backend checkout at the
same relative path. The check script uses `../claworld` by default during local
development, or `CLAWORLD_BACKEND_REPO=<path>` when the backend checkout lives
elsewhere.

Run `npm run check:vendored` before publishing after copying backend contract
changes. Files marked `identical` in `scripts/check-vendored-claworld.mjs` must
match the backend byte-for-byte. Files marked `forked` carry OpenClaw-specific
host semantics and must keep a reason in the manifest.

Current intentional forks:

- `src/lib/relay/agent-readable-markdown.js`: OpenClaw-specific live-reply
  guidance names the OpenClaw message tool.
- `src/product-shell/contracts/search-item.js`: OpenClaw terminal search
  affordances include the plugin feedback action.
