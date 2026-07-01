import assert from 'assert';
import { registerClaworldPlugin } from '../src/openclaw/index.js';

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
  const chatRequestBodies = [];

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
        if (
          String(url).includes('/v1/worlds/dating-demo-world/join')
          && String(init?.method || 'GET').toUpperCase() === 'POST'
        ) {
          return {
            ok: false,
            status: 409,
            async json() {
              return {
                error: 'account_profile_incomplete',
                message:
                  'join world is blocked because the current Claworld account profile is empty; '
                  + 'use claworld_manage_account with action=update_agent_profile first',
                requiredAction: 'update_agent_profile',
                nextAction: 'update_agent_profile',
                nextTool: 'claworld_manage_account',
                missingFields: [
                  {
                    fieldId: 'profile',
                    label: 'Account Profile',
                    description: 'A non-empty global Claworld account profile used when other agents need to know who you are.',
                  },
                ],
              };
            },
          };
        }
        if (
          String(url).includes('/v1/chat-requests')
          && String(init?.method || 'GET').toUpperCase() === 'POST'
        ) {
          const body = JSON.parse(init?.body || '{}');
          chatRequestBodies.push(body);
          if (!String(body.openingMessage || '').trim()) {
            return {
              ok: false,
              status: 400,
              async json() {
                return {
                  error: 'opening_message_required',
                  reason: 'missing_kickoff_brief',
                  message: 'openingMessage is required for chat request kickoff',
                  fieldErrors: [
                    {
                      fieldId: 'openingMessage',
                      message: 'openingMessage is required for chat request kickoff',
                    },
                  ],
                };
              },
            };
          }
          return {
            ok: true,
            status: 201,
            async json() {
              return {
                status: 'pending',
                verdict: 'pending',
                chatRequest: {
                  chatRequestId: `req_${chatRequestBodies.length}`,
                  requestId: `req_${chatRequestBodies.length}`,
                  fromAgentId: body.fromAgentId,
                  toAgentId: 'agt_target',
                  openingMessage: body.openingMessage,
                  kickoffBrief: body.kickoffBrief || { text: body.openingMessage },
                  status: 'pending',
                },
              };
            },
          };
        }
        if (
          (String(url).includes('/v1/moderation/worlds/remote-owner-world')
            || String(url).includes('/v1/worlds/remote-owner-world'))
          && String(init?.method || 'GET').toUpperCase() === 'GET'
        ) {
          return {
            ok: false,
            status: 403,
            async json() {
              return {
                error: 'world_action_not_allowed',
                message: 'agent does not have permission to access world management',
                worldId: 'remote-owner-world',
                agentId: 'agt_moza',
                action: 'view_management',
                actorRole: 'member',
                allowedRoles: ['owner'],
              };
            },
          };
        }
        throw new Error('network_down');
      },
    },
  );

  const search = tools.find((tool) => tool.name === 'claworld_search');
  const manageWorld = tools.find((tool) => tool.name === 'claworld_manage_worlds');
  const requestChat = tools.find((tool) => tool.name === 'claworld_manage_conversations');

  assert.ok(search, 'expected search tool to register');
  assert.ok(manageWorld, 'expected world management tool to register');
  assert.ok(requestChat, 'expected conversation management tool to register');

  const transportResult = await search.execute('tool_list_1', { accountId: 'moza', scope: 'worlds' });
  const transportPayload = JSON.parse(transportResult.content[0].text);
  assert.equal(transportPayload.status, 'error');
  assert.equal(transportPayload.tool, 'claworld_search');
  assert.equal(transportPayload.error, 'claworld_tool_failed');
  assert.equal(transportPayload.code, 'relay_fetch_failed');
  assert.equal(transportPayload.category, 'transport');
  assert.equal(transportPayload.message, 'relay fetch failed');

  const inputResult = await requestChat.execute('tool_send_1', {
    accountId: 'moza',
    action: 'request_chat',
    openingMessage: 'hello',
  });
  const inputPayload = JSON.parse(inputResult.content[0].text);
  assert.equal(inputPayload.status, 'error');
  assert.equal(inputPayload.tool, 'claworld_manage_conversations');
  assert.equal(inputPayload.error, 'claworld_tool_failed');
  assert.equal(inputPayload.code, 'tool_input_invalid');
  assert.equal(inputPayload.category, 'input');
  assert.ok(inputPayload.message.includes('action must be one of'));

  const missingOpeningResult = await requestChat.execute('tool_send_missing_opening', {
    accountId: 'moza',
    action: 'request',
    displayName: 'Runtime Candidate',
    agentCode: 'ZX82QP',
  });
  const missingOpeningPayload = JSON.parse(missingOpeningResult.content[0].text);
  assert.equal(missingOpeningPayload.status, 'error');
  assert.equal(missingOpeningPayload.tool, 'claworld_manage_conversations');
  assert.equal(missingOpeningPayload.code, 'opening_message_required');
  assert.equal(missingOpeningPayload.httpStatus, 400);
  assert.equal(missingOpeningPayload.fieldErrors?.[0]?.fieldId, 'openingMessage');

  const messageAliasIndex = chatRequestBodies.length;
  const messageAliasResult = await requestChat.execute('tool_send_message_alias', {
    accountId: 'moza',
    action: 'request',
    displayName: 'Runtime Candidate',
    agentCode: 'ZX82QP',
    message: 'hello from message alias',
  });
  const messageAliasPayload = JSON.parse(messageAliasResult.content[0].text);
  assert.equal(messageAliasPayload.status, 'pending');
  assert.equal(chatRequestBodies[messageAliasIndex]?.openingMessage, 'hello from message alias');

  const kickoffAliasIndex = chatRequestBodies.length;
  const kickoffAliasResult = await requestChat.execute('tool_send_kickoff_alias', {
    accountId: 'moza',
    action: 'request',
    displayName: 'Runtime Candidate',
    agentCode: 'ZX82QP',
    kickoffBrief: {
      message: 'hello from kickoff alias',
    },
  });
  const kickoffAliasPayload = JSON.parse(kickoffAliasResult.content[0].text);
  assert.equal(kickoffAliasPayload.status, 'pending');
  assert.equal(chatRequestBodies[kickoffAliasIndex]?.openingMessage, 'hello from kickoff alias');
  assert.equal(chatRequestBodies[kickoffAliasIndex]?.kickoffBrief?.message, 'hello from kickoff alias');

  const joinResult = await manageWorld.execute('tool_join_1', {
    accountId: 'moza',
    action: 'join_world',
    worldId: 'dating-demo-world',
    participantContextText: 'Probe the pending public identity gate.',
  });
  const joinPayload = JSON.parse(joinResult.content[0].text);
  assert.equal(joinPayload.status, 'error');
  assert.equal(joinPayload.tool, 'claworld_manage_worlds');
  assert.equal(joinPayload.error, 'claworld_tool_failed');
  assert.equal(joinPayload.code, 'account_profile_incomplete');
  assert.equal(joinPayload.category, 'conflict');
  assert.equal(
    joinPayload.message,
    'join world is blocked because the current Claworld account profile is empty; use claworld_manage_account with action=update_agent_profile first',
  );
  assert.equal(joinPayload.httpStatus, 409);
  assert.equal(joinPayload.backendCode, 'account_profile_incomplete');
  assert.equal(
    joinPayload.backendMessage,
    'join world is blocked because the current Claworld account profile is empty; use claworld_manage_account with action=update_agent_profile first',
  );
  assert.equal(joinPayload.requiredAction, 'update_agent_profile');
  assert.equal(joinPayload.nextAction, 'update_agent_profile');
  assert.equal(joinPayload.nextTool, 'claworld_manage_account');
  assert.deepEqual(joinPayload.missingFields, [
    {
      fieldId: 'profile',
      label: 'Account Profile',
      description: 'A non-empty global Claworld account profile used when other agents need to know who you are.',
    },
  ]);

  const manageResult = await manageWorld.execute('tool_manage_1', {
    accountId: 'moza',
    action: 'get_world',
    worldId: 'remote-owner-world',
  });
  const managePayload = JSON.parse(manageResult.content[0].text);
  assert.equal(managePayload.status, 'error');
  assert.equal(managePayload.tool, 'claworld_manage_worlds');
  assert.equal(managePayload.error, 'claworld_tool_failed');
  assert.equal(managePayload.code, 'world_action_not_allowed');
  assert.equal(managePayload.category, 'policy');
  assert.equal(managePayload.message, 'agent does not have permission to access world management');
  assert.equal(managePayload.httpStatus, 403);
  assert.equal(managePayload.backendCode, 'world_action_not_allowed');
  assert.equal(managePayload.backendMessage, 'agent does not have permission to access world management');

  console.log('PASS unit-openclaw-tool-error-boundary');
}

main().catch((error) => {
  console.error('FAIL unit-openclaw-tool-error-boundary');
  console.error(error);
  process.exit(1);
});
