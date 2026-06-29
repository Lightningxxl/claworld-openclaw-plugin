import { createRuntimeBoundaryError } from '../../lib/runtime-errors.js';

export const DUPLICATE_CONNECTION_CLOSE_CODE = 4001;
export const STALE_CONNECTION_CLOSE_CODE = 4002;
export const TERMINAL_CLOSE_REASONS = new Set(['duplicate_connection_replaced', 'stale_connection']);
export const DEFAULT_REPLY_ACK_TIMEOUT_MS = 5000;

function cloneObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  return { ...value };
}

function normalizeEnvelopeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function resolveEnvelopeMessageId(data = {}, payload = {}) {
  const notification = payload.notification && typeof payload.notification === 'object' && !Array.isArray(payload.notification)
    ? payload.notification
    : data.notification && typeof data.notification === 'object' && !Array.isArray(data.notification)
      ? data.notification
      : {};
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};
  const candidates = [
    data.deliveryId,
    data.inboxItemId,
    data.messageId,
    data.eventId,
    data.notificationId,
    payload.deliveryId,
    payload.inboxItemId,
    payload.messageId,
    payload.eventId,
    payload.notificationId,
    metadata.messageId,
    metadata.eventId,
    metadata.notificationId,
    notification.notificationId,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeEnvelopeText(candidate, null);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizeRelayWebSocketUrl(serverUrl) {
  const parsed = new URL(serverUrl);
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';

  const pathname = parsed.pathname || '/';
  const normalizedPathname = pathname.replace(/\/+$/, '') || '/';
  parsed.pathname = normalizedPathname === '/' || normalizedPathname === ''
    ? '/ws'
    : normalizedPathname.endsWith('/ws')
      ? normalizedPathname
      : normalizedPathname + '/ws';

  return parsed.toString();
}

export function buildInboundEnvelope(message = {}) {
  const data = message.data || {};
  const directPayload = data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
    ? { ...data.payload }
    : {};
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? { ...data.metadata }
    : directPayload.metadata && typeof directPayload.metadata === 'object' && !Array.isArray(directPayload.metadata)
      ? { ...directPayload.metadata }
      : cloneObject(data.meta, {});
  const payloadEventType = normalizeEnvelopeText(directPayload.eventType, null);
  const dataEventType = normalizeEnvelopeText(data.eventType, null);
  const eventType = dataEventType
    || payloadEventType
    || (message.event === 'delivery' ? 'delivery' : normalizeEnvelopeText(message.event, null));
  const payload = Object.keys(directPayload).length > 0
    ? { ...directPayload }
    : cloneObject(data, {});
  if (Object.keys(directPayload).length > 0) {
    for (const key of [
      'eventType',
      'eventName',
      'sessionKind',
      'sessionKey',
      'targetSessionKey',
      'targetAgentId',
      'text',
      'body',
      'notification',
      'conversationKey',
      'worldId',
    ]) {
      if (payload[key] == null && data[key] != null) payload[key] = data[key];
    }
  }
  const notification = payload.notification && typeof payload.notification === 'object' && !Array.isArray(payload.notification)
    ? payload.notification
    : data.notification && typeof data.notification === 'object' && !Array.isArray(data.notification)
      ? data.notification
      : {};
  const targetAgentId = normalizeEnvelopeText(
    data.targetAgentId,
    normalizeEnvelopeText(
      payload.targetAgentId,
      normalizeEnvelopeText(notification.targetAgentId, normalizeEnvelopeText(metadata.targetAgentId, null)),
    ),
  );
  const sessionKey = normalizeEnvelopeText(
    data.sessionKey,
    normalizeEnvelopeText(
      payload.sessionKey,
      normalizeEnvelopeText(
        data.targetSessionKey,
        normalizeEnvelopeText(
          payload.targetSessionKey,
          normalizeEnvelopeText(notification.targetSessionKey, normalizeEnvelopeText(metadata.sessionKey, null)),
        ),
      ),
    ),
  );
  const isDeliveryEvent = message.event === 'delivery';
  const isRoutableEvent = Boolean(eventType && sessionKey);
  if (!isDeliveryEvent && !isRoutableEvent) return null;
  const deliveryId = resolveEnvelopeMessageId(data, payload);
  const eventName = normalizeEnvelopeText(
    data.eventName,
    normalizeEnvelopeText(payload.eventName, isDeliveryEvent ? null : normalizeEnvelopeText(message.event, null)),
  );
  return {
    eventType: eventType || 'delivery',
    eventName,
    eventId: deliveryId,
    deliveryId,
    sessionKey,
    targetAgentId,
    conversationKey: normalizeEnvelopeText(
      data.conversationKey,
      normalizeEnvelopeText(payload.conversationKey, normalizeEnvelopeText(notification.relatedObjects?.conversationKey, null)),
    ),
    worldId: normalizeEnvelopeText(
      data.worldId,
      normalizeEnvelopeText(payload.worldId, normalizeEnvelopeText(notification.relatedObjects?.worldId, null)),
    ),
    createdAt: data.createdAt || payload.createdAt || data.availableAt || payload.availableAt || notification.createdAt || null,
    updatedAt: data.updatedAt || payload.updatedAt || notification.updatedAt || null,
    turnCreatedAt: data.turnCreatedAt || null,
    payload,
    metadata: {
      ...metadata,
      relayEvent: normalizeEnvelopeText(message.event, null),
      inboxItemId: normalizeEnvelopeText(data.inboxItemId, normalizeEnvelopeText(payload.inboxItemId, null)),
    },
  };
}

export function normalizeOptionalText(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function requireClientMessageId(value = null) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error('claworld relay clientMessageId is required for POST /v1/orchestration/messages');
  }
  return normalized;
}

export function buildReplyAckTimeoutError({ deliveryId, timeoutMs, context = {} } = {}) {
  return createRuntimeBoundaryError({
    code: 'relay_reply_ack_timeout',
    category: 'transport',
    status: 504,
    message: `timed out waiting for relay reply acknowledgement for ${deliveryId || 'unknown-delivery'} after ${timeoutMs}ms`,
    publicMessage: 'relay reply acknowledgement timed out',
    recoverable: true,
    context,
  });
}

export function buildAcceptedAckTimeoutError({ deliveryId, timeoutMs, context = {} } = {}) {
  return createRuntimeBoundaryError({
    code: 'relay_delivery_accept_ack_timeout',
    category: 'transport',
    status: 504,
    message: `timed out waiting for relay delivery acceptance acknowledgement for ${deliveryId || 'unknown-delivery'} after ${timeoutMs}ms`,
    publicMessage: 'relay delivery acceptance acknowledgement timed out',
    recoverable: true,
    context,
  });
}

export function buildReplyFallbackError({
  deliveryId = null,
  status = 502,
  body = {},
  context = {},
} = {}) {
  return createRuntimeBoundaryError({
    code: normalizeOptionalText(body?.code) || normalizeOptionalText(body?.error) || 'relay_reply_fallback_failed',
    category: status >= 500 ? 'runtime' : 'transport',
    status: Number.isInteger(status) ? status : 502,
    message: normalizeOptionalText(body?.message) || normalizeOptionalText(body?.reason) || 'relay reply fallback failed',
    publicMessage: 'relay reply fallback failed',
    recoverable: status >= 500,
    context: {
      deliveryId: normalizeOptionalText(deliveryId),
      ...context,
    },
  });
}

export function buildKeepSilentAckTimeoutError({ deliveryId, timeoutMs, context = {} } = {}) {
  return createRuntimeBoundaryError({
    code: 'relay_kept_silent_ack_timeout',
    category: 'transport',
    status: 504,
    message: `timed out waiting for relay kept_silent acknowledgement for ${deliveryId || 'unknown-delivery'} after ${timeoutMs}ms`,
    publicMessage: 'relay kept_silent acknowledgement timed out',
    recoverable: true,
    context,
  });
}

export function buildKeepSilentFallbackError({
  deliveryId = null,
  status = 502,
  body = {},
  context = {},
} = {}) {
  return createRuntimeBoundaryError({
    code: normalizeOptionalText(body?.code) || normalizeOptionalText(body?.error) || 'relay_kept_silent_fallback_failed',
    category: status >= 500 ? 'runtime' : 'transport',
    status: Number.isInteger(status) ? status : 502,
    message: normalizeOptionalText(body?.message) || normalizeOptionalText(body?.reason) || 'relay kept_silent fallback failed',
    publicMessage: 'relay kept_silent fallback failed',
    recoverable: status >= 500,
    context: {
      deliveryId: normalizeOptionalText(deliveryId),
      ...context,
    },
  });
}

export function isReplyAlreadyApplied(result = null, deliveryId = null) {
  if (!result || result.status !== 409) return false;
  if (normalizeOptionalText(result.body?.reason) !== 'delivery_not_replyable') return false;
  if (normalizeOptionalText(result.body?.delivery?.deliveryId) !== normalizeOptionalText(deliveryId)) return false;
  return normalizeOptionalText(result.body?.delivery?.status) === 'replied';
}

export function isDeliveryKeptSilentAlreadyApplied(result = null, deliveryId = null) {
  if (!result || result.status !== 409) return false;
  if (normalizeOptionalText(result.body?.reason) !== 'delivery_not_replyable') return false;
  if (normalizeOptionalText(result.body?.delivery?.deliveryId) !== normalizeOptionalText(deliveryId)) return false;
  return normalizeOptionalText(result.body?.delivery?.status) === 'kept_silent';
}
