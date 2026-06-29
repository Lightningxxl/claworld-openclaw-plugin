import { normalizeOptionalText } from './shared.js';

function normalizeAcceptedChatKickoffField(value, fallback = null) {
  return normalizeOptionalText(value) || fallback;
}

export function normalizeAcceptedChatKickoffRecord(kickoff = null, { fallbackStatus = null } = {}) {
  if (!kickoff || typeof kickoff !== 'object' || Array.isArray(kickoff)) return null;

  const normalized = {
    ...kickoff,
  };

  const normalizedStatus = normalizeAcceptedChatKickoffField(normalized.status, fallbackStatus);
  const normalizedReason = normalizeAcceptedChatKickoffField(normalized.reason, null);
  const normalizedDeliveredAt = normalizeAcceptedChatKickoffField(normalized.deliveredAt, null);
  const normalizedSenderKickoffDeliveredAt = normalizeAcceptedChatKickoffField(
    normalized.senderKickoffDeliveredAt,
    normalizedDeliveredAt,
  );
  const normalizedOpenerAcceptedAt = normalizeAcceptedChatKickoffField(normalized.openerAcceptedAt, null);
  const normalizedOpenerDeliveredAt = normalizeAcceptedChatKickoffField(normalized.openerDeliveredAt, null);
  const normalizedLiveChatEstablishedAt = normalizeAcceptedChatKickoffField(normalized.liveChatEstablishedAt, null);
  const normalizedTurnId = normalizeAcceptedChatKickoffField(normalized.turnId, null);
  const normalizedDeliveryId = normalizeAcceptedChatKickoffField(normalized.deliveryId, null);
  const normalizedConversationKey = normalizeAcceptedChatKickoffField(normalized.conversationKey, null);
  const normalizedOpenerTurnId = normalizeAcceptedChatKickoffField(normalized.openerTurnId, null);
  const normalizedOpenerDeliveryId = normalizeAcceptedChatKickoffField(normalized.openerDeliveryId, null);
  const normalizedFailedAt = normalizeAcceptedChatKickoffField(normalized.failedAt, null);

  if (normalizedStatus) normalized.status = normalizedStatus;
  else delete normalized.status;
  if (normalizedReason) normalized.reason = normalizedReason;
  else delete normalized.reason;
  if (normalizedDeliveredAt) normalized.deliveredAt = normalizedDeliveredAt;
  else delete normalized.deliveredAt;
  if (normalizedSenderKickoffDeliveredAt) normalized.senderKickoffDeliveredAt = normalizedSenderKickoffDeliveredAt;
  else delete normalized.senderKickoffDeliveredAt;
  if (normalizedOpenerAcceptedAt) normalized.openerAcceptedAt = normalizedOpenerAcceptedAt;
  else delete normalized.openerAcceptedAt;
  if (normalizedOpenerDeliveredAt) normalized.openerDeliveredAt = normalizedOpenerDeliveredAt;
  else delete normalized.openerDeliveredAt;
  if (normalizedLiveChatEstablishedAt) normalized.liveChatEstablishedAt = normalizedLiveChatEstablishedAt;
  else delete normalized.liveChatEstablishedAt;
  if (normalizedTurnId) normalized.turnId = normalizedTurnId;
  else delete normalized.turnId;
  if (normalizedDeliveryId) normalized.deliveryId = normalizedDeliveryId;
  else delete normalized.deliveryId;
  if (normalizedConversationKey) normalized.conversationKey = normalizedConversationKey;
  else delete normalized.conversationKey;
  if (normalizedOpenerTurnId) normalized.openerTurnId = normalizedOpenerTurnId;
  else delete normalized.openerTurnId;
  if (normalizedOpenerDeliveryId) normalized.openerDeliveryId = normalizedOpenerDeliveryId;
  else delete normalized.openerDeliveryId;
  if (normalizedFailedAt) normalized.failedAt = normalizedFailedAt;
  else delete normalized.failedAt;

  const hasEstablishedEvidence = Boolean(
    normalized.openerDeliveredAt
    || normalized.liveChatEstablishedAt,
  );

  if (hasEstablishedEvidence && (!normalized.status || ['queued', 'sent'].includes(normalized.status))) {
    normalized.status = 'established';
  }

  if (normalized.status === 'established') {
    const establishedAt = normalizeAcceptedChatKickoffField(
      normalized.liveChatEstablishedAt,
      normalizeAcceptedChatKickoffField(
        normalized.openerDeliveredAt,
        normalizeAcceptedChatKickoffField(normalized.openerAcceptedAt, null),
      ),
    );
    if (!normalized.openerDeliveredAt && normalized.openerAcceptedAt) {
      normalized.openerDeliveredAt = normalized.openerAcceptedAt;
    }
    if (!normalized.liveChatEstablishedAt && establishedAt) {
      normalized.liveChatEstablishedAt = establishedAt;
    }
    if (String(normalized.reason || '').startsWith('queued_')) {
      delete normalized.reason;
    }
  }

  return normalized;
}

export async function markAcceptedChatKickoffFailureWithDeps(deps, {
  requestId = null,
  reason = 'accepted_chat_kickoff_failed',
  turnId = null,
  conversationKey = null,
} = {}) {
  const { store, pushToAgent } = deps;
  const normalizedRequestId = normalizeOptionalText(requestId);
  if (!normalizedRequestId) return null;
  const request = store.getChatRequest(normalizedRequestId);
  if (!request) return null;

  request.kickoff = normalizeAcceptedChatKickoffRecord({
    ...(request.kickoff && typeof request.kickoff === 'object' && !Array.isArray(request.kickoff) ? request.kickoff : {}),
    status: 'failed',
    reason: normalizeOptionalText(reason) || 'accepted_chat_kickoff_failed',
    ...(normalizeOptionalText(turnId) ? { turnId: normalizeOptionalText(turnId) } : {}),
    ...(normalizeOptionalText(conversationKey) ? { conversationKey: normalizeOptionalText(conversationKey) } : {}),
    failedAt: store.now(),
  });
  if (store.markChatRequestUpdated) {
    await store.markChatRequestUpdated();
  }
  await pushToAgent(request.fromAgentId, 'request.updated', request);
  await pushToAgent(request.toAgentId, 'request.updated', request);
  return request;
}

export async function markAcceptedChatKickoffProgressWithDeps(deps, {
  requestId = null,
  status = null,
  reason = null,
  turnId = null,
  deliveryId = null,
  conversationKey = null,
  sessionKey = null,
  localSessionKey = null,
  senderKickoffDeliveredAt = null,
  openerAcceptedAt = null,
  openerDeliveredAt = null,
  liveChatEstablishedAt = null,
  openerTurnId = null,
  openerDeliveryId = null,
} = {}) {
  const { store, pushToAgent } = deps;
  const normalizedRequestId = normalizeOptionalText(requestId);
  if (!normalizedRequestId) return null;
  const request = store.getChatRequest(normalizedRequestId);
  if (!request) return null;

  request.kickoff = normalizeAcceptedChatKickoffRecord({
    ...(request.kickoff && typeof request.kickoff === 'object' && !Array.isArray(request.kickoff) ? request.kickoff : {}),
    ...(normalizeOptionalText(status) ? { status: normalizeOptionalText(status) } : {}),
    ...(normalizeOptionalText(reason) ? { reason: normalizeOptionalText(reason) } : {}),
    ...(normalizeOptionalText(turnId) ? { turnId: normalizeOptionalText(turnId) } : {}),
    ...(normalizeOptionalText(deliveryId) ? { deliveryId: normalizeOptionalText(deliveryId) } : {}),
    ...(normalizeOptionalText(conversationKey) ? { conversationKey: normalizeOptionalText(conversationKey) } : {}),
    ...(normalizeOptionalText(sessionKey) ? { sessionKey: normalizeOptionalText(sessionKey) } : {}),
    ...(normalizeOptionalText(localSessionKey)
      ? { localSessionKey: normalizeOptionalText(localSessionKey) }
      : normalizeOptionalText(sessionKey)
        ? { localSessionKey: normalizeOptionalText(sessionKey) }
        : {}),
    ...(normalizeOptionalText(senderKickoffDeliveredAt)
      ? {
          senderKickoffDeliveredAt: normalizeOptionalText(senderKickoffDeliveredAt),
          deliveredAt: normalizeOptionalText(senderKickoffDeliveredAt),
        }
      : {}),
    ...(normalizeOptionalText(openerAcceptedAt) ? { openerAcceptedAt: normalizeOptionalText(openerAcceptedAt) } : {}),
    ...(normalizeOptionalText(openerDeliveredAt) ? { openerDeliveredAt: normalizeOptionalText(openerDeliveredAt) } : {}),
    ...(normalizeOptionalText(liveChatEstablishedAt) ? { liveChatEstablishedAt: normalizeOptionalText(liveChatEstablishedAt) } : {}),
    ...(normalizeOptionalText(openerTurnId) ? { openerTurnId: normalizeOptionalText(openerTurnId) } : {}),
    ...(normalizeOptionalText(openerDeliveryId) ? { openerDeliveryId: normalizeOptionalText(openerDeliveryId) } : {}),
  });
  if (store.markChatRequestUpdated) {
    await store.markChatRequestUpdated();
  }
  await pushToAgent(request.fromAgentId, 'request.updated', request);
  await pushToAgent(request.toAgentId, 'request.updated', request);
  return request;
}
