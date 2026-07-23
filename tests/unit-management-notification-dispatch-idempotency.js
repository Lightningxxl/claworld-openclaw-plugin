import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { maybeBridgeRuntimeInboundEvent } from '../src/openclaw/plugin/claworld-channel-plugin.js';

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claworld-management-dispatch-'));
const logs = [];
const logger = {
  debug(...args) { logs.push(['debug', ...args]); },
  info(...args) { logs.push(['info', ...args]); },
  warn(...args) { logs.push(['warn', ...args]); },
  error(...args) { logs.push(['error', ...args]); },
};
let dispatchCount = 0;
let shouldFail = false;
const runtime = {
  config: {
    async loadConfig() {
      return {};
    },
  },
  channel: {
    reply: {
      finalizeInboundContext(ctx) {
        return ctx;
      },
      createReplyDispatcherWithTyping() {
        return {
          dispatcher: {
            async waitForIdle() {},
          },
          replyOptions: {},
          async markDispatchIdle() {},
        };
      },
      async dispatchReplyFromConfig() {
        dispatchCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (shouldFail) throw new Error('temporary dispatch failure');
        return {};
      },
    },
  },
};
const cfg = {
  agents: {
    list: [{ id: 'main', workspace: workspaceRoot }],
  },
};
const runtimeConfig = {
  accountId: 'default',
  agentId: 'main',
  relay: { agentId: 'agt-local' },
  routing: {
    sessionTarget: 'conversation_session',
    fallbackTarget: 'mainagent',
  },
};
const inbound = {
  routeInboundEvent() {
    return { sessionKind: 'management', sessionKey: 'management:agt-local', status: 'resolved' };
  },
};

function buildEvent(notificationId, chatRequestId, notificationOverrides = {}) {
  const deliveryId = `notification:${notificationId}`;
  return {
    eventType: 'notification',
    route: { sessionKind: 'management' },
    delivery: {
      eventType: 'notification',
      eventId: deliveryId,
      deliveryId,
      sessionKey: 'management:agt-local',
      targetAgentId: 'agt-local',
      chatRequestId,
      conversationKey: 'pair:agt-local::agt-peer:direct',
      payload: {
        contextText: `Conversation ended: ${chatRequestId}`,
        notification: {
          notificationId,
          ...notificationOverrides,
          relatedObjects: {
            chatRequestId,
            conversationKey: 'pair:agt-local::agt-peer:direct',
            ...(notificationOverrides.relatedObjects || {}),
          },
        },
      },
      metadata: {
        notificationId,
        inboxItemId: deliveryId,
      },
    },
  };
}

async function bridge(event) {
  return await maybeBridgeRuntimeInboundEvent({
    relayClient: {},
    runtimeConfig,
    runtimeAccountId: 'default',
    event,
    logger,
    runtime,
    cfg,
    inbound,
  });
}

try {
  const targetConflict = buildEvent('ntf-target-conflict', 'req-target-conflict');
  targetConflict.delivery.payload.targetAgentId = 'agt-other';
  await assert.rejects(
    () => bridge(targetConflict),
    (error) => error?.code === 'relay_target_scope_mismatch',
  );
  const requestConflict = buildEvent('ntf-request-conflict', 'req-request-conflict');
  requestConflict.delivery.payload.chatRequestId = 'req-other';
  await assert.rejects(
    () => bridge(requestConflict),
    (error) => error?.code === 'relay_chat_request_scope_mismatch',
  );
  assert.equal(dispatchCount, 0);

  const first = buildEvent('ntf-first', 'req-first');
  const concurrent = await Promise.all([bridge(first), bridge(first)]);
  assert.equal(dispatchCount, 1);
  assert.equal(concurrent.filter((result) => result.skipped === false).length, 1);
  assert.equal(concurrent.filter((result) => result.reason === 'duplicate_management_notification').length, 1);

  const afterRestart = await bridge(first);
  assert.equal(afterRestart.reason, 'duplicate_management_notification');
  assert.equal(dispatchCount, 1);

  const second = buildEvent('ntf-second', 'req-second');
  await bridge(second);
  assert.equal(dispatchCount, 2);

  const broadcastA = buildEvent('ntf-broadcast-a', null, {
    notificationType: 'world.broadcast_published',
    relatedObjects: { broadcastId: 'brd-semantic-dedupe' },
  });
  const broadcastB = buildEvent('ntf-broadcast-b', null, {
    notificationType: 'world.broadcast_published',
    relatedObjects: { broadcastId: 'brd-semantic-dedupe' },
  });
  await bridge(broadcastA);
  const duplicateBroadcast = await bridge(broadcastB);
  assert.equal(duplicateBroadcast.reason, 'duplicate_management_notification');
  assert.equal(dispatchCount, 3);

  shouldFail = true;
  const retryable = buildEvent('ntf-retry', 'req-retry');
  await assert.rejects(() => bridge(retryable), /temporary dispatch failure/u);
  shouldFail = false;
  await bridge(retryable);
  assert.equal(dispatchCount, 5);
} finally {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

console.log('PASS unit-management-notification-dispatch-idempotency');
