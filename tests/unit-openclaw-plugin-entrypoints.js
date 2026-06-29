import assert from 'assert';
import claworldChannelEntry, { claworldChannelPlugin, register } from '../index.js';
import claworldSetupEntry, { claworldSetupPlugin } from '../setup-entry.js';

function createRegistrationApi(registrationMode = 'full') {
  const channels = [];
  const httpRoutes = [];
  const tools = [];

  return {
    api: {
      registrationMode,
      runtime: {
        config: {
          async loadConfig() {
            return {};
          },
        },
      },
      registerChannel({ plugin }) {
        channels.push(plugin);
      },
      registerHttpRoute(route) {
        httpRoutes.push(route);
      },
      registerTool(tool, options) {
        tools.push({ tool, options });
      },
    },
    channels,
    httpRoutes,
    tools,
  };
}

async function main() {
  assert.equal(typeof claworldChannelEntry, 'object');
  assert.equal(claworldChannelEntry.id, 'claworld');
  assert.equal(claworldChannelEntry.name, 'Claworld Relay Channel');
  assert.equal(claworldChannelEntry.description, 'Claworld relay channel plugin for OpenClaw.');
  assert.equal(typeof claworldChannelEntry.register, 'function');
  assert.equal(claworldChannelPlugin.id, 'claworld');
  assert.equal(typeof register, 'function');

  const setupOnly = createRegistrationApi('setup');
  claworldChannelEntry.register(setupOnly.api);
  assert.equal(setupOnly.channels.length, 1);
  assert.equal(setupOnly.channels[0].id, 'claworld');
  assert.equal(setupOnly.httpRoutes.length, 0);
  assert.equal(setupOnly.tools.length, 0);

  const full = createRegistrationApi('full');
  claworldChannelEntry.register(full.api);
  assert.equal(full.channels.length, 1);
  assert.equal(full.channels[0].id, 'claworld');
  assert.equal(full.httpRoutes.length, 1);
  assert.ok(full.tools.length > 0);
  assert.ok(full.tools.every(({ options }) => options == null));

  assert.equal(typeof claworldSetupEntry, 'object');
  assert.equal(claworldSetupEntry.plugin.id, 'claworld');
  assert.equal(typeof claworldSetupEntry.plugin.setup, 'object');
  assert.equal(claworldSetupPlugin.id, 'claworld');

  console.log('PASS unit-openclaw-plugin-entrypoints');
}

main().catch((error) => {
  console.error('FAIL unit-openclaw-plugin-entrypoints');
  console.error(error);
  process.exit(1);
});
