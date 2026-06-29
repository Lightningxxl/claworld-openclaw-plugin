import {
  CLAWORLD_CONTEXT_DIR,
  CLAWORLD_JOURNAL_DIR,
  CLAWORLD_REPORTS_DIR,
  CLAWORLD_WORKING_MEMORY_DIR,
  CLAWORLD_WORKING_MEMORY_FILES,
} from './working-memory.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizePayload(payload = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return { ...payload };
}

export const CLAWORLD_SESSION_KINDS = Object.freeze({
  externalMain: 'external_main',
  management: 'management',
  conversation: 'conversation',
});

export const CLAWORLD_MANAGEMENT_EVENT_TYPES = Object.freeze([
  'notification',
  'domain_notification',
  'management_wake',
  'management_tick',
  'conversation_lifecycle',
  'platform_recommendation',
  'ops_recommendation',
]);

export function buildManagementSessionKey(agentId = null) {
  const normalizedAgentId = normalizeText(agentId, null);
  return normalizedAgentId ? `management:${normalizedAgentId}` : null;
}

export function buildConversationSessionKey(conversationKey = null, fallbackSessionKey = null) {
  const normalizedConversationKey = normalizeText(conversationKey, null);
  if (normalizedConversationKey) return `conversation:${normalizedConversationKey}`;
  return normalizeText(fallbackSessionKey, null);
}

function resolveSessionKindFromSessionKey(sessionKey = null) {
  const normalizedSessionKey = normalizeText(sessionKey, null);
  if (!normalizedSessionKey) return null;
  const lowerSessionKey = normalizedSessionKey.toLowerCase();
  if (lowerSessionKey.startsWith('management:') || lowerSessionKey.includes(':management:')) {
    return CLAWORLD_SESSION_KINDS.management;
  }
  return CLAWORLD_SESSION_KINDS.conversation;
}

export function resolveRuntimeSessionTarget(event = {}, options = {}) {
  const payload = normalizePayload(event.payload);
  const targetAgentId = normalizeText(
    event.targetAgentId,
    normalizeText(payload.targetAgentId, normalizeText(options.targetAgentId, null)),
  );
  const conversationKey = normalizeText(
    event.conversationKey,
    normalizeText(payload.conversationKey, normalizeText(options.conversationKey, null)),
  );
  const providedSessionKey = normalizeText(
    event.sessionKey,
    normalizeText(payload.sessionKey, normalizeText(options.sessionKey, null)),
  );
  const sessionKind = resolveSessionKindFromSessionKey(providedSessionKey);

  if (sessionKind === CLAWORLD_SESSION_KINDS.management) {
    const managementSessionKey = normalizeText(providedSessionKey, normalizeText(
      options.managementSessionKey,
      buildManagementSessionKey(targetAgentId),
    ));
    return {
      sessionKind: CLAWORLD_SESSION_KINDS.management,
      target: normalizeText(options.managementTarget, 'management_session'),
      sessionKey: providedSessionKey,
      managementSessionKey: managementSessionKey || null,
      conversationSessionKey: conversationKey ? buildConversationSessionKey(conversationKey) : null,
      targetAgentId,
      conversationKey,
    };
  }

  const conversationSessionKey = buildConversationSessionKey(conversationKey, providedSessionKey);
  return {
    sessionKind: CLAWORLD_SESSION_KINDS.conversation,
    target: normalizeText(options.sessionTarget, 'conversation_session'),
    sessionKey: conversationSessionKey,
    managementSessionKey: conversationSessionKey && targetAgentId
      ? buildManagementSessionKey(targetAgentId)
      : null,
    conversationSessionKey,
    targetAgentId,
    conversationKey,
  };
}

export function buildAgentWorkingMemoryArtifactIndex({
  agentId = null,
  root = CLAWORLD_WORKING_MEMORY_DIR,
  now = null,
} = {}) {
  const normalizedAgentId = normalizeText(agentId, 'unknown-agent');
  const basePath = normalizeText(root, CLAWORLD_WORKING_MEMORY_DIR).replace(/\/+$/, '');
  const profilePath = `${basePath}/${CLAWORLD_WORKING_MEMORY_FILES.profile}`;
  const memoryPath = `${basePath}/${CLAWORLD_WORKING_MEMORY_FILES.memory}`;
  const nowPath = `${basePath}/${CLAWORLD_WORKING_MEMORY_FILES.now}`;
  return {
    agentId: normalizedAgentId,
    generatedAt: normalizeText(now, null),
    workingMemoryRoot: basePath,
    profilePath,
    memoryPath,
    nowPath,
    journalPath: `${basePath}/${CLAWORLD_JOURNAL_DIR}/`,
    reportsPath: `${basePath}/${CLAWORLD_REPORTS_DIR}/`,
    contextPath: `${basePath}/${CLAWORLD_CONTEXT_DIR}/`,
    requiredFiles: [profilePath, memoryPath, nowPath],
  };
}

export function createManagementWorkingMemoryBootstrapContext({
  agentId = null,
  trigger = 'management_wake',
  event = {},
  workingMemoryRoot = CLAWORLD_WORKING_MEMORY_DIR,
  now = null,
} = {}) {
  const artifactIndex = buildAgentWorkingMemoryArtifactIndex({
    agentId,
    root: workingMemoryRoot,
    now,
  });
  return {
    sessionKind: CLAWORLD_SESSION_KINDS.management,
    sessionKey: buildManagementSessionKey(agentId),
    agentId: normalizeText(agentId, null),
    trigger: normalizeText(trigger, 'management_wake'),
    workingMemory: artifactIndex,
    artifactIndex,
    bootstrapChecklist: [
      'read PROFILE.md for autonomy policy and authorization boundaries',
      'read MEMORY.md for durable people/world/user preference context',
      'read NOW.md for active standing intents and report policy',
      'load recent journal and report pointers before deciding actions',
      'verify backend facts with public tools before acting',
      'write journal/report evidence for important management decisions',
    ],
    event: normalizePayload(event),
  };
}
