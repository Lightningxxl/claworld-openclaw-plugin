import assert from 'assert';
import { registerClaworldPlugin } from '../src/openclaw/index.js';

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

async function main() {
  const tools = [];
  const cfg = {
    channels: {
      claworld: {
        defaultAccount: 'moza',
        accounts: {
          moza: {
            enabled: true,
            serverUrl: 'http://127.0.0.1:8787',
            apiKey: 'demo-plugin-key',
            accountId: 'moza',
            relay: {
              agentId: 'agt_moza',
              credentialToken: 'relay_at_moza',
            },
          },
        },
      },
    },
  };
  let accountRelayMode = 'live';

  registerClaworldPlugin(
    {
      registerChannel() {},
      registerTool(tool) {
        tools.push(tool);
      },
      config: {
        async loadConfig() {
          return cfg;
        },
      },
    },
    {
      fetchImpl: async (url, init = {}) => {
        const href = String(url);
        const method = String(init?.method || 'GET').toUpperCase();
        if (href.endsWith('/v1/profile') && method === 'POST') {
          return jsonResponse({
            status: 'ready',
            ready: true,
            agentId: 'agt_moza',
            publicIdentity: {
              status: 'ready',
              displayName: 'Moza',
              code: 'MOZA',
              displayIdentity: 'Moza#MOZA',
              confirmedAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:00:00.000Z',
            },
            accountProfile: {
              status: 'ready',
              ready: true,
              profile: 'Builds careful product tests.',
            },
            profile: 'Builds careful product tests.',
          });
        }
        if (href.endsWith('/v1/account') && method === 'POST') {
          const common = {
            status: 'ready',
            readiness: 'ready',
            account: {
              agentId: 'agt_moza',
              emailVerified: true,
              email: 'yuanhangxurobin@gmail.com',
              profileReady: true,
            },
            diagnostics: {
              emailVerified: true,
              publicIdentityReady: true,
              accountProfileReady: true,
              ...(accountRelayMode === 'live' ? { relayOnline: true } : {}),
            },
          };
          if (accountRelayMode === 'live') {
            return jsonResponse({
              ...common,
              relay: {
                agentId: 'agt_moza',
                online: true,
                resolved: true,
                connectedAt: '2026-07-06T00:00:00.000Z',
                lastHeartbeatAt: '2026-07-06T00:00:01.000Z',
              },
            });
          }
          return jsonResponse(common);
        }
        if (href.endsWith('/v1/agents') && method === 'GET') {
          return jsonResponse({
            items: [
              {
                agentId: 'agt_moza',
                displayName: 'Moza',
                discoverable: true,
                contactable: true,
              },
            ],
          });
        }
        throw new Error(`unexpected request ${method} ${href}`);
      },
    },
  );

  const manageAccount = tools.find((tool) => tool.name === 'claworld_manage_account');
  assert.ok(manageAccount, 'expected account management tool to register');

  const liveResult = await manageAccount.execute('tool_account_live', {
    accountId: 'moza',
    action: 'view_account',
  });
  const livePayload = JSON.parse(liveResult.content[0].text);
  assert.equal(livePayload.status, 'ready');
  assert.equal(livePayload.relay.agentId, 'agt_moza');
  assert.equal(livePayload.relay.online, true);
  assert.equal(livePayload.relay.resolved, true);
  assert.equal(livePayload.diagnostics.relayOnline, true);
  assert.equal(livePayload.diagnostics.relayPresenceResolved, true);
  assert.equal(livePayload.diagnostics.relayIdentityResolved, true);

  accountRelayMode = 'omitted';
  const omittedResult = await manageAccount.execute('tool_account_omitted', {
    accountId: 'moza',
    action: 'view_account',
  });
  const omittedPayload = JSON.parse(omittedResult.content[0].text);
  assert.equal(omittedPayload.status, 'ready');
  assert.equal(omittedPayload.relay.agentId, 'agt_moza');
  assert.equal(omittedPayload.relay.online, null);
  assert.equal(omittedPayload.relay.resolved, false);
  assert.equal(omittedPayload.diagnostics.relayOnline, null);
  assert.equal(omittedPayload.diagnostics.relayPresenceResolved, false);
  assert.equal(omittedPayload.diagnostics.relayIdentityResolved, true);

  console.log('PASS unit-openclaw-account-view-relay');
}

main().catch((error) => {
  console.error('FAIL unit-openclaw-account-view-relay');
  console.error(error);
  process.exit(1);
});
