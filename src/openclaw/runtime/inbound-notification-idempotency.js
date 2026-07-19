import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_INBOUND_NOTIFICATION_LEASE_MS = 30 * 60 * 1000;

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function statePaths(workspaceRoot, key) {
  const digest = crypto.createHash('sha256').update(key).digest('hex');
  const root = path.join(workspaceRoot, '.claworld', 'runtime', 'inbound-notifications');
  return {
    root,
    digest,
    processingPath: path.join(root, `${digest}.processing.json`),
    completedPath: path.join(root, `${digest}.completed.json`),
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeExclusiveJson(filePath, value) {
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readProcessingStartedAt(processingPath) {
  try {
    const value = JSON.parse(await fs.readFile(processingPath, 'utf8'));
    const startedAtMs = Date.parse(normalizeText(value?.startedAt, ''));
    if (Number.isFinite(startedAtMs)) return startedAtMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
  }
  try {
    return (await fs.stat(processingPath)).mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, filePath);
}

export function resolveInboundNotificationIdempotencyKey({
  delivery = {},
  payload = {},
  metadata = {},
  eventType = null,
  sessionKind = null,
} = {}) {
  if (normalizeText(eventType, 'delivery') === 'delivery') return null;
  if (normalizeText(sessionKind, null) !== 'management') return null;
  const notification = normalizeObject(payload.notification || delivery.notification);
  const relatedObjects = normalizeObject(notification.relatedObjects);
  const normalizedEventName = normalizeText(
    notification.notificationType,
    normalizeText(
      payload.eventName,
      normalizeText(delivery.eventName, normalizeText(metadata.eventName, normalizeText(eventType, null))),
    ),
  );
  const targetAgentId = normalizeText(
    notification.targetAgentId,
    normalizeText(payload.targetAgentId, normalizeText(delivery.targetAgentId, normalizeText(metadata.targetAgentId, null))),
  );
  const semanticId = normalizedEventName === 'world.broadcast_published'
    ? normalizeText(relatedObjects.broadcastId, normalizeText(payload.broadcastId, null))
    : normalizedEventName === 'world.invite_received'
      ? normalizeText(
        relatedObjects.invitationId,
        normalizeText(relatedObjects.membershipId, normalizeText(payload.invitationId, normalizeText(payload.membershipId, null))),
      )
      : normalizedEventName === 'conversation_ended' || normalizedEventName === 'chat_request_created'
        ? normalizeText(relatedObjects.chatRequestId, normalizeText(payload.chatRequestId, null))
        : null;
  if (normalizedEventName && semanticId) {
    return [normalizedEventName, semanticId, targetAgentId].filter(Boolean).join(':');
  }
  const candidates = [
    notification.notificationId,
    metadata.notificationId,
    payload.notificationId,
    delivery.notificationId,
    metadata.inboxItemId,
    payload.inboxItemId,
    delivery.inboxItemId,
    delivery.eventId,
    delivery.deliveryId,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate, null);
    if (normalized) return normalized;
  }
  return null;
}

export async function claimInboundNotification({
  workspaceRoot,
  key,
  now = Date.now(),
  leaseMs = DEFAULT_INBOUND_NOTIFICATION_LEASE_MS,
} = {}) {
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot, null);
  const normalizedKey = normalizeText(key, null);
  if (!normalizedWorkspaceRoot || !normalizedKey) {
    throw new Error('inbound notification idempotency requires workspaceRoot and key');
  }
  const paths = statePaths(normalizedWorkspaceRoot, normalizedKey);
  await fs.mkdir(paths.root, { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await pathExists(paths.completedPath)) {
      return { claimed: false, reason: 'completed', key: normalizedKey, ...paths };
    }
    try {
      await writeExclusiveJson(paths.processingPath, {
        schema: 'claworld.inbound-notification.v1',
        key: normalizedKey,
        status: 'processing',
        startedAt: new Date(now).toISOString(),
      });
      if (await pathExists(paths.completedPath)) {
        await fs.unlink(paths.processingPath).catch(() => {});
        return { claimed: false, reason: 'completed', key: normalizedKey, ...paths };
      }
      return { claimed: true, reason: 'claimed', key: normalizedKey, ...paths };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const startedAt = await readProcessingStartedAt(paths.processingPath);
      if (startedAt == null) continue;
      if (now - startedAt < Math.max(1, Number(leaseMs) || DEFAULT_INBOUND_NOTIFICATION_LEASE_MS)) {
        return { claimed: false, reason: 'processing', key: normalizedKey, ...paths };
      }
      await fs.unlink(paths.processingPath).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  throw new Error(`unable to claim inbound notification ${paths.digest}`);
}

export async function completeInboundNotification(claim, { now = Date.now() } = {}) {
  if (!claim?.claimed || !claim?.completedPath || !claim?.processingPath) return false;
  await atomicWriteJson(claim.completedPath, {
    schema: 'claworld.inbound-notification.v1',
    key: claim.key,
    status: 'completed',
    completedAt: new Date(now).toISOString(),
  });
  await fs.unlink(claim.processingPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return true;
}

export async function releaseInboundNotification(claim) {
  if (!claim?.claimed || !claim?.processingPath) return false;
  await fs.unlink(claim.processingPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return true;
}
