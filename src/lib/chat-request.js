import { createKickoffBrief } from './relay/kickoff-text.js';
import { normalizeAcceptedChatKickoffRecord } from './relay/kickoff-progress.js';

export const DEFAULT_CHAT_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function cloneJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return null;
    return cloned;
  } catch {
    return null;
  }
}

export function normalizeChatRequestConversation(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const conversation = {
    ...(normalizeText(input.worldId, null) ? { worldId: normalizeText(input.worldId, null) } : {}),
    ...(normalizeText(input.scope, null)
      ? { scope: normalizeText(input.scope, null) }
      : {}),
    ...(normalizeText(input.conversationId, null) ? { conversationId: normalizeText(input.conversationId, null) } : {}),
    ...(normalizeText(input.threadId, null) ? { threadId: normalizeText(input.threadId, null) } : {}),
    ...(normalizeText(input.conversationKey, null) ? { conversationKey: normalizeText(input.conversationKey, null) } : {}),
    ...(normalizeText(input.sessionKey, null) ? { sessionKey: normalizeText(input.sessionKey, null) } : {}),
  };

  const episode = cloneJsonObject(input.episode);
  if (episode) {
    conversation.episode = episode;
  }
  const worldContextText = normalizeText(
    input.worldContextText,
    normalizeText(input.worldContext?.worldContextText, normalizeText(input.worldContext?.text, null)),
  );
  if (worldContextText) {
    conversation.worldContextText = worldContextText;
  }

  return conversation;
}

export function normalizeChatRequestOrigin(origin = {}, { fallbackType = null } = {}) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) {
    const type = normalizeText(fallbackType, null);
    return type ? { type } : null;
  }

  const normalized = {
    ...(normalizeText(origin.type, normalizeText(fallbackType, null))
      ? { type: normalizeText(origin.type, normalizeText(fallbackType, null)) }
      : {}),
    ...(normalizeText(origin.broadcastId, null) ? { broadcastId: normalizeText(origin.broadcastId, null) } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function normalizeChatRequestBroadcast(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const normalized = {
    ...(normalizeText(input.broadcastId, null) ? { broadcastId: normalizeText(input.broadcastId, null) } : {}),
    ...(normalizeText(input.worldId, null) ? { worldId: normalizeText(input.worldId, null) } : {}),
    ...(normalizeText(input.audience, null) ? { audience: normalizeText(input.audience, null) } : {}),
    ...(normalizeText(input.senderRole, null) ? { senderRole: normalizeText(input.senderRole, null) } : {}),
    ...(normalizeText(input.eligibility, null) ? { eligibility: normalizeText(input.eligibility, null) } : {}),
    ...(typeof input.excludeSelf === 'boolean' ? { excludeSelf: input.excludeSelf } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function normalizeChatRequestFollowUp(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const normalized = {
    ...(normalizeText(input.sessionKey, null) ? { sessionKey: normalizeText(input.sessionKey, null) } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function normalizeChatRequestOpeningPayload(input = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const payload = cloneJsonObject(input);
  if (!payload) return null;
  if (typeof payload.text === 'string') {
    payload.text = payload.text.trim();
    if (!payload.text) delete payload.text;
  }
  if (typeof payload.source === 'string') {
    payload.source = payload.source.trim() || undefined;
  }
  return Object.keys(payload).length > 0 ? payload : null;
}

function normalizeKickoffBriefInput(kickoffBrief = null) {
  if (kickoffBrief && typeof kickoffBrief === 'object' && !Array.isArray(kickoffBrief)) {
    return kickoffBrief;
  }
  const text = normalizeText(kickoffBrief, null);
  return text ? { text } : null;
}

function resolveKickoffBriefOpeningMessage(kickoffBrief = null, fallback = null) {
  if (!kickoffBrief || typeof kickoffBrief !== 'object' || Array.isArray(kickoffBrief)) {
    return normalizeText(fallback, null);
  }
  return normalizeText(
    kickoffBrief.text,
    normalizeText(kickoffBrief.openingMessage, normalizeText(kickoffBrief.message, normalizeText(fallback, null))),
  );
}

export function resolveChatRequestOpeningMessage({
  openingMessage = null,
  openingPayload = null,
  requestContext = null,
} = {}) {
  return normalizeText(
    openingMessage,
    normalizeText(openingPayload?.text, normalizeText(requestContext?.message, null)),
  );
}

function resolveKickoffBriefSource({
  kickoffBrief = null,
  openingPayload = null,
  requestContext = null,
  source = null,
} = {}) {
  const normalizedContext = requestContext && typeof requestContext === 'object' && !Array.isArray(requestContext)
    ? requestContext
    : {};
  const explicitKickoffBrief = normalizeKickoffBriefInput(kickoffBrief);
  const contextKickoffBrief = normalizeKickoffBriefInput(normalizedContext.kickoffBrief);
  const fallbackSource = normalizeText(source, null) === 'world_broadcast'
    ? 'world_broadcast_brief'
    : 'chat_request_brief';
  return normalizeText(
    explicitKickoffBrief?.source,
    normalizeText(
      contextKickoffBrief?.source,
      normalizeText(
        openingPayload?.source,
        normalizeText(normalizedContext.openingPayload?.source, fallbackSource),
      ),
    ),
  );
}

function resolveChatRequestKickoffBrief({
  kickoffBrief = null,
  openingMessage = null,
  openingPayload = null,
  requestContext = null,
  source = null,
} = {}) {
  const normalizedContext = requestContext && typeof requestContext === 'object' && !Array.isArray(requestContext)
    ? requestContext
    : {};
  const explicitKickoffBrief = normalizeKickoffBriefInput(kickoffBrief);
  const contextKickoffBrief = normalizeKickoffBriefInput(normalizedContext.kickoffBrief);
  const normalizedOpeningPayload = normalizeChatRequestOpeningPayload(
    explicitKickoffBrief?.payload
    ?? contextKickoffBrief?.payload
    ?? openingPayload
    ?? normalizedContext.openingPayload,
  );
  const normalizedOpeningMessage = resolveChatRequestOpeningMessage({
    openingMessage: resolveKickoffBriefOpeningMessage(
      explicitKickoffBrief,
      resolveKickoffBriefOpeningMessage(contextKickoffBrief, openingMessage),
    ),
    openingPayload: normalizedOpeningPayload,
    requestContext: normalizedContext,
  });
  return createKickoffBrief({
    text: normalizedOpeningMessage,
    payload: explicitKickoffBrief?.payload ?? contextKickoffBrief?.payload ?? normalizedOpeningPayload,
    source: resolveKickoffBriefSource({
      kickoffBrief: explicitKickoffBrief ?? contextKickoffBrief,
      openingPayload: normalizedOpeningPayload,
      requestContext: normalizedContext,
      source,
    }),
  });
}

export function normalizeChatRequestInput({ requestContext = {}, source = null } = {}) {
  const normalizedContext = requestContext && typeof requestContext === 'object' && !Array.isArray(requestContext)
    ? requestContext
    : {};
  const conversationSource = normalizedContext.conversation && typeof normalizedContext.conversation === 'object' && !Array.isArray(normalizedContext.conversation)
    ? normalizedContext.conversation
    : {};
  const conversation = normalizeChatRequestConversation({
    ...conversationSource,
    conversationKey: normalizedContext.conversationKey ?? conversationSource.conversationKey,
    sessionKey: normalizedContext.sessionKey ?? conversationSource.sessionKey,
  });
  const kickoffBrief = resolveChatRequestKickoffBrief({
    requestContext: normalizedContext,
    source,
  });
  const openingPayload = normalizeChatRequestOpeningPayload(kickoffBrief?.payload ?? normalizedContext.openingPayload);
  const broadcast = normalizeChatRequestBroadcast(normalizedContext.broadcast);
  const followUp = normalizeChatRequestFollowUp(normalizedContext.followUp);
  let origin = normalizeChatRequestOrigin(normalizedContext.origin, {
    fallbackType: normalizeText(source, null) === 'world_broadcast' ? 'world_broadcast' : 'chat_request',
  });

  if (broadcast?.broadcastId && !origin?.broadcastId) {
    origin = {
      ...(origin || { type: normalizeText(source, null) === 'world_broadcast' ? 'world_broadcast' : 'chat_request' }),
      broadcastId: broadcast.broadcastId,
    };
  }

  return {
    kickoffBrief,
    openingMessage: resolveChatRequestOpeningMessage({
      openingMessage: kickoffBrief?.text ?? null,
      openingPayload: kickoffBrief?.payload ?? openingPayload,
      requestContext: normalizedContext,
    }),
    openingPayload: kickoffBrief?.payload ?? openingPayload,
    conversation,
    origin,
    broadcast,
    followUp,
  };
}

export function buildChatRequestContext({
  kickoffBrief = null,
  openingMessage = null,
  openingPayload = null,
  conversation = {},
  origin = null,
  broadcast = null,
  followUp = null,
  source = 'chat_request',
} = {}) {
  const normalizedConversation = normalizeChatRequestConversation(conversation);
  const normalizedKickoffBrief = resolveChatRequestKickoffBrief({
    kickoffBrief,
    openingMessage,
    openingPayload,
    source,
  });
  const normalizedOpeningPayload = normalizeChatRequestOpeningPayload(
    normalizedKickoffBrief?.payload ?? openingPayload,
  );
  const normalizedMessage = resolveChatRequestOpeningMessage({
    openingMessage: normalizedKickoffBrief?.text ?? openingMessage,
    openingPayload: normalizedOpeningPayload,
  });
  let normalizedOrigin = normalizeChatRequestOrigin(origin, {
    fallbackType: normalizeText(source, null) === 'world_broadcast' ? 'world_broadcast' : 'chat_request',
  });
  let normalizedBroadcast = normalizeChatRequestBroadcast(broadcast);
  const normalizedFollowUp = normalizeChatRequestFollowUp(followUp);

  if (normalizedOrigin?.broadcastId && !normalizedBroadcast?.broadcastId) {
    normalizedBroadcast = {
      ...(normalizedBroadcast || {}),
      broadcastId: normalizedOrigin.broadcastId,
    };
  }

  const requestContext = {
    type: 'chat_request',
    ...(normalizedKickoffBrief ? { kickoffBrief: normalizedKickoffBrief } : {}),
    ...(normalizedMessage ? { message: normalizedMessage } : {}),
    ...(normalizedOpeningPayload ? { openingPayload: normalizedOpeningPayload } : {}),
    ...(Object.keys(normalizedConversation).length > 0 ? { conversation: normalizedConversation } : {}),
    ...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
    ...(normalizedBroadcast ? { broadcast: normalizedBroadcast } : {}),
    ...(normalizedFollowUp ? { followUp: normalizedFollowUp } : {}),
  };

  return requestContext;
}

export function normalizeStoredChatRequest(input = {}, { defaultSource = 'chat_request' } = {}) {
  const normalizedSource = normalizeText(input.source, defaultSource);
  const normalizedRequest = normalizeChatRequestInput({
    requestContext: input.requestContext,
    source: normalizedSource,
  });
  const kickoffBrief = resolveChatRequestKickoffBrief({
    kickoffBrief: input.kickoffBrief,
    openingMessage: input.openingMessage,
    openingPayload: input.openingPayload ?? normalizedRequest.openingPayload,
    requestContext: input.requestContext,
    source: normalizedSource,
  });
  const openingPayload = normalizeChatRequestOpeningPayload(
    input.openingPayload ?? kickoffBrief?.payload ?? normalizedRequest.openingPayload,
  );
  const openingMessage = resolveChatRequestOpeningMessage({
    openingMessage: kickoffBrief?.text ?? input.openingMessage,
    openingPayload,
    requestContext: input.requestContext,
  });
  const conversation = normalizeChatRequestConversation(
    input.conversation && typeof input.conversation === 'object' && !Array.isArray(input.conversation)
      ? input.conversation
      : normalizedRequest.conversation,
  );
  const broadcast = normalizeChatRequestBroadcast(
    input.broadcast && typeof input.broadcast === 'object' && !Array.isArray(input.broadcast)
      ? input.broadcast
      : normalizedRequest.broadcast,
  );
  const followUp = normalizeChatRequestFollowUp(
    input.followUp && typeof input.followUp === 'object' && !Array.isArray(input.followUp)
      ? input.followUp
      : normalizedRequest.followUp,
  );
  let origin = normalizeChatRequestOrigin(
    input.origin && typeof input.origin === 'object' && !Array.isArray(input.origin)
      ? input.origin
      : normalizedRequest.origin,
    { fallbackType: normalizedSource === 'world_broadcast' ? 'world_broadcast' : 'chat_request' },
  );

  if (broadcast?.broadcastId && !origin?.broadcastId) {
    origin = {
      ...(origin || { type: normalizedSource === 'world_broadcast' ? 'world_broadcast' : 'chat_request' }),
      broadcastId: broadcast.broadcastId,
    };
  }

  const chatRequestId = normalizeText(input.chatRequestId, normalizeText(input.requestId, null));
  const normalized = {
    chatRequestId,
    requestId: chatRequestId,
    fromAgentId: normalizeText(input.fromAgentId, null),
    toAgentId: normalizeText(input.toAgentId, null),
    openingMessage,
    ...(kickoffBrief ? { kickoffBrief } : {}),
    ...(openingPayload ? { openingPayload } : {}),
    conversation,
    ...(origin ? { origin } : {}),
    ...(broadcast ? { broadcast } : {}),
    requestContext: buildChatRequestContext({
      kickoffBrief,
      openingMessage,
      openingPayload,
      conversation,
      origin,
      broadcast,
      followUp,
      source: normalizedSource,
    }),
    status: normalizeText(input.status, 'pending'),
    createdAt: normalizeText(input.createdAt, null),
    respondedAt: normalizeText(input.respondedAt, null),
    expiresAt: normalizeText(input.expiresAt, null),
    source: normalizedSource,
  };

  const acceptedByAgentId = normalizeText(input.acceptedByAgentId, null);
  if (acceptedByAgentId) normalized.acceptedByAgentId = acceptedByAgentId;
  const approvalGrantId = normalizeText(input.approvalGrantId, null);
  if (approvalGrantId) normalized.approvalGrantId = approvalGrantId;
  const kickoff = normalizeAcceptedChatKickoffRecord(cloneJsonObject(input.kickoff));
  if (kickoff) normalized.kickoff = kickoff;

  return normalized;
}
