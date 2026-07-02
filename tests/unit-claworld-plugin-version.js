import assert from 'assert';
import { buildRuntimeAuthHeaders } from '../src/openclaw/plugin/account-identity.js';
import {
  CLAWORLD_CLIENT_CHANNEL_HEADER,
  CLAWORLD_CLIENT_HEADER,
  CLAWORLD_CLIENT_VERSION_HEADER,
  CLAWORLD_OPENCLAW_PLUGIN_CLIENT,
  CLAWORLD_PLUGIN_CURRENT_VERSION,
  inferClaworldClientChannel,
} from '../src/openclaw/plugin-version.js';

assert.match(CLAWORLD_PLUGIN_CURRENT_VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const runtimeHeaders = buildRuntimeAuthHeaders({ appToken: 'tok' });
assert.equal(runtimeHeaders[CLAWORLD_CLIENT_HEADER], CLAWORLD_OPENCLAW_PLUGIN_CLIENT);
assert.equal(runtimeHeaders[CLAWORLD_CLIENT_VERSION_HEADER], CLAWORLD_PLUGIN_CURRENT_VERSION);
assert.equal(runtimeHeaders[CLAWORLD_CLIENT_CHANNEL_HEADER], inferClaworldClientChannel());
assert.equal(Object.hasOwn(runtimeHeaders, 'x-claworld-plugin-version'), false);

console.log('PASS unit-claworld-plugin-version');
