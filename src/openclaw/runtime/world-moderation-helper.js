import { resolveClaworldRuntimeConfig } from '../plugin/config-schema.js';
import { buildRuntimeAuthHeaders } from '../plugin/account-identity.js';
import { createRuntimeBoundaryError } from '../../lib/runtime-errors.js';
import { extractBackendErrorContext } from './backend-error-context.js';
import { fetchJson, inferHttpErrorCategory, normalizeRelayHttpBaseUrl } from './http-boundary.js';
import { normalizeWorldJoinResponse } from './product-shell-helper.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeOptionalBoolean(value, fallback = null) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeOptionalInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function normalizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeText(value, null)).filter(Boolean))];
}

function normalizeParticipantContextField(field = {}, index = 0) {
  return {
    fieldId: normalizeText(field.fieldId, `field_${index + 1}`),
    label: normalizeText(field.label, `Field ${index + 1}`),
    type: normalizeText(field.type, 'string'),
    required: typeof field.required === 'boolean' ? field.required : null,
    searchable: typeof field.searchable === 'boolean' ? field.searchable : null,
    description: normalizeText(field.description, null),
    examples: normalizeStringList(field.examples),
  };
}

function normalizeParticipantContextFieldPayload(field = null) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
  return normalizeParticipantContextField(field);
}

function normalizeWorldStats(stats = null) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  return {
    totalParticipants: normalizeOptionalInteger(stats.totalParticipants, null),
    activeParticipants: normalizeOptionalInteger(stats.activeParticipants, null),
    totalConversationCount: normalizeOptionalInteger(stats.totalConversationCount, null),
  };
}

function normalizeWorldRole(worldRole, fallback = null) {
  const normalized = normalizeText(worldRole, fallback);
  return ['owner', 'member'].includes(normalized) ? normalized : fallback;
}

function normalizeBroadcastAudience(value, fallback = 'members') {
  const normalized = normalizeText(value, fallback);
  if (normalized === 'admins') return 'admins';
  if (normalized === 'admins_and_owner') return 'admins_and_owner';
  return 'members';
}

function normalizeBroadcastReplyPolicy(value, fallback = 'zero') {
  const normalized = normalizeText(value, fallback);
  if (normalized === 'at_most_one') return 'at_most_one';
  return 'zero';
}

function normalizeWorldBroadcastConfig(broadcast = null) {
  if (!broadcast || typeof broadcast !== 'object' || Array.isArray(broadcast)) return null;
  return {
    enabled: normalizeOptionalBoolean(broadcast.enabled, null),
    audience: normalizeBroadcastAudience(broadcast.audience, 'members'),
    replyPolicy: normalizeBroadcastReplyPolicy(broadcast.replyPolicy, 'zero'),
    excludeSelf: normalizeOptionalBoolean(broadcast.excludeSelf, null),
  };
}

function normalizeWorldInvite(payload = {}) {
  return {
    status: normalizeText(payload.status, null),
    worldId: normalizeText(payload.worldId, null),
    displayName: normalizeText(payload.displayName, null),
    targetAgentId: normalizeText(payload.targetAgentId, null),
    targetIdentity: normalizeText(payload.targetIdentity, null),
    invitedByAgentId: normalizeText(payload.invitedByAgentId, null),
    membershipId: normalizeText(payload.membershipId, null),
    membershipStatus: normalizeText(payload.membershipStatus, null),
    created: normalizeOptionalBoolean(payload.created, null),
    invitedAt: normalizeText(payload.invitedAt, null),
    inviteMessage: normalizeText(payload.inviteMessage, null),
    inviteRevokedAt: normalizeText(payload.inviteRevokedAt, null),
    notificationId: normalizeText(payload.notificationId, null),
    nextAction: normalizeText(payload.nextAction, null),
  };
}

function normalizeWorldInviteList(payload = {}) {
  return {
    worldId: normalizeText(payload.worldId, null),
    items: Array.isArray(payload.items) ? payload.items.map((item) => normalizeWorldInvite(item)) : [],
    totalItems: normalizeOptionalInteger(payload.totalItems, 0),
    nextAction: normalizeText(payload.nextAction, null),
  };
}

function normalizeManagedWorld(payload = {}) {
  return {
    worldId: normalizeText(payload.worldId, null),
    displayName: normalizeText(payload.displayName, null),
    worldContextText: normalizeText(payload.worldContextText, null),
    ownerAgentId: normalizeText(payload.ownerAgentId, null),
    enabled: normalizeOptionalBoolean(payload.enabled, null),
    status: normalizeText(payload.status, null),
    worldRole: normalizeWorldRole(payload.worldRole, null),
    visibility: normalizeText(payload.visibility, 'public'),
    identityMode: normalizeText(payload.identityMode, 'imaginary'),
    joinPolicy: normalizeText(payload.joinPolicy, 'open'),
    approvalPolicy: normalizeText(payload.approvalPolicy, 'auto'),
    schemaVersion: normalizeOptionalInteger(payload.schemaVersion, null),
    createdAt: normalizeText(payload.createdAt, null),
    updatedAt: normalizeText(payload.updatedAt, null),
    participantContextField: normalizeParticipantContextFieldPayload(payload.participantContextField),
    broadcast: normalizeWorldBroadcastConfig(payload.broadcast),
    stats: normalizeWorldStats(payload.stats),
  };
}

function normalizeCreatedWorld(payload = {}) {
  const world = normalizeManagedWorld(payload);
  return {
    ...world,
    ownerJoin:
      payload.ownerJoin && typeof payload.ownerJoin === 'object'
        ? normalizeWorldJoinResponse(payload.ownerJoin, {
          worldId: world.worldId,
          agentId: world.ownerAgentId,
        })
        : null,
  };
}

function normalizeOwnedWorldSummary(payload = {}) {
  return {
    worldId: normalizeText(payload.worldId, null),
    displayName: normalizeText(payload.displayName, null),
    worldContextText: normalizeText(payload.worldContextText, null),
    ownerAgentId: normalizeText(payload.ownerAgentId, null),
    enabled: normalizeOptionalBoolean(payload.enabled, null),
    status: normalizeText(payload.status, null),
    worldRole: normalizeWorldRole(payload.worldRole, null),
    visibility: normalizeText(payload.visibility, 'public'),
    identityMode: normalizeText(payload.identityMode, 'imaginary'),
    joinPolicy: normalizeText(payload.joinPolicy, 'open'),
    approvalPolicy: normalizeText(payload.approvalPolicy, 'auto'),
    createdAt: normalizeText(payload.createdAt, null),
    updatedAt: normalizeText(payload.updatedAt, null),
    broadcast: normalizeWorldBroadcastConfig(payload.broadcast),
    stats: normalizeWorldStats(payload.stats),
  };
}

function normalizeWorldBroadcastRequestItem(item = {}) {
  return {
    agentId: normalizeText(item.agentId, null),
    status: normalizeText(item.status, null),
    verdict: normalizeText(item.verdict, null),
    chatRequest: item.chatRequest && typeof item.chatRequest === 'object' && !Array.isArray(item.chatRequest)
      ? item.chatRequest
      : null,
    kickoff: item.kickoff && typeof item.kickoff === 'object' && !Array.isArray(item.kickoff)
      ? item.kickoff
      : null,
  };
}

function normalizeWorldBroadcastFailureItem(item = {}) {
  return {
    agentId: normalizeText(item.agentId, null),
    status: normalizeText(item.status, 'failed'),
    httpStatus: normalizeOptionalInteger(item.httpStatus, null),
    error: normalizeText(item.error, null),
    reason: normalizeText(item.reason, null),
    message: normalizeText(item.message, null),
  };
}

function normalizeWorldBroadcastResponse(payload = {}) {
  return {
    accepted: payload.accepted === true,
    status: normalizeText(payload.status, null),
    commandId: normalizeText(payload.commandId, null),
    command: payload.command && typeof payload.command === 'object' && !Array.isArray(payload.command)
      ? payload.command
      : null,
    worldId: normalizeText(payload.worldId, null),
    senderAgentId: normalizeText(payload.senderAgentId, null),
    senderRole: normalizeWorldRole(payload.senderRole, null),
    audience: normalizeBroadcastAudience(payload.audience, 'members'),
    excludeSelf: normalizeOptionalBoolean(payload.excludeSelf, null),
    eligibility: normalizeText(payload.eligibility, null),
    broadcastId: normalizeText(payload.broadcastId, null),
    fanoutStatus: normalizeText(payload.fanoutStatus, null),
    totalTargets: normalizeOptionalInteger(payload.totalTargets, null),
    createdCount: normalizeOptionalInteger(payload.createdCount, null),
    failedCount: normalizeOptionalInteger(payload.failedCount, null),
    pendingCount: normalizeOptionalInteger(payload.pendingCount, null),
    autoAcceptedCount: normalizeOptionalInteger(payload.autoAcceptedCount, null),
    rejectedCount: normalizeOptionalInteger(payload.rejectedCount, null),
    nextAction: normalizeText(payload.nextAction, null),
    requests: Array.isArray(payload.requests)
      ? payload.requests.map((item) => normalizeWorldBroadcastRequestItem(item))
      : [],
    failures: Array.isArray(payload.failures)
      ? payload.failures.map((item) => normalizeWorldBroadcastFailureItem(item))
      : [],
  };
}

function createModerationHttpError(action, response, { accountId = null, worldId = null } = {}) {
  const backendCode = normalizeText(response?.body?.error, null);
  const backendMessage = normalizeText(response?.body?.message, `claworld world ${action} failed`);

  return createRuntimeBoundaryError({
    code: backendCode || `claworld_world_${action}_failed`,
    category: inferHttpErrorCategory(response?.status),
    status: response?.status ?? 500,
    message: `claworld world ${action} failed: ${response?.status ?? 500}`,
    publicMessage: backendMessage,
    recoverable: Number(response?.status) >= 400 && Number(response?.status) < 500,
    context: {
      action: `world_${action}`,
      accountId,
      ...(worldId ? { worldId } : {}),
      httpStatus: response?.status ?? 500,
      ...extractBackendErrorContext(response?.body),
    },
  });
}

export async function createModeratedWorld({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  displayName = null,
  worldContextText = null,
  participantContextText = null,
  enabled = true,
  visibility = null,
  identityMode = null,
  joinPolicy = null,
  approvalPolicy = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world creation helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world creation helper requires agentId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const created = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      displayName,
      worldContextText,
      participantContextText: normalizeText(participantContextText, null),
      enabled,
      ...(normalizeText(visibility, null) ? { visibility: normalizeText(visibility, null) } : {}),
      ...(normalizeText(identityMode, null) ? { identityMode: normalizeText(identityMode, null) } : {}),
      ...(normalizeText(joinPolicy, null) ? { joinPolicy: normalizeText(joinPolicy, null) } : {}),
      ...(normalizeText(approvalPolicy, null) ? { approvalPolicy: normalizeText(approvalPolicy, null) } : {}),
    }),
  });

  if (!created.ok) {
    logger.error?.('[claworld:moderation] world create failed', {
      status: created.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: created.body,
    });
    throw createModerationHttpError('create', created, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }

  return normalizeCreatedWorld(created.body);
}

export async function fetchOwnedWorlds({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  includeDisabled = true,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld owned-worlds helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld owned-worlds helper requires agentId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/moderation/worlds`);
  requestUrl.searchParams.set('agentId', resolvedAgentId);
  requestUrl.searchParams.set('includeDisabled', includeDisabled ? 'true' : 'false');
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:moderation] managed worlds fetch failed', {
      status: result.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createModerationHttpError('list', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }

  return {
    items: Array.isArray(result.body?.items) ? result.body.items.map((item) => normalizeOwnedWorldSummary(item)) : [],
  };
}

export async function manageModeratedWorld({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  mode = 'get',
  changes = null,
  enabled = null,
  status = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world management helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world management helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world management helper requires worldId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);

  if (normalizeText(mode, 'get') === 'get') {
    const requestUrl = new URL(`${baseUrl}/v1/moderation/worlds/${encodeURIComponent(resolvedWorldId)}`);
    requestUrl.searchParams.set('agentId', resolvedAgentId);
    const result = await fetchJson(fetchImpl, requestUrl.toString(), {
      headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
        accept: 'application/json',
        ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
      }),
    });

    if (!result.ok) {
      logger.error?.('[claworld:moderation] managed world fetch failed', {
        status: result.status,
        worldId: resolvedWorldId,
        accountId: resolvedRuntimeConfig.accountId || accountId || null,
        body: result.body,
      });
      throw createModerationHttpError('get', result, {
        accountId: resolvedRuntimeConfig.accountId || accountId || null,
        worldId: resolvedWorldId,
      });
    }

    return normalizeManagedWorld(result.body);
  }

  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/moderation/worlds/${encodeURIComponent(resolvedWorldId)}`, {
    method: 'PATCH',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      ...(changes && typeof changes === 'object' ? { changes } : {}),
      ...(enabled == null ? {} : { enabled }),
      ...(normalizeText(status, null) ? { status: normalizeText(status, null) } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:moderation] managed world update failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createModerationHttpError('update', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeManagedWorld(result.body);
}

export async function inviteModeratedWorldMember({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  targetAgentId = null,
  identity = null,
  inviteMessage = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world invite helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world invite helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world invite helper requires worldId');
  }
  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/moderation/worlds/${encodeURIComponent(resolvedWorldId)}/invitations`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      ...(normalizeText(targetAgentId, null) ? { targetAgentId: normalizeText(targetAgentId, null) } : {}),
      ...(normalizeText(identity, null) ? { identity: normalizeText(identity, null) } : {}),
      ...(normalizeText(inviteMessage, null) ? { inviteMessage: normalizeText(inviteMessage, null) } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:moderation] world invite failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createModerationHttpError('invite_member', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldInvite(result.body);
}

export async function revokeModeratedWorldInvite({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  targetAgentId = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world invite revoke helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world invite revoke helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world invite revoke helper requires worldId');
  }
  const resolvedTargetAgentId = normalizeText(targetAgentId, null);
  if (!resolvedTargetAgentId) {
    throw new Error('claworld world invite revoke helper requires targetAgentId');
  }
  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/moderation/worlds/${encodeURIComponent(resolvedWorldId)}/invitations/revoke`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      targetAgentId: resolvedTargetAgentId,
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:moderation] world invite revoke failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createModerationHttpError('revoke_invite', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldInvite(result.body);
}

export async function fetchModeratedWorldInvites({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  status = 'invited',
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world invites helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world invites helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world invites helper requires worldId');
  }
  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/moderation/worlds/${encodeURIComponent(resolvedWorldId)}/invitations`);
  requestUrl.searchParams.set('agentId', resolvedAgentId);
  if (normalizeText(status, null)) requestUrl.searchParams.set('status', normalizeText(status, null));
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:moderation] world invites fetch failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createModerationHttpError('list_invites', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldInviteList(result.body);
}

export async function broadcastModeratedWorld({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  announcementText = null,
  audience = null,
  excludeSelf = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world broadcast helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world broadcast helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world broadcast helper requires worldId');
  }
  const resolvedAnnouncementText = normalizeText(announcementText, null);
  if (!resolvedAnnouncementText) {
    throw new Error('claworld world broadcast helper requires announcementText');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}/broadcast`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      payload: {
        text: resolvedAnnouncementText,
      },
      ...(normalizeText(audience, null) ? { audience: normalizeText(audience, null) } : {}),
      ...(typeof excludeSelf === 'boolean' ? { excludeSelf } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:moderation] world broadcast failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createModerationHttpError('broadcast', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldBroadcastResponse({
    ...result.body,
    worldId: resolvedWorldId,
    senderAgentId: resolvedAgentId,
  });
}
