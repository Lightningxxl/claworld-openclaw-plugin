import { renderAcceptedChatKickoffMarkdown } from './agent-readable-markdown.js';

export const ACCEPTED_CHAT_KICKOFF_PAYLOAD_KIND = 'accepted_chat_kickoff';

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

function normalizeKickoffPayload(input) {
  return cloneJsonObject(input);
}

function normalizeKickoffSource(value, fallback = 'chat_request_brief') {
  return normalizeText(value, fallback);
}

export function projectKickoffBrief(input = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const normalized = createKickoffBrief({
    text: input.text,
    payload: input.payload,
    source: input.source,
  });
  if (!normalized) return null;

  const payload = normalized.payload && typeof normalized.payload === 'object' && !Array.isArray(normalized.payload)
    ? cloneJsonObject(normalized.payload)
    : null;
  if (payload?.text === normalized.text) delete payload.text;
  if (payload?.source === normalized.source) delete payload.source;

  return {
    ...(normalized.text ? { text: normalized.text } : {}),
    ...(payload && Object.keys(payload).length > 0 ? { payload } : {}),
    ...(normalized.source && normalized.source !== 'chat_request_brief' ? { source: normalized.source } : {}),
  };
}

export function createKickoffBrief({
  text = null,
  payload = null,
  source = 'chat_request_brief',
} = {}) {
  const normalizedPayload = normalizeKickoffPayload(payload);
  const normalizedText = normalizeText(text, normalizeText(normalizedPayload?.text, null));
  if (!normalizedText && !normalizedPayload) return null;
  const hasPayloadText = typeof normalizedPayload?.text === 'string' && normalizedPayload.text.trim().length > 0;
  return {
    ...(normalizedText ? { text: normalizedText } : {}),
    ...(normalizedPayload ? {
      payload: {
        ...normalizedPayload,
        ...(normalizedText && !hasPayloadText ? { text: normalizedText } : {}),
      },
    } : {}),
    source: normalizeKickoffSource(source),
  };
}

export function resolveStoredKickoffBrief(requestContext = {}) {
  if (!requestContext || typeof requestContext !== 'object' || Array.isArray(requestContext)) return null;

  const kickoffBrief = requestContext.kickoffBrief && typeof requestContext.kickoffBrief === 'object' && !Array.isArray(requestContext.kickoffBrief)
    ? requestContext.kickoffBrief
    : null;
  if (kickoffBrief) {
    return createKickoffBrief({
      text: kickoffBrief.text,
      payload: kickoffBrief.payload,
      source: kickoffBrief.source,
    });
  }

  return createKickoffBrief({
    text: normalizeText(requestContext.openingPayload?.text, normalizeText(requestContext.message, null)),
    payload: requestContext.openingPayload,
    source: requestContext.openingPayload?.source || 'chat_request_opening',
  });
}

export function resolveAcceptedChatKickoffViewer(bundle = {}, {
  localAgentId = null,
  fallback = 'recipient',
} = {}) {
  const normalizedLocalAgentId = normalizeText(localAgentId, null);
  const participants = bundle?.participants && typeof bundle.participants === 'object' && !Array.isArray(bundle.participants)
    ? bundle.participants
    : {};
  const senderAgentId = normalizeText(participants.sender?.agentId, null);
  const recipientAgentId = normalizeText(participants.recipient?.agentId, null);

  if (normalizedLocalAgentId && normalizedLocalAgentId === senderAgentId) return 'sender';
  if (normalizedLocalAgentId && normalizedLocalAgentId === recipientAgentId) return 'recipient';
  return fallback === 'sender' ? 'sender' : 'recipient';
}

function buildAcceptedChatKickoffRuntimeContext(bundle = {}, { viewer = 'recipient' } = {}) {
  const resolvedViewer = viewer === 'sender' ? 'sender' : 'recipient';
  const requestContext = bundle.requestContext && typeof bundle.requestContext === 'object' && !Array.isArray(bundle.requestContext)
    ? bundle.requestContext
    : {};
  const request = bundle.request && typeof bundle.request === 'object' && !Array.isArray(bundle.request)
    ? bundle.request
    : {};
  const brief = requestContext.brief && typeof requestContext.brief === 'object' && !Array.isArray(requestContext.brief)
    ? requestContext.brief
    : request.brief && typeof request.brief === 'object' && !Array.isArray(request.brief)
      ? request.brief
      : {};

  return {
    viewer: resolvedViewer,
    text: formatAcceptedChatKickoffMessage(bundle, { viewer: resolvedViewer }),
    briefText: normalizeText(brief.text, null),
  };
}

export function readAcceptedChatKickoffRuntimeContext(bundle = {}, { viewer = 'recipient' } = {}) {
  const resolvedViewer = viewer === 'sender' ? 'sender' : 'recipient';
  const requestContext = bundle.requestContext && typeof bundle.requestContext === 'object' && !Array.isArray(bundle.requestContext)
    ? bundle.requestContext
    : {};
  const request = bundle.request && typeof bundle.request === 'object' && !Array.isArray(bundle.request)
    ? bundle.request
    : {};
  const brief = requestContext.brief && typeof requestContext.brief === 'object' && !Array.isArray(requestContext.brief)
    ? requestContext.brief
    : request.brief && typeof request.brief === 'object' && !Array.isArray(request.brief)
      ? request.brief
      : {};
  const runtimeContext = bundle.runtimeContext && typeof bundle.runtimeContext === 'object' && !Array.isArray(bundle.runtimeContext)
    ? bundle.runtimeContext
    : {};
  const candidate = runtimeContext[resolvedViewer] && typeof runtimeContext[resolvedViewer] === 'object' && !Array.isArray(runtimeContext[resolvedViewer])
    ? runtimeContext[resolvedViewer]
    : null;
  if (!candidate) return null;

  const text = normalizeText(candidate.text, null);
  if (!text) return null;

  return {
    viewer: resolvedViewer,
    text,
    briefText: normalizeText(candidate.briefText, normalizeText(brief.text, null)),
  };
}

export function createAcceptedChatKickoffRuntimeContext(bundle = {}, { viewer = 'recipient' } = {}) {
  return readAcceptedChatKickoffRuntimeContext(bundle, { viewer })
    || buildAcceptedChatKickoffRuntimeContext(bundle, { viewer });
}

export function createAcceptedChatKickoffRuntimeContexts(bundle = {}) {
  return {
    sender: buildAcceptedChatKickoffRuntimeContext(bundle, { viewer: 'sender' }),
    recipient: buildAcceptedChatKickoffRuntimeContext(bundle, { viewer: 'recipient' }),
  };
}

export function createAcceptedChatKickoffRuntimeContextForAgent(bundle = {}, {
  localAgentId = null,
  fallback = 'recipient',
} = {}) {
  return createAcceptedChatKickoffRuntimeContext(bundle, {
    viewer: resolveAcceptedChatKickoffViewer(bundle, {
      localAgentId,
      fallback,
    }),
  });
}

export function formatAcceptedChatKickoffMessage(bundle = {}, { viewer = 'recipient' } = {}) {
  return renderAcceptedChatKickoffMarkdown(
    cloneJsonObject(bundle) || {},
    { viewer: viewer === 'sender' ? 'sender' : 'recipient' },
  );
}
