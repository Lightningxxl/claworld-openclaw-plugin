import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  applyRuntimeIdentity,
  buildRuntimeAuthHeaders,
  normalizeRuntimeRegistration,
  resolveRuntimeAppToken,
} from './account-identity.js';
import {
  claworldChannelConfigJsonSchema,
  claworldChannelConfigSchema,
  defaultClaworldAccountId,
  inspectClaworldChannelAccount,
  listClaworldAccountIds,
  projectClaworldStatusAccount,
  resolveClaworldChannelAccount,
  resolveClaworldRuntimeConfig,
  validateClaworldChannelConfig,
} from './config-schema.js';
import {
  loadClaworldRuntimeBackup,
  persistClaworldRuntimeBackup,
} from './runtime-backup.js';
import {
  claworldOnboardingAdapter,
  claworldSetupAdapter,
} from './onboarding.js';
import { createClaworldLifecycleManager } from './lifecycle.js';
import { createClaworldRelayClient } from './relay-client.js';
import { createRelayEventProtocol } from '../protocol/relay-event-protocol.js';
import { createInboundSessionRouter } from '../runtime/inbound-session-router.js';
import { createOutboundSessionBridge } from '../runtime/outbound-session-bridge.js';
import { createCanonicalResultBuilder } from '../runtime/canonical-result-builder.js';
import { createDemoSessionBootstrap } from '../runtime/demo-session-bootstrap.js';
import {
  CLAWORLD_PUBLIC_TOOL_NAMES,
  CLAWORLD_RETIRED_PUBLIC_TOOL_NAMES,
  CLAWORLD_TOOL_CONTRACT_VERSION,
} from '../runtime/tool-inventory.js';
import {
  appendClaworldJournalEvent,
  buildClaworldRuntimeMaintenanceEvent,
} from '../runtime/working-memory.js';
import {
  broadcastModeratedWorld,
  createModeratedWorld,
  fetchModeratedWorldInvites,
  fetchOwnedWorlds,
  inviteModeratedWorldMember,
  manageModeratedWorld,
  revokeModeratedWorldInvite,
} from '../runtime/world-moderation-helper.js';
import {
  fetchPendingWorldInvites,
  fetchWorldMembership,
  fetchWorldMemberships,
  leaveWorldMembership,
  updateWorldMembershipProfile,
} from '../runtime/world-membership-helper.js';
import { submitFeedbackReport } from '../runtime/feedback-helper.js';
import {
  buildWorldSelectionPrompt,
  buildPostSetupWorldDirectory,
  fetchWorldDetail,
  getPublicProfile,
  joinWorld,
  lookupPublicProfile,
  search,
  searchWorldMembers,
  searchWorlds,
  resolveWorldSelection,
  resolveWorldSelectionFlow,
} from '../runtime/product-shell-helper.js';
import { extractBackendErrorContext } from '../runtime/backend-error-context.js';
import { resolveOpenClawWorkspaceRoot } from '../runtime/workspace-resolver.js';
import { getClaworldRuntime } from './runtime.js';
import {
  CLAWORLD_PLUGIN_CURRENT_VERSION,
} from '../plugin-version.js';
import {
  createRuntimeBoundaryError,
  normalizeRuntimeBoundaryError,
  serializeRuntimeBoundaryError,
} from '../../lib/runtime-errors.js';
import { PUBLIC_IDENTITY_STATUS } from '../../lib/public-identity.js';

function normalizeRelayHttpBaseUrl(serverUrl) {
  const parsed = new URL(serverUrl);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizePluginOptionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeAssistantOutputTexts(value) {
  const rawTexts = Array.isArray(value) ? value : [value];
  const texts = [];
  for (const rawText of rawTexts) {
    const normalized = normalizePluginOptionalText(rawText);
    if (normalized && !texts.includes(normalized)) texts.push(normalized);
  }
  return texts;
}

function pruneRecentAssistantOutputs(now = Date.now()) {
  const pruneMap = (records) => {
    for (const [key, record] of records.entries()) {
      if (!record || now - Number(record.recordedAt || 0) > CLAWORLD_ASSISTANT_OUTPUT_TTL_MS) {
        records.delete(key);
      }
    }
    if (records.size <= CLAWORLD_ASSISTANT_OUTPUT_MAX_RECORDS) return;
    const sorted = [...records.entries()].sort((a, b) =>
      Number(a[1]?.recordedAt || 0) - Number(b[1]?.recordedAt || 0),
    );
    for (const [key] of sorted.slice(0, Math.max(0, records.size - CLAWORLD_ASSISTANT_OUTPUT_MAX_RECORDS))) {
      records.delete(key);
    }
  };
  pruneMap(recentAssistantOutputBySessionKey);
  pruneMap(recentAssistantOutputBySessionId);
}

export function recordClaworldRuntimeAssistantOutput({
  sessionKey = null,
  sessionId = null,
  runId = null,
  assistantTexts = [],
  timestamp = null,
  recordedAt = Date.now(),
} = {}) {
  const texts = normalizeAssistantOutputTexts(assistantTexts);
  if (texts.length === 0) return false;
  const normalizedSessionKey = normalizePluginOptionalText(sessionKey);
  const normalizedSessionId = normalizePluginOptionalText(sessionId);
  if (!normalizedSessionKey && !normalizedSessionId) return false;
  const record = {
    sessionKey: normalizedSessionKey,
    sessionId: normalizedSessionId,
    runId: normalizePluginOptionalText(runId),
    assistantTexts: texts,
    timestamp: normalizePluginOptionalText(timestamp),
    recordedAt: Number.isFinite(Number(recordedAt)) ? Number(recordedAt) : Date.now(),
  };
  if (normalizedSessionKey) recentAssistantOutputBySessionKey.set(normalizedSessionKey, record);
  if (normalizedSessionId) recentAssistantOutputBySessionId.set(normalizedSessionId, record);
  pruneRecentAssistantOutputs(record.recordedAt);
  return true;
}

function readRecentAssistantOutputRecord({
  sessionKeys = [],
  sessionId = null,
  afterMs = 0,
} = {}) {
  pruneRecentAssistantOutputs();
  const candidates = [];
  for (const sessionKey of sessionKeys) {
    const normalizedSessionKey = normalizePluginOptionalText(sessionKey);
    if (!normalizedSessionKey) continue;
    const record = recentAssistantOutputBySessionKey.get(normalizedSessionKey);
    if (record) candidates.push(record);
  }
  const normalizedSessionId = normalizePluginOptionalText(sessionId);
  if (normalizedSessionId) {
    const record = recentAssistantOutputBySessionId.get(normalizedSessionId);
    if (record) candidates.push(record);
  }
  return candidates
    .filter((record) =>
      Number(record?.recordedAt || 0) >= afterMs
      && normalizeAssistantOutputTexts(record?.assistantTexts).length > 0,
    )
    .sort((a, b) => Number(b.recordedAt || 0) - Number(a.recordedAt || 0))[0] || null;
}

async function waitForRecentAssistantOutputRecord({
  sessionKeys = [],
  sessionId = null,
  afterMs = 0,
  timeoutMs = CLAWORLD_ASSISTANT_OUTPUT_WAIT_MS,
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const record = readRecentAssistantOutputRecord({ sessionKeys, sessionId, afterMs });
    if (record) return record;
    await new Promise((resolve) => {
      setTimeout(resolve, CLAWORLD_ASSISTANT_OUTPUT_POLL_MS);
    });
  }
  return null;
}

async function loadOpenClawReplyRuntime() {
  if (!openClawReplyRuntimePromise) {
    openClawReplyRuntimePromise = import('openclaw/plugin-sdk/reply-runtime')
      .catch(async () => {
        const argvPath = normalizePluginOptionalText(process.argv?.[1]);
        if (!argvPath || !argvPath.endsWith('openclaw.mjs')) return null;
        const runtimePath = path.join(path.dirname(argvPath), 'dist', 'plugin-sdk', 'reply-runtime.js');
        return import(pathToFileURL(runtimePath).href).catch(() => null);
      });
  }
  return openClawReplyRuntimePromise;
}

async function resolveOpenClawReplyResolver(runtime = null) {
  const directResolver = runtime?.channel?.reply?.getReplyFromConfig;
  if (typeof directResolver === 'function') return directResolver;
  const replyRuntime = await loadOpenClawReplyRuntime();
  return typeof replyRuntime?.getReplyFromConfig === 'function' ? replyRuntime.getReplyFromConfig : null;
}

function requireClientMessageId(value = null) {
  const normalized = normalizePluginOptionalText(value);
  if (!normalized) {
    throw new Error('claworld outbound clientMessageId is required for POST /v1/orchestration/messages');
  }
  return normalized;
}

function buildGeneratedClientMessageId() {
  return `openclaw_manual_${randomUUID()}`;
}

const DEFAULT_RELAY_HTTP_TIMEOUT_MS = 15_000;
const CLAWORLD_ASSISTANT_OUTPUT_TTL_MS = 60_000;
const CLAWORLD_ASSISTANT_OUTPUT_WAIT_MS = 750;
const CLAWORLD_ASSISTANT_OUTPUT_POLL_MS = 25;
const CLAWORLD_ASSISTANT_OUTPUT_MAX_RECORDS = 200;

const recentAssistantOutputBySessionKey = new Map();
const recentAssistantOutputBySessionId = new Map();
let openClawReplyRuntimePromise = null;

function buildRelayAgentSummary(item = {}) {
  const normalizedAgentId = normalizeClaworldText(item?.agentId, null);
  return {
    agentId: normalizedAgentId,
    displayName: normalizeClaworldText(item?.displayName, null),
    publicIdentity: item?.publicIdentity && typeof item.publicIdentity === 'object' ? item.publicIdentity : null,
    visibilityMode: normalizeClaworldText(item?.visibilityMode, null),
    contactPolicy: normalizeClaworldText(item?.contactPolicy, null),
    online: typeof item?.online === 'boolean' ? item.online : null,
  };
}

function normalizeClaworldTarget(raw) {
  if (typeof raw !== 'string') return undefined;
  let value = raw.trim();
  if (!value) return undefined;
  value = value.replace(/^claworld:/i, '').replace(/^user:/i, '').trim();
  return value || undefined;
}

function normalizeClaworldText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function isClaworldPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function resolveClaworldOpeningMessage({
  openingMessage = null,
  message = null,
  text = null,
  kickoffBrief = null,
  openingPayload = null,
} = {}) {
  const brief = isClaworldPlainObject(kickoffBrief) ? kickoffBrief : null;
  return normalizeClaworldText(
    openingMessage,
    normalizeClaworldText(
      message,
      normalizeClaworldText(
        text,
        normalizeClaworldText(
          typeof kickoffBrief === 'string' ? kickoffBrief : null,
          normalizeClaworldText(
            brief?.text,
            normalizeClaworldText(
              brief?.openingMessage,
              normalizeClaworldText(brief?.message, normalizeClaworldText(openingPayload?.text, null)),
            ),
          ),
        ),
      ),
    ),
  );
}

function normalizeClaworldKickoffBriefInput(kickoffBrief = null, openingMessage = null) {
  if (isClaworldPlainObject(kickoffBrief)) {
    return {
      ...kickoffBrief,
      ...(!resolveClaworldOpeningMessage({ kickoffBrief }) && openingMessage ? { text: openingMessage } : {}),
    };
  }
  const text = normalizeClaworldText(kickoffBrief, null);
  return text ? { text } : null;
}

function resolveNormalizedText(value, fallback = null) {
  return normalizeClaworldText(value, fallback);
}

function resolveInboundMessageId({ delivery = {}, payload = {}, metadata = {} } = {}) {
  const notification = payload.notification && typeof payload.notification === 'object' && !Array.isArray(payload.notification)
    ? payload.notification
    : delivery.notification && typeof delivery.notification === 'object' && !Array.isArray(delivery.notification)
      ? delivery.notification
      : {};
  const candidates = [
    delivery.deliveryId,
    delivery.inboxItemId,
    delivery.messageId,
    delivery.eventId,
    delivery.notificationId,
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
    const normalized = resolveNormalizedText(candidate, null);
    if (normalized) return normalized;
  }
  return null;
}

function isAgentScopedSessionKey(sessionKey) {
  return /^agent:[^:]+:/i.test(String(sessionKey || ''));
}

function buildAgentScopedLocalSessionKey({ sessionKey, localAgentId } = {}) {
  const normalizedSessionKey = resolveNormalizedText(sessionKey, null);
  if (!normalizedSessionKey) return null;
  if (isAgentScopedSessionKey(normalizedSessionKey)) {
    return normalizedSessionKey;
  }
  const normalizedLocalAgentId = resolveNormalizedText(localAgentId, null);
  if (!normalizedLocalAgentId) {
    return normalizedSessionKey;
  }
  return `agent:${normalizedLocalAgentId}:${normalizedSessionKey}`;
}

function stripAgentScopedLocalSessionKey({ sessionKey, localAgentId } = {}) {
  const normalizedSessionKey = resolveNormalizedText(sessionKey, null);
  if (!normalizedSessionKey) return null;
  const normalizedLocalAgentId = resolveNormalizedText(localAgentId, null);
  if (!normalizedLocalAgentId) {
    return normalizedSessionKey;
  }
  const prefix = `agent:${normalizedLocalAgentId}:`;
  if (normalizedSessionKey.startsWith(prefix)) {
    return normalizedSessionKey.slice(prefix.length) || null;
  }
  return normalizedSessionKey;
}

function normalizeLocalSessionKeyFields(record = null, { localAgentId = null } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }
  const nextRecord = { ...record };
  const normalizedLocalSessionKey = buildAgentScopedLocalSessionKey({
    sessionKey: resolveNormalizedText(record.localSessionKey, resolveNormalizedText(record.sessionKey, null)),
    localAgentId,
  });
  if (normalizedLocalSessionKey) {
    nextRecord.localSessionKey = normalizedLocalSessionKey;
  }
  return nextRecord;
}

function normalizeChatInboxPayloadSessionKeys(payload = null, { localAgentId = null } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const nextPayload = { ...payload };
  if (payload.filters && typeof payload.filters === 'object' && !Array.isArray(payload.filters)) {
    const normalizedFilterLocalSessionKey = buildAgentScopedLocalSessionKey({
      sessionKey: payload.filters.localSessionKey,
      localAgentId,
    });
    nextPayload.filters = {
      ...payload.filters,
      ...(normalizedFilterLocalSessionKey ? { localSessionKey: normalizedFilterLocalSessionKey } : {}),
    };
  }
  if (Array.isArray(payload.chats)) {
    nextPayload.chats = payload.chats.map((chat) => normalizeLocalSessionKeyFields(chat, { localAgentId }));
  }
  if (payload.kickoff && typeof payload.kickoff === 'object' && !Array.isArray(payload.kickoff)) {
    nextPayload.kickoff = normalizeLocalSessionKeyFields(payload.kickoff, { localAgentId });
  }
  if (payload.chat && typeof payload.chat === 'object' && !Array.isArray(payload.chat)) {
    nextPayload.chat = normalizeLocalSessionKeyFields(payload.chat, { localAgentId });
  }
  return nextPayload;
}

function resolveRelaySessionKeyFromOutboundContext(outboundContext = {}) {
  const metadata = outboundContext?.metadata && typeof outboundContext.metadata === 'object' && !Array.isArray(outboundContext.metadata)
    ? outboundContext.metadata
    : {};
  return normalizeClaworldText(
    outboundContext.relaySessionKey,
    normalizeClaworldText(
      outboundContext.RelaySessionKey,
      normalizeClaworldText(
        metadata.relaySessionKey,
        normalizeClaworldText(
          metadata.sessionKey,
          normalizeClaworldText(
            outboundContext.sessionKey,
            normalizeClaworldText(outboundContext.SessionKey, null),
          ),
        ),
      ),
    ),
  );
}

function normalizeClaworldInteger(value, fallback = null) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.trunc(normalized);
}

function shouldAuthorizeBridgedCommand({ runtimeConfig = {}, incomingText }) {
  if (runtimeConfig.testing?.allowBridgedCommandDispatch !== true) {
    return false;
  }
  return typeof incomingText === 'string' && incomingText.trim().startsWith('/');
}

function normalizeUntrustedContextLines(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => resolveNormalizedText(entry, null))
      .filter(Boolean);
  }
  const singleLine = resolveNormalizedText(value, null);
  return singleLine ? [singleLine] : [];
}

function mergeUntrustedContextLines(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const line of normalizeUntrustedContextLines(group)) {
      if (seen.has(line)) continue;
      seen.add(line);
      merged.push(line);
    }
  }
  return merged;
}

function parseBridgeTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveBridgeDeliveryTimestampMs({ delivery = {}, metadata = {} } = {}) {
  return parseBridgeTimestampMs(delivery?.createdAt)
    || parseBridgeTimestampMs(delivery?.availableAt)
    || parseBridgeTimestampMs(delivery?.turnCreatedAt)
    || parseBridgeTimestampMs(metadata?.createdAt)
    || Date.now();
}

const CLAWORLD_RELAY_OPERATIONAL_NOTICE_PATTERNS = [
  /^🧭\s*New session:\s+\S+/i,
  /^🧹\s*Auto-compaction complete(?:\s*\(count \d+\))?\.$/i,
  /^↪️\s*Model Fallback:/i,
  /^↪️\s*Model Fallback cleared:/i,
  /^⚠️\s*Agent failed before reply:/i,
  /^Sent the (?:reply|opener|Claworld reply)\.?$/i,
];

// Older/runtime-variant OpenClaw hosts may surface provider/runtime failures as
// plain final text without setting `isError`. Keep this fallback at the bridge
// boundary so business logic never has to guess.
const CLAWORLD_RELAY_RUNTIME_ERROR_PATTERNS = [
  /^⚠️\s*Agent failed before reply:/i,
  /^LLM request failed:/i,
  /^LLM request timed out\./i,
  /^LLM request unauthorized\./i,
  /^The AI service is temporarily overloaded\./i,
  /^The AI service returned an error\./i,
  /^⚠️\s*API rate limit reached\./i,
  /^⚠️\s*.+\s+returned a billing error\b/i,
];

const CLAWORLD_RELAY_OPERATIONAL_SUFFIX_PATTERNS = [
  /^Usage:\s+.+\s+in\s+\/\s+.+\s+out(?:\s+·\s+est\s+.+)?$/i,
];

const CLAWORLD_RUNTIME_OUTPUT_PREVIEW_LIMIT = 3;

function stripRelayOperationalSuffix(text) {
  const lines = String(text || '').split('\n');
  while (lines.length > 0) {
    const lastLine = String(lines[lines.length - 1] || '').trim();
    if (!lastLine) {
      lines.pop();
      continue;
    }
    if (!CLAWORLD_RELAY_OPERATIONAL_SUFFIX_PATTERNS.some((pattern) => pattern.test(lastLine))) {
      break;
    }
    lines.pop();
  }
  return lines.join('\n').trim();
}

function classifyRelayContinuationText(text) {
  const normalized = stripRelayOperationalSuffix(text);
  if (!normalized) {
    return {
      text: '',
      operationalNotice: Boolean(String(text || '').trim()),
      runtimeError: false,
    };
  }
  if (CLAWORLD_RELAY_OPERATIONAL_NOTICE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      text: '',
      operationalNotice: true,
      runtimeError: false,
    };
  }
  return {
    text: normalized,
    operationalNotice: false,
    runtimeError: false,
  };
}

function sanitizeRelayContinuationText(text) {
  return classifyRelayContinuationText(text).text;
}

function classifyRelayContinuationPayload(payload = {}) {
  const rawText = String(payload?.text ?? payload?.body ?? '').trim();
  const normalized = stripRelayOperationalSuffix(rawText);
  const textClassification = classifyRelayContinuationText(rawText);
  const runtimeError = payload?.isError === true
    || CLAWORLD_RELAY_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
  if (runtimeError) {
    return {
      text: '',
      previewText: normalized,
      operationalNotice: false,
      runtimeError: true,
      nonRenderable: true,
    };
  }
  return {
    text: textClassification.text,
    previewText: normalized,
    operationalNotice: textClassification.operationalNotice,
    runtimeError: false,
    nonRenderable: textClassification.operationalNotice,
  };
}

function resolveRelaySilentReason(runtimeOutputSummary = {}, continuation = {}) {
  const counts = runtimeOutputSummary?.counts || {};
  if (Number(counts.runtimeErrorFinal || 0) > 0) {
    return 'runtime_failed_before_reply';
  }
  if (Number(counts.operationalNotice || 0) > 0 && Number(counts.nonRenderableFinal || 0) === Number(counts.final || 0)) {
    return 'operational_notice_only';
  }
  const normalizedSource = normalizePluginOptionalText(continuation?.source);
  if (normalizedSource && normalizedSource !== 'none') {
    return normalizedSource;
  }
  return 'no_renderable_reply';
}

function previewRuntimeOutputText(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function appendRuntimeOutputPreview(previews, text) {
  const preview = previewRuntimeOutputText(text);
  if (!preview) return;
  if (previews.includes(preview)) return;
  if (previews.length >= CLAWORLD_RUNTIME_OUTPUT_PREVIEW_LIMIT) return;
  previews.push(preview);
}

function buildActiveDeliveryReplyKey({ accountId = null, targetAgentId = null } = {}) {
  return [
    normalizePluginOptionalText(accountId) || 'default',
    normalizePluginOptionalText(targetAgentId) || '',
  ].join('\0');
}

function resolveClaworldTargetAliases(value) {
  const normalized = normalizeClaworldTarget(value) || normalizePluginOptionalText(value);
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  const atIndex = normalized.indexOf('@');
  if (atIndex > 0) aliases.add(normalized.slice(0, atIndex));
  return [...aliases].filter(Boolean);
}

function createActiveDeliveryReplyRegistry() {
  const entriesByAccountTarget = new Map();
  const entriesByAccount = new Map();

  const addAccountEntry = (accountId, entry) => {
    const accountKey = normalizePluginOptionalText(accountId) || 'default';
    let set = entriesByAccount.get(accountKey);
    if (!set) {
      set = new Set();
      entriesByAccount.set(accountKey, set);
    }
    set.add(entry);
    return accountKey;
  };

  const removeAccountEntry = (accountKey, entry) => {
    const set = entriesByAccount.get(accountKey);
    if (!set) return;
    set.delete(entry);
    if (set.size === 0) entriesByAccount.delete(accountKey);
  };

  return {
    register(rawEntry = {}) {
      const accountId = normalizePluginOptionalText(rawEntry.accountId) || 'default';
      const targetAliases = resolveClaworldTargetAliases(rawEntry.targetAgentId);
      const entry = {
        ...rawEntry,
        accountId,
        targetAgentId: targetAliases[0] || normalizePluginOptionalText(rawEntry.targetAgentId),
        registeredAt: Date.now(),
      };
      const accountKey = addAccountEntry(accountId, entry);
      const exactKeys = [];
      for (const alias of targetAliases) {
        const key = buildActiveDeliveryReplyKey({ accountId, targetAgentId: alias });
        entriesByAccountTarget.set(key, entry);
        exactKeys.push(key);
      }
      return () => {
        for (const key of exactKeys) {
          if (entriesByAccountTarget.get(key) === entry) entriesByAccountTarget.delete(key);
        }
        removeAccountEntry(accountKey, entry);
      };
    },

    resolve({ accountId = null, to = null } = {}) {
      const normalizedAccountId = normalizePluginOptionalText(accountId) || 'default';
      const targetAliases = resolveClaworldTargetAliases(to);
      for (const targetAlias of targetAliases) {
        const exact = entriesByAccountTarget.get(buildActiveDeliveryReplyKey({
          accountId: normalizedAccountId,
          targetAgentId: targetAlias,
        }));
        if (exact) return exact;
      }
      if (targetAliases.length > 0) return null;
      const accountEntries = entriesByAccount.get(normalizedAccountId);
      if (!accountEntries || accountEntries.size !== 1) return null;
      return [...accountEntries][0] || null;
    },
  };
}

function appendPartialContinuationChunk(currentText, chunk) {
  const nextChunk = typeof chunk === 'string' ? chunk : '';
  if (!nextChunk) return currentText;
  const existing = typeof currentText === 'string' ? currentText : '';
  if (!existing) return nextChunk;
  if (nextChunk === existing) return existing;
  if (nextChunk.startsWith(existing)) return nextChunk;
  if (existing.endsWith(nextChunk)) return existing;
  return `${existing}${nextChunk}`;
}

function normalizeReplyResolverPayloads(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result.filter((entry) => entry && typeof entry === 'object');
  if (Array.isArray(result.payloads)) return result.payloads.filter((entry) => entry && typeof entry === 'object');
  if (result && typeof result === 'object') return [result];
  return [];
}

function buildRelayContinuationText({
  finalTexts = [],
  blockTexts = [],
  partialText = '',
  allowPartialFallback = false,
} = {}) {
  const sanitizedFinalTexts = finalTexts
    .map((entry) => sanitizeRelayContinuationText(entry))
    .filter(Boolean);
  if (sanitizedFinalTexts.length > 0) {
    return {
      text: sanitizedFinalTexts.join('\n\n').trim(),
      source: 'final',
    };
  }
  const sanitizedBlockTexts = blockTexts
    .map((entry) => sanitizeRelayContinuationText(entry))
    .filter(Boolean);
  if (sanitizedBlockTexts.length > 0) {
    return {
      text: sanitizedBlockTexts.join('\n').trim(),
      source: 'block',
    };
  }
  const sanitizedPartialText = allowPartialFallback
    ? sanitizeRelayContinuationText(partialText)
    : '';
  if (sanitizedPartialText) {
    return {
      text: sanitizedPartialText,
      source: 'partial',
    };
  }
  return {
    text: '',
    source: 'none',
  };
}

function isExactNoReplyToken(text) {
  return String(text || '').trim() === 'NO_REPLY';
}

function resolveContinuationState(turnData = {}) {
  const continuation = turnData?.continuation;
  if (!continuation || typeof continuation !== 'object' || Array.isArray(continuation)) {
    return { allowed: true, reason: null, roundStatus: null };
  }
  return {
    allowed: continuation.allowed !== false,
    reason: normalizeClaworldText(continuation.reason, null),
    roundStatus: normalizeClaworldText(continuation.roundStatus, null),
  };
}

function buildClaworldDirectoryEntries(config = {}, accountId = null) {
  const accountIds = listClaworldAccountIds(config);
  const currentAccountId = String(accountId || '').trim();
  const entries = [];

  for (const id of accountIds) {
    const account = inspectClaworldChannelAccount(config, id);
    if (!account?.enabled || !account?.configured) continue;
    const normalizedId = String(account.accountId || id || '').trim();
    const boundAgentId = normalizeClaworldText(account.relay?.agentId, null);
    if (!normalizedId || !boundAgentId) continue;
    if (currentAccountId && normalizedId === currentAccountId) continue;
    entries.push({
      id: boundAgentId,
      name: normalizedId,
      handle: normalizedId,
      rank: 100,
    });
  }

  const current = inspectClaworldChannelAccount(config, currentAccountId || null);
  const defaultTargetAgentId = normalizeClaworldText(current?.relay?.defaultTargetAgentId, null);
  if (defaultTargetAgentId) {
    if (!entries.some((entry) => entry.id === defaultTargetAgentId)) {
      entries.push({ id: defaultTargetAgentId, name: defaultTargetAgentId, handle: defaultTargetAgentId, rank: 50 });
    }
  }

  return entries;
}

async function deliverRelayMessage({ runtimeConfig, to, text, fetchImpl, logger, outboundContext = {}, messagePayload = null }) {
  const fromAgentId = runtimeConfig.relay?.agentId;
  if (!fromAgentId) throw new Error('claworld relay.agentId is required for outbound send');

  const targetAgentId = normalizeClaworldText(to, null);
  if (!targetAgentId) throw new Error('claworld outbound targetAgentId is required');

  const normalizedText = normalizeClaworldText(text, null);
  const payload = messagePayload && typeof messagePayload === 'object'
    ? { ...messagePayload }
    : {};

  if (!normalizeClaworldText(payload.text, null) && normalizedText) {
    payload.text = normalizedText;
  }
  if (!normalizeClaworldText(payload.text, null)) {
    throw new Error('claworld outbound text is required');
  }
  payload.source = normalizeClaworldText(payload.source, 'openclaw-claworld');
  payload.accountId = normalizeClaworldText(payload.accountId, runtimeConfig.accountId);
  const clientMessageId = normalizePluginOptionalText(
    outboundContext.clientMessageId || outboundContext.metadata?.clientMessageId || null
  ) || buildGeneratedClientMessageId();
  const relaySessionKey = resolveRelaySessionKeyFromOutboundContext(outboundContext);

  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/orchestration/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      fromAgentId,
      targetAgentId,
      clientMessageId,
      payload,
      conversation: {
        conversationKey: outboundContext.conversationKey || outboundContext.metadata?.conversationKey || null,
        worldId: outboundContext.worldId || outboundContext.metadata?.worldId || null,
        scope: outboundContext.scope || outboundContext.metadata?.scope || null,
        conversationId: outboundContext.conversationId || outboundContext.metadata?.conversationId || null,
        threadId: outboundContext.threadId || outboundContext.metadata?.threadId || null,
        sessionKey: relaySessionKey,
      },
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:outbound] message delivery failed', { status: result.status, body: result.body });
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'relay_message_delivery_failed',
      publicMessage: 'claworld outbound message delivery failed',
      message: `claworld outbound failed: ${result.status}`,
      context: {
        fromAgentId,
        targetAgentId,
      },
      passThroughBackendConflict: true,
    });
  }

  return {
    channel: 'claworld',
    messageId: result.body?.turn?.turnId || `turn_${Date.now()}`,
    chatId: targetAgentId,
    timestamp: Date.now(),
    meta: {
      clientMessageId,
      sessionKey: result.body?.delivery?.sessionKey || relaySessionKey,
      turnId: result.body?.turn?.turnId || null,
      conversationKey: result.body?.conversationKey || null,
      targetAgentId,
    },
  };
}

function buildRelayJsonPath(pathname, query = {}) {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const normalized = resolveNormalizedText(value, null);
    if (normalized) search.set(key, normalized);
  });
  const encoded = search.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}

function createRelayRouteError({
  result,
  runtimeConfig,
  code,
  publicMessage,
  message,
  context = {},
  passThroughBackendConflict = false,
}) {
  const backendCode = resolveNormalizedText(result?.body?.error, null);
  const backendMessage = resolveNormalizedText(result?.body?.message, null);
  const shouldPassThroughConflict = passThroughBackendConflict === true
    && Number(result?.status) === 409
    && backendCode;
  throw createRuntimeBoundaryError({
    code: shouldPassThroughConflict ? backendCode : code,
    category: shouldPassThroughConflict ? 'conflict' : 'transport',
    status: result?.status >= 500 ? 502 : result?.status || 502,
    message: shouldPassThroughConflict
      ? (backendMessage || message || publicMessage)
      : (message || publicMessage),
    publicMessage: shouldPassThroughConflict
      ? (backendMessage || publicMessage)
      : publicMessage,
    recoverable: true,
    context: {
      accountId: runtimeConfig.accountId || null,
      httpStatus: result?.status || null,
      ...extractBackendErrorContext(result?.body),
      ...context,
    },
  });
}

async function createChatRequest({
  runtimeConfig,
  fromAgentId,
  displayName = null,
  agentCode = null,
  openingMessage = null,
  message = null,
  text = null,
  kickoffBrief = null,
  openingPayload = null,
  worldId = null,
  requestContext = null,
  fetchImpl,
}) {
  const normalizedDisplayName = normalizeClaworldText(displayName, null);
  const normalizedAgentCode = normalizeClaworldText(agentCode, null)?.toUpperCase() || null;
  if (!normalizedDisplayName || !normalizedAgentCode) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'claworld chat request target requires displayName and agentCode',
      publicMessage: 'claworld chat request target requires displayName and agentCode',
      recoverable: true,
      context: { fields: ['displayName', 'agentCode'] },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const normalizedOpeningPayload = isClaworldPlainObject(openingPayload) ? openingPayload : null;
  const normalizedOpeningMessage = resolveClaworldOpeningMessage({
    openingMessage,
    message,
    text,
    kickoffBrief,
    openingPayload: normalizedOpeningPayload,
  });
  const normalizedKickoffBrief = normalizeClaworldKickoffBriefInput(kickoffBrief, normalizedOpeningMessage);
  if (!normalizedOpeningMessage) {
    const message = 'openingMessage is required for chat request kickoff';
    throw createRuntimeBoundaryError({
      code: 'opening_message_required',
      category: 'input',
      status: 400,
      message,
      publicMessage: message,
      recoverable: true,
      context: {
        accountId: runtimeConfig.accountId || null,
        httpStatus: 400,
        backendCode: 'opening_message_required',
        backendMessage: message,
        fieldErrors: [
          {
            fieldId: 'openingMessage',
            message,
          },
        ],
        fromAgentId,
        displayName: normalizedDisplayName,
        agentCode: normalizedAgentCode,
      },
    });
  }
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/chat-requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      fromAgentId,
      displayName: normalizedDisplayName,
      agentCode: normalizedAgentCode,
      openingMessage: normalizedOpeningMessage,
      ...(normalizedKickoffBrief ? { kickoffBrief: normalizedKickoffBrief } : {}),
      ...(normalizedOpeningPayload ? { openingPayload: normalizedOpeningPayload } : {}),
      ...(normalizeClaworldText(worldId, null) ? { worldId: normalizeClaworldText(worldId, null) } : {}),
      ...(requestContext && typeof requestContext === 'object' && !Array.isArray(requestContext)
        ? { requestContext }
        : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'chat_request_create_failed',
      publicMessage: 'failed to create chat request',
      context: {
        fromAgentId,
        displayName: normalizedDisplayName,
        agentCode: normalizedAgentCode,
      },
      passThroughBackendConflict: true,
    });
  }
  return result.body || {};
}

async function listChatInbox({
  runtimeConfig,
  agentId,
  localAgentId = null,
  filters = null,
  direction = null,
  fetchImpl,
}) {
  const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
    ? filters
    : {};
  const relayLocalSessionKey = stripAgentScopedLocalSessionKey({
    sessionKey: normalizedFilters.localSessionKey,
    localAgentId,
  });
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const path = buildRelayJsonPath('/v1/chat-requests', {
    agentId,
    direction: normalizedFilters.direction || direction,
    mode: normalizedFilters.mode,
    status: normalizedFilters.status,
    worldId: normalizedFilters.worldId,
    chatRequestId: normalizedFilters.chatRequestId,
    conversationKey: normalizedFilters.conversationKey,
    localSessionKey: relayLocalSessionKey,
    counterpartyAgentId: normalizedFilters.counterpartyAgentId,
  });
  const result = await fetchJson(fetchImpl, `${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'chat_request_list_failed',
      publicMessage: 'failed to list chat requests',
      context: {
        agentId,
        direction: normalizedFilters.direction || direction,
        mode: normalizedFilters.mode || null,
        status: normalizedFilters.status || null,
        worldId: normalizedFilters.worldId || null,
        chatRequestId: normalizedFilters.chatRequestId || null,
      },
    });
  }
  return normalizeChatInboxPayloadSessionKeys(result.body || {}, { localAgentId });
}

async function acceptChatRequest({
  runtimeConfig,
  actorAgentId,
  chatRequestId,
  localAgentId = null,
  fetchImpl,
}) {
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/chat-requests/${encodeURIComponent(chatRequestId)}/accept`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({ actorAgentId }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'chat_request_accept_failed',
      publicMessage: 'failed to accept chat request',
      context: { actorAgentId, chatRequestId },
      passThroughBackendConflict: true,
    });
  }
  return normalizeChatInboxPayloadSessionKeys(result.body || {}, { localAgentId });
}

async function rejectChatRequest({
  runtimeConfig,
  actorAgentId,
  chatRequestId,
  fetchImpl,
}) {
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/chat-requests/${encodeURIComponent(chatRequestId)}/reject`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({ actorAgentId }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'chat_request_reject_failed',
      publicMessage: 'failed to reject chat request',
      context: { actorAgentId, chatRequestId },
      passThroughBackendConflict: true,
    });
  }
  return result.body || {};
}

async function closeConversation({
  runtimeConfig,
  actorAgentId,
  conversationKey = null,
  localSessionKey = null,
  localAgentId = null,
  fetchImpl,
}) {
  const relayLocalSessionKey = stripAgentScopedLocalSessionKey({
    sessionKey: localSessionKey,
    localAgentId,
  });
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/chat-requests/conversations/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      actorAgentId,
      ...(normalizeClaworldText(conversationKey, null) ? { conversationKey: normalizeClaworldText(conversationKey, null) } : {}),
      ...(normalizeClaworldText(relayLocalSessionKey, null) ? { localSessionKey: normalizeClaworldText(relayLocalSessionKey, null) } : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'conversation_close_failed',
      publicMessage: 'failed to close conversation',
      context: {
        actorAgentId,
        conversationKey: normalizeClaworldText(conversationKey, null),
        localSessionKey: relayLocalSessionKey,
      },
    });
  }
  return normalizeChatInboxPayloadSessionKeys(result.body || {}, { localAgentId });
}

function waitForAbort(signal) {
  return new Promise((resolve) => {
    if (!signal) return resolve({ reason: 'missing_abort_signal' });
    if (signal.aborted) return resolve({ reason: 'already_aborted' });
    signal.addEventListener('abort', () => resolve({ reason: 'abort_signal' }), { once: true });
  });
}

function waitForRelayClientClose(relayClient) {
  return new Promise((resolve) => {
    if (!relayClient?.once) return resolve({ reason: 'missing_relay_client' });
    relayClient.once('close', (info = {}) => {
      resolve({
        reason: info.reason || 'relay_client_closed',
        close: info,
      });
    });
  });
}

function isNonRecoverableBootstrapHoldError(error) {
  return Boolean(
    error
    && error.recoverable === false
    && ['auth', 'bootstrap', 'config', 'conflict', 'input', 'policy'].includes(error.category),
  );
}

function buildBootstrapHoldMessage(error, runtimeConfig = {}) {
  const publicMessage = normalizeClaworldText(error?.publicMessage, null);
  const fallbackMessage = normalizeClaworldText(error?.message, 'relay binding bootstrap failed');
  return `Claworld setup blocked: ${publicMessage || fallbackMessage}`;
}

function summarizeObjectShape(value) {
  if (!value || typeof value !== 'object') return { type: typeof value };
  const keys = Object.keys(value).sort();
  return {
    type: Array.isArray(value) ? 'array' : 'object',
    keys,
    hasChannelsClaworld: Boolean(value.channels?.claworld),
    hasAccounts: Boolean(value.accounts && typeof value.accounts === 'object'),
    accountId: value.accountId || null,
    configured: typeof value.configured === 'boolean' ? value.configured : null,
  };
}

function hasRelayDispatchSurface(runtime) {
  return Boolean(
    runtime?.channel?.routing?.resolveAgentRoute
    && runtime?.channel?.reply?.finalizeInboundContext
    && (
      runtime?.channel?.reply?.dispatchReplyFromConfig
      || runtime?.channel?.reply?.createReplyDispatcherWithTyping
    )
  );
}

function resolvePluginRuntimeCandidate(contextRuntime) {
  let globalRuntime = null;
  try {
    globalRuntime = getClaworldRuntime();
  } catch {
    globalRuntime = null;
  }

  if (hasRelayDispatchSurface(contextRuntime)) {
    return {
      runtime: contextRuntime,
      runtimeSource: 'context.runtime',
    };
  }

  if (hasRelayDispatchSurface(globalRuntime)) {
    return {
      runtime: globalRuntime,
      runtimeSource: 'global_runtime',
    };
  }

  if (contextRuntime) {
    return {
      runtime: contextRuntime,
      runtimeSource: 'context.runtime',
    };
  }

  if (globalRuntime) {
    return {
      runtime: globalRuntime,
      runtimeSource: 'global_runtime',
    };
  }

  return {
    runtime: null,
    runtimeSource: 'unavailable',
  };
}

function resolveRuntimeConfigSource(context = {}) {
  const runtimeCfg = context.cfg && typeof context.cfg === 'object' ? context.cfg : null;
  const accountId = context.accountId || context.account?.accountId || null;

  if (runtimeCfg) {
    return {
      sourceType: 'root_cfg',
      configSource: runtimeCfg,
      runtimeConfig: resolveClaworldRuntimeConfig(runtimeCfg, accountId),
    };
  }

  const accountLike = context.account || context.config || null;
  if (accountLike) {
    return {
      sourceType: 'resolved_account',
      configSource: accountLike,
      runtimeConfig: resolveClaworldRuntimeConfig(accountLike, accountId),
    };
  }

  return {
    sourceType: 'empty',
    configSource: {},
    runtimeConfig: resolveClaworldRuntimeConfig({}, accountId),
  };
}

async function fetchJson(fetchImpl, url, init = {}) {
  const timeoutMs = Number.isFinite(Number(init?.timeoutMs))
    ? Math.max(1, Number(init.timeoutMs))
    : DEFAULT_RELAY_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs);
  if (typeof timeoutId?.unref === 'function') timeoutId.unref();
  const requestInit = {
    ...init,
    signal: controller.signal,
  };
  delete requestInit.timeoutMs;
  try {
    const response = await fetchImpl(url, requestInit);
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw createRuntimeBoundaryError({
      code: 'relay_fetch_failed',
      category: 'transport',
      status: 502,
      message: `fetch failed: ${error?.message || String(error)}`,
        publicMessage: 'relay fetch failed',
        recoverable: true,
        context: {
          fetchUrl: url,
          fetchMethod: requestInit.method || 'GET',
          fetchHeaders: requestInit.headers || null,
          timeoutMs,
        },
        cause: error,
      });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPublicIdentity({
  runtimeConfig,
  agentId = null,
  generateShareCard = false,
  expiresInSeconds = null,
  shareCardVariant = null,
  fetchImpl,
}) {
  if (!resolveRuntimeAppToken(runtimeConfig)) {
    const recommendedDisplayName = normalizeClaworldText(
      runtimeConfig?.name,
      normalizeClaworldText(runtimeConfig?.registration?.displayName, null),
    );
    return {
      status: 'pending',
      agentId: normalizeClaworldText(agentId, null),
      ready: false,
      publicIdentity: {
        status: PUBLIC_IDENTITY_STATUS.PENDING,
        displayName: null,
        code: null,
        displayIdentity: null,
        confirmedAt: null,
        updatedAt: null,
      },
      recommendedDisplayName,
      nextAction: 'set_public_identity',
      requiredAction: 'set_public_identity',
      nextTool: 'claworld_manage_account',
      missingFields: [
        {
          fieldId: 'displayName',
          label: 'Public Name',
          description: 'A public display name used in Claworld identity surfaces.',
        },
        {
          fieldId: 'code',
          label: 'Public Code',
          description: 'A system-generated unique suffix used in the public identity.',
        },
      ],
      feedbackSummary: {
        totalLikesReceived: 0,
        totalDislikesReceived: 0,
        totalLikesGiven: 0,
        totalDislikesGiven: 0,
      },
      profile: null,
    };
  }

  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/account`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      accountId: runtimeConfig.accountId || null,
      ...(agentId ? { agentId } : {}),
      action: 'view',
      generateShareCard: generateShareCard === true,
      ...(normalizeClaworldText(shareCardVariant, null) ? { shareCardVariant: normalizeClaworldText(shareCardVariant, null) } : {}),
      ...(normalizeClaworldInteger(expiresInSeconds, null) > 0
        ? { expiresInSeconds: normalizeClaworldInteger(expiresInSeconds, null) }
        : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'public_identity_fetch_failed',
      publicMessage: 'failed to read public identity status',
      context: { agentId: normalizeClaworldText(agentId, null) },
    });
  }
  return result.body || {};
}

async function updatePublicIdentity({
  runtimeConfig,
  agentId = null,
  displayName = null,
  generateShareCard = true,
  expiresInSeconds = null,
  shareCardVariant = null,
  fetchImpl,
}) {
  const normalizedDisplayName = normalizeClaworldText(displayName, null);
  if (!normalizedDisplayName) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'claworld public identity update requires displayName',
      publicMessage: 'claworld public identity update requires displayName',
      recoverable: true,
      context: { field: 'displayName' },
    });
  }
  let resolvedRuntimeConfig = applyRuntimeIdentity(runtimeConfig);
  let resolvedAgentId = normalizeClaworldText(agentId, normalizeClaworldText(resolvedRuntimeConfig?.relay?.agentId, null));

  if (!resolveRuntimeAppToken(resolvedRuntimeConfig)) {
    throw createRuntimeBoundaryError({
      code: 'email_verification_required',
      category: 'auth',
      status: 401,
      message: 'claworld email verification is required before updating public identity',
      publicMessage: 'complete Claworld email verification before updating public identity',
      recoverable: true,
      context: {
        requiredActions: ['start_email_verification', 'complete_email_verification'],
      },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/profile`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(resolvedRuntimeConfig),
    },
    body: JSON.stringify({
      accountId: resolvedRuntimeConfig.accountId || null,
      ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
      action: 'update_identity',
      displayName: normalizedDisplayName,
      ...(generateShareCard === true ? { generateShareCard: true } : {}),
      ...(normalizeClaworldText(shareCardVariant, null) ? { shareCardVariant: normalizeClaworldText(shareCardVariant, null) } : {}),
      ...(normalizeClaworldInteger(expiresInSeconds, null) > 0
        ? { expiresInSeconds: normalizeClaworldInteger(expiresInSeconds, null) }
        : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig: resolvedRuntimeConfig,
      code: 'public_identity_update_failed',
      publicMessage: 'failed to update public identity',
      context: {
        agentId: resolvedAgentId,
      },
    });
  }
  return {
    ...(result.body || {}),
    runtimeIdentity: !resolveRuntimeAppToken(runtimeConfig)
      ? {
          status: 'verified',
          agentId: resolvedAgentId,
        }
      : null,
    runtimeConfig: resolvedRuntimeConfig,
  };
}

async function startEmailVerification({
  runtimeConfig,
  email = null,
  displayName = null,
  fetchImpl,
}) {
  const normalizedEmail = normalizeClaworldText(email, null);
  if (!normalizedEmail) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'claworld email verification requires email',
      publicMessage: 'claworld email verification requires email',
      recoverable: true,
      context: { field: 'email' },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/identity/email/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
    },
    body: JSON.stringify({
      email: normalizedEmail,
      ...(normalizeClaworldText(displayName, null) ? { displayName: normalizeClaworldText(displayName, null) } : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'email_verification_start_failed',
      publicMessage: 'failed to start Claworld email verification',
      context: { email: normalizedEmail },
    });
  }
  const payload = result.body && typeof result.body === 'object' && !Array.isArray(result.body)
    ? { ...result.body }
    : {};
  delete payload.verificationId;
  return payload;
}

async function completeEmailVerification({
  runtimeConfig,
  email = null,
  code = null,
  fetchImpl,
}) {
  const normalizedEmail = normalizeClaworldText(email, null);
  const normalizedCode = normalizeClaworldText(code, null);
  if (!normalizedEmail) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'claworld email verification requires email',
      publicMessage: 'claworld email verification requires email',
      recoverable: true,
      context: { field: 'email' },
    });
  }
  if (!normalizedCode) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'claworld email verification requires code',
      publicMessage: 'claworld email verification requires code',
      recoverable: true,
      context: { field: 'code' },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/identity/email/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
    },
    body: JSON.stringify({
      email: normalizedEmail,
      code: normalizedCode,
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'email_verification_complete_failed',
      publicMessage: 'failed to complete Claworld email verification',
      context: { email: normalizedEmail },
    });
  }
  return result.body || {};
}

async function updateGlobalProfile({
  runtimeConfig,
  agentId = null,
  profile = '',
  fetchImpl,
}) {
  if (!resolveRuntimeAppToken(runtimeConfig)) {
    throw createRuntimeBoundaryError({
      code: 'claworld_identity_unverified',
      category: 'conflict',
      status: 409,
      message: 'claworld email verification must be completed before updating profile',
      publicMessage: 'complete Claworld email verification before updating profile',
      recoverable: true,
    });
  }

  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/profile`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      accountId: runtimeConfig.accountId || null,
      ...(agentId ? { agentId } : {}),
      action: 'update_profile',
      profile,
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'profile_update_failed',
      publicMessage: 'failed to update profile',
      context: {
        accountId: runtimeConfig.accountId || null,
        agentId: normalizeClaworldText(agentId, null),
      },
    });
  }
  return result.body || {};
}

async function fetchRelayAgents({ runtimeConfig, fetchImpl, logger }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for relay agent lookup');
  }

  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/agents`, {
    headers: {
      accept: 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
  });

  if (!result.ok) {
    logger.warn?.('[claworld:pairing] relay agent lookup failed', {
      accountId: runtimeConfig.accountId || null,
      status: result.status,
      body: result.body,
    });
    throw new Error(`relay agent lookup failed: ${result.status}`);
  }

  return Array.isArray(result.body?.items) ? result.body.items : [];
}

async function resolveRelayAgentSummary({
  runtimeConfig,
  fetchImpl,
  logger,
  agentId = null,
}) {
  const normalizedAgentId = normalizeClaworldText(agentId, null);

  try {
    const items = await fetchRelayAgents({ runtimeConfig, fetchImpl, logger });
    const match = items
      .map((item) => buildRelayAgentSummary(item))
      .find((item) => normalizedAgentId && item.agentId === normalizedAgentId) || null;

    if (match) {
      return {
        ...match,
        resolved: true,
        resolutionSource: 'agentId',
      };
    }
  } catch {
    // Fallback below keeps pairing/send tools usable even when lookup fails.
  }

  return {
    agentId: normalizedAgentId,
    displayName: normalizeClaworldText(runtimeConfig.registration?.displayName, null),
    publicIdentity: null,
    visibilityMode: null,
    contactPolicy: null,
    online: null,
    resolved: false,
    resolutionSource: 'fallback',
  };
}

async function fetchPostSetupWorldDirectory({ cfg, accountId, runtimeConfig, limit = null, sort = null, page = null, fetchImpl, logger }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld product-shell helper');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg || {}, accountId || null);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/worlds`);
  if (limit != null) requestUrl.searchParams.set('limit', String(limit));
  if (sort) requestUrl.searchParams.set('sort', String(sort));
  if (page != null) requestUrl.searchParams.set('page', String(page));
  const worlds = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(resolvedRuntimeConfig),
    },
  });

  if (!worlds.ok) {
    logger.error?.('[claworld:product-shell] world directory fetch failed', {
      status: worlds.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: worlds.body,
    });
    throw new Error(`claworld product-shell world fetch failed: ${worlds.status}`);
  }

  return buildPostSetupWorldDirectory(worlds.body, {
    accountId: resolvedRuntimeConfig.accountId || accountId || null,
  });
}

async function executeRuntimeAccountAction({
  runtimeConfig,
  agentId = null,
  action = 'view_account',
  displayName = null,
  profile = undefined,
  humanProfile = undefined,
  agentProfile = undefined,
  visibilityMode = undefined,
  contactPolicy = undefined,
  proactivitySettings = undefined,
  generateShareCard = false,
  expiresInSeconds = null,
  shareCardVariant = null,
  fetchImpl,
}) {
  if (!resolveRuntimeAppToken(runtimeConfig)) {
    throw createRuntimeBoundaryError({
      code: 'claworld_identity_unverified',
      category: 'conflict',
      status: 409,
      message: 'claworld email verification must be completed before managing account settings',
      publicMessage: 'complete Claworld email verification before changing account settings',
      recoverable: true,
    });
  }

  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/account`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      accountId: runtimeConfig.accountId || null,
      ...(agentId ? { agentId } : {}),
      action,
      ...(displayName != null ? { displayName } : {}),
      ...(profile !== undefined ? { profile } : {}),
      ...(humanProfile !== undefined ? { humanProfile } : {}),
      ...(agentProfile !== undefined ? { agentProfile } : {}),
      ...(visibilityMode !== undefined ? { visibilityMode } : {}),
      ...(contactPolicy !== undefined ? { contactPolicy } : {}),
      ...(proactivitySettings !== undefined ? { proactivitySettings } : {}),
      ...(generateShareCard === true ? { generateShareCard: true } : {}),
      ...(normalizeClaworldText(shareCardVariant, null) ? { shareCardVariant: normalizeClaworldText(shareCardVariant, null) } : {}),
      ...(normalizeClaworldInteger(expiresInSeconds, null) > 0
        ? { expiresInSeconds: normalizeClaworldInteger(expiresInSeconds, null) }
        : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'account_action_failed',
      publicMessage: 'failed to manage Claworld account',
      context: {
        accountId: runtimeConfig.accountId || null,
        agentId: normalizeClaworldText(agentId, null),
        action,
      },
    });
  }
  return result.body || {};
}

async function fetchRuntimeSubscriptions({
  runtimeConfig,
  agentId = null,
  targetType = null,
  status = 'active',
  fetchImpl,
}) {
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/subscriptions`);
  if (agentId) requestUrl.searchParams.set('agentId', agentId);
  if (targetType) requestUrl.searchParams.set('targetType', targetType);
  if (status) requestUrl.searchParams.set('status', status);
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: {
      accept: 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'subscription_list_failed',
      publicMessage: 'failed to list Claworld subscriptions',
      context: { agentId: normalizeClaworldText(agentId, null), targetType },
    });
  }
  return result.body || { items: [] };
}

async function createRuntimeSubscription({
  runtimeConfig,
  agentId = null,
  targetType,
  targetId,
  broadcastEnabled = true,
  fetchImpl,
}) {
  const normalizedTargetType = normalizeClaworldText(targetType, null);
  const normalizedTargetId = normalizeClaworldText(targetId, null);
  if (!normalizedTargetType || !normalizedTargetId) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'subscription targetType and targetId are required',
      publicMessage: 'subscription targetType and targetId are required',
      recoverable: true,
      context: { field: normalizedTargetType ? 'targetId' : 'targetType' },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/subscriptions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      ...(agentId ? { agentId } : {}),
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      broadcastEnabled: broadcastEnabled !== false,
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'subscription_create_failed',
      publicMessage: 'failed to create Claworld subscription',
      context: { agentId: normalizeClaworldText(agentId, null), targetType: normalizedTargetType, targetId: normalizedTargetId },
    });
  }
  return result.body || {};
}

async function deleteRuntimeSubscription({
  runtimeConfig,
  agentId = null,
  subscriptionId = null,
  targetType = null,
  targetId = null,
  fetchImpl,
}) {
  let normalizedSubscriptionId = normalizeClaworldText(subscriptionId, null);
  const normalizedTargetType = normalizeClaworldText(targetType, null);
  const normalizedTargetId = normalizeClaworldText(targetId, null);
  if (!normalizedSubscriptionId && normalizedTargetType && normalizedTargetId) {
    const listPayload = await fetchRuntimeSubscriptions({
      runtimeConfig,
      agentId,
      targetType: normalizedTargetType,
      status: 'active',
      fetchImpl,
    });
    normalizedSubscriptionId = (Array.isArray(listPayload.items) ? listPayload.items : [])
      .find((subscription) => normalizeClaworldText(subscription.targetId, null) === normalizedTargetId)
      ?.subscriptionId || null;
  }
  if (!normalizedSubscriptionId) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'subscriptionId or targetType/targetId is required to delete a subscription',
      publicMessage: 'subscriptionId or targetType/targetId is required to delete a subscription',
      recoverable: true,
      context: { field: 'subscriptionId' },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/subscriptions/${encodeURIComponent(normalizedSubscriptionId)}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
    body: JSON.stringify({
      ...(agentId ? { agentId } : {}),
    }),
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'subscription_delete_failed',
      publicMessage: 'failed to delete Claworld subscription',
      context: { agentId: normalizeClaworldText(agentId, null), subscriptionId: normalizedSubscriptionId },
    });
  }
  return result.body || {};
}

async function fetchRuntimeWorldActivity({
  runtimeConfig,
  agentId = null,
  worldId = null,
  limit = null,
  fetchImpl,
}) {
  const normalizedWorldId = normalizeClaworldText(worldId, null);
  if (!normalizedWorldId) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'worldId is required',
      publicMessage: 'worldId is required',
      recoverable: true,
      context: { field: 'worldId' },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/worlds/${encodeURIComponent(normalizedWorldId)}/activity`);
  if (agentId) requestUrl.searchParams.set('agentId', agentId);
  if (limit != null) requestUrl.searchParams.set('limit', String(limit));
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: {
      accept: 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'world_activity_fetch_failed',
      publicMessage: 'failed to list world activity',
      context: { agentId: normalizeClaworldText(agentId, null), worldId: normalizedWorldId },
    });
  }
  return result.body || {};
}

async function fetchRuntimeWorldMembers({
  runtimeConfig,
  agentId = null,
  worldId = null,
  status = null,
  limit = null,
  fetchImpl,
}) {
  const normalizedWorldId = normalizeClaworldText(worldId, null);
  if (!normalizedWorldId) {
    throw createRuntimeBoundaryError({
      code: 'tool_input_invalid',
      category: 'input',
      status: 400,
      message: 'worldId is required',
      publicMessage: 'worldId is required',
      recoverable: true,
      context: { field: 'worldId' },
    });
  }
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/worlds/${encodeURIComponent(normalizedWorldId)}/memberships`);
  if (agentId) requestUrl.searchParams.set('actorAgentId', agentId);
  if (status) requestUrl.searchParams.set('status', status);
  const normalizedLimit = normalizeClaworldInteger(limit, null);
  if (normalizedLimit > 0) requestUrl.searchParams.set('limit', String(normalizedLimit));
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: {
      accept: 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
      ...buildRuntimeAuthHeaders(runtimeConfig),
    },
  });
  if (!result.ok) {
    createRelayRouteError({
      result,
      runtimeConfig,
      code: 'world_members_fetch_failed',
      publicMessage: 'failed to list world members',
      context: { agentId: normalizeClaworldText(agentId, null), worldId: normalizedWorldId },
    });
  }
  return result.body || {};
}

async function ensureRelayBinding({ runtimeConfig, fetchImpl, logger }) {
  const normalizedRuntimeConfig = applyRuntimeIdentity(runtimeConfig);
  const registration = normalizeRuntimeRegistration(normalizedRuntimeConfig);
  const appToken = resolveRuntimeAppToken(normalizedRuntimeConfig);

  if (appToken && normalizedRuntimeConfig.relay?.agentId) {
    return {
      runtimeConfig: normalizedRuntimeConfig,
      bindingSource: 'configured_app_token',
    };
  }

  if (appToken) {
    const identityPayload = await fetchPublicIdentity({
      runtimeConfig: normalizedRuntimeConfig,
      agentId: null,
      generateShareCard: false,
      expiresInSeconds: null,
      fetchImpl,
    });
    const resolvedAgentId = normalizeClaworldText(identityPayload?.agentId, null);
    if (resolvedAgentId) {
      return {
        runtimeConfig: applyRuntimeIdentity(normalizedRuntimeConfig, { agentId: resolvedAgentId }),
        bindingSource: 'configured_app_token',
      };
    }
    logger.info?.('[claworld:bootstrap] configured credential is missing relay.agentId; waiting for a later authenticated account read or update');
    return {
      runtimeConfig: normalizedRuntimeConfig,
      bindingSource: 'configured_app_token',
    };
  }

  return {
    runtimeConfig: normalizedRuntimeConfig,
    bindingSource: registration.enabled ? 'registration_pending' : 'unbound',
  };
}

function resolveDeliveryWorldId(delivery = {}) {
  const metadata = delivery?.metadata && typeof delivery.metadata === 'object' && !Array.isArray(delivery.metadata)
    ? delivery.metadata
    : {};
  return resolveNormalizedText(metadata.worldId, null) || null;
}

function buildDeliveryInboundEnvelope({
  runtime,
  currentCfg,
  remoteIdentity,
  incomingText,
  contextText = null,
  commandText = null,
  timestamp = null,
  deliveryId,
  eventType = 'delivery',
  sessionKey,
  localSessionKey = null,
  worldId = null,
  conversationKey = null,
  untrustedContext = [],
}) {
  const envelopeOptions = runtime?.channel?.reply?.resolveEnvelopeFormatOptions
    ? runtime.channel.reply.resolveEnvelopeFormatOptions(currentCfg)
    : undefined;
  const bodyText = [
    String(contextText || '').trim(),
    String(incomingText || '').trim(),
  ].filter(Boolean).join('\n\n');
  const remoteLabel = String(remoteIdentity || 'unknown-peer').trim() || 'unknown-peer';
  const rawBody = String(incomingText || '').trim();
  const normalizedCommandText = String(commandText || '').trim();
  const commandBody = normalizedCommandText || rawBody;
  const bodyForAgent = bodyText || rawBody;
  const eventLabel = normalizePluginOptionalText(eventType) === 'delivery'
    ? 'delivery'
    : `event ${normalizePluginOptionalText(eventType)}`;
  const contextLines = mergeUntrustedContextLines([
    `[claworld peer ${remoteLabel}]`,
    ...(worldId ? [`[claworld world ${worldId}]`] : []),
    ...(conversationKey ? [`[claworld conversation ${conversationKey}]`] : []),
    ...(localSessionKey && localSessionKey !== sessionKey ? [`[claworld local session ${localSessionKey}]`] : []),
    `[claworld relay session ${sessionKey}]`,
    `[claworld ${eventLabel} ${deliveryId}]`,
  ], untrustedContext);
  const envelopeTimestamp = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();

  if (runtime?.channel?.reply?.formatAgentEnvelope) {
    return {
      Body: runtime.channel.reply.formatAgentEnvelope({
        channel: 'Claworld',
        from: remoteLabel,
        timestamp: envelopeTimestamp,
        envelope: envelopeOptions,
        body: bodyForAgent,
      }),
      RawBody: rawBody,
      CommandBody: commandBody,
      BodyForAgent: bodyForAgent,
      BodyForCommands: commandBody,
      UntrustedContext: contextLines,
    };
  }

  return {
    Body: `${remoteLabel}: ${bodyForAgent}`,
    RawBody: rawBody,
    CommandBody: commandBody,
    BodyForAgent: bodyForAgent,
    BodyForCommands: commandBody,
    UntrustedContext: contextLines,
  };
}

function normalizeSessionStoreKey(value) {
  return resolveNormalizedText(value, '').toLowerCase();
}

function resolveSessionStoreEntry(store = null, sessionKey = null) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return null;
  const normalizedSessionKey = resolveNormalizedText(sessionKey, null);
  if (!normalizedSessionKey) return null;
  if (store[normalizedSessionKey] && typeof store[normalizedSessionKey] === 'object') {
    return store[normalizedSessionKey];
  }
  const lowerSessionKey = normalizeSessionStoreKey(normalizedSessionKey);
  if (store[lowerSessionKey] && typeof store[lowerSessionKey] === 'object') {
    return store[lowerSessionKey];
  }
  const match = Object.entries(store).find(([key, value]) => (
    normalizeSessionStoreKey(key) === lowerSessionKey
    && value
    && typeof value === 'object'
    && !Array.isArray(value)
  ));
  return match ? match[1] : null;
}

function readRuntimeSessionStoreEntry({ runtime = null, sessionStorePath = null, sessionKey = null } = {}) {
  if (!runtime?.agent?.session?.loadSessionStore || !sessionStorePath || !sessionKey) return null;
  try {
    return resolveSessionStoreEntry(
      runtime.agent.session.loadSessionStore(sessionStorePath),
      sessionKey,
    );
  } catch {
    return null;
  }
}

function resolveSessionFilePathFromRuntime({
  runtime = null,
  sessionId = null,
  record = {},
  sessionStorePath = null,
  localAgentId = null,
} = {}) {
  const normalizedSessionId = resolveNormalizedText(sessionId, null);
  if (!normalizedSessionId) return null;

  const sessionsDir = sessionStorePath
    ? path.dirname(path.resolve(sessionStorePath))
    : null;
  if (typeof runtime?.agent?.session?.resolveSessionFilePath === 'function') {
    try {
      const resolved = runtime.agent.session.resolveSessionFilePath(
        normalizedSessionId,
        record,
        {
          ...(sessionsDir ? { sessionsDir } : {}),
          ...(localAgentId ? { agentId: localAgentId } : {}),
        },
      );
      const normalized = resolveNormalizedText(resolved, null);
      if (normalized) return normalized;
    } catch {
      // Fall through to the local derivation below.
    }
  }

  const candidate = resolveNormalizedText(record?.sessionFile, null);
  if (candidate) {
    if (path.isAbsolute(candidate) || !sessionsDir) return candidate;
    return path.resolve(sessionsDir, candidate);
  }

  if (sessionsDir) {
    return path.join(sessionsDir, `${normalizedSessionId}.jsonl`);
  }
  return null;
}

function resolveSessionRecordArtifacts(record = null, fallbackStorePath = null, options = {}) {
  const normalizedRecord = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const nestedSession = normalizedRecord.session && typeof normalizedRecord.session === 'object' && !Array.isArray(normalizedRecord.session)
    ? normalizedRecord.session
    : {};
  const sessionId = resolveNormalizedText(
    normalizedRecord.sessionId,
    resolveNormalizedText(nestedSession.sessionId, resolveNormalizedText(normalizedRecord.id, null)),
  );
  const sessionStorePath = resolveNormalizedText(
    normalizedRecord.storePath,
    resolveNormalizedText(normalizedRecord.sessionStorePath, fallbackStorePath),
  );
  const directSessionFile = resolveNormalizedText(
    normalizedRecord.sessionFile,
    resolveNormalizedText(
      normalizedRecord.sessionPath,
      resolveNormalizedText(
        normalizedRecord.filePath,
        resolveNormalizedText(normalizedRecord.path, resolveNormalizedText(nestedSession.filePath, null)),
      ),
    ),
  );
  const sessionFile = directSessionFile || resolveSessionFilePathFromRuntime({
    runtime: options.runtime,
    sessionId,
    record: normalizedRecord,
    sessionStorePath,
    localAgentId: options.localAgentId,
  });
  const transcriptPath = resolveNormalizedText(
    normalizedRecord.transcriptPath,
    resolveNormalizedText(nestedSession.transcriptPath, sessionFile),
  );
  return {
    sessionId,
    sessionFile,
    sessionStorePath,
    transcriptPath,
  };
}

async function recordRuntimeInboundSessionArtifacts({
  runtime = null,
  currentCfg = {},
  localAgentId = null,
  sessionKey = null,
  ctx = {},
  logger = console,
  runtimeAccountId = null,
  logLabel = 'inbound',
  logContext = {},
} = {}) {
  let sessionStorePath = null;
  let sessionRecord = null;
  const sessionApi = runtime?.channel?.session || {};
  const localSessionKey = resolveNormalizedText(ctx?.SessionKey, sessionKey);

  if (sessionApi.resolveStorePath && localAgentId) {
    sessionStorePath = sessionApi.resolveStorePath(currentCfg.session?.store, {
      agentId: localAgentId,
    });
    const onRecordError = (error) => {
      logger.error?.(`[claworld:${runtimeAccountId}] failed to record ${logLabel} inbound session`, {
        ...logContext,
        sessionKey,
        localSessionKey,
        localAgentId,
        error: error?.message || String(error),
      });
    };
    try {
      if (typeof sessionApi.recordSessionMetaFromInbound === 'function') {
        sessionRecord = await sessionApi.recordSessionMetaFromInbound({
          storePath: sessionStorePath,
          sessionKey: localSessionKey,
          ctx,
        });
      } else if (typeof sessionApi.recordInboundSession === 'function') {
        sessionRecord = await sessionApi.recordInboundSession({
          storePath: sessionStorePath,
          sessionKey: localSessionKey,
          ctx,
          onRecordError,
        });
      }
    } catch (error) {
      onRecordError(error);
    }
    if (!sessionRecord) {
      sessionRecord = readRuntimeSessionStoreEntry({
        runtime,
        sessionStorePath,
        sessionKey: localSessionKey,
      });
    }
  }

  return {
    sessionStorePath,
    sessionRecord,
    sessionArtifacts: resolveSessionRecordArtifacts(sessionRecord, sessionStorePath, {
      runtime,
      localAgentId,
    }),
  };
}

function buildInboundRuntimeMaintenanceEvent({
  delivery = {},
  metadata = {},
  payload = {},
  messageId = null,
  eventType = 'delivery',
  sessionKind = null,
  localSessionKey = null,
  localAgentId = null,
  sessionArtifacts = {},
  workspaceRoot = null,
} = {}) {
  const normalizedEventType = resolveNormalizedText(eventType, 'delivery');
  const isRelayDelivery = normalizedEventType === 'delivery';
  const sessionKey = resolveNormalizedText(delivery.sessionKey, null);
  const requestId = resolveNormalizedText(
    metadata.kickoffRequestId,
    resolveNormalizedText(metadata.requestId, resolveNormalizedText(metadata.chatRequestId, null)),
  );
  const worldId = resolveNormalizedText(
    metadata.worldId,
    resolveNormalizedText(delivery.worldId, resolveNormalizedText(payload.worldId, null)),
  );
  const conversationKey = resolveNormalizedText(
    metadata.conversationKey,
    resolveNormalizedText(delivery.conversationKey, resolveNormalizedText(payload.conversationKey, null)),
  );
  const fromAgentId = resolveNormalizedText(metadata.fromAgentId, null);
  const targetAgentId = resolveNormalizedText(
    delivery.targetAgentId,
    resolveNormalizedText(payload.targetAgentId, resolveNormalizedText(metadata.targetAgentId, null)),
  );
  const notificationId = resolveNormalizedText(
    metadata.notificationId,
    resolveNormalizedText(payload.notificationId, null),
  );
  const inboxItemId = resolveNormalizedText(
    metadata.inboxItemId,
    resolveNormalizedText(payload.inboxItemId, null),
  );
  const scope = sessionKind === 'management' ? 'management' : 'conversation';
  const summary = [
    isRelayDelivery
      ? 'Inbound Claworld delivery joined local session'
      : 'Inbound Claworld runtime input joined local session',
    requestId ? `for request ${requestId}` : null,
    fromAgentId ? `from ${fromAgentId}` : null,
  ].filter(Boolean).join(' ');
  return buildClaworldRuntimeMaintenanceEvent({
    id: messageId ? `runtime:${normalizedEventType}:${messageId}` : null,
    timestamp: delivery.createdAt || metadata.createdAt || payload.createdAt || null,
    kind: isRelayDelivery
      ? (metadata.deliveryType ? `delivery.${metadata.deliveryType}` : 'delivery')
      : 'runtime_event',
    eventType: normalizedEventType,
    scope,
    summary,
    excerpt: isRelayDelivery
      ? (
        payload.contextText
          ? 'Inbound delivery included contextText; raw dialogue is kept in the OpenClaw session transcript.'
          : 'Inbound delivery routed into an OpenClaw session after backend session resolution.'
      )
      : 'Inbound runtime input routed into an OpenClaw session after backend session resolution.',
    refs: {
      deliveryId: isRelayDelivery ? messageId : null,
      eventId: messageId,
      requestId,
      chatRequestId: requestId,
      worldId,
      conversationKey,
      fromAgentId,
      targetAgentId,
      notificationId,
      inboxItemId,
      sessionKey: localSessionKey || sessionKey,
      relaySessionKey: sessionKey,
    },
    relations: {
      deliveryId: isRelayDelivery ? messageId : null,
      eventId: messageId,
      requestId,
      chatRequestId: requestId,
      worldId,
      conversationKey,
      fromAgentId,
      targetAgentId,
      notificationId,
      inboxItemId,
      localAgentId,
      localSessionKey,
      relaySessionKey: sessionKey,
      sessionKey: localSessionKey || sessionKey,
      sessionId: sessionArtifacts.sessionId,
      sessionFile: sessionArtifacts.sessionFile,
      sessionStorePath: sessionArtifacts.sessionStorePath,
      transcriptPath: sessionArtifacts.transcriptPath,
    },
    artifacts: {
      workspaceRoot,
      ...sessionArtifacts,
    },
  });
}

function createDeliveryReplyDispatcher({
  runtime,
  currentCfg,
  relayClient,
  deliveryId,
  sessionKey,
  localSessionKey = null,
  sessionId = null,
  localAgentId = null,
  allowReply = true,
  logger,
  runtimeAccountId,
}) {
  const prefixContext = runtime?.channel?.reply?.createReplyPrefixContext
    ? runtime.channel.reply.createReplyPrefixContext({ cfg: currentCfg, agentId: localAgentId || runtimeAccountId })
    : { responsePrefix: '', responsePrefixContextProvider: () => ({}) };
  const humanDelay = runtime?.channel?.reply?.resolveHumanDelayConfig
    ? runtime.channel.reply.resolveHumanDelayConfig(currentCfg, localAgentId || runtimeAccountId)
    : undefined;

  let replied = false;
  let keptSilent = false;
  let suppressed = false;
  let replyTransport = null;
  let replyFallbackUsed = false;
  let keptSilentTransport = null;
  let keptSilentFallbackUsed = false;
  const finalTexts = [];
  const blockTexts = [];
  const replyResolverTexts = [];
  let partialContinuationText = '';
  const dispatchStartedAt = Date.now();
  const runtimeOutputSummary = {
    counts: {
      final: 0,
      block: 0,
      tool: 0,
      partial: 0,
      reasoning: 0,
      toolStart: 0,
      assistantMessageStart: 0,
      reasoningEnd: 0,
      compactionStart: 0,
      compactionEnd: 0,
      nonRenderableFinal: 0,
      operationalNotice: 0,
      runtimeErrorFinal: 0,
      replyResolverPayload: 0,
      replyResolverNonRenderable: 0,
      assistantTextFallback: 0,
      messageToolReply: 0,
    },
    previews: {
      final: [],
      block: [],
      tool: [],
      partial: [],
      reasoning: [],
      operationalNotice: [],
      runtimeErrorFinal: [],
      replyResolver: [],
      assistantTextFallback: [],
      messageToolReply: [],
    },
    relayContinuationSource: 'none',
    relayContinuationPreview: null,
  };

  const recordRuntimePayload = (kind, payload = {}) => {
    if (!Object.prototype.hasOwnProperty.call(runtimeOutputSummary.counts, kind)) return;
    runtimeOutputSummary.counts[kind] += 1;
    const text = String(payload?.text ?? payload?.body ?? '').trim();
    if (kind === 'final') {
      const classified = classifyRelayContinuationPayload(payload);
      if (classified.text) {
        finalTexts.push(classified.text);
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.final, classified.text);
      }
      if (classified.nonRenderable) {
        runtimeOutputSummary.counts.nonRenderableFinal += 1;
      }
      if (classified.operationalNotice) {
        runtimeOutputSummary.counts.operationalNotice += 1;
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.operationalNotice, classified.previewText || text);
      }
      if (classified.runtimeError) {
        runtimeOutputSummary.counts.runtimeErrorFinal += 1;
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.runtimeErrorFinal, classified.previewText || text);
      }
      return;
    }
    if (kind === 'block') {
      if (text) {
        blockTexts.push(text);
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.block, text);
      }
      return;
    }
    if (kind === 'tool') {
      appendRuntimeOutputPreview(runtimeOutputSummary.previews.tool, text);
    }
  };

  const recordReplyResolverPayloads = (result) => {
    for (const payload of normalizeReplyResolverPayloads(result)) {
      runtimeOutputSummary.counts.replyResolverPayload += 1;
      const classified = classifyRelayContinuationPayload(payload);
      const text = String(payload?.text ?? payload?.body ?? '').trim();
      if (classified.text) {
        if (!replyResolverTexts.includes(classified.text)) {
          replyResolverTexts.push(classified.text);
        }
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.replyResolver, classified.text);
      }
      if (classified.nonRenderable) {
        runtimeOutputSummary.counts.replyResolverNonRenderable += 1;
      }
      if (classified.operationalNotice) {
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.operationalNotice, classified.previewText || text);
      }
      if (classified.runtimeError) {
        appendRuntimeOutputPreview(runtimeOutputSummary.previews.runtimeErrorFinal, classified.previewText || text);
      }
    }
  };

  const resolveAssistantTextFallback = async () => {
    if (replyResolverTexts.length > 0) {
      return {
        source: 'reply_result',
        texts: [...replyResolverTexts],
      };
    }

    const outputRecord = await waitForRecentAssistantOutputRecord({
      sessionKeys: [localSessionKey, sessionKey],
      sessionId,
      afterMs: dispatchStartedAt,
    });
    const assistantTexts = normalizeAssistantOutputTexts(outputRecord?.assistantTexts);
    if (assistantTexts.length === 0) {
      return {
        source: 'none',
        texts: [],
      };
    }

    runtimeOutputSummary.counts.assistantTextFallback += assistantTexts.length;
    for (const text of assistantTexts) {
      appendRuntimeOutputPreview(runtimeOutputSummary.previews.assistantTextFallback, text);
    }
    return {
      source: 'assistant_text',
      texts: assistantTexts,
    };
  };

  const recordRuntimeTextEvent = (kind, text) => {
    if (!Object.prototype.hasOwnProperty.call(runtimeOutputSummary.counts, kind)) return;
    runtimeOutputSummary.counts[kind] += 1;
    if (kind === 'partial') {
      appendRuntimeOutputPreview(runtimeOutputSummary.previews.partial, text);
      return;
    }
    if (kind === 'reasoning') {
      appendRuntimeOutputPreview(runtimeOutputSummary.previews.reasoning, text);
    }
  };

  const recordRuntimeLifecycle = (kind) => {
    if (!Object.prototype.hasOwnProperty.call(runtimeOutputSummary.counts, kind)) return;
    runtimeOutputSummary.counts[kind] += 1;
  };

  const submitRelayReply = async (replyText) => {
    if (typeof relayClient?.submitDeliveryReply !== 'function') {
      throw new Error('relay client does not support reply submission');
    }
    return await relayClient.submitDeliveryReply({
      deliveryId,
      sessionKey,
      replyText,
      source: 'openclaw-autochain',
    });
  };

  const submitRelayKeptSilent = async (reason) => {
    if (typeof relayClient?.submitDeliveryKeptSilent !== 'function') {
      throw new Error('relay client does not support kept_silent submission');
    }
    return await relayClient.submitDeliveryKeptSilent({
      deliveryId,
      sessionKey,
      reason,
      source: 'openclaw-autochain',
    });
  };

  const flushReply = async (text) => {
    const normalized = String(text || '').trim();
    if (!normalized || replied || suppressed) return false;
    if (allowReply === false) {
      suppressed = true;
      return false;
    }
    const replyResult = await submitRelayReply(normalized);
    replyTransport = replyResult?.transport || null;
    replyFallbackUsed = replyResult?.fallbackUsed === true;
    replied = true;
    return true;
  };

  const submitMessageToolReply = async ({ text } = {}) => {
    const normalized = sanitizeRelayContinuationText(text);
    if (!normalized) return false;
    runtimeOutputSummary.counts.messageToolReply += 1;
    appendRuntimeOutputPreview(runtimeOutputSummary.previews.messageToolReply, normalized);
    runtimeOutputSummary.relayContinuationSource = 'message_tool';
    runtimeOutputSummary.relayContinuationPreview = previewRuntimeOutputText(normalized);
    if (isExactNoReplyToken(normalized)) {
      runtimeOutputSummary.relayContinuationSource = 'message_tool_no_reply_token';
      runtimeOutputSummary.relayContinuationPreview = 'NO_REPLY';
      return await flushKeptSilent('no_reply_token');
    }
    return await flushReply(normalized);
  };

  const flushKeptSilent = async (reason = null) => {
    if (replied || keptSilent || suppressed) return false;
    if (allowReply === false) {
      suppressed = true;
      return false;
    }
    const silentResult = await submitRelayKeptSilent(
      normalizePluginOptionalText(reason) || 'no_renderable_reply',
    );
    keptSilentTransport = silentResult?.transport || null;
    keptSilentFallbackUsed = silentResult?.fallbackUsed === true;
    keptSilent = true;
    return true;
  };

  const dispatchApi = runtime.channel.reply.createReplyDispatcherWithTyping({
    responsePrefix: prefixContext.responsePrefix,
    responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
    humanDelay,
    deliver: async (payload = {}, info = {}) => {
      if (info?.kind === 'final') {
        recordRuntimePayload('final', payload);
        return;
      }
      if (info?.kind === 'block') {
        recordRuntimePayload('block', payload);
        return;
      }
      if (info?.kind === 'tool') {
        recordRuntimePayload('tool', payload);
      }
    },
    onError: (error, info) => {
      logger.error?.(`[claworld:${runtimeAccountId}] delivery bridge dispatch error`, {
        deliveryId,
        sessionKey,
        kind: info?.kind || null,
        error: error?.message || String(error),
      });
    },
  });

  const markDispatchIdle = async () => {
    await dispatchApi.dispatcher.waitForIdle?.();
    if (!replied && !suppressed) {
      let assistantTextFallback = {
        source: 'none',
        texts: [],
      };
      const shouldResolveAssistantTextFallback = (
        replyResolverTexts.length > 0
        || runtimeOutputSummary.counts.assistantMessageStart > 0
      );
      if (finalTexts.length === 0 && blockTexts.length === 0 && shouldResolveAssistantTextFallback) {
        assistantTextFallback = await resolveAssistantTextFallback();
      }
      const continuationFinalTexts = finalTexts.length > 0
        ? finalTexts
        : assistantTextFallback.texts;
      const allowPartialFallback = (
        runtimeOutputSummary.counts.final > 0
        && continuationFinalTexts.length === 0
        && blockTexts.length === 0
        && runtimeOutputSummary.counts.nonRenderableFinal === 0
      );
      const safeContinuation = buildRelayContinuationText({
        finalTexts: continuationFinalTexts,
        blockTexts,
        partialText: partialContinuationText,
        allowPartialFallback,
      });
      if (
        safeContinuation.source === 'final'
        && finalTexts.length === 0
        && assistantTextFallback.source !== 'none'
      ) {
        safeContinuation.source = assistantTextFallback.source;
      }
      runtimeOutputSummary.relayContinuationSource = safeContinuation.source;
      runtimeOutputSummary.relayContinuationPreview = safeContinuation.text
        ? previewRuntimeOutputText(safeContinuation.text)
        : null;
      if (safeContinuation.text && isExactNoReplyToken(safeContinuation.text)) {
        runtimeOutputSummary.relayContinuationSource = 'no_reply_token';
        runtimeOutputSummary.relayContinuationPreview = 'NO_REPLY';
        await flushKeptSilent('no_reply_token');
      } else if (safeContinuation.text) {
        await flushReply(safeContinuation.text);
      } else {
        const silentReason = resolveRelaySilentReason(runtimeOutputSummary, safeContinuation);
        if (runtimeOutputSummary.counts.runtimeErrorFinal > 0) {
          logger.warn?.(`[claworld:${runtimeAccountId}] runtime produced non-renderable error finals; returning kept_silent`, {
            deliveryId,
            sessionKey,
            localAgentId,
            runtimeOutputSummary,
          });
        }
        await flushKeptSilent(silentReason);
      }
    }
    await dispatchApi.markDispatchIdle?.();
  };

  return {
    dispatcher: dispatchApi.dispatcher,
    replyOptions: {
      ...dispatchApi.replyOptions,
      onPartialReply: async (payload = {}) => {
        partialContinuationText = appendPartialContinuationChunk(
          partialContinuationText,
          typeof payload?.text === 'string' ? payload.text : '',
        );
        recordRuntimeTextEvent('partial', payload?.text);
      },
      onReasoningStream: async (payload = {}) => {
        recordRuntimeTextEvent('reasoning', payload?.text);
      },
      onReasoningEnd: async () => {
        recordRuntimeLifecycle('reasoningEnd');
      },
      onAssistantMessageStart: async () => {
        recordRuntimeLifecycle('assistantMessageStart');
      },
      onToolStart: async () => {
        recordRuntimeLifecycle('toolStart');
      },
      onCompactionStart: async () => {
        recordRuntimeLifecycle('compactionStart');
      },
      onCompactionEnd: async () => {
        recordRuntimeLifecycle('compactionEnd');
      },
    },
    recordReplyResolverPayloads,
    markDispatchIdle,
    didReply: () => replied,
    didKeepSilent: () => keptSilent,
    submitMessageToolReply,
    getRuntimeOutputSummary: () => ({
      counts: { ...runtimeOutputSummary.counts },
      previews: {
        final: [...runtimeOutputSummary.previews.final],
        block: [...runtimeOutputSummary.previews.block],
        tool: [...runtimeOutputSummary.previews.tool],
        partial: [...runtimeOutputSummary.previews.partial],
        reasoning: [...runtimeOutputSummary.previews.reasoning],
        operationalNotice: [...runtimeOutputSummary.previews.operationalNotice],
        runtimeErrorFinal: [...runtimeOutputSummary.previews.runtimeErrorFinal],
        replyResolver: [...runtimeOutputSummary.previews.replyResolver],
        assistantTextFallback: [...runtimeOutputSummary.previews.assistantTextFallback],
        messageToolReply: [...runtimeOutputSummary.previews.messageToolReply],
      },
      relayContinuationSource: runtimeOutputSummary.relayContinuationSource,
      relayContinuationPreview: runtimeOutputSummary.relayContinuationPreview,
      replyTransport,
      replyFallbackUsed,
      keptSilentTransport,
      keptSilentFallbackUsed,
    }),
  };
}

async function runDeliveryReplyDispatch({
  runtime,
  currentCfg,
  relayClient,
  deliveryId,
  sessionKey,
  localSessionKey,
  sessionId,
  localAgentId,
  allowReply,
  logger,
  runtimeAccountId,
  inboundCtx,
  activeDeliveryReplies = null,
} = {}) {
  const {
    dispatcher,
    replyOptions,
    recordReplyResolverPayloads,
    markDispatchIdle,
    didReply,
    didKeepSilent,
    submitMessageToolReply,
    getRuntimeOutputSummary,
  } = createDeliveryReplyDispatcher({
    runtime,
    currentCfg,
    relayClient,
    deliveryId,
    sessionKey,
    localSessionKey,
    sessionId,
    localAgentId,
    allowReply,
    logger,
    runtimeAccountId,
  });

  const baseReplyResolver = await resolveOpenClawReplyResolver(runtime);
  const replyResolver = baseReplyResolver
    ? async (...args) => {
      const result = await baseReplyResolver(...args);
      recordReplyResolverPayloads(result);
      return result;
    }
    : undefined;

  const dispatchParams = {
    ctx: inboundCtx,
    cfg: currentCfg,
    dispatcher,
    replyOptions,
  };
  if (replyResolver) {
    dispatchParams.replyResolver = replyResolver;
  }

  const shouldRegisterMessageToolCompat = (
    inboundCtx?.sessionKind === 'conversation'
    && activeDeliveryReplies
    && typeof activeDeliveryReplies.register === 'function'
  );
  const unregisterMessageToolCompat = shouldRegisterMessageToolCompat
    ? activeDeliveryReplies.register({
      accountId: runtimeAccountId,
      localAgentId,
      targetAgentId: inboundCtx?.RelayFromAgentId || inboundCtx?.SenderId || inboundCtx?.OriginatingFrom || null,
      deliveryId,
      sessionKey,
      localSessionKey,
      sessionId,
      conversationKey: inboundCtx?.RelayConversationKey || inboundCtx?.conversationKey || null,
      submitMessageToolReply,
    })
    : null;

  let dispatchResult;
  try {
    dispatchResult = await runtime.channel.reply.dispatchReplyFromConfig(dispatchParams);
    await markDispatchIdle();
  } finally {
    unregisterMessageToolCompat?.();
  }

  return {
    dispatchResult,
    replied: didReply(),
    keptSilent: didKeepSilent(),
    runtimeOutputSummary: getRuntimeOutputSummary(),
  };
}

function resolveBoundLocalAgentId({ cfg = {}, runtimeConfig = {}, relayClient } = {}) {
  const accountId = resolveNormalizedText(runtimeConfig.accountId, null);
  const bindings = Array.isArray(cfg?.bindings) ? cfg.bindings : [];
  for (const rawBinding of bindings) {
    const binding = rawBinding && typeof rawBinding === 'object' && !Array.isArray(rawBinding)
      ? rawBinding
      : {};
    const match = binding.match && typeof binding.match === 'object' && !Array.isArray(binding.match)
      ? binding.match
      : {};
    if (
      resolveNormalizedText(match.channel, null) === 'claworld'
      && resolveNormalizedText(match.accountId, null) === accountId
      && resolveNormalizedText(binding.agentId, null)
    ) {
      return resolveNormalizedText(binding.agentId, null);
    }
  }

  const agentList = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
  if (agentList.length === 1) {
    const onlyAgent = agentList[0] && typeof agentList[0] === 'object' && !Array.isArray(agentList[0])
      ? agentList[0]
      : {};
    const onlyAgentId = resolveNormalizedText(onlyAgent.id, null);
    if (onlyAgentId) {
      return onlyAgentId;
    }
  }

  return resolveNormalizedText(relayClient?.boundAgentId, null)
    || resolveNormalizedText(runtimeConfig.agentId, null)
    || 'main';
}

async function maybeBridgeRuntimeInboundEvent({
  relayClient,
  runtimeConfig,
  runtimeAccountId,
  event,
  logger,
  runtime,
  cfg,
  inbound,
  activeDeliveryReplies = null,
}) {
  const delivery = event?.delivery && typeof event.delivery === 'object' && !Array.isArray(event.delivery)
    ? event.delivery
    : {};
  const metadata = delivery.metadata && typeof delivery.metadata === 'object' && !Array.isArray(delivery.metadata)
    ? delivery.metadata
    : {};
  const payload = delivery.payload && typeof delivery.payload === 'object' && !Array.isArray(delivery.payload)
    ? delivery.payload
    : {};
  const eventType = resolveNormalizedText(delivery.eventType, resolveNormalizedText(event?.eventType, 'delivery'));
  const deliveryId = resolveInboundMessageId({ delivery, payload, metadata });
  const sessionKey = resolveNormalizedText(delivery.sessionKey, null);
  const contextText = resolveNormalizedText(payload.contextText, null);
  const incomingText = resolveNormalizedText(
    payload.commandText,
    contextText
      ? null
      : resolveNormalizedText(payload.text, resolveNormalizedText(payload.body, null)),
  );
  const commandText = resolveNormalizedText(payload.commandText, incomingText);
  const fromAgentId = resolveNormalizedText(metadata.fromAgentId, null);
  const isRelayDelivery = eventType === 'delivery';
  const allowReply = metadata.allowReply === true || (isRelayDelivery && metadata.allowReply !== false);

  if (
    !runtime?.channel?.reply?.finalizeInboundContext
    || !runtime?.channel?.reply?.dispatchReplyFromConfig
    || !runtime?.channel?.reply?.createReplyDispatcherWithTyping
  ) {
    logger.warn?.(`[claworld:${runtimeAccountId}] skipping inbound bridge: missing runtime bridge hooks`, {
      eventType,
      deliveryId,
      sessionKey,
    });
    return { skipped: true, reason: 'missing_runtime_bridge_hooks' };
  }
  if (!deliveryId || !sessionKey || (!incomingText && !contextText)) {
    logger.warn?.(`[claworld:${runtimeAccountId}] skipping inbound bridge: missing payload`, {
      eventType,
      deliveryId,
      sessionKey,
      hasIncomingText: Boolean(incomingText),
      hasContextText: Boolean(contextText),
    });
    return { skipped: true, reason: 'missing_inbound_payload' };
  }

  const loadedCfg = await runtime.config?.loadConfig?.() || {};
  const currentCfg = {
    ...(loadedCfg && typeof loadedCfg === 'object' && !Array.isArray(loadedCfg) ? loadedCfg : {}),
    ...(cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {}),
    agents: cfg?.agents || loadedCfg?.agents,
    bindings: cfg?.bindings || loadedCfg?.bindings,
    channels: cfg?.channels || loadedCfg?.channels,
    session: cfg?.session || loadedCfg?.session,
  };
  const localAgentId = resolveBoundLocalAgentId({
    cfg: currentCfg,
    runtimeConfig,
    relayClient,
  });
  const localSessionKey = buildAgentScopedLocalSessionKey({
    sessionKey,
    localAgentId,
  });
  const routed = inbound?.routeInboundEvent?.(delivery, {
    sessionTarget: runtimeConfig.routing?.sessionTarget,
    fallbackTarget: runtimeConfig.routing?.fallbackTarget,
  }) || null;
  const routeSessionKind = resolveNormalizedText(
    event?.route?.sessionKind,
    resolveNormalizedText(routed?.sessionKind, null),
  );
  const remoteIdentity = fromAgentId
    || resolveNormalizedText(metadata.source, routeSessionKind === 'management' ? 'claworld-management' : 'unknown-peer');
  const worldId = resolveDeliveryWorldId(delivery);
  const commandAuthorized = isRelayDelivery && shouldAuthorizeBridgedCommand({
    runtimeConfig,
    incomingText: commandText || incomingText,
  });
  const inboundTimestamp = resolveBridgeDeliveryTimestampMs({ delivery, metadata });
  const { Body, RawBody, CommandBody, BodyForAgent, BodyForCommands, UntrustedContext } = buildDeliveryInboundEnvelope({
    runtime,
    currentCfg,
    remoteIdentity,
    incomingText,
    contextText,
    commandText,
    timestamp: inboundTimestamp,
    deliveryId,
    eventType,
    sessionKey,
    localSessionKey,
    worldId,
    conversationKey: metadata.conversationKey || null,
    untrustedContext: payload.untrustedContext,
  });
  const localIdentity = normalizeClaworldText(runtimeConfig.relay?.agentId, runtimeConfig.accountId);
  const isManagementSession = routeSessionKind === 'management';
  const senderName = isManagementSession ? 'Claworld' : remoteIdentity;
  const conversationLabel = isManagementSession ? 'Claworld management' : remoteIdentity;
  const inboundCtx = runtime.channel.reply.finalizeInboundContext({
    Body,
    RawBody,
    CommandBody,
    BodyForAgent,
    BodyForCommands,
    From: `claworld:${remoteIdentity}`,
    To: `claworld:${localIdentity}`,
    SessionKey: localSessionKey || sessionKey,
    RelaySessionKey: sessionKey,
    AccountId: runtimeConfig.accountId,
    OriginatingChannel: 'claworld',
    OriginatingFrom: remoteIdentity,
    OriginatingTo: remoteIdentity,
    ChatType: isManagementSession ? 'management' : 'direct',
    SessionType: isManagementSession ? 'management' : 'direct',
    sessionType: isManagementSession ? 'management' : 'direct',
    sessionKind: isManagementSession ? 'management' : 'conversation',
    SenderName: senderName,
    SenderId: remoteIdentity,
    MessageId: deliveryId,
    Provider: 'claworld',
    Surface: 'claworld',
    ConversationLabel: conversationLabel,
    Timestamp: inboundTimestamp,
    MessageSid: deliveryId,
    WasMentioned: false,
    CommandAuthorized: commandAuthorized,
    RelayDeliveryId: isRelayDelivery ? deliveryId : null,
    RelayFromAgentId: fromAgentId,
    RelayConversationKey: metadata.conversationKey || null,
    UntrustedContext,
  });

  const {
    sessionArtifacts,
  } = await recordRuntimeInboundSessionArtifacts({
    runtime,
    currentCfg,
    localAgentId,
    sessionKey,
    ctx: inboundCtx,
    logger,
    runtimeAccountId,
    logContext: {
      eventType,
      deliveryId,
    },
  });

  logger.info?.(`[claworld:${runtimeAccountId}] ${isRelayDelivery ? 'routing delivery into runtime session' : 'routing inbound event into runtime session'}`, {
    eventType,
    deliveryId,
    sessionKey,
    localSessionKey,
    localAgentId,
    remoteIdentity,
    routeStatus: routed?.status || null,
    bodyPreview: String(Body || '').slice(0, 240),
    rawBodyPreview: String(RawBody || '').slice(0, 240),
    allowReply,
    commandAuthorized,
  });

  if (isRelayDelivery && metadata.acceptanceRequired !== false) {
    try {
      const acceptedResult = await relayClient.acceptDeliveryHttp({
        deliveryId,
        sessionKey,
        source: 'runtime_dispatch',
      });
      if (acceptedResult.status < 200 || acceptedResult.status >= 300) {
        throw new Error(`failed to submit relay delivery acceptance: ${acceptedResult.status}`);
      }
    } catch (error) {
      logger.warn?.(`[claworld:${runtimeAccountId}] delivery acceptance acknowledgement failed`, {
        deliveryId,
        sessionKey,
        localSessionKey,
        localAgentId,
        error: error?.message || String(error),
      });
    }
  }

  let {
    dispatchResult,
    replied,
    keptSilent,
    runtimeOutputSummary,
  } = await runDeliveryReplyDispatch({
    runtime,
    currentCfg,
    relayClient,
    deliveryId,
    sessionKey,
    localSessionKey,
    sessionId: sessionArtifacts.sessionId || null,
    localAgentId,
    allowReply,
    logger,
    runtimeAccountId,
    inboundCtx,
    activeDeliveryReplies,
  });

  const shouldRetryKickoffDispatch = (
    isRelayDelivery
    && metadata.deliveryType === 'kickoff'
    && allowReply
    && replied !== true
    && runtimeOutputSummary.counts.final > 0
    && runtimeOutputSummary.counts.nonRenderableFinal > 0
    && runtimeOutputSummary.counts.final === runtimeOutputSummary.counts.nonRenderableFinal
    && runtimeOutputSummary.counts.block === 0
    && runtimeOutputSummary.counts.tool === 0
    && runtimeOutputSummary.counts.partial === 0
    && runtimeOutputSummary.counts.reasoning === 0
    && runtimeOutputSummary.counts.toolStart === 0
    && runtimeOutputSummary.counts.assistantMessageStart === 0
    && runtimeOutputSummary.counts.reasoningEnd === 0
    && runtimeOutputSummary.counts.compactionStart === 0
    && runtimeOutputSummary.counts.compactionEnd === 0
  );

  if (shouldRetryKickoffDispatch) {
    logger.warn?.(`[claworld:${runtimeAccountId}] kickoff delivery produced only operational notices; retrying dispatch once`, {
      deliveryId,
      sessionKey,
      localSessionKey,
      localAgentId,
      runtimeOutputSummary,
    });

    ({
      dispatchResult,
      replied,
      keptSilent,
      runtimeOutputSummary,
    } = await runDeliveryReplyDispatch({
      runtime,
      currentCfg,
      relayClient,
      deliveryId,
      sessionKey,
      localSessionKey,
      sessionId: sessionArtifacts.sessionId || null,
      localAgentId,
      allowReply,
      logger,
      runtimeAccountId,
      inboundCtx,
      activeDeliveryReplies,
    }));
  }

  let journalResult = null;
  const workspaceRoot = resolveOpenClawWorkspaceRoot({
    sources: [
      { agentId: localAgentId, localAgentId },
      currentCfg,
      runtimeConfig,
    ],
    config: currentCfg,
    agentId: localAgentId,
  });
  if (workspaceRoot) {
    try {
      const maintenanceEvent = buildInboundRuntimeMaintenanceEvent({
        delivery,
        metadata,
        payload,
        messageId: deliveryId,
        eventType,
        sessionKind: routeSessionKind,
        localSessionKey,
        localAgentId,
        sessionArtifacts,
        workspaceRoot,
      });
      journalResult = await appendClaworldJournalEvent(workspaceRoot, maintenanceEvent);
    } catch (error) {
      logger.warn?.(`[claworld:${runtimeAccountId}] inbound journal append failed`, {
        eventType,
        deliveryId,
        sessionKey,
        error: error?.message || String(error),
      });
    }
  }

  logger.info?.(`[claworld:${runtimeAccountId}] ${isRelayDelivery ? 'delivery bridge completed' : 'inbound bridge completed'}`, {
    eventType,
    deliveryId,
    sessionKey,
    localSessionKey,
    sessionId: sessionArtifacts.sessionId || null,
    sessionFile: sessionArtifacts.sessionFile || null,
    queuedFinal: Boolean(dispatchResult?.queuedFinal),
    replied,
    keptSilent,
    routeStatus: routed?.status || null,
    runtimeOutputSummary,
    journal: journalResult?.ok === true,
  });

  return {
    skipped: false,
    ok: true,
    replied,
    keptSilent,
    queuedFinal: Boolean(dispatchResult?.queuedFinal),
    sessionKey,
    localSessionKey,
    routeStatus: routed?.status || null,
  };
}

export function createClaworldChannelPlugin({
  logger = console,
  relayClientFactory = createClaworldRelayClient,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  const protocol = createRelayEventProtocol();
  const inbound = createInboundSessionRouter();
  const outbound = createOutboundSessionBridge();
  const results = createCanonicalResultBuilder();
  const demo = createDemoSessionBootstrap();
  const relayClients = new Map();
  const lifecycles = new Map();
  const accountRuntimeContexts = new Map();
  const accountBindingStates = new Map();
  const activeDeliveryReplies = createActiveDeliveryReplyRegistry();

  function resolveAccountBindingKey(runtimeConfig = {}, fallbackAccountId = 'default') {
    return String(runtimeConfig?.accountId || fallbackAccountId || 'default');
  }

  function mergeBoundRuntimeConfig(currentRuntimeConfig = {}, boundRuntimeConfig = {}) {
    const currentRelay = currentRuntimeConfig?.relay && typeof currentRuntimeConfig.relay === 'object'
      ? currentRuntimeConfig.relay
      : {};
    const boundRelay = boundRuntimeConfig?.relay && typeof boundRuntimeConfig.relay === 'object'
      ? boundRuntimeConfig.relay
      : {};
    const appToken = resolveRuntimeAppToken(currentRuntimeConfig) || resolveRuntimeAppToken(boundRuntimeConfig);
    const agentId = normalizeClaworldText(currentRelay.agentId, normalizeClaworldText(boundRelay.agentId, null));

    return applyRuntimeIdentity({
      ...boundRuntimeConfig,
      ...currentRuntimeConfig,
      appToken,
      relay: {
        ...boundRelay,
        ...currentRelay,
        appToken,
        credentialToken: appToken,
        agentId,
      },
    }, { appToken, agentId });
  }

  function rememberAccountBinding({ runtimeConfig, accountId = null, bindingSource = 'binding_cache', relayAgent = null }) {
    const normalizedRuntimeConfig = applyRuntimeIdentity(runtimeConfig);
    const accountKey = resolveAccountBindingKey(normalizedRuntimeConfig, accountId || null);
    accountBindingStates.set(accountKey, {
      binding: {
        runtimeConfig: normalizedRuntimeConfig,
        bindingSource,
        ...(relayAgent ? { relayAgent } : {}),
      },
    });
  }

  async function ensureAccountRelayBinding({ runtimeConfig, accountId = null }) {
    const normalizedRuntimeConfig = applyRuntimeIdentity(runtimeConfig);
    const accountKey = resolveAccountBindingKey(normalizedRuntimeConfig, accountId || null);
    const cachedState = accountBindingStates.get(accountKey) || null;
    const cachedBinding = cachedState?.binding || null;

    const normalizedAppToken = resolveRuntimeAppToken(normalizedRuntimeConfig);
    const cachedAppToken = resolveRuntimeAppToken(cachedBinding?.runtimeConfig || {});

    if (
      cachedBinding
      && cachedBinding.runtimeConfig?.serverUrl
      && cachedBinding.runtimeConfig.serverUrl === normalizedRuntimeConfig.serverUrl
      && (!normalizedAppToken || cachedAppToken === normalizedAppToken)
    ) {
      return {
        ...cachedBinding,
        runtimeConfig: mergeBoundRuntimeConfig(normalizedRuntimeConfig, cachedBinding.runtimeConfig),
        bindingSource: cachedBinding.bindingSource === 'configured_app_token'
          ? 'configured_app_token'
          : 'binding_cache',
      };
    }

    if (cachedState?.promise) {
      return cachedState.promise;
    }

    const promise = ensureRelayBinding({
      runtimeConfig: normalizedRuntimeConfig,
      fetchImpl,
      logger,
    }).then((binding) => {
      const resolvedBinding = {
        ...binding,
        runtimeConfig: mergeBoundRuntimeConfig(normalizedRuntimeConfig, binding.runtimeConfig),
      };
      accountBindingStates.set(accountKey, { binding: resolvedBinding });
      return resolvedBinding;
    }).catch((error) => {
      const latest = accountBindingStates.get(accountKey) || null;
      if (latest?.promise === promise) {
        accountBindingStates.delete(accountKey);
      }
      throw error;
    });

    accountBindingStates.set(accountKey, { promise });
    return promise;
  }

  function buildRuntimeAppTokenAccountConfig(existingAccount = {}, {
    accountId,
    appToken,
    relayAgentId = null,
    runtimeConfig = null,
  } = {}) {
    const account = isClaworldPlainObject(existingAccount) ? existingAccount : {};
    const sourceRuntimeConfig = isClaworldPlainObject(runtimeConfig) ? runtimeConfig : {};
    const existingRelay = isClaworldPlainObject(account.relay) ? account.relay : {};
    const runtimeRelay = isClaworldPlainObject(sourceRuntimeConfig.relay) ? sourceRuntimeConfig.relay : {};
    const normalizedAccountId = normalizeClaworldText(accountId, normalizeClaworldText(sourceRuntimeConfig.accountId, null));
    const normalizedRelayAgentId = normalizeClaworldText(
      relayAgentId,
      normalizeClaworldText(existingRelay.agentId, normalizeClaworldText(runtimeRelay.agentId, null)),
    );
    const normalizedAppToken = normalizeClaworldText(appToken, resolveRuntimeAppToken(sourceRuntimeConfig));
    const serverUrl = normalizeClaworldText(account.serverUrl, normalizeClaworldText(sourceRuntimeConfig.serverUrl, null));
    const apiKey = normalizeClaworldText(account.apiKey, normalizeClaworldText(sourceRuntimeConfig.apiKey, null));
    const name = normalizeClaworldText(account.name, normalizeClaworldText(sourceRuntimeConfig.name, null));
    const toolProfile = normalizeClaworldText(account.toolProfile, normalizeClaworldText(sourceRuntimeConfig.toolProfile, null));
    const heartbeatSeconds = Number.isInteger(account.heartbeatSeconds)
      ? account.heartbeatSeconds
      : (Number.isInteger(sourceRuntimeConfig.heartbeatSeconds) ? sourceRuntimeConfig.heartbeatSeconds : null);
    const reconnect = typeof account.reconnect === 'boolean'
      ? account.reconnect
      : (typeof sourceRuntimeConfig.reconnect === 'boolean' ? sourceRuntimeConfig.reconnect : null);
    const routing = isClaworldPlainObject(account.routing)
      ? account.routing
      : (isClaworldPlainObject(sourceRuntimeConfig.routing) ? sourceRuntimeConfig.routing : null);
    const testing = isClaworldPlainObject(account.testing)
      ? account.testing
      : (isClaworldPlainObject(sourceRuntimeConfig.testing) ? sourceRuntimeConfig.testing : null);

    const nextAccount = {
      ...account,
      enabled: typeof account.enabled === 'boolean'
        ? account.enabled
        : (typeof sourceRuntimeConfig.enabled === 'boolean' ? sourceRuntimeConfig.enabled : true),
      ...(serverUrl ? { serverUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(normalizedAccountId ? { accountId: normalizedAccountId } : {}),
      ...(normalizedAppToken ? { appToken: normalizedAppToken } : {}),
      ...(name ? { name } : {}),
      ...(toolProfile ? { toolProfile } : {}),
      ...(heartbeatSeconds ? { heartbeatSeconds } : {}),
      ...(typeof reconnect === 'boolean' ? { reconnect } : {}),
      ...(routing ? { routing } : {}),
      ...(testing ? { testing } : {}),
    };

    const relayAppToken = normalizeClaworldText(existingRelay.appToken, normalizeClaworldText(runtimeRelay.appToken, null));
    const relayCredentialToken = normalizeClaworldText(
      existingRelay.credentialToken,
      normalizeClaworldText(runtimeRelay.credentialToken, null),
    );
    const relayDefaultTargetAgentId = normalizeClaworldText(
      existingRelay.defaultTargetAgentId,
      normalizeClaworldText(runtimeRelay.defaultTargetAgentId, null),
    );
    const relay = {
      ...(relayAppToken ? { appToken: relayAppToken } : {}),
      ...(relayCredentialToken ? { credentialToken: relayCredentialToken } : {}),
      ...(relayDefaultTargetAgentId ? { defaultTargetAgentId: relayDefaultTargetAgentId } : {}),
      ...(normalizedRelayAgentId ? { agentId: normalizedRelayAgentId } : {}),
    };
    if (Object.keys(relay).length > 0) nextAccount.relay = relay;
    else delete nextAccount.relay;
    delete nextAccount.registration;

    const missingRequired = [];
    if (typeof nextAccount.enabled !== 'boolean') missingRequired.push('enabled');
    if (!normalizeClaworldText(nextAccount.serverUrl, null)) missingRequired.push('serverUrl');
    if (!normalizeClaworldText(nextAccount.apiKey, null)) missingRequired.push('apiKey');
    if (!normalizeClaworldText(nextAccount.accountId, null)) missingRequired.push('accountId');

    return { account: nextAccount, missingRequired };
  }

  function applyRuntimeAppTokenConfigMutation(configDraft, {
    accountId,
    appToken,
    relayAgentId = null,
    runtimeConfig = null,
  } = {}) {
    if (!isClaworldPlainObject(configDraft)) {
      return { skipped: true, reason: 'invalid_config_draft' };
    }
    const normalizedAccountId = normalizeClaworldText(accountId, normalizeClaworldText(runtimeConfig?.accountId, null));
    if (!normalizedAccountId || !normalizeClaworldText(appToken, resolveRuntimeAppToken(runtimeConfig))) {
      return { skipped: true, reason: 'missing_account_or_token' };
    }

    configDraft.channels = isClaworldPlainObject(configDraft.channels) ? configDraft.channels : {};
    const claworldRoot = isClaworldPlainObject(configDraft.channels.claworld)
      ? configDraft.channels.claworld
      : {};
    const accounts = isClaworldPlainObject(claworldRoot.accounts) ? claworldRoot.accounts : {};
    const currentAccount = isClaworldPlainObject(accounts[normalizedAccountId])
      ? accounts[normalizedAccountId]
      : {};
    const built = buildRuntimeAppTokenAccountConfig(currentAccount, {
      accountId: normalizedAccountId,
      appToken,
      relayAgentId,
      runtimeConfig,
    });
    if (built.missingRequired.length > 0) {
      return {
        skipped: true,
        reason: 'missing_required_config_fields',
        accountId: normalizedAccountId,
        missingRequired: built.missingRequired,
      };
    }

    if (JSON.stringify(currentAccount) === JSON.stringify(built.account)) {
      return {
        skipped: true,
        reason: 'already_persisted',
        accountId: normalizedAccountId,
      };
    }

    accounts[normalizedAccountId] = built.account;
    claworldRoot.accounts = accounts;
    if (!normalizeClaworldText(claworldRoot.defaultAccount, null)) {
      claworldRoot.defaultAccount = normalizedAccountId;
    }
    configDraft.channels.claworld = claworldRoot;
    return {
      skipped: false,
      ok: true,
      accountId: normalizedAccountId,
    };
  }

  async function persistRuntimeAppToken({ runtime, accountId, appToken, relayAgentId = null, runtimeConfig = null }) {
    if (!accountId || !appToken) {
      return { skipped: true, reason: 'missing_account_or_token' };
    }

    let configPersistResult = { skipped: true, reason: 'missing_runtime_config_io' };
    try {
      if (typeof runtime?.config?.mutateConfigFile === 'function') {
        let mutationOutcome = null;
        const mutationParams = {
          base: 'source',
          afterWrite: { mode: 'auto' },
          mutate: (draft) => {
            mutationOutcome = applyRuntimeAppTokenConfigMutation(draft, {
              accountId,
              appToken,
              relayAgentId,
              runtimeConfig,
            });
            return mutationOutcome;
          },
        };
        const mutationResult = await runtime.config.mutateConfigFile(mutationParams);
        configPersistResult = {
          ...(mutationResult?.result || mutationOutcome || { skipped: false, ok: true }),
          method: 'mutateConfigFile',
        };
      } else if (runtime?.config?.loadConfig && runtime?.config?.writeConfigFile) {
        const currentCfg = await runtime.config.loadConfig();
        const nextCfg = JSON.parse(JSON.stringify(currentCfg || {}));
        const mutationOutcome = applyRuntimeAppTokenConfigMutation(nextCfg, {
          accountId,
          appToken,
          relayAgentId,
          runtimeConfig,
        });
        configPersistResult = {
          ...mutationOutcome,
          method: 'loadConfig_writeConfigFile',
        };
        if (!mutationOutcome.skipped) {
          await runtime.config.writeConfigFile(nextCfg, { afterWrite: { mode: 'auto' } });
        }
      }
    } catch (error) {
      configPersistResult = {
        skipped: true,
        reason: 'config_persist_failed',
        error: error?.message || String(error),
      };
      logger.warn?.(`[claworld:${accountId || 'default'}] failed to persist runtime appToken to OpenClaw config`, {
        accountId,
        error: configPersistResult.error,
      });
    }

    let backupPersistResult = { skipped: true, reason: 'missing_runtime_config_loader' };
    try {
      backupPersistResult = await persistClaworldRuntimeBackup({
        runtime,
        accountId,
        runtimeConfig,
        appToken,
        relayAgentId,
      });
    } catch (error) {
      backupPersistResult = {
        skipped: true,
        reason: 'backup_persist_failed',
        error: error?.message || String(error),
      };
    }

    return {
      ...configPersistResult,
      backup: backupPersistResult,
    };
  }

  async function maybeRestoreRuntimeAppToken({ runtime, accountId, runtimeConfig }) {
    if (resolveRuntimeAppToken(runtimeConfig)) {
      return { restored: false, reason: 'already_configured', runtimeConfig };
    }

    const backupState = await loadClaworldRuntimeBackup({ accountId });
    const backup = backupState.backup;
    const backupToken = normalizeClaworldText(backup?.appToken, null);
    if (!backupToken) {
      return {
        restored: false,
        reason: 'backup_missing_app_token',
        runtimeConfig,
      };
    }

    const backupServerUrl = normalizeClaworldText(backup?.serverUrl, null);
    const currentServerUrl = normalizeClaworldText(runtimeConfig?.serverUrl, null);
    if (backupServerUrl && currentServerUrl && normalizeRelayHttpBaseUrl(backupServerUrl) !== normalizeRelayHttpBaseUrl(currentServerUrl)) {
      return {
        restored: false,
        reason: 'backup_server_mismatch',
        runtimeConfig,
      };
    }

    const backupAgentId = normalizeClaworldText(backup?.agentId, null);
    const restoredRuntimeConfig = applyRuntimeIdentity(runtimeConfig, {
      appToken: backupToken,
      agentId: backupAgentId,
    });

    try {
      await persistRuntimeAppToken({
        runtime,
        accountId,
        appToken: backupToken,
        relayAgentId: backupAgentId,
        runtimeConfig: restoredRuntimeConfig,
      });
    } catch (error) {
      logger.warn?.(`[claworld:${accountId || 'default'}] failed to persist restored runtime appToken`, {
        error: error?.message || String(error),
      });
    }

    return {
      restored: true,
      reason: 'installer_state_backup',
      runtimeConfig: restoredRuntimeConfig,
      backup,
      installerStatePath: backupState.installerStatePath,
    };
  }

  function resolveConfiguredRuntimeContext(context = {}) {
    const cfg = context.cfg || {};
    const accountId = context.accountId || null;
    const runtimeContext = accountRuntimeContexts.get(accountId || 'default') || null;
    const runtimeConfig = runtimeContext?.runtimeConfig || context.runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
    return {
      ...context,
      cfg: runtimeContext?.cfg || cfg,
      accountId: runtimeConfig.accountId || accountId || null,
      runtimeConfig,
      agentId: context.agentId || runtimeConfig.relay?.agentId || null,
      bindingSource: runtimeContext?.deferredFailure ? 'runtime_context_deferred' : 'runtime_context',
    };
  }

  async function resolveBoundRuntimeContext(context = {}) {
    const configuredContext = resolveConfiguredRuntimeContext(context);
    const cfg = configuredContext.cfg || {};
    const accountId = configuredContext.accountId || null;
    let runtimeConfig = configuredContext.runtimeConfig;
    const runtimeResolution = resolvePluginRuntimeCandidate(context.runtime || null);
    const restoredBinding = await maybeRestoreRuntimeAppToken({
      runtime: runtimeResolution.runtime,
      accountId,
      runtimeConfig,
    });
    if (restoredBinding.restored) {
      runtimeConfig = restoredBinding.runtimeConfig;
      logger.info?.(`[claworld:${accountId || 'default'}] restored runtime binding from installer state`, {
        installerStatePath: restoredBinding.installerStatePath || null,
        relayAgentId: runtimeConfig?.relay?.agentId || null,
      });
    }
    const runtimeContext = accountRuntimeContexts.get(accountId || 'default') || null;
    if (runtimeContext?.runtimeConfig && !runtimeContext?.deferredFailure) {
      return {
        ...configuredContext,
        cfg: runtimeContext.cfg || cfg,
        accountId: runtimeConfig.accountId || accountId || null,
        runtimeConfig,
        runtime: runtimeResolution.runtime,
        runtimeSource: runtimeResolution.runtimeSource,
        agentId: configuredContext.agentId || runtimeConfig.relay?.agentId || null,
        bindingSource: 'runtime_context',
      };
    }
    const binding = await ensureAccountRelayBinding({ runtimeConfig, accountId });
    runtimeConfig = binding.runtimeConfig;
    return {
      ...configuredContext,
      cfg,
      accountId: runtimeConfig.accountId || accountId || null,
      runtimeConfig,
      runtime: runtimeResolution.runtime,
      runtimeSource: runtimeResolution.runtimeSource,
      agentId: configuredContext.agentId || runtimeConfig.relay?.agentId || null,
      bindingSource: binding.bindingSource,
    };
  }

  function resolveContextBoundLocalAgentId(context = {}) {
    return resolveBoundLocalAgentId({
      cfg: context.cfg || {},
      runtimeConfig: context.runtimeConfig || {},
      relayClient: relayClients.get(context.accountId || 'default') || null,
    });
  }

  function getAccountLifecycle(accountKey = 'default') {
    if (lifecycles.has(accountKey)) return lifecycles.get(accountKey);

    const lifecycle = createClaworldLifecycleManager({
      logger,
      connect: async (context = {}) => {
        const runtimeAccountId = String(context.accountId || context.account?.accountId || accountKey);

        logger.info?.(`[claworld:${runtimeAccountId}] startAccount invoked`, {
          accountId: context.accountId || null,
          hasAbortSignal: Boolean(context.abortSignal),
          hasAccount: Boolean(context.account),
          hasConfig: Boolean(context.config),
          hasCfg: Boolean(context.cfg),
          accountShape: summarizeObjectShape(context.account),
          configShape: summarizeObjectShape(context.config),
          cfgShape: summarizeObjectShape(context.cfg),
        });

        const { sourceType, configSource, runtimeConfig: initialRuntimeConfig } = resolveRuntimeConfigSource(context);
        let runtimeConfig = initialRuntimeConfig;
        logger.info?.(`[claworld:${runtimeAccountId}] resolved runtime config source`, {
          sourceType,
          configSourceShape: summarizeObjectShape(configSource),
          runtimeConfigShape: summarizeObjectShape(runtimeConfig),
        });

        const runtimeResolution = resolvePluginRuntimeCandidate(context.runtime || null);
        const restoredBinding = await maybeRestoreRuntimeAppToken({
          runtime: runtimeResolution.runtime,
          accountId: runtimeAccountId,
          runtimeConfig,
        });
        if (restoredBinding.restored) {
          runtimeConfig = restoredBinding.runtimeConfig;
          logger.info?.(`[claworld:${runtimeAccountId}] restored runtime binding from installer state`, {
            installerStatePath: restoredBinding.installerStatePath || null,
            relayAgentId: runtimeConfig?.relay?.agentId || null,
          });
        }

        const validation = validateClaworldChannelConfig(configSource, context.accountId);
        if (!validation.ok && sourceType !== 'root_cfg') {
          logger.warn?.(`[claworld:${runtimeAccountId}] non-root runtime source would not validate as full cfg`, {
            sourceType,
            errors: validation.errors,
          });
        }

        let binding;
        try {
          binding = await ensureAccountRelayBinding({ runtimeConfig, accountId: runtimeAccountId });
        } catch (error) {
          const normalized = normalizeRuntimeBoundaryError(error, {
            code: 'claworld_relay_binding_failed',
            category: 'bootstrap',
            message: 'claworld relay binding bootstrap failed',
            publicMessage: 'claworld relay binding bootstrap failed',
            recoverable: true,
            context: {
              accountId: runtimeAccountId,
              stage: 'ensureRelayBinding',
            },
          });
          if (!isNonRecoverableBootstrapHoldError(normalized)) {
            throw normalized;
          }

          const { runtime: deferredRuntime } = resolvePluginRuntimeCandidate(context.runtime || null);
          const deferredFailure = serializeRuntimeBoundaryError(normalized);
          const holdMessage = buildBootstrapHoldMessage(normalized, runtimeConfig);
          accountRuntimeContexts.set(accountKey, {
            runtime: deferredRuntime,
            cfg: context.cfg || null,
            runtimeConfig,
            deferredFailure,
            deferredErrorMessage: holdMessage,
          });
          context.setStatus?.({
            accountId: runtimeAccountId,
            configured: false,
            connected: false,
            running: false,
            restartPending: false,
            lastError: holdMessage,
          });
          logger.warn?.(`[claworld:${runtimeAccountId}] relay binding requires operator setup; holding runtime`, {
            code: normalized.code,
            category: normalized.category,
            status: normalized.status,
            requestedAgentCode: normalized.context?.requestedAgentCode || null,
          });
          return {
            startedDeferred: true,
            reason: 'bootstrap_setup_required',
            runtimeConfig,
            deferredFailure,
          };
        }
        runtimeConfig = binding.runtimeConfig;
        logger.info?.(`[claworld:${runtimeAccountId}] relay binding ready`, {
          bindingSource: binding.bindingSource,
          relayAgentId: runtimeConfig.relay?.agentId || null,
          hasAppToken: Boolean(resolveRuntimeAppToken(runtimeConfig)),
        });

        const relayAgentId = context.agentId || runtimeConfig.relay?.agentId || null;
        const relayCredential = context.credential || (resolveRuntimeAppToken(runtimeConfig)
          ? { type: 'agent_token', token: resolveRuntimeAppToken(runtimeConfig) }
          : null);

        if (!relayAgentId) {
          logger.warn?.(`[claworld:${runtimeAccountId}] missing relay runtime context; deferring connect`);
          return { startedDeferred: true, reason: 'missing_runtime_context', runtimeConfig };
        }

        const pluginRuntime = runtimeResolution.runtime;
        const runtimeSource = runtimeResolution.runtimeSource;

        logger.info?.(`[claworld:${runtimeAccountId}] runtime surface resolved`, {
          runtimeSource,
        });

        try {
          const persisted = await persistRuntimeAppToken({
            runtime: pluginRuntime,
            accountId: runtimeConfig.accountId,
            appToken: resolveRuntimeAppToken(runtimeConfig),
            relayAgentId: runtimeConfig.relay?.agentId || null,
            runtimeConfig,
          });
          if (!persisted.skipped || persisted.backup?.skipped === false) {
            logger.info?.(`[claworld:${runtimeAccountId}] persisted runtime binding state`, {
              accountId: runtimeConfig.accountId,
              configSkipped: persisted.skipped === true,
              backupSkipped: persisted.backup?.skipped === true,
            });
          }
        } catch (error) {
          logger.warn?.(`[claworld:${runtimeAccountId}] failed to persist runtime appToken`, {
            error: error?.message || String(error),
          });
        }

        accountRuntimeContexts.set(accountKey, {
          runtime: pluginRuntime,
          cfg: context.cfg || null,
          runtimeConfig,
          deferredFailure: null,
          deferredErrorMessage: null,
        });

        const relayClient = relayClientFactory({ logger, inbound, outbound, protocol });
        relayClients.set(accountKey, relayClient);

        relayClient.on?.('close', (info = {}) => {
          logger.warn?.(`[claworld:${runtimeAccountId}] relay websocket closed`, info);
        });
        relayClient.on?.('runtime_event', (event) => {
          logger.debug?.(`[claworld:${runtimeAccountId}] inbound relay event`, {
            eventType: event?.eventType || null,
            target: event?.route?.target || null,
            deliveryId: event?.delivery?.deliveryId || null,
            sessionKey: event?.delivery?.sessionKey || null,
          });

          if (event?.delivery?.sessionKey) {
            const runtimeContext = accountRuntimeContexts.get(accountKey) || {};
            maybeBridgeRuntimeInboundEvent({
              relayClient,
              runtimeConfig,
              runtimeAccountId,
              event,
              logger,
              runtime: runtimeContext.runtime,
              cfg: runtimeContext.cfg,
              inbound,
              activeDeliveryReplies,
            }).catch((error) => {
              logger.error?.(`[claworld:${runtimeAccountId}] inbound bridge exception`, {
                error: error?.message || String(error),
              });
            });
          }
        });

        if (context.autoConnect === false) {
          logger.info?.(`[claworld:${runtimeAccountId}] lifecycle started in deferred mode (autoConnect=false)`);
          return { startedDeferred: true, runtimeConfig, relayClient };
        }

        logger.info?.(`[claworld:${runtimeAccountId}] connecting relay websocket ...`);
        await relayClient.connect({
          config: runtimeConfig,
          agentId: relayAgentId,
          credential: relayCredential,
          clientVersion: context.clientVersion,
          sessionTarget: context.sessionTarget || runtimeConfig.routing?.sessionTarget,
          fallbackTarget: context.fallbackTarget || runtimeConfig.routing?.fallbackTarget,
        });
        logger.info?.(`[claworld:${runtimeAccountId}] auth ok`);
        return relayClient;
      },
      disconnect: async ({ reason }) => {
        const relayClient = relayClients.get(accountKey);
        if (relayClient) {
          await relayClient.close(reason);
          relayClients.delete(accountKey);
        }
        accountRuntimeContexts.delete(accountKey);
        accountBindingStates.delete(accountKey);
      },
    });

    lifecycles.set(accountKey, lifecycle);
    return lifecycle;
  }

  async function runAccountLifecycle(context = {}) {
    const accountKey = String(context.accountId || context.account?.accountId || 'default');
    const lifecycle = getAccountLifecycle(accountKey);
    const started = await lifecycle.start(context);
    const runtimeAccountId = String(
      context.accountId
      || context.account?.accountId
      || started?.connection?.runtimeConfig?.accountId
      || accountKey
    );

    if (!context.abortSignal) {
      logger.warn?.(`[claworld:${runtimeAccountId}] no abortSignal; startAccount will behave as a short-lived start call`);
      return started;
    }

    if (context.abortSignal.aborted) {
      logger.info?.(`[claworld:${runtimeAccountId}] abort already signaled before runtime entered steady state`);
      await lifecycle.stop('abort_before_run');
      return started;
    }

    const startedDeferred = Boolean(started?.connection?.startedDeferred);
    logger.info?.(
      `[claworld:${runtimeAccountId}] account runtime started; waiting for ${
        startedDeferred ? 'abort while setup is deferred' : 'abort'
      }`,
    );
    const stopReason = startedDeferred
      ? await waitForAbort(context.abortSignal)
      : await Promise.race([
        waitForAbort(context.abortSignal),
        waitForRelayClientClose(started?.connection),
      ]);

    if (stopReason?.reason === 'abort_signal') {
      logger.info?.(`[claworld:${runtimeAccountId}] abort signal received, stopping`);
      await lifecycle.stop('abort_signal');
      return started;
    }

    logger.warn?.(`[claworld:${runtimeAccountId}] account runtime ended before abort`, stopReason);
    await lifecycle.stop(stopReason?.reason || 'runtime_stopped');
    return started;
  }

  function createStatusSnapshot() {
    const configuredAccounts = new Set([
      ...listClaworldAccountIds({ channels: { claworld: { accounts: {} } } }),
      ...Array.from(accountRuntimeContexts.keys()),
      ...Array.from(relayClients.keys()),
      ...Array.from(lifecycles.keys()),
    ]);

    const accountSnapshots = Object.fromEntries(
      Array.from(configuredAccounts).map((accountId) => {
        const lifecycle = lifecycles.get(accountId)?.snapshot?.() || null;
        const relayClient = relayClients.get(accountId)?.snapshot?.() || null;
        const runtimeContext = accountRuntimeContexts.get(accountId) || null;
        const deferredFailure = runtimeContext?.deferredFailure || null;
        const connected = Boolean(relayClient && relayClient.connectionState === 'authenticated');
        const lastFailure = lifecycle?.lastStartFailure || deferredFailure || null;
        const lastError = runtimeContext?.deferredErrorMessage || lifecycle?.lastStartError || deferredFailure?.message || null;
        const setupBlocked = isNonRecoverableBootstrapHoldError(lastFailure);
        const degraded = Boolean(lastError) || Boolean(relayClient && relayClient.connectionState === 'error');
        return [accountId, {
          configured: !setupBlocked,
          enabled: true,
          connected,
          degraded,
          hasRuntime: Boolean(runtimeContext?.runtime),
          hasCfg: Boolean(runtimeContext?.cfg),
          lifecycle,
          relayClient,
          lastError,
          lastFailure,
        }];
      }),
    );

    return {
      ok: true,
      pluginId: 'claworld',
      version: CLAWORLD_PLUGIN_CURRENT_VERSION,
      toolContractVersion: CLAWORLD_TOOL_CONTRACT_VERSION,
      publicToolNames: [...CLAWORLD_PUBLIC_TOOL_NAMES],
      retiredPublicToolNames: [...CLAWORLD_RETIRED_PUBLIC_TOOL_NAMES],
      defaultAccountId: null,
      accounts: accountSnapshots,
      relayClients: Object.fromEntries(
        Array.from(relayClients.entries()).map(([accountId, client]) => [accountId, client?.snapshot?.() || null]),
      ),
      lifecycles: Object.fromEntries(
        Array.from(lifecycles.entries()).map(([accountId, lifecycle]) => [accountId, lifecycle.snapshot()]),
      ),
    };
  }

  async function getRuntimePublicIdentity(context = {}) {
    const resolvedContext = resolveConfiguredRuntimeContext(context);
    return fetchPublicIdentity({
      runtimeConfig: resolvedContext.runtimeConfig,
      agentId: resolvedContext.agentId || null,
      generateShareCard: context.generateShareCard === true,
      expiresInSeconds: context.expiresInSeconds ?? null,
      shareCardVariant: context.shareCardVariant ?? null,
      fetchImpl,
    });
  }

  async function updateRuntimePublicIdentity(context = {}) {
    const configuredContext = resolveConfiguredRuntimeContext(context);
    const resolvedContext = await resolveBoundRuntimeContext(context);
    const updateResult = await updatePublicIdentity({
      runtimeConfig: resolvedContext.runtimeConfig,
      agentId: resolvedContext.agentId || null,
      displayName: context.displayName || null,
      generateShareCard: context.generateShareCard !== false,
      expiresInSeconds: context.expiresInSeconds ?? null,
      shareCardVariant: context.shareCardVariant ?? null,
      fetchImpl,
    });

    const runtimeIdentity = updateResult?.runtimeIdentity && typeof updateResult.runtimeIdentity === 'object'
      ? updateResult.runtimeIdentity
      : null;
    const nextRuntimeConfig = updateResult?.runtimeConfig && typeof updateResult.runtimeConfig === 'object'
      ? updateResult.runtimeConfig
      : resolvedContext.runtimeConfig;
    const nextAgentId = normalizeClaworldText(
      runtimeIdentity?.agentId,
      normalizeClaworldText(
        updateResult?.agentId,
        null,
      ),
    ) || normalizeClaworldText(
      normalizeClaworldText(resolvedContext.agentId, normalizeClaworldText(nextRuntimeConfig?.relay?.agentId, null)),
      null,
    );
    const boundRuntimeConfig = nextAgentId
      ? applyRuntimeIdentity(nextRuntimeConfig, { agentId: nextAgentId })
      : nextRuntimeConfig;

    const configuredAppToken = resolveRuntimeAppToken(configuredContext.runtimeConfig);
    const previousAgentId = normalizeClaworldText(
      configuredContext.runtimeConfig?.relay?.agentId,
      normalizeClaworldText(configuredContext.agentId, null),
    );
    const nextAppToken = resolveRuntimeAppToken(boundRuntimeConfig);
    const shouldPersistRuntimeBinding = Boolean(
      nextAppToken
      && nextAgentId
      && (
        runtimeIdentity
        || configuredAppToken !== nextAppToken
        || previousAgentId !== nextAgentId
      ),
    );

    if (shouldPersistRuntimeBinding) {
      const runtimeResolution = resolvePluginRuntimeCandidate(context.runtime || null);
      try {
        await persistRuntimeAppToken({
          runtime: runtimeResolution.runtime,
          accountId: resolvedContext.accountId || boundRuntimeConfig.accountId || null,
          appToken: nextAppToken,
          relayAgentId: nextAgentId,
          runtimeConfig: boundRuntimeConfig,
        });
      } catch (error) {
        logger.warn?.('[claworld:profile] failed to persist verified runtime binding', {
          accountId: resolvedContext.accountId || boundRuntimeConfig.accountId || null,
          error: error?.message || String(error),
        });
      }

      rememberAccountBinding({
        runtimeConfig: boundRuntimeConfig,
        accountId: resolvedContext.accountId || boundRuntimeConfig.accountId || null,
        bindingSource: runtimeIdentity
          ? 'verified_app_token'
          : (resolvedContext.bindingSource || 'configured_app_token'),
      });

      const accountKey = resolveAccountBindingKey(boundRuntimeConfig, resolvedContext.accountId || null);
      const currentRuntimeContext = accountRuntimeContexts.get(accountKey) || null;
      if (currentRuntimeContext) {
        accountRuntimeContexts.set(accountKey, {
          ...currentRuntimeContext,
          runtimeConfig: boundRuntimeConfig,
          deferredFailure: null,
          deferredErrorMessage: null,
        });
      }
    }

    const payload = updateResult && typeof updateResult === 'object' && !Array.isArray(updateResult)
      ? { ...updateResult }
      : {};
  delete payload.runtimeConfig;
  return payload;
}

async function startRuntimeEmailVerification(context = {}) {
  const configuredContext = resolveConfiguredRuntimeContext(context);
  return startEmailVerification({
    runtimeConfig: configuredContext.runtimeConfig,
    email: context.email || null,
    displayName: context.displayName || null,
    fetchImpl,
  });
}

function projectRuntimeCredentialPersistence(persistence = {}) {
  if (!persistence || typeof persistence !== 'object' || Array.isArray(persistence)) {
    return { status: 'unknown' };
  }
  const skipped = persistence?.skipped === true;
  return {
    status: skipped ? 'best_effort' : 'saved',
    method: normalizeClaworldText(persistence?.method, null),
    reason: skipped ? normalizeClaworldText(persistence?.reason, null) : null,
    backupStatus: persistence?.backup?.skipped === true
      ? 'best_effort'
      : (persistence?.backup?.ok === true ? 'saved' : null),
    restartRequired: false,
    reloadRequired: !skipped,
    reloadMode: skipped ? null : 'openclaw_channel_hot_reload',
  };
}

async function completeRuntimeEmailVerification(context = {}) {
  const configuredContext = resolveConfiguredRuntimeContext(context);
  const verification = await completeEmailVerification({
    runtimeConfig: configuredContext.runtimeConfig,
    email: context.email || null,
    code: context.code || null,
    fetchImpl,
  });
  const appToken = normalizeClaworldText(verification?.appToken, null);
  const agentId = normalizeClaworldText(verification?.agentId, null);
  if (!appToken || !agentId) {
    throw createRuntimeBoundaryError({
      code: 'email_verification_complete_failed',
      category: 'runtime',
      status: 502,
      message: 'claworld email verification did not return appToken and agentId',
      publicMessage: 'failed to complete Claworld email verification',
      recoverable: true,
    });
  }

  const boundRuntimeConfig = applyRuntimeIdentity(configuredContext.runtimeConfig, {
    appToken,
    agentId,
  });
  const accountId = configuredContext.accountId || boundRuntimeConfig.accountId || null;
  const runtimeResolution = resolvePluginRuntimeCandidate(context.runtime || null);
  let persistence = null;
  try {
    persistence = await persistRuntimeAppToken({
      runtime: runtimeResolution.runtime,
      accountId,
      appToken,
      relayAgentId: agentId,
      runtimeConfig: boundRuntimeConfig,
    });
  } catch (error) {
    persistence = {
      skipped: true,
      reason: 'persist_runtime_binding_failed',
      error: error?.message || String(error),
    };
    logger.warn?.('[claworld:identity] failed to persist email verification runtime binding', {
      accountId,
      error: persistence.error,
    });
  }

  rememberAccountBinding({
    runtimeConfig: boundRuntimeConfig,
    accountId,
    bindingSource: 'email_verification',
  });

  const accountKey = resolveAccountBindingKey(boundRuntimeConfig, accountId);
  const currentRuntimeContext = accountRuntimeContexts.get(accountKey) || null;
  if (currentRuntimeContext) {
    accountRuntimeContexts.set(accountKey, {
      ...currentRuntimeContext,
      runtimeConfig: boundRuntimeConfig,
      deferredFailure: null,
      deferredErrorMessage: null,
    });
  }

  const payload = verification && typeof verification === 'object' && !Array.isArray(verification)
    ? { ...verification }
    : {};
  delete payload.appToken;
  delete payload.credential;
  const credentialPersistence = projectRuntimeCredentialPersistence(persistence);
  return {
    ...payload,
    credentialPersistence,
    runtimeIdentity: {
      status: 'verified',
      agentId,
      created: verification?.created === true,
      recovered: verification?.recovered === true,
      bindingSource: 'email_verification',
    },
    runtimeBinding: {
      status: 'bound',
      accountId,
      agentId,
      bindingSource: 'email_verification',
      credentialPersistence,
    },
  };
}

async function getRuntimeIdentityStatus(context = {}) {
  const configuredContext = resolveConfiguredRuntimeContext(context);
  const runtimeConfig = applyRuntimeIdentity(configuredContext.runtimeConfig);
  const agentId = normalizeClaworldText(
    context.agentId,
    normalizeClaworldText(runtimeConfig?.relay?.agentId, null),
  );
  if (!resolveRuntimeAppToken(runtimeConfig)) {
    return { emailVerified: false, reason: 'missing_app_token' };
  }
  if (!agentId) {
    return { emailVerified: false, reason: 'agent_id_required' };
  }

  const accountView = await executeRuntimeAccountAction({
    runtimeConfig,
    agentId,
    action: 'view_account',
    generateShareCard: false,
    fetchImpl,
  });
  const account = accountView?.account && typeof accountView.account === 'object' && !Array.isArray(accountView.account)
    ? accountView.account
    : {};
  const emailVerified = account.emailVerified === true;
  return {
    emailVerified,
    email: normalizeClaworldText(account.email, null),
    verifiedAt: normalizeClaworldText(account.verifiedAt, null),
    reason: emailVerified ? null : 'no_email_identity',
    relay: accountView?.relay && typeof accountView.relay === 'object' && !Array.isArray(accountView.relay)
      ? accountView.relay
      : null,
    diagnostics: accountView?.diagnostics && typeof accountView.diagnostics === 'object' && !Array.isArray(accountView.diagnostics)
      ? accountView.diagnostics
      : null,
    accountView,
  };
}

async function updateRuntimeProfile(context = {}) {
  const resolvedContext = await resolveBoundRuntimeContext(context);
  return updateGlobalProfile({
    runtimeConfig: resolvedContext.runtimeConfig,
    agentId: resolvedContext.agentId || null,
    profile: Object.prototype.hasOwnProperty.call(context, 'profile')
      ? (context.profile == null ? '' : String(context.profile))
      : '',
    fetchImpl,
  });
}

async function generateRuntimeProfileCard(context = {}) {
  const resolvedContext = await resolveBoundRuntimeContext(context);
  const result = await fetchPublicIdentity({
    runtimeConfig: resolvedContext.runtimeConfig,
    agentId: context.agentId || resolvedContext.agentId || null,
    generateShareCard: true,
    expiresInSeconds: context.expiresInSeconds ?? null,
    shareCardVariant: context.shareCardVariant ?? null,
    fetchImpl,
  });
  return result?.shareCard || {};
}

  return {
    id: 'claworld',
    meta: {
      id: 'claworld',
      label: 'Claworld',
      selectionLabel: 'Claworld Relay Channel',
      detailLabel: 'Claworld A2A Relay Channel',
      docsPath: '/channels/claworld',
      docsLabel: 'claworld',
      blurb: 'Claworld relay channel backed by the Claworld backend.',
      version: CLAWORLD_PLUGIN_CURRENT_VERSION,
      forceAccountBinding: true,
    },
    onboarding: claworldOnboardingAdapter,
    capabilities: {
      chatTypes: ['direct'],
      polls: false,
      threads: false,
      reactions: false,
      media: false,
      edit: false,
      reply: true,
    },
    agentPrompt: {
      messageToolHints: () => [
        '- Claworld message targets are canonical `agentId` values such as `agt_xxx`.',
        '- Omit `target` to keep replying inside the current A2A session when the runtime already inferred the peer.',
        '- For new chat requests, use the target `displayName` plus public `agentCode`; the backend resolves by `agentCode` and returns a warning if the displayName is stale.',
      ],
    },
    reload: { configPrefixes: ['channels.claworld'] },
    configSchema: {
      schema: claworldChannelConfigJsonSchema,
    },
    config: {
      schema: claworldChannelConfigSchema,
      validate: validateClaworldChannelConfig,
      listAccountIds: (cfg) => listClaworldAccountIds(cfg),
      defaultAccountId: (cfg) => defaultClaworldAccountId(cfg),
      inspectAccount: (cfg, accountId) =>
        projectClaworldStatusAccount(inspectClaworldChannelAccount(cfg, accountId)),
      resolveAccount: (cfg, accountId) => resolveClaworldChannelAccount(cfg, accountId),
      resolveRuntimeConfig: (cfg, accountId) => resolveClaworldRuntimeConfig(cfg, accountId),
      isConfigured: (account, cfg) => {
        if (account?.configured != null) return Boolean(account.configured);
        return inspectClaworldChannelAccount(account || cfg || {}).configured;
      },
      describeAccount: (account, cfg) => {
        if (account?.configured != null) return account;
        return inspectClaworldChannelAccount(account || cfg || {});
      },
    },
    setup: claworldSetupAdapter,
    messaging: {
      normalizeTarget: (raw) => normalizeClaworldTarget(raw) ?? undefined,
      targetResolver: {
        looksLikeId: (raw, normalized) => {
          const value = String(normalized || raw || '').trim();
          if (!value) return false;
          return /^agt_[a-z0-9_-]+$/i.test(value);
        },
        hint: '<agentId>',
      },
    },
    directory: {
      self: async ({ cfg, accountId } = {}) => {
        const account = inspectClaworldChannelAccount(cfg || {}, accountId || null);
        const agentId = normalizeClaworldText(account?.relay?.agentId, null);
        if (!account?.configured || !agentId) return null;
        return {
          id: agentId,
          name: account.accountId,
          handle: account.accountId,
        };
      },
      listPeers: async ({ cfg, accountId } = {}) => buildClaworldDirectoryEntries(cfg || {}, accountId || null),
      listGroups: async () => [],
    },
    status: {
      getSnapshot: () => createStatusSnapshot(),
    },
    gateway: {
      startAccount: async (context = {}) => {
        context.log?.info?.(`starting claworld[${context.accountId || context.account?.accountId || 'default'}]`);
        return runAccountLifecycle({
          ...context,
          config: context.cfg || context.config || context.account || {},
        });
      },
      stopAccount: async (context = {}) => {
        const accountKey = String(context.accountId || context.account?.accountId || 'default');
        const lifecycle = getAccountLifecycle(accountKey);
        return lifecycle.stop('stop_account');
      },
      start: (context = {}) => runAccountLifecycle(context),
      stop: async (reasonOrContext = 'manual_stop') => {
        if (typeof reasonOrContext === 'object' && reasonOrContext !== null) {
          const accountKey = String(reasonOrContext.accountId || reasonOrContext.account?.accountId || 'default');
          return getAccountLifecycle(accountKey).stop(reasonOrContext.reason || 'manual_stop');
        }
        const entries = Array.from(lifecycles.entries());
        await Promise.all(entries.map(([, lifecycle]) => lifecycle.stop(reasonOrContext)));
        return { started: false, stopped: true, reason: reasonOrContext };
      },
      reconnect: async (context = {}) => {
        const accountKey = String(context.accountId || context.account?.accountId || 'default');
        return getAccountLifecycle(accountKey).reconnect(context);
      },
      snapshot: () => ({
        lifecycles: Object.fromEntries(Array.from(lifecycles.entries()).map(([accountId, lifecycle]) => [accountId, lifecycle.snapshot()])),
        relayClients: Object.fromEntries(Array.from(relayClients.entries()).map(([accountId, client]) => [accountId, client?.snapshot?.() || null])),
      }),
    },
    inbound: {
      routeRelayEvent: (event = {}, options = {}) => {
        return inbound.routeInboundEvent({
          eventType: event.eventType || event.type || 'delivery',
          deliveryId: event.deliveryId || event.event_id || event.eventId || null,
          sessionKey: event.sessionKey || null,
          payload: event.payload || {},
          metadata: event.metadata || {},
        }, options);
      },
    },
    outbound: {
      deliveryMode: 'direct',
      createReplyEnvelope: (params = {}) => outbound.createReplyEnvelope(params),
      sendText: async (ctx = {}) => {
        const resolvedContext = await resolveBoundRuntimeContext(ctx);
        const activeReply = activeDeliveryReplies.resolve({
          accountId: resolvedContext.accountId || ctx.accountId || null,
          to: ctx.to,
        });
        const activeReplyText = normalizeClaworldText(ctx.text, null);
        if (activeReply && activeReplyText) {
          const submitted = await activeReply.submitMessageToolReply?.({
            text: activeReplyText,
            to: ctx.to,
          });
          const clientMessageId = normalizePluginOptionalText(
            ctx.clientMessageId || ctx.metadata?.clientMessageId || null,
          ) || buildGeneratedClientMessageId();
          logger.info?.(`[claworld:${resolvedContext.accountId || ctx.accountId || 'default'}] routed message tool send through active delivery reply`, {
            deliveryId: activeReply.deliveryId || null,
            sessionKey: activeReply.sessionKey || null,
            localSessionKey: activeReply.localSessionKey || null,
            targetAgentId: activeReply.targetAgentId || normalizeClaworldTarget(ctx.to) || null,
            submitted: submitted === true,
          });
          return {
            channel: 'claworld',
            messageId: activeReply.deliveryId || `delivery_${Date.now()}`,
            chatId: activeReply.targetAgentId || normalizeClaworldTarget(ctx.to) || ctx.to || null,
            timestamp: Date.now(),
            meta: {
              clientMessageId,
              sessionKey: activeReply.sessionKey || null,
              turnId: activeReply.deliveryId || null,
              conversationKey: activeReply.conversationKey || null,
              targetAgentId: activeReply.targetAgentId || normalizeClaworldTarget(ctx.to) || null,
              deliveryId: activeReply.deliveryId || null,
              routedVia: 'delivery_reply',
            },
          };
        }
        if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for claworld outbound');
        return deliverRelayMessage({
          runtimeConfig: resolvedContext.runtimeConfig,
          to: ctx.to,
          text: ctx.text,
          fetchImpl,
          logger,
          outboundContext: ctx,
        });
      },
    },
    helpers: {
      resolveToolRuntimeContext: resolveBoundRuntimeContext,
      pairing: {
        resolveAgentIdentity: async (context = {}) => resolveRelayAgentSummary({
          runtimeConfig: context.runtimeConfig || resolveClaworldRuntimeConfig(context.cfg || {}, context.accountId || null),
          fetchImpl,
          logger,
          agentId: context.agentId || context.targetAgentId || null,
        }),
      },
      social: {
        requestChat: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          const requestContext = resolvedContext.requesterSessionKey
            ? {
                followUp: {
                  sessionKey: resolvedContext.requesterSessionKey,
                },
              }
            : null;
          return createChatRequest({
            runtimeConfig: resolvedContext.runtimeConfig,
            fromAgentId: resolvedContext.agentId || null,
            displayName: context.displayName || null,
            agentCode: context.agentCode || null,
            openingMessage: context.openingMessage || context.message || context.text || null,
            message: context.message || null,
            text: context.text || null,
            kickoffBrief: context.kickoffBrief || null,
            openingPayload: context.openingPayload || null,
            worldId: context.worldId || null,
            requestContext,
            fetchImpl,
          });
        },
        listChatInbox: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return listChatInbox({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            localAgentId: resolveContextBoundLocalAgentId(resolvedContext),
            filters: context.filters || null,
            direction: context.direction || null,
            fetchImpl,
          });
        },
        acceptChatRequest: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return acceptChatRequest({
            runtimeConfig: resolvedContext.runtimeConfig,
            actorAgentId: resolvedContext.agentId || null,
            chatRequestId: context.chatRequestId || null,
            localAgentId: resolveContextBoundLocalAgentId(resolvedContext),
            fetchImpl,
          });
        },
        rejectChatRequest: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return rejectChatRequest({
            runtimeConfig: resolvedContext.runtimeConfig,
            actorAgentId: resolvedContext.agentId || null,
            chatRequestId: context.chatRequestId || null,
            fetchImpl,
          });
        },
        closeConversation: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return closeConversation({
            runtimeConfig: resolvedContext.runtimeConfig,
            actorAgentId: resolvedContext.agentId || null,
            conversationKey: context.conversationKey || null,
            localSessionKey: context.localSessionKey || null,
            localAgentId: resolveContextBoundLocalAgentId(resolvedContext),
            fetchImpl,
          });
        },
      },
      profile: {
        getPublicIdentity: getRuntimePublicIdentity,
        executeAccountAction: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return executeRuntimeAccountAction({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            action: context.action || 'view_account',
            displayName: context.displayName || null,
            profile: Object.prototype.hasOwnProperty.call(context, 'profile') ? context.profile : undefined,
            humanProfile: Object.prototype.hasOwnProperty.call(context, 'humanProfile') ? context.humanProfile : undefined,
            agentProfile: Object.prototype.hasOwnProperty.call(context, 'agentProfile') ? context.agentProfile : undefined,
            visibilityMode: Object.prototype.hasOwnProperty.call(context, 'visibilityMode') ? context.visibilityMode : undefined,
            contactPolicy: Object.prototype.hasOwnProperty.call(context, 'contactPolicy') ? context.contactPolicy : undefined,
            proactivitySettings: Object.prototype.hasOwnProperty.call(context, 'proactivitySettings') ? context.proactivitySettings : undefined,
            generateShareCard: context.generateShareCard === true,
            expiresInSeconds: context.expiresInSeconds ?? null,
            shareCardVariant: context.shareCardVariant ?? null,
            fetchImpl,
          });
        },
        updatePublicIdentity: updateRuntimePublicIdentity,
        updateProfile: updateRuntimeProfile,
        generateShareCard: generateRuntimeProfileCard,
      },
      identity: {
        startEmailVerification: startRuntimeEmailVerification,
        completeEmailVerification: completeRuntimeEmailVerification,
        getIdentityStatus: getRuntimeIdentityStatus,
      },
      postSetup: {
        fetchWorldDirectory: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchPostSetupWorldDirectory({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            limit: context.limit ?? null,
            sort: context.sort || null,
            page: context.page ?? null,
            fetchImpl,
            logger,
          });
        },
        fetchWorldDetail: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchWorldDetail({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldId: context.worldId || null,
            fetchImpl,
            logger,
          });
        },
        searchWorlds: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return searchWorlds({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            query: context.query ?? context.queryText ?? null,
            keywords: context.keywords || [],
            topics: context.topics || [],
            location: context.location || null,
            timeWindow: context.timeWindow || null,
            intent: context.intent || null,
            desiredInteraction: context.desiredInteraction || null,
            constraints: context.constraints || [],
            limit: context.limit ?? null,
            sort: context.sort || null,
            page: context.page ?? null,
            fetchImpl,
            logger,
          });
        },
        joinWorld: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return joinWorld({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldId: context.worldId || null,
            agentId: resolvedContext.agentId || null,
            participantContextText: context.participantContextText || null,
            fetchImpl,
            logger,
          });
        },
        searchWorldMembers: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return searchWorldMembers({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldId: context.worldId || null,
            agentId: resolvedContext.agentId || null,
            query: context.query ?? context.queryText ?? null,
            keywords: context.keywords || [],
            topics: context.topics || [],
            location: context.location || null,
            timeWindow: context.timeWindow || null,
            intent: context.intent || null,
            desiredInteraction: context.desiredInteraction || null,
            constraints: context.constraints || [],
            sort: context.sort || null,
            limit: context.limit ?? null,
            fetchImpl,
            logger,
          });
        },
        resolveWorldSelection: (context = {}) => resolveWorldSelection(
          context.worldDirectory || {},
          context.selection ?? context.userChoice ?? null,
        ),
        resolveWorldSelectionFlow: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return resolveWorldSelectionFlow({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldDirectory: context.worldDirectory || null,
            selection: context.selection ?? context.userChoice ?? null,
            profile: context.profile || {},
            fetchImpl,
            logger,
          });
        },
      },
      subscriptions: {
        listSubscriptions: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchRuntimeSubscriptions({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            targetType: context.targetType || null,
            status: context.status || 'active',
            fetchImpl,
          });
        },
        createSubscription: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return createRuntimeSubscription({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            targetType: context.targetType || null,
            targetId: context.targetId || null,
            broadcastEnabled: context.broadcastEnabled !== false,
            fetchImpl,
          });
        },
        deleteSubscription: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return deleteRuntimeSubscription({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            subscriptionId: context.subscriptionId || null,
            targetType: context.targetType || null,
            targetId: context.targetId || null,
            fetchImpl,
          });
        },
      },
      publicProfiles: {
        getPublicProfile: async (context = {}) => {
          const targetAgentId = normalizeClaworldText(
            context.targetAgentId,
            normalizeClaworldText(context.profileAgentId, normalizeClaworldText(context.agentId, null)),
          );
          const runtimeContext = { ...context };
          delete runtimeContext.agentId;
          delete runtimeContext.targetAgentId;
          delete runtimeContext.profileAgentId;
          const resolvedContext = await resolveBoundRuntimeContext(runtimeContext);
          return getPublicProfile({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: targetAgentId || resolvedContext.agentId || null,
            viewerAgentId: resolvedContext.agentId || null,
            fetchImpl,
            logger,
          });
        },
        lookupPublicProfile: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return lookupPublicProfile({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            identity: context.identity || null,
            viewerAgentId: resolvedContext.agentId || null,
            fetchImpl,
            logger,
          });
        },
      },
      activity: {
        listWorldActivity: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchRuntimeWorldActivity({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            limit: context.limit ?? null,
            fetchImpl,
          });
        },
      },
      moderation: {
        createWorld: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return createModeratedWorld({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            displayName: context.displayName || null,
            worldContextText: context.worldContextText || null,
            participantContextText: context.participantContextText || null,
            enabled: typeof context.enabled === 'boolean' ? context.enabled : true,
            visibility: context.visibility || null,
            identityMode: context.identityMode || null,
            joinPolicy: context.joinPolicy || null,
            approvalPolicy: context.approvalPolicy || null,
            fetchImpl,
            logger,
          });
        },
        listOwnedWorlds: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchOwnedWorlds({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            includeDisabled: context.includeDisabled !== false,
            fetchImpl,
            logger,
          });
        },
        broadcastWorld: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return broadcastModeratedWorld({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            announcementText: context.announcementText || null,
            audience: context.audience || null,
            excludeSelf: Object.prototype.hasOwnProperty.call(context, 'excludeSelf') ? context.excludeSelf : null,
            fetchImpl,
            logger,
          });
        },
        manageWorld: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return manageModeratedWorld({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            mode: context.mode || 'get',
            changes: context.changes || null,
            enabled: Object.prototype.hasOwnProperty.call(context, 'enabled') ? context.enabled : null,
            status: context.status || null,
            fetchImpl,
            logger,
          });
        },
        inviteMember: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return inviteModeratedWorldMember({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            targetAgentId: context.targetAgentId || null,
            identity: context.identity || null,
            inviteMessage: context.inviteMessage || null,
            fetchImpl,
            logger,
          });
        },
        revokeInvite: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return revokeModeratedWorldInvite({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            targetAgentId: context.targetAgentId || null,
            fetchImpl,
            logger,
          });
        },
        listInvites: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchModeratedWorldInvites({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            status: context.status || 'invited',
            fetchImpl,
            logger,
          });
        },
      },
      membership: {
        listWorldMembers: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchRuntimeWorldMembers({
            runtimeConfig: resolvedContext.runtimeConfig,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            status: context.status || null,
            limit: context.limit ?? null,
            fetchImpl,
          });
        },
        listWorldMemberships: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchWorldMemberships({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            status: context.status || null,
            includeInactive: context.includeInactive === true,
            includeDisabled: context.includeDisabled !== false,
            fetchImpl,
            logger,
          });
        },
        listPendingInvites: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchPendingWorldInvites({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            status: context.status || 'pending',
            includeDisabled: context.includeDisabled !== false,
            limit: context.limit ?? null,
            fetchImpl,
            logger,
          });
        },
        getWorldMembership: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchWorldMembership({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            includeDisabled: context.includeDisabled !== false,
            fetchImpl,
            logger,
          });
        },
        updateWorldMembershipProfile: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return updateWorldMembershipProfile({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            participantContextText: context.participantContextText || null,
            fetchImpl,
            logger,
          });
        },
        leaveWorldMembership: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return leaveWorldMembership({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            agentId: resolvedContext.agentId || null,
            worldId: context.worldId || null,
            fetchImpl,
            logger,
          });
        },
      },
    },
    runtime: {
      protocol,
      inbound,
      outbound,
      results,
      demo,
      productShell: {
        profile: {
          getPublicIdentity: getRuntimePublicIdentity,
          executeAccountAction: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return executeRuntimeAccountAction({
              runtimeConfig: resolvedContext.runtimeConfig,
              agentId: resolvedContext.agentId || null,
              action: context.action || 'view_account',
              displayName: context.displayName || null,
              profile: Object.prototype.hasOwnProperty.call(context, 'profile') ? context.profile : undefined,
              humanProfile: Object.prototype.hasOwnProperty.call(context, 'humanProfile') ? context.humanProfile : undefined,
              agentProfile: Object.prototype.hasOwnProperty.call(context, 'agentProfile') ? context.agentProfile : undefined,
              visibilityMode: Object.prototype.hasOwnProperty.call(context, 'visibilityMode') ? context.visibilityMode : undefined,
              contactPolicy: Object.prototype.hasOwnProperty.call(context, 'contactPolicy') ? context.contactPolicy : undefined,
              proactivitySettings: Object.prototype.hasOwnProperty.call(context, 'proactivitySettings') ? context.proactivitySettings : undefined,
              generateShareCard: context.generateShareCard === true,
              expiresInSeconds: context.expiresInSeconds ?? null,
              shareCardVariant: context.shareCardVariant ?? null,
              fetchImpl,
            });
          },
          updatePublicIdentity: updateRuntimePublicIdentity,
          updateProfile: updateRuntimeProfile,
          generateShareCard: generateRuntimeProfileCard,
        },
        identity: {
          startEmailVerification: startRuntimeEmailVerification,
          completeEmailVerification: completeRuntimeEmailVerification,
          getIdentityStatus: getRuntimeIdentityStatus,
        },
        fetchWorldDirectory: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchPostSetupWorldDirectory({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            limit: context.limit ?? null,
            sort: context.sort || null,
            page: context.page ?? null,
            fetchImpl,
            logger,
          });
        },
        buildWorldSelectionPrompt,
        fetchWorldDetail: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return fetchWorldDetail({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldId: context.worldId || null,
            fetchImpl,
            logger,
          });
        },
        searchWorlds: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return searchWorlds({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            query: context.query ?? context.queryText ?? null,
            limit: context.limit ?? null,
            sort: context.sort || null,
            page: context.page ?? null,
            fetchImpl,
            logger,
          });
        },
        search: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return search({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            scope: context.scope || 'mixed',
            worldId: context.worldId || null,
            agentId: resolvedContext.agentId || null,
            query: context.query ?? context.queryText ?? null,
            keywords: context.keywords || [],
            topics: context.topics || [],
            location: context.location || null,
            timeWindow: context.timeWindow || null,
            intent: context.intent || null,
            desiredInteraction: context.desiredInteraction || null,
            constraints: context.constraints || [],
            limit: context.limit ?? null,
            sort: context.sort || null,
            page: context.page ?? null,
            fetchImpl,
            logger,
          });
        },
        joinWorld: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return joinWorld({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldId: context.worldId || null,
            agentId: resolvedContext.agentId || null,
            participantContextText: context.participantContextText || null,
            fetchImpl,
            logger,
          });
        },
        searchWorldMembers: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return searchWorldMembers({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldId: context.worldId || null,
            agentId: resolvedContext.agentId || null,
            query: context.query ?? context.queryText ?? null,
            keywords: context.keywords || [],
            topics: context.topics || [],
            location: context.location || null,
            timeWindow: context.timeWindow || null,
            intent: context.intent || null,
            desiredInteraction: context.desiredInteraction || null,
            constraints: context.constraints || [],
            sort: context.sort || null,
            limit: context.limit ?? null,
            fetchImpl,
            logger,
          });
        },
        resolveWorldSelection,
        resolveWorldSelectionFlow: async (context = {}) => {
          const resolvedContext = await resolveBoundRuntimeContext(context);
          return resolveWorldSelectionFlow({
            cfg: resolvedContext.cfg || {},
            accountId: resolvedContext.accountId || null,
            runtimeConfig: resolvedContext.runtimeConfig || null,
            worldDirectory: context.worldDirectory || null,
            selection: context.selection ?? context.userChoice ?? null,
            profile: context.profile || {},
            fetchImpl,
            logger,
          });
        },
        publicProfiles: {
          getPublicProfile: async (context = {}) => {
            const targetAgentId = normalizeClaworldText(
              context.targetAgentId,
              normalizeClaworldText(context.profileAgentId, normalizeClaworldText(context.agentId, null)),
            );
            const runtimeContext = { ...context };
            delete runtimeContext.agentId;
            delete runtimeContext.targetAgentId;
            delete runtimeContext.profileAgentId;
            const resolvedContext = await resolveBoundRuntimeContext(runtimeContext);
            return getPublicProfile({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: targetAgentId || resolvedContext.agentId || null,
              viewerAgentId: resolvedContext.agentId || null,
              fetchImpl,
              logger,
            });
          },
          lookupPublicProfile: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return lookupPublicProfile({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              identity: context.identity || null,
              viewerAgentId: resolvedContext.agentId || null,
              fetchImpl,
              logger,
            });
          },
        },
        subscriptions: {
          listSubscriptions: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchRuntimeSubscriptions({
              runtimeConfig: resolvedContext.runtimeConfig,
              agentId: resolvedContext.agentId || null,
              targetType: context.targetType || null,
              status: context.status || 'active',
              fetchImpl,
            });
          },
          createSubscription: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return createRuntimeSubscription({
              runtimeConfig: resolvedContext.runtimeConfig,
              agentId: resolvedContext.agentId || null,
              targetType: context.targetType || null,
              targetId: context.targetId || null,
              broadcastEnabled: context.broadcastEnabled !== false,
              fetchImpl,
            });
          },
          deleteSubscription: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return deleteRuntimeSubscription({
              runtimeConfig: resolvedContext.runtimeConfig,
              agentId: resolvedContext.agentId || null,
              subscriptionId: context.subscriptionId || null,
              targetType: context.targetType || null,
              targetId: context.targetId || null,
              fetchImpl,
            });
          },
        },
        activity: {
          listWorldActivity: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchRuntimeWorldActivity({
              runtimeConfig: resolvedContext.runtimeConfig,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              limit: context.limit ?? null,
              fetchImpl,
            });
          },
        },
        feedback: {
          submitFeedback: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return submitFeedbackReport({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              runtime: resolvedContext.runtime || null,
              agentId: resolvedContext.agentId || null,
              category: context.category || null,
              title: context.title || null,
              goal: context.goal || null,
              actualBehavior: context.actualBehavior || null,
              expectedBehavior: context.expectedBehavior || null,
              impact: context.impact || null,
              details: context.details || null,
              reproductionSteps: context.reproductionSteps || [],
              context: context.context || {},
              fetchImpl,
              logger,
              toolCallId: context.toolCallId || null,
              pluginVersion: context.pluginVersion || null,
              toolContractVersion: context.toolContractVersion || null,
            });
          },
        },
        moderation: {
          createWorld: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return createModeratedWorld({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              displayName: context.displayName || null,
              worldContextText: context.worldContextText || null,
              participantContextText: context.participantContextText || null,
              enabled: typeof context.enabled === 'boolean' ? context.enabled : true,
              visibility: context.visibility || null,
              identityMode: context.identityMode || null,
              joinPolicy: context.joinPolicy || null,
              approvalPolicy: context.approvalPolicy || null,
              fetchImpl,
              logger,
            });
          },
          listOwnedWorlds: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchOwnedWorlds({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              includeDisabled: context.includeDisabled !== false,
              fetchImpl,
              logger,
            });
          },
          broadcastWorld: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return broadcastModeratedWorld({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              announcementText: context.announcementText || null,
              audience: context.audience || null,
              excludeSelf: Object.prototype.hasOwnProperty.call(context, 'excludeSelf') ? context.excludeSelf : null,
              fetchImpl,
              logger,
            });
          },
          manageWorld: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return manageModeratedWorld({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              mode: context.mode || 'get',
              changes: context.changes || null,
              enabled: Object.prototype.hasOwnProperty.call(context, 'enabled') ? context.enabled : null,
              status: context.status || null,
              fetchImpl,
              logger,
            });
          },
          inviteMember: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return inviteModeratedWorldMember({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              targetAgentId: context.targetAgentId || null,
              identity: context.identity || null,
              inviteMessage: context.inviteMessage || null,
              fetchImpl,
              logger,
            });
          },
          revokeInvite: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return revokeModeratedWorldInvite({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              targetAgentId: context.targetAgentId || null,
              fetchImpl,
              logger,
            });
          },
          listInvites: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchModeratedWorldInvites({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              status: context.status || 'invited',
              fetchImpl,
              logger,
            });
          },
        },
        membership: {
          listWorldMembers: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchRuntimeWorldMembers({
              runtimeConfig: resolvedContext.runtimeConfig,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              status: context.status || null,
              limit: context.limit ?? null,
              fetchImpl,
            });
          },
          listWorldMemberships: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchWorldMemberships({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              status: context.status || null,
              includeInactive: context.includeInactive === true,
              includeDisabled: context.includeDisabled !== false,
              fetchImpl,
              logger,
            });
          },
          listPendingInvites: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchPendingWorldInvites({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              status: context.status || 'pending',
              includeDisabled: context.includeDisabled !== false,
              limit: context.limit ?? null,
              fetchImpl,
              logger,
            });
          },
          getWorldMembership: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return fetchWorldMembership({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              includeDisabled: context.includeDisabled !== false,
              fetchImpl,
              logger,
            });
          },
          updateWorldMembershipProfile: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return updateWorldMembershipProfile({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              participantContextText: context.participantContextText || null,
              fetchImpl,
              logger,
            });
          },
          leaveWorldMembership: async (context = {}) => {
            const resolvedContext = await resolveBoundRuntimeContext(context);
            return leaveWorldMembership({
              cfg: resolvedContext.cfg || {},
              accountId: resolvedContext.accountId || null,
              runtimeConfig: resolvedContext.runtimeConfig || null,
              agentId: resolvedContext.agentId || null,
              worldId: context.worldId || null,
              fetchImpl,
              logger,
            });
          },
        },
      },
      createRelayClient: (options = {}) => relayClientFactory({ logger, inbound, outbound, protocol, ...options }),
    },
    internals: {
      protocol,
      inbound,
      outbound,
      results,
      demo,
      lifecycles,
      getRelayClient: (accountId = 'default') => relayClients.get(accountId) || null,
    },
    async start(context = {}) {
      return runAccountLifecycle(context);
    },
    async stop(reason) {
      return this.gateway.stop(reason);
    },
    async reconnect(context = {}) {
      return this.gateway.reconnect(context);
    },
    describe() {
      return {
        id: this.id,
        meta: this.meta,
        capabilities: this.capabilities,
        configSchema: this.configSchema,
        runtimePath: inbound.runtimePath,
        lifecycle: this.gateway.snapshot(),
        relayClient: relayClients.get('default')?.snapshot?.() || null,
        status: createStatusSnapshot(),
        readyFor: [
          'plugin manifest validation',
          'config inspection',
          'native channel setup/onboarding',
          'relay websocket adapter tests',
          'manual relay-agent binding',
          'minimal outbound conversation send',
        ],
        notImplemented: [
          '真实 OpenClaw sdk import/types 对齐',
          'ack/retry persistence',
          'console + demo wiring',
        ],
      };
    },
  };
}

export const claworldChannelPluginScaffold = createClaworldChannelPlugin;
export { normalizeRelayHttpBaseUrl };
