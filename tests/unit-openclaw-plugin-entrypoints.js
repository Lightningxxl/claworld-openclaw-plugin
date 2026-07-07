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
  assert.deepEqual(
    full.tools.map(({ tool }) => tool.name).sort(),
    [
      'claworld_get_public_profile',
      'claworld_manage_account',
      'claworld_manage_conversations',
      'claworld_manage_worlds',
      'claworld_search',
    ],
  );
  const manageAccount = full.tools.find(({ tool }) => tool.name === 'claworld_manage_account')?.tool;
  assert.ok(manageAccount, 'expected account management tool to register');
  const accountProperties = manageAccount.parameters?.properties || {};
  assert.ok(accountProperties.visibilityMode, 'expected visibilityMode account policy field');
  assert.ok(accountProperties.contactMode, 'expected contactMode account policy field');
  assert.ok(accountProperties.chatRequestPolicy, 'expected chatRequestPolicy account policy field');
  assert.equal(Object.prototype.hasOwnProperty.call(accountProperties, 'discoverable'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(accountProperties, 'contactable'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(accountProperties, 'chatRequestApprovalPolicy'), false);
  assert.ok(accountProperties.action.enum.includes('set_visibility_mode'));
  assert.ok(accountProperties.action.enum.includes('set_contact_mode'));
  assert.ok(accountProperties.action.enum.includes('set_chat_request_policy'));
  assert.equal(accountProperties.action.enum.includes('set_discoverability'), false);
  assert.equal(accountProperties.action.enum.includes('set_contactability'), false);
  assert.equal(accountProperties.action.enum.includes('set_chat_policy'), false);

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
