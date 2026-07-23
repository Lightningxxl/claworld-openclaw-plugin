import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  claimInboundNotification,
  completeInboundNotification,
  releaseInboundNotification,
  resolveInboundNotificationIdempotencyKey,
} from '../src/openclaw/runtime/inbound-notification-idempotency.js';

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claworld-openclaw-idempotency-'));
try {
  const key = resolveInboundNotificationIdempotencyKey({
    eventType: 'notification',
    sessionKind: 'management',
    delivery: { deliveryId: 'notification:notif-1' },
    payload: { notification: { notificationId: 'notif-1' } },
    metadata: { inboxItemId: 'notification:notif-1' },
  });
  assert.equal(key, 'notif-1');
  assert.equal(resolveInboundNotificationIdempotencyKey({
    eventType: 'notification',
    sessionKind: 'management',
    delivery: { deliveryId: 'notification:notif-broadcast-a', targetAgentId: 'agt-local' },
    payload: {
      notification: {
        notificationId: 'notif-broadcast-a',
        notificationType: 'world.broadcast_published',
        relatedObjects: { broadcastId: 'brd-shared' },
      },
    },
  }), 'world.broadcast_published:brd-shared:agt-local');
  assert.equal(resolveInboundNotificationIdempotencyKey({
    eventType: 'notification',
    sessionKind: 'management',
    delivery: { deliveryId: 'notification:notif-invite-a', targetAgentId: 'agt-local' },
    payload: {
      notification: {
        notificationId: 'notif-invite-a',
        notificationType: 'world.invite_received',
        relatedObjects: { membershipId: 'mbr-shared' },
      },
    },
  }), 'world.invite_received:mbr-shared:agt-local');
  assert.equal(resolveInboundNotificationIdempotencyKey({
    eventType: 'delivery',
    sessionKind: 'conversation',
    delivery: { deliveryId: 'dlv-1' },
  }), null);

  const concurrentClaims = await Promise.all(Array.from({ length: 32 }, () => (
    claimInboundNotification({ workspaceRoot, key, now: 1_000_000 })
  )));
  assert.equal(concurrentClaims.filter((claim) => claim.claimed).length, 1);
  assert.equal(concurrentClaims.filter((claim) => claim.reason === 'processing').length, 31);
  const activeClaim = concurrentClaims.find((claim) => claim.claimed);
  await completeInboundNotification(activeClaim, { now: 1_000_100 });
  const completedDuplicate = await claimInboundNotification({ workspaceRoot, key, now: 1_000_200 });
  assert.equal(completedDuplicate.claimed, false);
  assert.equal(completedDuplicate.reason, 'completed');

  const retryClaim = await claimInboundNotification({ workspaceRoot, key: 'notif-retry', now: 2_000_000 });
  await releaseInboundNotification(retryClaim);
  assert.equal((await claimInboundNotification({ workspaceRoot, key: 'notif-retry', now: 2_000_001 })).claimed, true);

  const staleClaim = await claimInboundNotification({ workspaceRoot, key: 'notif-stale', now: 3_000_000 });
  assert.equal(staleClaim.claimed, true);
  const reclaimed = await claimInboundNotification({
    workspaceRoot,
    key: 'notif-stale',
    now: 3_000_101,
    leaseMs: 100,
  });
  assert.equal(reclaimed.claimed, true);
  await completeInboundNotification(reclaimed, { now: 3_000_102 });
} finally {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

console.log('PASS unit-inbound-notification-idempotency');
