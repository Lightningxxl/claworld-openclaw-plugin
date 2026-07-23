#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BACKEND_REPO = path.resolve(REPO_ROOT, '..', 'claworld');
const BACKEND_REPO = path.resolve(process.env.CLAWORLD_BACKEND_REPO || DEFAULT_BACKEND_REPO);

const VENDORED_FILES = Object.freeze([
  {
    path: 'src/lib/chat-request.js',
    mode: 'identical',
  },
  {
    path: 'src/lib/public-identity.js',
    mode: 'identical',
  },
  {
    path: 'src/lib/relay/agent-readable-markdown.js',
    mode: 'forked',
    reason: 'OpenClaw package keeps host-specific live-reply guidance for the OpenClaw message tool.',
  },
  {
    path: 'src/lib/relay/kickoff-progress.js',
    mode: 'identical',
  },
  {
    path: 'src/lib/relay/kickoff-text.js',
    mode: 'identical',
  },
  {
    path: 'src/lib/relay/shared.js',
    mode: 'identical',
  },
  {
    path: 'src/lib/runtime-errors.js',
    mode: 'identical',
  },
  {
    path: 'src/product-shell/contracts/search-item.js',
    mode: 'forked',
    reason: 'OpenClaw package exposes its terminal feedback action in search affordances.',
  },
  {
    path: 'src/product-shell/contracts/world-orchestration.js',
    mode: 'identical',
  },
  {
    path: 'src/product-shell/orchestration/world-conversation-text.js',
    mode: 'identical',
  },
]);

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function main() {
  if (!fs.existsSync(path.join(BACKEND_REPO, 'package.json'))) {
    console.log(`SKIP vendored Claworld check: backend repo not found at ${BACKEND_REPO}`);
    return;
  }

  const errors = [];
  const notes = [];

  for (const entry of VENDORED_FILES) {
    const pluginPath = path.join(REPO_ROOT, entry.path);
    const backendPath = path.join(BACKEND_REPO, entry.path);
    if (!fs.existsSync(pluginPath)) {
      errors.push(`missing vendored file in plugin: ${entry.path}`);
      continue;
    }
    if (!fs.existsSync(backendPath)) {
      errors.push(`missing source file in backend: ${entry.path}`);
      continue;
    }

    if (entry.mode === 'identical') {
      if (readText(pluginPath) !== readText(backendPath)) {
        errors.push(`vendored file drifted from backend source: ${entry.path}`);
      }
      continue;
    }

    notes.push(`${entry.path}: ${entry.reason}`);
  }

  if (errors.length > 0) {
    console.error('Vendored Claworld check failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`PASS vendored Claworld check against ${BACKEND_REPO}`);
  for (const note of notes) console.log(`FORK ${note}`);
}

main();
