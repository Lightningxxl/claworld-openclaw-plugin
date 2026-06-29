import assert from 'assert';
import { EventEmitter } from 'events';
import { setTimeout as delay } from 'timers/promises';
import { createClaworldRelayClient } from '../src/openclaw/index.js';

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  deliver(raw) {
    this.emit('message', raw);
  }

  close(code = 1000, reason = 'manual_close') {
    this.readyState = 3;
    this.emit('close', code, reason);
  }
}

async function main() {
  const logs = [];
  const fakeWs = new FakeWebSocket();
  const relayErrors = [];
  const client = createClaworldRelayClient({
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    wsFactory: () => fakeWs,
  });

  client.on('relay_error', (message) => relayErrors.push(message));

  const connectPromise = client.connect({
    config: {
      enabled: true,
      serverUrl: 'http://127.0.0.1:8787',
      apiKey: 'demo-plugin-key',
      accountId: 'boundary-test',
      heartbeatSeconds: 1,
    },
    agentId: 'agt_boundary',
    credential: { type: 'agent_token', token: 'relay_at_boundary' },
    clientVersion: 'unit-relay-client-error-boundary',
  });

  fakeWs.open();
  fakeWs.deliver(JSON.stringify({ event: 'auth.ok', data: { agentId: 'agt_boundary' } }));

  await connectPromise;
  assert.equal(client.snapshot().connectionState, 'authenticated');
  assert.equal(fakeWs.sent[0].type, 'auth');

  fakeWs.send = function send(payload) {
    this.sent.push(JSON.parse(payload));
    const message = this.sent[this.sent.length - 1];
    if (message.type === 'accepted') {
      this.deliver(JSON.stringify({
        event: 'delivery.accepted',
        data: {
          acceptedDeliveryId: message.deliveryId,
        },
      }));
    } else if (message.type === 'reply') {
      this.deliver(JSON.stringify({
        event: 'reply.accepted',
        data: {
          repliedDeliveryId: message.deliveryId,
          delivery: {
            deliveryId: message.deliveryId,
          },
        },
      }));
    }
  };

  const accepted = await client.sendAcceptedAndWaitForAck({
    deliveryId: 'dlv_accept_race',
    sessionKey: 'conversation:test',
    timeoutMs: 50,
    httpFallback: false,
  });
  assert.equal(accepted.transport, 'websocket');
  assert.equal(accepted.ack.data.acceptedDeliveryId, 'dlv_accept_race');

  const replied = await client.sendReplyAndWaitForAck({
    deliveryId: 'dlv_reply_race',
    sessionKey: 'conversation:test',
    replyText: 'ok',
    timeoutMs: 50,
    httpFallback: false,
  });
  assert.equal(replied.transport, 'websocket');
  assert.equal(replied.ack.data.repliedDeliveryId, 'dlv_reply_race');

  let acceptAttempts = 0;
  const retryingClient = createClaworldRelayClient({
    httpFetch: async () => {
      acceptAttempts += 1;
      return {
        status: acceptAttempts < 3 ? 404 : 200,
        async json() {
          if (acceptAttempts < 3) {
            return { error: 'delivery_not_found' };
          }
          return { acceptedDeliveryId: 'dlv_retry' };
        },
      };
    },
  });
  retryingClient.serverUrl = 'http://127.0.0.1:8787';
  retryingClient.runtimeConfig = {
    accountId: 'retry-test',
    apiKey: 'retry-key',
  };
  retryingClient.boundAgentId = 'agt_retry';

  const acceptedAfterRetry = await retryingClient.acceptDeliveryHttp({
    deliveryId: 'dlv_retry',
    sessionKey: 'conversation:test',
  });
  assert.equal(acceptedAfterRetry.status, 200);
  assert.equal(acceptedAfterRetry.body.acceptedDeliveryId, 'dlv_retry');
  assert.equal(acceptAttempts, 3);

  let preSendReplyFallbackAttempts = 0;
  const preSendReplyFallbackClient = createClaworldRelayClient({
    httpFetch: async () => {
      preSendReplyFallbackAttempts += 1;
      return {
        status: 200,
        async json() {
          return { repliedDeliveryId: 'dlv_reply_pre_send_fallback' };
        },
      };
    },
  });
  preSendReplyFallbackClient.serverUrl = 'http://127.0.0.1:8787';
  preSendReplyFallbackClient.runtimeConfig = {
    accountId: 'reply-pre-send-fallback',
    apiKey: 'reply-pre-send-fallback-key',
  };
  preSendReplyFallbackClient.boundAgentId = 'agt_reply_pre_send_fallback';
  preSendReplyFallbackClient.ws = { readyState: 3, send() {} };

  const preSendReplyFallback = await preSendReplyFallbackClient.submitDeliveryReply({
    deliveryId: 'dlv_reply_pre_send_fallback',
    sessionKey: 'conversation:test',
    replyText: 'fallback before send',
    timeoutMs: 20,
    httpFallback: true,
  });
  assert.equal(preSendReplyFallback.transport, 'http');
  assert.equal(preSendReplyFallback.fallbackUsed, true);
  assert.equal(preSendReplyFallback.ack.data.repliedDeliveryId, 'dlv_reply_pre_send_fallback');
  assert.equal(preSendReplyFallbackAttempts, 1);

  let sendErrorReplyFallbackAttempts = 0;
  const sendErrorReplyFallbackClient = createClaworldRelayClient({
    httpFetch: async () => {
      sendErrorReplyFallbackAttempts += 1;
      return {
        status: 200,
        async json() {
          return { repliedDeliveryId: 'dlv_reply_send_error_fallback' };
        },
      };
    },
  });
  sendErrorReplyFallbackClient.serverUrl = 'http://127.0.0.1:8787';
  sendErrorReplyFallbackClient.runtimeConfig = {
    accountId: 'reply-send-error-fallback',
    apiKey: 'reply-send-error-fallback-key',
  };
  sendErrorReplyFallbackClient.boundAgentId = 'agt_reply_send_error_fallback';
  sendErrorReplyFallbackClient.ws = {
    readyState: 1,
    send() {
      throw new Error('socket send failed');
    },
  };

  const sendErrorReplyFallback = await sendErrorReplyFallbackClient.submitDeliveryReply({
    deliveryId: 'dlv_reply_send_error_fallback',
    sessionKey: 'conversation:test',
    replyText: 'fallback after send error',
    timeoutMs: 20,
    httpFallback: true,
  });
  assert.equal(sendErrorReplyFallback.transport, 'http');
  assert.equal(sendErrorReplyFallback.fallbackUsed, true);
  assert.equal(sendErrorReplyFallback.ack.data.repliedDeliveryId, 'dlv_reply_send_error_fallback');
  assert.equal(sendErrorReplyFallbackAttempts, 1);

  let keptSilentFallbackAttempts = 0;
  const keptSilentFallbackClient = createClaworldRelayClient({
    httpFetch: async () => {
      keptSilentFallbackAttempts += 1;
      return {
        status: 200,
        async json() {
          return { keptSilentDeliveryId: 'dlv_kept_silent_pre_send_fallback' };
        },
      };
    },
  });
  keptSilentFallbackClient.serverUrl = 'http://127.0.0.1:8787';
  keptSilentFallbackClient.runtimeConfig = {
    accountId: 'kept-silent-pre-send-fallback',
    apiKey: 'kept-silent-pre-send-fallback-key',
  };
  keptSilentFallbackClient.boundAgentId = 'agt_kept_silent_pre_send_fallback';
  keptSilentFallbackClient.ws = { readyState: 3, send() {} };

  const keptSilentFallback = await keptSilentFallbackClient.submitDeliveryKeptSilent({
    deliveryId: 'dlv_kept_silent_pre_send_fallback',
    sessionKey: 'conversation:test',
    reason: 'no_renderable_reply',
    timeoutMs: 20,
    httpFallback: true,
  });
  assert.equal(keptSilentFallback.transport, 'http');
  assert.equal(keptSilentFallback.fallbackUsed, true);
  assert.equal(keptSilentFallback.ack.data.keptSilentDeliveryId, 'dlv_kept_silent_pre_send_fallback');
  assert.equal(keptSilentFallbackAttempts, 1);

  fakeWs.deliver('{bad-json');
  await delay(0);

  assert.equal(client.snapshot().connectionState, 'authenticated', 'malformed relay frames should not tear down the client');
  assert.equal(relayErrors.length, 1, 'expected one normalized relay boundary event');
  assert.equal(relayErrors[0].data?.error, 'relay_runtime_error');
  assert.equal(relayErrors[0].data?.code, 'relay_ws_message_invalid');
  assert.equal(relayErrors[0].data?.category, 'transport');
  assert.equal(relayErrors[0].data?.message, 'relay websocket delivered invalid JSON');
  assert.ok(logs.some((entry) => String(entry[1]).includes('invalid relay message')));

  await client.close();

  console.log('PASS unit-relay-client-error-boundary');
}

main().catch((error) => {
  console.error('FAIL unit-relay-client-error-boundary');
  console.error(error);
  process.exit(1);
});
