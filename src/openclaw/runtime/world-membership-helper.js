import { resolveClaworldRuntimeConfig } from '../plugin/config-schema.js';
import { buildRuntimeAuthHeaders } from '../plugin/account-identity.js';
import { createRuntimeBoundaryError } from '../../lib/runtime-errors.js';
import { extractBackendErrorContext } from './backend-error-context.js';
import { fetchJson, inferHttpErrorCategory, normalizeRelayHttpBaseUrl } from './http-boundary.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
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

function normalizeWorldRole(worldRole, fallback = null) {
  const normalized = normalizeText(worldRole, fallback);
  return ['owner', 'member'].includes(normalized) ? normalized : fallback;
}

function normalizeManagedWorldMembership(payload = {}) {
  return {
    membershipId: normalizeText(payload.membershipId, null),
    worldId: normalizeText(payload.worldId, null),
    displayName: normalizeText(payload.displayName, null),
    worldContextText: normalizeText(payload.worldContextText, null),
    ownerAgentId: normalizeText(payload.ownerAgentId, null),
    enabled: normalizeOptionalBoolean(payload.enabled, null),
    worldStatus: normalizeText(payload.worldStatus, null),
    worldRole: normalizeWorldRole(payload.worldRole, null),
    membershipStatus: normalizeText(payload.membershipStatus, null),
    participantContextText: normalizeText(payload.participantContextText, null),
    joinedAt: normalizeText(payload.joinedAt, null),
    updatedAt: normalizeText(payload.updatedAt, null),
    nextAction: normalizeText(payload.nextAction, null),
  };
}

function normalizePendingInviteAction(action = null) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  return {
    action: normalizeText(action.action, null),
    tool: normalizeText(action.tool, null),
    worldId: normalizeText(action.worldId, null),
    requiredFields: normalizeStringList(action.requiredFields),
  };
}

function normalizeParticipantContextField(field = null) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
  return {
    fieldId: normalizeText(field.fieldId, null),
    label: normalizeText(field.label, null),
    description: normalizeText(field.description, null),
  };
}

function normalizeJoinPlan(plan = null) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  return {
    worldId: normalizeText(plan.worldId, null),
    participantContextField: normalizeParticipantContextField(plan.participantContextField),
    nextAction: normalizeText(plan.nextAction, null),
  };
}

function normalizeInviterProfile(inviter = null) {
  if (!inviter || typeof inviter !== 'object' || Array.isArray(inviter)) return null;
  return {
    agentId: normalizeText(inviter.agentId, null),
    displayName: normalizeText(inviter.displayName, null),
    publicIdentity: normalizeText(inviter.publicIdentity, null),
    profile: normalizeText(inviter.profile, null),
  };
}

function normalizeInviteLifecycle(lifecycle = null) {
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) return null;
  return {
    status: normalizeText(lifecycle.status, null),
    expiresAt: normalizeText(lifecycle.expiresAt, null),
    expirationPolicy: normalizeText(lifecycle.expirationPolicy, null),
    acceptedAt: normalizeText(lifecycle.acceptedAt, null),
    inviteRevokedAt: normalizeText(lifecycle.inviteRevokedAt, null),
  };
}

function normalizePendingWorldInvite(payload = {}) {
  return {
    invitationId: normalizeText(payload.invitationId, null),
    membershipId: normalizeText(payload.membershipId, null),
    agentId: normalizeText(payload.agentId, null),
    worldId: normalizeText(payload.worldId, null),
    displayName: normalizeText(payload.displayName, null),
    worldContextText: normalizeText(payload.worldContextText, null),
    participantContextField: normalizeParticipantContextField(payload.participantContextField),
    joinPlan: normalizeJoinPlan(payload.joinPlan),
    membershipStatus: normalizeText(payload.membershipStatus, null),
    status: normalizeText(payload.status, null),
    invitedByAgentId: normalizeText(payload.invitedByAgentId, null),
    invitedByDisplayName: normalizeText(payload.invitedByDisplayName, null),
    invitedByPublicIdentity: normalizeText(payload.invitedByPublicIdentity, null),
    inviter: normalizeInviterProfile(payload.inviter),
    invitedAt: normalizeText(payload.invitedAt, null),
    inviteMessage: normalizeText(payload.inviteMessage, null),
    expiresAt: normalizeText(payload.expiresAt, null),
    expirationPolicy: normalizeText(payload.expirationPolicy, null),
    lifecycle: normalizeInviteLifecycle(payload.lifecycle),
    membershipUpdatedAt: normalizeText(payload.membershipUpdatedAt, null),
    worldUpdatedAt: normalizeText(payload.worldUpdatedAt, null),
    nextAction: normalizeText(payload.nextAction, null),
    nextActions: Array.isArray(payload.nextActions)
      ? payload.nextActions.map((action) => normalizePendingInviteAction(action)).filter(Boolean)
      : [],
  };
}

function normalizePendingWorldInviteList(payload = {}) {
  return {
    agentId: normalizeText(payload.agentId, null),
    status: normalizeText(payload.status, null),
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => normalizePendingWorldInvite(item))
      : [],
    totalItems: normalizeOptionalInteger(payload.totalItems, 0),
    nextAction: normalizeText(payload.nextAction, null),
  };
}

function normalizeMembershipList(payload = {}) {
  return {
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => normalizeManagedWorldMembership(item))
      : [],
    nextAction: normalizeText(payload.nextAction, null),
  };
}

function createWorldMembershipHttpError(action, response, { accountId = null, worldId = null } = {}) {
  const backendCode = normalizeText(response?.body?.error, null);
  const backendMessage = normalizeText(response?.body?.message, `claworld world membership ${action} failed`);

  return createRuntimeBoundaryError({
    code: backendCode || `claworld_world_membership_${action}_failed`,
    category: inferHttpErrorCategory(response?.status),
    status: response?.status ?? 500,
    message: `claworld world membership ${action} failed: ${response?.status ?? 500}`,
    publicMessage: backendMessage,
    recoverable: Number(response?.status) >= 400 && Number(response?.status) < 500,
    context: {
      action: `world_membership_${action}`,
      accountId,
      ...(worldId ? { worldId } : {}),
      httpStatus: response?.status ?? 500,
      ...extractBackendErrorContext(response?.body),
    },
  });
}

export async function fetchWorldMemberships({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  status = null,
  includeInactive = false,
  includeDisabled = true,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world membership helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world membership helper requires agentId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/world-memberships`);
  requestUrl.searchParams.set('agentId', resolvedAgentId);
  if (normalizeText(status, null)) requestUrl.searchParams.set('status', normalizeText(status, null));
  if (includeInactive) requestUrl.searchParams.set('includeInactive', 'true');
  requestUrl.searchParams.set('includeDisabled', includeDisabled ? 'true' : 'false');
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:membership] world memberships fetch failed', {
      status: result.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createWorldMembershipHttpError('list', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }

  return normalizeMembershipList(result.body);
}

export async function fetchPendingWorldInvites({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  status = 'pending',
  includeDisabled = true,
  limit = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world membership helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world membership helper requires agentId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/world-invitations`);
  requestUrl.searchParams.set('agentId', resolvedAgentId);
  requestUrl.searchParams.set('status', normalizeText(status, 'pending'));
  requestUrl.searchParams.set('includeDisabled', includeDisabled ? 'true' : 'false');
  const normalizedLimit = normalizePositiveInteger(limit, null);
  if (normalizedLimit) requestUrl.searchParams.set('limit', String(normalizedLimit));
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:membership] pending world invites fetch failed', {
      status: result.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createWorldMembershipHttpError('list_pending_invites', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }

  return normalizePendingWorldInviteList(result.body);
}

export async function fetchWorldMembership({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  includeDisabled = true,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world membership helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world membership helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world membership helper requires worldId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}/membership`);
  requestUrl.searchParams.set('agentId', resolvedAgentId);
  requestUrl.searchParams.set('includeDisabled', includeDisabled ? 'true' : 'false');
  const result = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:membership] world membership fetch failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createWorldMembershipHttpError('get', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeManagedWorldMembership(result.body);
}

export async function updateWorldMembershipProfile({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  participantContextText = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world membership helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world membership helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world membership helper requires worldId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}/membership`, {
    method: 'PATCH',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      participantContextText: normalizeText(participantContextText, null),
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:membership] world membership profile update failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createWorldMembershipHttpError('update_profile', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeManagedWorldMembership(result.body);
}

export async function leaveWorldMembership({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  worldId = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld world membership helper');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld world membership helper requires agentId');
  }
  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld world membership helper requires worldId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}/membership/leave`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:membership] world membership leave failed', {
      status: result.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw createWorldMembershipHttpError('leave', result, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeManagedWorldMembership(result.body);
}
