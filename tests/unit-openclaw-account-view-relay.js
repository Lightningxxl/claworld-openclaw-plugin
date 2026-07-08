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
  const publicIdentity = {
    status: 'ready',
    displayName: 'Moza',
    code: 'MOZA',
    displayIdentity: 'Moza#MOZA',
    confirmedAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
  };
  const accountProfile = {
    status: 'ready',
    ready: true,
    profile: 'Builds careful product tests.',
  };
  const shareCard = {
    status: 'ready',
    imageUrl: 'https://staging.claworld.love/v1/share-card/claworld-share-card-moza.jpg?token=card_token',
    downloadUrl: 'https://staging.claworld.love/v1/share-card/claworld-share-card-moza.jpg?token=card_token',
    templateId: 'agent-card.slot-04',
    variant: 'zh',
    imageFormat: 'jpeg',
    mimeType: 'image/jpeg',
    expiresAt: '2026-07-06T02:00:00.000Z',
    description: '该链接为您的 public identity 名片图片，请直接打开或下载后发送给用户。',
  };
  const buildProfileEnvelope = ({ includeShareCard = false, displayName = 'Moza' } = {}) => ({
    status: 'ready',
    ready: true,
    agentId: 'agt_moza',
    publicIdentity: {
      ...publicIdentity,
      displayName,
      displayIdentity: `${displayName}#MOZA`,
    },
    accountProfile,
    profile: accountProfile.profile,
    clientVersionStatus: {
      client: 'openclaw-plugin',
      status: 'latest',
      compatible: true,
      reportedVersion: '2026.7.7-testing.1',
      minSupportedVersion: '2026.7.7-testing.1',
      latestVersion: '2026.7.7-testing.1',
      message: 'OpenClaw Claworld plugin version is up to date.',
    },
    ...(includeShareCard ? { shareCard } : {}),
  });

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
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (href.endsWith('/v1/profile') && method === 'POST') {
          return jsonResponse({
            ...buildProfileEnvelope({ includeShareCard: body.generateShareCard === true }),
            publicIdentity: {
              ...publicIdentity,
              ...(body.displayName ? {
                displayName: body.displayName,
                displayIdentity: `${body.displayName}#MOZA`,
              } : {}),
            },
          });
        }
        if (href.endsWith('/v1/account') && method === 'POST') {
          const common = {
            status: 'ready',
            readiness: 'ready',
            diagnostics: {
              emailVerified: true,
              publicIdentityReady: true,
              accountProfileReady: true,
              ...(accountRelayMode === 'live' ? { relayOnline: true } : {}),
            },
            account: {
              agentId: 'agt_moza',
              displayName: 'Moza',
            publicIdentity: {
              ...publicIdentity,
              ...(body.displayName ? {
                displayName: body.displayName,
                displayIdentity: `${body.displayName}#MOZA`,
              } : {}),
            },
              humanProfile: 'Builds careful product tests.',
              agentProfile: accountProfile.profile,
              legacyProfile: accountProfile.profile,
              emailVerified: true,
              email: 'yuanhangxurobin@gmail.com',
              verifiedAt: '2026-07-06T00:00:00.000Z',
              profileReady: true,
            },
            profile: buildProfileEnvelope({
              includeShareCard: body.generateShareCard === true,
              displayName: body.displayName || 'Moza',
            }),
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
  assert.equal(livePayload.publicIdentity.displayIdentity, 'Moza#MOZA');
  assert.equal(livePayload.profile, 'Builds careful product tests.');
  assert.equal(livePayload.accountProfile.profile, 'Builds careful product tests.');
  assert.equal(livePayload.pluginVersionStatus.status, 'latest');
  assert.equal(JSON.stringify(livePayload).includes('[object Object]'), false);

  const shareCardResult = await manageAccount.execute('tool_account_share_card', {
    accountId: 'moza',
    action: 'view_account',
    generateShareCard: true,
    shareCardVariant: 'zh',
  });
  const shareCardPayload = JSON.parse(shareCardResult.content[0].text);
  assert.equal(shareCardPayload.shareCard.status, 'ready');
  assert.equal(shareCardPayload.shareCard.variant, 'zh');
  assert.equal(shareCardPayload.shareCard.imageUrl, shareCard.imageUrl);
  assert.equal(shareCardPayload.shareCard.downloadUrl, shareCard.downloadUrl);
  assert.equal(shareCardPayload.publicIdentity.displayIdentity, 'Moza#MOZA');
  assert.equal(shareCardPayload.profile, 'Builds careful product tests.');
  assert.equal(JSON.stringify(shareCardPayload).includes('[object Object]'), false);

  const updateIdentityResult = await manageAccount.execute('tool_account_update_display_name', {
    accountId: 'moza',
    action: 'update_display_name',
    displayName: 'Moza Prime',
    shareCardVariant: 'zh',
  });
  const updateIdentityPayload = JSON.parse(updateIdentityResult.content[0].text);
  assert.equal(updateIdentityPayload.action, 'update_display_name');
  assert.equal(updateIdentityPayload.publicIdentity.displayIdentity, 'Moza Prime#MOZA');
  assert.equal(updateIdentityPayload.shareCard.status, 'ready');
  assert.equal(updateIdentityPayload.shareCard.imageUrl, shareCard.imageUrl);
  assert.equal(JSON.stringify(updateIdentityPayload).includes('[object Object]'), false);

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
