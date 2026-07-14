#!/usr/bin/env node

import assert from 'node:assert/strict';

import { assertReleaseGitState } from '../scripts/publish-package.mjs';

function createGitCommand({ branch = 'staging', status = '', head = 'abc123', remoteHead = head } = {}) {
  return (args) => {
    const command = args.join(' ');
    if (command === 'rev-parse --abbrev-ref HEAD') return { stdout: `${branch}\n` };
    if (command === 'status --porcelain --untracked-files=all') return { stdout: status };
    if (command === 'fetch origin staging --quiet') return { stdout: '' };
    if (command === 'rev-parse HEAD') return { stdout: `${head}\n` };
    if (command === 'rev-parse origin/staging') return { stdout: `${remoteHead}\n` };
    throw new Error(`unexpected git command: ${command}`);
  };
}

assert.doesNotThrow(() => assertReleaseGitState({ gitCommand: createGitCommand() }));

assert.throws(
  () => assertReleaseGitState({ gitCommand: createGitCommand({ branch: 'feature' }) }),
  /releases must run from the staging branch/,
);

assert.throws(
  () => assertReleaseGitState({ gitCommand: createGitCommand({ status: '?? local-only.js\n' }) }),
  /working tree must be clean before release/,
);

assert.throws(
  () => assertReleaseGitState({ gitCommand: createGitCommand({ remoteHead: 'def456' }) }),
  /staging must match origin\/staging before release/,
);

console.log('PASS unit-publish-package-git-state');
