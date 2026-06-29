import assert from 'assert';
import {
  buildClaworldRelayClientVersion,
  CLAWORLD_PLUGIN_CURRENT_VERSION,
  CLAWORLD_PLUGIN_VERSION_HEADER,
  readClaworldPluginVersionFromHeaders,
} from '../src/openclaw/plugin-version.js';

const TESTING_PRERELEASE_VERSION = '2026.04.13-testing.1';

assert.match(CLAWORLD_PLUGIN_CURRENT_VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const parsedHeader = readClaworldPluginVersionFromHeaders({
  [CLAWORLD_PLUGIN_VERSION_HEADER]: ` v${TESTING_PRERELEASE_VERSION} `,
});
assert.equal(parsedHeader.rawVersion, `v${TESTING_PRERELEASE_VERSION}`);
assert.equal(parsedHeader.reportedVersion, TESTING_PRERELEASE_VERSION);
assert.equal(parsedHeader.normalizedVersion, TESTING_PRERELEASE_VERSION);
assert.equal(parsedHeader.source, CLAWORLD_PLUGIN_VERSION_HEADER);

const invalidHeader = readClaworldPluginVersionFromHeaders({
  [CLAWORLD_PLUGIN_VERSION_HEADER]: 'not-a-version',
});
assert.equal(invalidHeader.rawVersion, 'not-a-version');
assert.equal(invalidHeader.reportedVersion, 'not-a-version');
assert.equal(invalidHeader.normalizedVersion, null);
assert.equal(invalidHeader.source, CLAWORLD_PLUGIN_VERSION_HEADER);

const missingHeader = readClaworldPluginVersionFromHeaders({});
assert.equal(missingHeader.rawVersion, null);
assert.equal(missingHeader.reportedVersion, null);
assert.equal(missingHeader.normalizedVersion, null);
assert.equal(missingHeader.source, null);

assert.equal(
  buildClaworldRelayClientVersion(TESTING_PRERELEASE_VERSION),
  `claworld-plugin/${TESTING_PRERELEASE_VERSION}`,
);

console.log('PASS unit-claworld-plugin-version');
