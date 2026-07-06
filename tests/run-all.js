#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const TEST_GROUPS = {
  unit: [
    'tests/unit-claworld-plugin-version.js',
    'tests/unit-claworld-lifecycle.js',
    'tests/unit-claworld-working-memory.js',
    'tests/unit-claworld-managed-setup.js',
    'tests/unit-openclaw-plugin-entrypoints.js',
    'tests/unit-openclaw-account-view-relay.js',
    'tests/unit-openclaw-tool-error-boundary.js',
    'tests/unit-relay-client-error-boundary.js',
    'tests/unit-relay-client-management-events.js',
  ],
};

const requestedGroup = process.argv[2] || 'unit';
const selectedTests = TEST_GROUPS[requestedGroup];

if (!selectedTests) {
  console.error(`Unknown test group: ${requestedGroup}`);
  console.error(`Available groups: ${Object.keys(TEST_GROUPS).join(', ')}`);
  process.exit(1);
}

for (const testPath of selectedTests) {
  const result = spawnSync(process.execPath, [testPath], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`PASS ${requestedGroup} tests`);
