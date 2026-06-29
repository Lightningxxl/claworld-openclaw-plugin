import { resolveClaworldRuntimeConfig } from '../plugin/config-schema.js';
import { buildRuntimeAuthHeaders } from '../plugin/account-identity.js';
import { createRuntimeBoundaryError } from '../../lib/runtime-errors.js';
import { extractBackendErrorContext } from './backend-error-context.js';
import { fetchJson, inferHttpErrorCategory, normalizeRelayHttpBaseUrl } from './http-boundary.js';
import {
  buildWorldSelectionPrompt as buildBackendWorldSelectionPrompt,
  resolveWorldSelection as resolveBackendWorldSelection,
} from '../../product-shell/contracts/world-orchestration.js';

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

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeText(value, null)).filter(Boolean))];
}

function normalizeWorldRole(worldRole, fallback = null) {
  const normalized = normalizeText(worldRole, fallback);
  return ['owner', 'member'].includes(normalized) ? normalized : fallback;
}

function sentenceCase(value, fallback = '') {
  const normalized = normalizeText(value, fallback);
  if (!normalized) return fallback;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function quoteExample(example) {
  return `"${String(example).trim()}"`;
}

function joinAsNaturalLanguage(values = []) {
  const items = values.filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function normalizeWorldSummary(world = {}) {
  const summary = world.agentSummary && typeof world.agentSummary === 'object' ? world.agentSummary : world;
  const rawWorldId = world.worldId || summary.worldId;

  return {
    worldId: normalizeText(rawWorldId, 'unknown-world'),
    displayName: normalizeText(summary.displayName || world.displayName, normalizeText(rawWorldId, 'Unknown World')),
    summary: normalizeText(summary.summary || world.summary, null),
    worldContextText: normalizeText(summary.worldContextText || world.worldContextText, ''),
    hotness: normalizeInteger(summary.hotness || world.hotness || world.activatedMemberCount, 0),
    activatedMemberCount: normalizeInteger(summary.activatedMemberCount || world.activatedMemberCount || summary.hotness || world.hotness, 0),
    tags: normalizeStringList(summary.tags || world.tags),
    matchScore: normalizeInteger(summary.matchScore || world.matchScore, 0),
    matchedFieldIds: normalizeStringList(summary.matchedFieldIds || world.matchedFieldIds),
    matchedTerms: normalizeStringList(summary.matchedTerms || world.matchedTerms),
    reasonSummary: normalizeText(summary.reasonSummary || world.reasonSummary, null),
    requiredFieldCount: normalizeInteger(summary.requiredFieldCount || world.requiredFieldCount, 0),
    detailAction: world.detailAction && typeof world.detailAction === 'object' ? world.detailAction : null,
    joinAction: world.joinAction && typeof world.joinAction === 'object' ? world.joinAction : null,
  };
}

function normalizeField(field = {}, index = 0, { required = false } = {}) {
  const fieldId = normalizeText(field.fieldId || field.id, `field_${index + 1}`);
  return {
    fieldId,
    label: normalizeText(field.label, fieldId),
    type: normalizeText(field.type, 'string'),
    source: normalizeText(field.source, 'profile'),
    required: field.required === true || required,
    description: normalizeText(field.description, null),
    examples: normalizeStringList(field.examples),
    constraints: field.constraints && typeof field.constraints === 'object' ? field.constraints : {},
  };
}

function buildParticipantContextField(field = null) {
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    return normalizeField(field, 0, { required: true });
  }
  return normalizeField({
    fieldId: 'participantContextText',
    label: 'Entry Profile',
    type: 'string',
    source: 'membership',
    required: true,
    description: 'A short text describing who you are in this world and what context you bring into it.',
    examples: [],
    constraints: {},
  }, 0, { required: true });
}

function normalizeSearchSchema(payload = {}, { worldId = null, fallbackFields = [] } = {}) {
  const rawInputFields = Array.isArray(payload.inputFields) && payload.inputFields.length > 0
    ? payload.inputFields
    : fallbackFields;
  const inputFields = rawInputFields.map((field, index) => normalizeField(field, index, { required: false }));
  const inputFieldIds = normalizeStringList(
    Array.isArray(payload.inputFieldIds)
      ? payload.inputFieldIds
      : inputFields.map((field) => field.fieldId),
  );

  return {
    modelId: normalizeText(payload.modelId, worldId ? `${worldId}.search.v1` : 'world.search.v1'),
    worldId: normalizeText(payload.worldId, worldId || 'unknown-world'),
    mode: normalizeText(payload.mode, 'membership_profile_search'),
    previewRoute: normalizeText(payload.previewRoute, worldId ? `/v1/worlds/${worldId}/search` : '/v1/worlds/:worldId/search'),
    inputFieldIds,
    inputFields,
    resultFields: normalizeStringList(payload.resultFields),
    viewerRequirement: normalizeText(payload.viewerRequirement, 'active_membership'),
    onlineOnly: payload.onlineOnly !== false,
    defaultLimit: normalizeInteger(payload.defaultLimit, 10),
    summary: normalizeText(payload.summary, ''),
    hints: normalizeStringList(payload.hints),
    status: normalizeText(payload.status, 'phase1_world_search'),
  };
}

function normalizeWorldDetail(payload = {}) {
  if (Array.isArray(payload.requiredFields) || Array.isArray(payload.optionalFields)) {
    const requiredFields = Array.isArray(payload.requiredFields)
      ? payload.requiredFields.map((field, index) => normalizeField(field, index, { required: true }))
      : [];
    const optionalFields = Array.isArray(payload.optionalFields)
      ? payload.optionalFields.map((field, index) => normalizeField(field, index, { required: false }))
      : [];
    const normalizedWorldId = normalizeText(payload.worldId, 'unknown-world');

    return {
      status: normalizeText(payload.status, 'ready'),
      source: normalizeText(payload.source, 'product_shell'),
      worldId: normalizedWorldId,
      displayName: normalizeText(payload.displayName, normalizedWorldId),
      worldContextText: normalizeText(payload.worldContextText, ''),
      ownerAgentId: normalizeText(payload.ownerAgentId, null),
      worldRole: normalizeWorldRole(payload.worldRole, null),
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : null,
      broadcast: normalizeBroadcastConfig(payload.broadcast),
      requiredFieldCount: normalizeInteger(payload.requiredFieldCount, requiredFields.length) || requiredFields.length,
      optionalFieldCount: normalizeInteger(payload.optionalFieldCount, optionalFields.length) || optionalFields.length,
      requiredFields,
      optionalFields,
      hints: normalizeStringList(payload.hints),
      nextAction: normalizeText(payload.nextAction, 'call_join_world'),
      searchSchema: normalizeSearchSchema(payload.searchSchema || {}, {
        worldId: normalizedWorldId,
        fallbackFields: requiredFields,
      }),
    };
  }

  const world = payload.world && typeof payload.world === 'object' ? payload.world : {};
  const management = payload.management && typeof payload.management === 'object' ? payload.management : {};
  const joinSchema = payload.joinSchema && typeof payload.joinSchema === 'object' ? payload.joinSchema : {};
  const fieldGuide = payload.fieldGuide && typeof payload.fieldGuide === 'object' ? payload.fieldGuide : {};
  const searchOverview = payload.searchSchema && typeof payload.searchSchema === 'object'
    ? payload.searchSchema
    : {};
  const participantContextField = buildParticipantContextField(
    payload.participantContextField
      || (Array.isArray(fieldGuide.required) ? fieldGuide.required[0] : null)
      || (Array.isArray(joinSchema.requiredFields) ? joinSchema.requiredFields[0] : null),
  );

  const requiredFields = [participantContextField];
  const optionalFields = [];
  const worldId = normalizeText(world.worldId || joinSchema.worldId, 'unknown-world');
  const displayName = normalizeText(world.displayName, worldId);

  return {
    status: 'ready',
    source: 'product_shell',
    worldId,
    displayName,
    worldContextText: normalizeText(world.worldContextText || payload.worldContextText, ''),
    ownerAgentId: normalizeText(management.ownerAgentId, null),
    worldRole: normalizeWorldRole(payload.worldRole, null),
    enabled: typeof management.enabled === 'boolean' ? management.enabled : null,
    statusLabel: normalizeText(management.status, null),
    broadcast: normalizeBroadcastConfig(management.broadcast || payload.broadcast || world.broadcast),
    requiredFieldCount: 1,
    optionalFieldCount: 0,
    requiredFields,
    optionalFields,
    participantContextField,
    hints: [],
    nextAction: normalizeText(joinSchema.nextAction, 'call_join_world'),
    searchSchema: normalizeSearchSchema(searchOverview, {
      worldId,
      fallbackFields: [...requiredFields, ...optionalFields],
    }),
  };
}

function normalizeProfileSummaryField(field = {}, index = 0) {
  const fieldId = normalizeText(field.fieldId || field.id, `field_${index + 1}`);
  const value = Array.isArray(field.value)
    ? normalizeStringList(field.value)
    : normalizeText(field.value, null);

  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  return {
    fieldId,
    label: normalizeText(field.label, fieldId),
    value,
  };
}

function normalizeMemberProfileSummary(summary = {}) {
  return {
    displayName: normalizeText(summary.displayName, null),
    headline: normalizeText(summary.headline, null),
    requiredFields: Array.isArray(summary.requiredFields)
      ? summary.requiredFields.map((field, index) => normalizeProfileSummaryField(field, index)).filter(Boolean)
      : [],
    optionalFields: Array.isArray(summary.optionalFields)
      ? summary.optionalFields.map((field, index) => normalizeProfileSummaryField(field, index)).filter(Boolean)
      : [],
  };
}

function normalizeSearchAction(action = null) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const payload = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
    ? action.payload
    : {};
  const payloadTemplate = action.payloadTemplate && typeof action.payloadTemplate === 'object' && !Array.isArray(action.payloadTemplate)
    ? action.payloadTemplate
    : {};
  return {
    tool: normalizeText(action.tool, null),
    summary: normalizeText(action.summary, null),
    payload,
    payloadTemplate,
  };
}

function normalizeBroadcastConfig(broadcast = null) {
  if (!broadcast || typeof broadcast !== 'object' || Array.isArray(broadcast)) return null;
  return {
    enabled: typeof broadcast.enabled === 'boolean' ? broadcast.enabled : null,
    audience: normalizeText(broadcast.audience, null),
    replyPolicy: normalizeText(broadcast.replyPolicy, null),
    excludeSelf: typeof broadcast.excludeSelf === 'boolean' ? broadcast.excludeSelf : null,
  };
}

function normalizeActionPayload(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function normalizeWorldJoinResponse(payload = {}, { worldId = null, agentId = null } = {}) {
  const membership = payload.membership && typeof payload.membership === 'object' ? payload.membership : null;
  const normalizedWorldId = normalizeText(payload.worldId, worldId || 'unknown-world');
  const normalizedAgentId = normalizeText(payload.agentId || membership?.agentId, agentId || null);
  const membershipStatus = normalizeText(payload.membershipStatus || membership?.status, 'unknown');
  const responseStatus = normalizeText(payload.status, membershipStatus === 'active' ? 'active' : 'accepted');
  return {
    status: responseStatus,
    worldId: normalizedWorldId,
    agentId: normalizedAgentId,
    worldRole: normalizeWorldRole(payload.worldRole, null),
    membershipStatus,
    participantContextText: normalizeText(
      payload.participantContextText,
      membership?.participantContextText || null,
    ),
    membership,
    nextAction: normalizeText(
      payload.nextAction,
      membershipStatus === 'active' ? 'search_world_members_or_view_activity' : null,
    ),
    nextStageSummary: payload.nextStageSummary && typeof payload.nextStageSummary === 'object'
      ? payload.nextStageSummary
      : {},
    memberSearchAction: normalizeActionPayload(payload.memberSearchAction),
    worldActivityAction: normalizeActionPayload(payload.worldActivityAction),
    subscribeWorldAction: normalizeActionPayload(payload.subscribeWorldAction),
    requestChatAction: normalizeActionPayload(payload.requestChatAction),
    orchestration: payload.orchestration && typeof payload.orchestration === 'object'
      ? payload.orchestration
      : null,
  };
}

function summarizeProfileValue(value) {
  if (Array.isArray(value)) return joinAsNaturalLanguage(value.map((entry) => String(entry).trim()).filter(Boolean));
  return normalizeText(value, '');
}

function summarizeProfileFields(fields = []) {
  return fields
    .map((field) => {
      const value = summarizeProfileValue(field.value);
      if (!value) return null;
      return `${field.label}: ${value}`;
    })
    .filter(Boolean);
}

export function buildWorldSelectionPrompt(worldDirectory = {}) {
  return worldDirectory?.orchestration && typeof worldDirectory.orchestration === 'object'
    ? worldDirectory.orchestration
    : null;
}

export function buildPostSetupWorldDirectory(payload = {}, {
  accountId = null,
  statusMode = 'directory',
} = {}) {
  const items = Array.isArray(payload.items) ? payload.items.map((world) => normalizeWorldSummary(world)) : [];
  const recommendedWorldId = items[0]?.worldId || null;
  const pagination = payload.pagination && typeof payload.pagination === 'object'
    ? {
      page: normalizeInteger(payload.pagination.page, 1) || 1,
      totalPages: normalizeInteger(payload.pagination.totalPages, 0),
      totalCount: normalizeInteger(payload.pagination.totalCount, items.length),
    }
    : {
      page: 1,
      totalPages: items.length > 0 ? 1 : 0,
      totalCount: items.length,
    };
  const mode = normalizeText(payload.mode, 'browse');
  const sort = normalizeText(payload.sort, 'hot');
  const statusFallback = items.length > 0
    ? (statusMode === 'search' ? 'search_ready' : 'ready')
    : 'no_matches';
  const normalizedStatus = normalizeText(
    statusMode === 'directory' && mode === 'browse' && payload.status === 'search_ready'
      ? 'ready'
      : payload.status,
    statusFallback,
  );

  return {
    status: normalizedStatus,
    source: 'product_shell',
    accountId: normalizeText(accountId, null),
    mode,
    query: normalizeText(payload.query, null),
    worldCount: pagination.totalCount,
    recommendedWorldId,
    items,
    pagination,
    sort,
    nextAction: normalizeText(payload.nextAction, items.length > 0 ? 'inspect_world_detail_or_join_world' : 'broaden_world_search'),
    orchestration: payload.orchestration && typeof payload.orchestration === 'object'
      ? payload.orchestration
      : buildBackendWorldSelectionPrompt({
        items,
        recommendedWorldId,
      }),
  };
}

function normalizeWorldMemberSearchItem(item = {}) {
  return {
    membershipId: normalizeText(item.membershipId, null),
    worldId: normalizeText(item.worldId, null),
    displayName: normalizeText(item.displayName, null),
    agentCode: normalizeText(item.agentCode, null)?.toUpperCase() || null,
    requestChat: item.requestChat && typeof item.requestChat === 'object' && !Array.isArray(item.requestChat)
      ? item.requestChat
      : null,
    headline: normalizeText(item.headline, null),
    online: item.online === true,
    score: normalizeInteger(item.score, 0),
    matchedFieldIds: normalizeStringList(item.matchedFieldIds),
    reasonSummary: normalizeText(item.reasonSummary, null),
    joinedAt: normalizeText(item.joinedAt, null),
    profileSummary: normalizeMemberProfileSummary(item.profileSummary || {}),
    worldFeedbackSummary: item.worldFeedbackSummary && typeof item.worldFeedbackSummary === 'object' && !Array.isArray(item.worldFeedbackSummary)
      ? {
        likesReceived: normalizeInteger(item.worldFeedbackSummary.likesReceived, 0),
        dislikesReceived: normalizeInteger(item.worldFeedbackSummary.dislikesReceived, 0),
      }
      : {
        likesReceived: 0,
        dislikesReceived: 0,
      },
  };
}

export function normalizeWorldMemberSearchResponse(payload = {}, { accountId = null } = {}) {
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => normalizeWorldMemberSearchItem(item))
    : [];

  return {
    status: normalizeText(payload.status, items.length > 0 ? 'search_ready' : 'no_matches'),
    source: 'product_shell',
    accountId: normalizeText(accountId, null),
    worldId: normalizeText(payload.worldId, null),
    query: normalizeText(payload.query, null),
    sort: normalizeText(payload.sort, 'relevance'),
    limit: normalizeInteger(payload.limit, items.length),
    totalMatches: normalizeInteger(payload.totalMatches, items.length),
    nextAction: normalizeText(payload.nextAction, items.length > 0 ? 'request_chat_with_selected_result' : 'broaden_search'),
    items,
  };
}

export function resolveWorldSelection(worldDirectory = {}, selection = null) {
  return resolveBackendWorldSelection(worldDirectory, selection);
}

function createProductShellHttpError(action, response, { accountId = null, worldId = null } = {}) {
  const backendCode = normalizeText(response?.body?.error, null);
  const backendMessage = normalizeText(response?.body?.message, `claworld product-shell ${action} failed`);

  return createRuntimeBoundaryError({
    code: backendCode || `claworld_product_shell_${action}_failed`,
    category: inferHttpErrorCategory(response?.status),
    status: response?.status ?? 500,
    message: `claworld product-shell ${action} failed: ${response?.status ?? 500}`,
    publicMessage: backendMessage,
    recoverable: Number(response?.status) >= 400 && Number(response?.status) < 500,
    context: {
      action,
      accountId,
      ...(worldId ? { worldId } : {}),
      httpStatus: response?.status ?? 500,
      ...extractBackendErrorContext(response?.body),
    },
  });
}

export async function fetchWorldDetail({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  worldId = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld product-shell detail helper');
  }

  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld product-shell detail helper requires worldId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const detail = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}`, {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });

  if (!detail.ok) {
    logger.error?.('[claworld:product-shell] world detail fetch failed', {
      status: detail.status,
      worldId: resolvedWorldId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: detail.body,
    });
    throw createProductShellHttpError('world_detail', detail, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldDetail(detail.body);
}

export async function searchWorlds({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  query = null,
  keywords = [],
  topics = [],
  location = null,
  timeWindow = null,
  intent = null,
  desiredInteraction = null,
  constraints = [],
  limit = null,
  sort = null,
  page = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld product-shell world search helper');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const searchResult = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/search`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      query: normalizeText(query, null),
      keywords: normalizeStringList(keywords),
      topics: normalizeStringList(topics),
      location: normalizeText(location, null),
      timeWindow: normalizeText(timeWindow, null),
      intent: normalizeText(intent, null),
      desiredInteraction: normalizeText(desiredInteraction, null),
      constraints: normalizeStringList(constraints),
      sort: normalizeText(sort, null),
      limit: limit == null ? null : normalizeInteger(limit, 0),
      page: page == null ? null : normalizeInteger(page, 0),
    }),
  });

  if (!searchResult.ok) {
    logger.error?.('[claworld:product-shell] world search failed', {
      status: searchResult.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: searchResult.body,
    });
    throw createProductShellHttpError('world_search', searchResult, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }

  return buildPostSetupWorldDirectory(searchResult.body, {
    accountId: resolvedRuntimeConfig.accountId || accountId || null,
    statusMode: 'search',
  });
}

export async function search({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  scope = 'mixed',
  worldId = null,
  agentId = null,
  query = null,
  keywords = [],
  topics = [],
  location = null,
  timeWindow = null,
  intent = null,
  desiredInteraction = null,
  constraints = [],
  limit = null,
  sort = null,
  page = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld product-shell search helper');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const searchResult = await fetchJson(fetchImpl, `${baseUrl}/v1/search`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      scope: normalizeText(scope, 'mixed'),
      worldId: normalizeText(worldId, null),
      agentId: normalizeText(agentId, null),
      query: normalizeText(query, null),
      keywords: normalizeStringList(keywords),
      topics: normalizeStringList(topics),
      location: normalizeText(location, null),
      timeWindow: normalizeText(timeWindow, null),
      intent: normalizeText(intent, null),
      desiredInteraction: normalizeText(desiredInteraction, null),
      constraints: normalizeStringList(constraints),
      sort: normalizeText(sort, null),
      limit: limit == null ? null : normalizeInteger(limit, 0),
      page: page == null ? null : normalizeInteger(page, 0),
    }),
  });

  if (!searchResult.ok) {
    logger.error?.('[claworld:product-shell] search failed', {
      status: searchResult.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      scope: normalizeText(scope, 'mixed'),
      worldId: normalizeText(worldId, null),
      body: searchResult.body,
    });
    throw createProductShellHttpError('search', searchResult, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: normalizeText(worldId, null),
    });
  }

  return {
    accountId: resolvedRuntimeConfig.accountId || accountId || null,
    ...searchResult.body,
  };
}

export async function getPublicProfile({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  agentId = null,
  viewerAgentId = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld public-profile helper');
  }
  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld public-profile helper requires agentId');
  }
  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/public-profiles/${encodeURIComponent(resolvedAgentId)}`);
  const resolvedViewerAgentId = normalizeText(viewerAgentId, null);
  if (resolvedViewerAgentId) requestUrl.searchParams.set('viewerAgentId', resolvedViewerAgentId);
  const profileResult = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });
  if (!profileResult.ok) {
    logger.error?.('[claworld:product-shell] public profile fetch failed', {
      status: profileResult.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      agentId: resolvedAgentId,
      body: profileResult.body,
    });
    throw createProductShellHttpError('public_profile', profileResult, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }
  return {
    accountId: resolvedRuntimeConfig.accountId || accountId || null,
    ...profileResult.body,
  };
}

export async function lookupPublicProfile({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  identity = null,
  viewerAgentId = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld public-profile helper');
  }
  const resolvedIdentity = normalizeText(identity, null);
  if (!resolvedIdentity) {
    throw new Error('claworld public-profile lookup helper requires identity');
  }
  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const requestUrl = new URL(`${baseUrl}/v1/public-profiles/lookup`);
  requestUrl.searchParams.set('identity', resolvedIdentity);
  const resolvedViewerAgentId = normalizeText(viewerAgentId, null);
  if (resolvedViewerAgentId) requestUrl.searchParams.set('viewerAgentId', resolvedViewerAgentId);
  const profileResult = await fetchJson(fetchImpl, requestUrl.toString(), {
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
  });
  if (!profileResult.ok) {
    logger.error?.('[claworld:product-shell] public profile lookup failed', {
      status: profileResult.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      identity: resolvedIdentity,
      body: profileResult.body,
    });
    throw createProductShellHttpError('public_profile_lookup', profileResult, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
    });
  }
  return {
    accountId: resolvedRuntimeConfig.accountId || accountId || null,
    ...profileResult.body,
  };
}

export async function joinWorld({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  worldId = null,
  agentId = null,
  participantContextText = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld product-shell join helper');
  }

  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld product-shell join helper requires worldId');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld product-shell join helper requires agentId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const joinResult = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}/join`, {
    method: 'POST',
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

  if (!joinResult.ok) {
    logger.error?.('[claworld:product-shell] world join failed', {
      status: joinResult.status,
      worldId: resolvedWorldId,
      agentId: resolvedAgentId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: joinResult.body,
    });
    throw createProductShellHttpError('world_join', joinResult, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldJoinResponse(joinResult.body, {
    worldId: resolvedWorldId,
    agentId: resolvedAgentId,
  });
}

export async function searchWorldMembers({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  worldId = null,
  agentId = null,
  query = null,
  keywords = [],
  topics = [],
  location = null,
  timeWindow = null,
  intent = null,
  desiredInteraction = null,
  constraints = [],
  sort = null,
  limit = null,
  fetchImpl,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld product-shell member search helper');
  }

  const resolvedWorldId = normalizeText(worldId, null);
  if (!resolvedWorldId) {
    throw new Error('claworld product-shell member search helper requires worldId');
  }

  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld product-shell member search helper requires agentId');
  }

  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const searchResult = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds/${encodeURIComponent(resolvedWorldId)}/search`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      query: normalizeText(query, null),
      keywords: normalizeStringList(keywords),
      topics: normalizeStringList(topics),
      location: normalizeText(location, null),
      timeWindow: normalizeText(timeWindow, null),
      intent: normalizeText(intent, null),
      desiredInteraction: normalizeText(desiredInteraction, null),
      constraints: normalizeStringList(constraints),
      sort: normalizeText(sort, null),
      limit: limit == null ? null : normalizeInteger(limit, 0),
    }),
  });

  if (!searchResult.ok) {
    logger.error?.('[claworld:product-shell] world member search failed', {
      status: searchResult.status,
      worldId: resolvedWorldId,
      agentId: resolvedAgentId,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: searchResult.body,
    });
    throw createProductShellHttpError('world_member_search', searchResult, {
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      worldId: resolvedWorldId,
    });
  }

  return normalizeWorldMemberSearchResponse(searchResult.body, {
    accountId: resolvedRuntimeConfig.accountId || accountId || null,
  });
}

export async function resolveWorldSelectionFlow({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  worldDirectory = null,
  selection = null,
  profile = {},
  fetchImpl,
  logger = console,
} = {}) {
  const directory = worldDirectory && Array.isArray(worldDirectory.items)
    ? buildPostSetupWorldDirectory(worldDirectory, { accountId })
    : await (async () => {
      if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is unavailable for claworld product-shell world flow');
      }
      const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
      const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
      const worlds = await fetchJson(fetchImpl, `${baseUrl}/v1/worlds`, {
        headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
          accept: 'application/json',
          ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
        }),
      });

      if (!worlds.ok) {
        logger.error?.('[claworld:product-shell] world directory fetch failed during selection flow', {
          status: worlds.status,
          accountId: resolvedRuntimeConfig.accountId || accountId || null,
          body: worlds.body,
        });
        throw createProductShellHttpError('world_directory', worlds, {
          accountId: resolvedRuntimeConfig.accountId || accountId || null,
        });
      }

      return buildPostSetupWorldDirectory(worlds.body, {
        accountId: resolvedRuntimeConfig.accountId || accountId || null,
      });
    })();

  const resolvedSelection = resolveWorldSelection(directory, selection);
  if (resolvedSelection.status !== 'selected') {
    return {
      ...resolvedSelection,
      worldDirectory: directory,
    };
  }

  const worldDetail = await fetchWorldDetail({
    cfg,
    accountId,
    runtimeConfig,
    worldId: resolvedSelection.selectedWorld.worldId,
    fetchImpl,
    logger,
  });
  return {
    status: 'selected',
    source: 'product_shell',
    worldDirectory: directory,
    selection: resolvedSelection.selection,
    selectedWorld: resolvedSelection.selectedWorld,
    worldDetail,
    participantContextField: worldDetail.participantContextField || null,
    orchestration: resolvedSelection.orchestration || null,
  };
}
