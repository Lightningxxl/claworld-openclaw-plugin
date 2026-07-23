import assert from 'assert';
import { ClaworldRelayClient } from '../src/openclaw/plugin/relay-client.js';
import { buildInboundEnvelope } from '../src/openclaw/plugin/relay-client-shared.js';

const relayNotification = {
  event: 'world.invite_received',
  data: {
    eventType: 'notification',
    eventName: 'world.invite_received',
    sessionKind: 'management',
    inboxItemId: 'notification:ntf_unit_management',
    targetAgentId: 'agt_ff4',
    sessionKey: 'management:agt_ff4',
    text: 'Claworld notification: Invitation to Test World',
    notification: {
      notificationId: 'ntf_unit_management',
      targetAgentId: 'agt_ff4',
      targetSessionKey: 'management:agt_ff4',
      notificationType: 'world.invite_received',
      title: 'Invitation to Test World',
      body: 'You were invited to a private world.',
      relatedObjects: {
        chatRequestId: 'req_unit_management',
        worldId: 'wld_unit',
      },
    },
  },
};

const envelope = buildInboundEnvelope(relayNotification);
assert.equal(envelope.eventType, 'notification');
assert.equal(envelope.deliveryId, 'notification:ntf_unit_management');
assert.equal(envelope.targetAgentId, 'agt_ff4');
assert.equal(envelope.sessionKey, 'management:agt_ff4');
assert.equal(envelope.payload.text, 'Claworld notification: Invitation to Test World');
assert.equal(envelope.payload.notification.notificationType, 'world.invite_received');
assert.equal(envelope.chatRequestId, 'req_unit_management');
assert.equal(envelope.metadata.notificationId, 'ntf_unit_management');

const simpleBackendNotification = {
  event: 'world.invite_received',
  data: {
    notificationId: 'ntf_simple_management',
    sessionKind: 'management',
    targetAgentId: 'agt_ff4',
    sessionKey: 'management:agt_ff4',
    text: 'Invitation to Simple World',
  },
};

const simpleEnvelope = buildInboundEnvelope(simpleBackendNotification);
assert.equal(simpleEnvelope.eventType, 'world.invite_received');
assert.equal(simpleEnvelope.deliveryId, 'ntf_simple_management');
assert.equal(simpleEnvelope.targetAgentId, 'agt_ff4');
assert.equal(simpleEnvelope.sessionKey, 'management:agt_ff4');
assert.equal(simpleEnvelope.payload.text, 'Invitation to Simple World');

const notificationBatch = {
  event: 'notification_batch.activity',
  data: {
    eventType: 'notification_batch',
    eventName: 'notification_batch.activity',
    sessionKind: 'management',
    inboxItemId: 'notification_batch:ntfb_unit_management',
    targetAgentId: 'agt_ff4',
    sessionKey: 'management:agt_ff4',
    text: 'Claworld notifications: 2 activity notifications grouped for this Management Session.',
    notificationIds: ['ntf_world_one', 'ntf_world_two'],
  },
};

const batchEnvelope = buildInboundEnvelope(notificationBatch);
assert.equal(batchEnvelope.eventType, 'notification_batch');
assert.equal(batchEnvelope.eventName, 'notification_batch.activity');
assert.equal(batchEnvelope.deliveryId, 'notification_batch:ntfb_unit_management');
assert.equal(batchEnvelope.targetAgentId, 'agt_ff4');
assert.equal(batchEnvelope.sessionKey, 'management:agt_ff4');
assert.equal(batchEnvelope.payload.notificationIds.length, 2);

const relayClient = new ClaworldRelayClient({
  logger: {
    info() {},
    warn() {},
    error() {},
    debug() {},
  },
});
relayClient.runtimeConfig = {
  routing: {
    sessionTarget: 'conversation_session',
    fallbackTarget: 'mainagent',
  },
};

let runtimeEvent = null;
relayClient.on('runtime_event', (event) => {
  runtimeEvent = event;
});

relayClient.emitRelayMessage(relayNotification, {});

assert.equal(runtimeEvent.eventType, 'notification');
assert.equal(runtimeEvent.delivery.deliveryId, 'notification:ntf_unit_management');
assert.equal(runtimeEvent.route.sessionKind, 'management');
assert.equal(runtimeEvent.route.sessionKey, 'management:agt_ff4');
assert.equal(runtimeEvent.route.status, 'resolved');

runtimeEvent = null;
relayClient.emitRelayMessage(simpleBackendNotification, {});

assert.equal(runtimeEvent.eventType, 'world.invite_received');
assert.equal(runtimeEvent.delivery.deliveryId, 'ntf_simple_management');
assert.equal(runtimeEvent.route.sessionKind, 'management');
assert.equal(runtimeEvent.route.sessionKey, 'management:agt_ff4');
assert.equal(runtimeEvent.route.status, 'resolved');

runtimeEvent = null;
relayClient.emitRelayMessage(notificationBatch, {});

assert.equal(runtimeEvent.eventType, 'notification_batch');
assert.equal(runtimeEvent.delivery.deliveryId, 'notification_batch:ntfb_unit_management');
assert.equal(runtimeEvent.route.sessionKind, 'management');
assert.equal(runtimeEvent.route.sessionKey, 'management:agt_ff4');
assert.equal(runtimeEvent.route.status, 'resolved');

const deliveryWrappedManagement = buildInboundEnvelope({
  event: 'delivery',
  data: {
    eventType: 'delivery',
    sessionKey: 'management:agt_ff4',
    payload: {
      eventType: 'notification',
      sessionKind: 'management',
      targetAgentId: 'agt_ff4',
      text: 'wrapped management notification',
    },
  },
});
assert.equal(deliveryWrappedManagement.eventType, 'delivery');
assert.equal(deliveryWrappedManagement.sessionKey, 'management:agt_ff4');

const directChatRequestEnvelope = buildInboundEnvelope({
  event: 'delivery',
  data: {
    eventType: 'delivery',
    chatRequestId: 'req_direct_transcript',
    sessionKey: 'conversation:agt_ff4:agt_peer',
    payload: {
      commandText: 'Reply to the peer.',
    },
  },
});
assert.equal(directChatRequestEnvelope.chatRequestId, 'req_direct_transcript');
assert.equal(directChatRequestEnvelope.payload.chatRequestId, 'req_direct_transcript');

console.log('PASS unit-relay-client-management-events');
