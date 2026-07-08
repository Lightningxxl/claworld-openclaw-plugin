import { normalizeAcceptedChatKickoffRecord } from '../../lib/relay/kickoff-progress.js';

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

function normalizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.trunc(parsed));
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

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeText(value, null))
    .filter(Boolean);
}

function projectParticipantContextField(field = null) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
  return {
    fieldId: normalizeText(field.fieldId, null),
    label: normalizeText(field.label, normalizeText(field.fieldId, 'Entry Profile')),
    description: normalizeText(field.description, null),
  };
}

function projectWorldRole(worldRole, fallback = null) {
  const normalized = normalizeText(worldRole, fallback);
  return ['owner', 'member'].includes(normalized) ? normalized : fallback;
}

function projectWorldStats(stats = null) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  return {
    totalParticipants: normalizeOptionalInteger(stats.totalParticipants, null),
    activeParticipants: normalizeOptionalInteger(stats.activeParticipants, null),
    totalConversationCount: normalizeOptionalInteger(stats.totalConversationCount, null),
    totalLikes: normalizeOptionalInteger(stats.totalLikes, null),
    totalDislikes: normalizeOptionalInteger(stats.totalDislikes, null),
  };
}

function projectToolBroadcastConfig(broadcast = null) {
  if (!broadcast || typeof broadcast !== 'object' || Array.isArray(broadcast)) return null;
  return {
    enabled: normalizeOptionalBoolean(broadcast.enabled, null),
    audience: normalizeText(broadcast.audience, null),
    replyPolicy: normalizeText(broadcast.replyPolicy, null),
    excludeSelf: normalizeOptionalBoolean(broadcast.excludeSelf, null),
  };
}

function projectWorldFeedbackSummary(summary = null) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  return {
    likesReceived: normalizeInteger(summary.likesReceived, 0),
    dislikesReceived: normalizeInteger(summary.dislikesReceived, 0),
  };
}

function projectConversationFeedbackSummary(summary = null) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  return {
    likeCount: normalizeInteger(summary.likeCount, 0),
    dislikeCount: normalizeInteger(summary.dislikeCount, 0),
    viewerGave: normalizeText(summary.viewerGave, null),
    viewerReceived: normalizeText(summary.viewerReceived, null),
  };
}

function projectOrchestration(orchestration = null) {
  if (!orchestration || typeof orchestration !== 'object' || Array.isArray(orchestration)) return null;
  return {
    stage: normalizeText(orchestration.stage, null),
    system: normalizeText(orchestration.system, null),
    confirmation: normalizeText(orchestration.confirmation, null),
    user: normalizeText(orchestration.user, null),
    followUp: normalizeText(orchestration.followUp, null),
  };
}

function projectToolAction(action = null) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const tool = normalizeText(action.tool, null);
  const payload = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
    ? action.payload
    : {};
  const payloadTemplate = action.payloadTemplate && typeof action.payloadTemplate === 'object' && !Array.isArray(action.payloadTemplate)
    ? action.payloadTemplate
    : {};
  if (tool === 'claworld_join_world') {
    return {
      tool: 'claworld_manage_worlds',
      summary: normalizeText(action.summary, null),
      payload: { ...payload, action: 'join_world' },
      payloadTemplate: { ...payloadTemplate, action: 'join_world' },
    };
  }
  if (tool === 'claworld_get_world_detail') {
    return {
      tool: 'claworld_manage_worlds',
      summary: normalizeText(action.summary, null),
      payload: { ...payload, action: 'get_world' },
      payloadTemplate: { ...payloadTemplate, action: 'get_world' },
    };
  }
  return {
    tool,
    summary: normalizeText(action.summary, null),
    payload,
    payloadTemplate,
  };
}

function projectRequestChatPayload(
  requestChat = null,
  {
    accountId = null,
    requestToolName = 'claworld_manage_conversations',
  } = {},
) {
  if (!requestChat || typeof requestChat !== 'object' || Array.isArray(requestChat)) return null;
  const worldId = normalizeText(requestChat.worldId, null);
  const displayName = normalizeText(requestChat.displayName, null);
  const agentCode = normalizeText(requestChat.agentCode, null)?.toUpperCase() || null;
  if (!worldId || !displayName || !agentCode) return null;

  const normalizedAccountId = normalizeText(accountId, null);

  return {
    worldId,
    displayName,
    agentCode,
    requestTool: normalizeText(requestToolName, null),
    requestPayload: {
      ...(normalizedAccountId ? { accountId: normalizedAccountId } : {}),
      action: 'request',
      worldId,
      displayName,
      agentCode,
    },
  };
}

function projectRequestChatAction(
  requestChatAction = null,
  {
    accountId = null,
    requestToolName = 'claworld_manage_conversations',
  } = {},
) {
  if (!requestChatAction || typeof requestChatAction !== 'object' || Array.isArray(requestChatAction)) return null;
  const worldId = normalizeText(requestChatAction.worldId, null);
  if (!worldId) return null;

  const normalizedAccountId = normalizeText(accountId, null);

  return {
    action: normalizeText(requestChatAction.action, 'request_chat'),
    worldId,
    requiredFields: normalizeStringList(requestChatAction.requiredFields),
    requestTool: normalizeText(requestToolName, null),
    requestPayloadTemplate: {
      ...(normalizedAccountId ? { accountId: normalizedAccountId } : {}),
      action: 'request',
      worldId,
      displayName: ':displayName',
      agentCode: ':agentCode',
      openingMessage: ':openingMessage',
    },
    summary: normalizeText(requestChatAction.summary, null),
  };
}

export function projectToolWorldList(worldDirectory = {}) {
  const worlds = Array.isArray(worldDirectory.items)
    ? worldDirectory.items.map((world) => ({
      worldId: world.worldId,
      displayName: world.displayName,
      summary: normalizeText(world.summary, null),
      worldContextText: normalizeText(world.worldContextText, null),
      tags: normalizeStringList(world.tags),
      hotness: normalizeInteger(world.hotness, 0),
      activatedMemberCount: normalizeInteger(world.activatedMemberCount, normalizeInteger(world.hotness, 0)),
      reasonSummary: normalizeText(world.reasonSummary, null),
      detailAction: projectToolAction(world.detailAction),
      joinAction: projectToolAction(world.joinAction),
    }))
    : [];

  return {
    worlds,
    mode: normalizeText(worldDirectory.mode, 'browse'),
    query: normalizeText(worldDirectory.query, null),
    sort: normalizeText(worldDirectory.sort, 'hot'),
    nextAction: normalizeText(worldDirectory.nextAction, 'inspect_world_detail_or_join_world'),
    pagination: worldDirectory.pagination && typeof worldDirectory.pagination === 'object'
      ? {
        page: normalizeInteger(worldDirectory.pagination.page, 1),
        totalPages: normalizeInteger(worldDirectory.pagination.totalPages, 0),
        totalCount: normalizeInteger(worldDirectory.pagination.totalCount, worlds.length),
      }
      : {
        page: 1,
        totalPages: worlds.length > 0 ? 1 : 0,
        totalCount: worlds.length,
      },
  };
}

export function projectToolWorldSearchResponse(worldDirectory = {}, { accountId = null } = {}) {
  const worlds = Array.isArray(worldDirectory.items)
    ? worldDirectory.items.map((world) => ({
      worldId: world.worldId,
      displayName: world.displayName,
      summary: normalizeText(world.summary, null),
      worldContextText: normalizeText(world.worldContextText, null),
      tags: normalizeStringList(world.tags),
      hotness: normalizeInteger(world.hotness, 0),
      activatedMemberCount: normalizeInteger(world.activatedMemberCount, normalizeInteger(world.hotness, 0)),
      matchScore: normalizeInteger(world.matchScore, 0),
      matchedFieldIds: normalizeStringList(world.matchedFieldIds),
      matchedTerms: normalizeStringList(world.matchedTerms),
      reasonSummary: normalizeText(world.reasonSummary, null),
      detailAction: projectToolAction(world.detailAction),
      joinAction: projectToolAction(world.joinAction),
    }))
    : [];

  return {
    accountId: normalizeText(accountId, null),
    status: normalizeText(worldDirectory.status, worlds.length > 0 ? 'search_ready' : 'no_matches'),
    mode: normalizeText(worldDirectory.mode, 'browse'),
    query: normalizeText(worldDirectory.query, null),
    sort: normalizeText(worldDirectory.sort, 'match'),
    nextAction: normalizeText(worldDirectory.nextAction, worlds.length > 0 ? 'inspect_world_detail_or_join_world' : 'broaden_world_search'),
    worlds,
    pagination: worldDirectory.pagination && typeof worldDirectory.pagination === 'object'
      ? {
        page: normalizeInteger(worldDirectory.pagination.page, 1),
        totalPages: normalizeInteger(worldDirectory.pagination.totalPages, 0),
        totalCount: normalizeInteger(worldDirectory.pagination.totalCount, worlds.length),
      }
      : {
        page: 1,
        totalPages: worlds.length > 0 ? 1 : 0,
        totalCount: worlds.length,
      },
  };
}

export function projectToolWorldDetail(worldDetail = {}, { accountId = null } = {}) {
  return {
    worldId: worldDetail.worldId,
    displayName: normalizeText(worldDetail.world?.displayName, worldDetail.displayName || ''),
    worldContextText: normalizeText(
      worldDetail.world?.worldContextText,
      worldDetail.worldContextText || '',
    ),
    ownerAgentId: normalizeText(
      worldDetail.management?.ownerAgentId,
      normalizeText(worldDetail.ownerAgentId, null),
    ),
    worldRole: projectWorldRole(worldDetail.worldRole, null),
    enabled: normalizeOptionalBoolean(worldDetail.management?.enabled, normalizeOptionalBoolean(worldDetail.enabled, null)),
    status: normalizeText(worldDetail.management?.status, normalizeText(worldDetail.statusLabel, null)),
    broadcast: projectToolBroadcastConfig(
      worldDetail.management?.broadcast || worldDetail.broadcast || worldDetail.world?.broadcast,
    ),
    participantContextField: projectParticipantContextField(worldDetail.participantContextField),
    memberSearchAction: {
      tool: 'claworld_search',
      summary: 'After joining this world, search joined members by profile match or likes.',
      payloadTemplate: {
        ...(normalizeText(accountId, null) ? { accountId: normalizeText(accountId, null) } : {}),
        scope: 'world_members',
        worldId: worldDetail.worldId,
        query: ':query',
      },
    },
  };
}

function projectMemberProfileSummary(summary = {}) {
  return {
    displayName: normalizeText(summary.displayName, null),
    headline: normalizeText(summary.headline, null),
    requiredFields: Array.isArray(summary.requiredFields)
      ? summary.requiredFields.map((field) => ({
        fieldId: normalizeText(field.fieldId, null),
        label: normalizeText(field.label, normalizeText(field.fieldId, null)),
        value: Array.isArray(field.value) ? normalizeStringList(field.value) : normalizeText(field.value, null),
      }))
      : [],
    optionalFields: Array.isArray(summary.optionalFields)
      ? summary.optionalFields.map((field) => ({
        fieldId: normalizeText(field.fieldId, null),
        label: normalizeText(field.label, normalizeText(field.fieldId, null)),
        value: Array.isArray(field.value) ? normalizeStringList(field.value) : normalizeText(field.value, null),
      }))
      : [],
  };
}

function projectToolJoinAction(action = null, { accountId = null, requestToolName = null } = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const normalizedAccountId = normalizeText(accountId, null);
  const requestTool = normalizeText(requestToolName, null);
  return {
    ...action,
    ...(normalizedAccountId ? { accountId: normalizedAccountId } : {}),
    ...(requestTool ? { requestTool } : {}),
  };
}

export function projectToolJoinWorldResponse(
  joinResult = {},
  { accountId = null } = {},
) {
  return {
    status: joinResult.membershipStatus === 'active' ? 'active' : 'accepted',
    worldId: normalizeText(joinResult.worldId, null),
    accountId: normalizeText(accountId, null),
    worldRole: projectWorldRole(joinResult.worldRole, null),
    membershipStatus: joinResult.membershipStatus || 'unknown',
    participantContextText: normalizeText(
      joinResult.participantContextText,
      joinResult.membership?.participantContextText || null,
    ),
    nextAction: normalizeText(joinResult.nextAction, 'search_world_members_or_view_activity'),
    memberSearchAction: projectToolJoinAction(joinResult.memberSearchAction, { accountId }),
    worldActivityAction: projectToolJoinAction(joinResult.worldActivityAction, { accountId }),
    subscribeWorldAction: projectToolJoinAction(joinResult.subscribeWorldAction, { accountId }),
    requestChatAction: projectToolJoinAction(joinResult.requestChatAction, {
      accountId,
      requestToolName: 'claworld_manage_conversations',
    }),
    orchestration: projectOrchestration(joinResult.orchestration),
  };
}

export function projectToolCreateWorldResponse(world = {}, { accountId = null } = {}) {
  return {
    worldId: world.worldId,
    accountId: normalizeText(accountId, null),
    displayName: normalizeText(world.displayName, null),
    worldContextText: normalizeText(world.worldContextText, null),
    participantContextField: projectParticipantContextField(world.participantContextField),
    ownerAgentId: normalizeText(world.ownerAgentId, null),
    status: normalizeText(world.status, null),
    enabled: normalizeOptionalBoolean(world.enabled, null),
    worldRole: projectWorldRole(world.worldRole, null),
    ownerJoin:
      world.ownerJoin && typeof world.ownerJoin === 'object'
        ? projectToolJoinWorldResponse(world.ownerJoin, { accountId })
        : null,
    schemaVersion: normalizeOptionalInteger(world.schemaVersion, null),
    createdAt: normalizeText(world.createdAt, null),
  };
}

export function projectToolOwnedWorldsResponse(payload = {}, { accountId = null } = {}) {
  const worlds = Array.isArray(payload.items)
    ? payload.items.map((world) => ({
      worldId: world.worldId,
      displayName: world.displayName,
      worldContextText: normalizeText(world.worldContextText, null),
      enabled: normalizeOptionalBoolean(world.enabled, null),
      status: normalizeText(world.status, null),
      worldRole: projectWorldRole(world.worldRole, null),
      createdAt: normalizeText(world.createdAt, null),
      updatedAt: normalizeText(world.updatedAt, null),
      broadcast: projectToolBroadcastConfig(world.broadcast),
      stats: projectWorldStats(world.stats),
    }))
    : [];

  return {
    accountId: normalizeText(accountId, null),
    worlds,
  };
}

export function projectToolManagedWorldResponse(world = {}, { accountId = null } = {}) {
  return {
    worldId: world.worldId,
    accountId: normalizeText(accountId, null),
    displayName: world.displayName,
    worldContextText: normalizeText(world.worldContextText, null),
    ownerAgentId: normalizeText(world.ownerAgentId, null),
    enabled: normalizeOptionalBoolean(world.enabled, null),
    status: normalizeText(world.status, null),
    worldRole: projectWorldRole(world.worldRole, null),
    schemaVersion: normalizeOptionalInteger(world.schemaVersion, null),
    createdAt: normalizeText(world.createdAt, null),
    updatedAt: normalizeText(world.updatedAt, null),
    participantContextField: projectParticipantContextField(world.participantContextField),
    broadcast: projectToolBroadcastConfig(world.broadcast),
    stats: projectWorldStats(world.stats),
  };
}

function projectToolWorldBroadcastRequestItem(item = {}) {
  return {
    agentId: normalizeText(item.agentId, null),
    status: normalizeText(item.status, null),
    verdict: normalizeText(item.verdict, null),
    chatRequest: projectChatRequestItem(item.chatRequest),
    kickoff: projectChatRequestKickoff(item.kickoff),
  };
}

function projectToolWorldBroadcastFailureItem(item = {}) {
  return {
    agentId: normalizeText(item.agentId, null),
    status: normalizeText(item.status, 'failed'),
    httpStatus: normalizeOptionalInteger(item.httpStatus, null),
    error: normalizeText(item.error, null),
    reason: normalizeText(item.reason, null),
    message: normalizeText(item.message, null),
  };
}

export function projectToolWorldBroadcastResponse(payload = {}, { accountId = null } = {}) {
  return {
    accountId: normalizeText(accountId, null),
    accepted: payload.accepted === true,
    status: normalizeText(payload.status, null),
    commandId: normalizeText(payload.commandId, null),
    command: payload.command && typeof payload.command === 'object' && !Array.isArray(payload.command)
      ? payload.command
      : null,
    worldId: normalizeText(payload.worldId, null),
    senderAgentId: normalizeText(payload.senderAgentId, null),
    senderRole: projectWorldRole(payload.senderRole, null),
    audience: normalizeText(payload.audience, null),
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
      ? payload.requests.map((item) => projectToolWorldBroadcastRequestItem(item))
      : [],
    failures: Array.isArray(payload.failures)
      ? payload.failures.map((item) => projectToolWorldBroadcastFailureItem(item))
      : [],
  };
}

function projectToolWorldMembershipSummary(membership = {}) {
  return {
    membershipId: normalizeText(membership.membershipId, null),
    worldId: normalizeText(membership.worldId, null),
    displayName: normalizeText(membership.displayName, null),
    worldContextText: normalizeText(membership.worldContextText, null),
    ownerAgentId: normalizeText(membership.ownerAgentId, null),
    enabled: normalizeOptionalBoolean(membership.enabled, null),
    worldStatus: normalizeText(membership.worldStatus, null),
    worldRole: projectWorldRole(membership.worldRole, null),
    membershipStatus: normalizeText(membership.membershipStatus, null),
    participantContextText: normalizeText(membership.participantContextText, null),
    joinedAt: normalizeText(membership.joinedAt, null),
    updatedAt: normalizeText(membership.updatedAt, null),
    nextAction: normalizeText(membership.nextAction, null),
  };
}

export function projectToolWorldMembershipListResponse(payload = {}, { accountId = null } = {}) {
  return {
    accountId: normalizeText(accountId, null),
    memberships: Array.isArray(payload.items)
      ? payload.items.map((membership) => projectToolWorldMembershipSummary(membership))
      : [],
    nextAction: normalizeText(payload.nextAction, null),
  };
}

export function projectToolWorldMembershipResponse(payload = {}, { accountId = null } = {}) {
  return {
    accountId: normalizeText(accountId, null),
    ...projectToolWorldMembershipSummary(payload),
  };
}

export function projectToolWorldMemberSearchResponse(payload = {}, { accountId = null } = {}) {
  return {
    accountId: normalizeText(accountId, null),
    status: normalizeText(payload.status, 'no_matches'),
    worldId: normalizeText(payload.worldId, null),
    query: normalizeText(payload.query, null),
    sort: normalizeText(payload.sort, 'relevance'),
    limit: normalizeInteger(payload.limit, 0),
    totalMatches: normalizeInteger(payload.totalMatches, Array.isArray(payload.items) ? payload.items.length : 0),
    nextAction: normalizeText(payload.nextAction, null),
    members: Array.isArray(payload.items)
      ? payload.items.map((item, index) => ({
        memberId: normalizeText(item.membershipId, `member_${index + 1}`),
        membershipId: normalizeText(item.membershipId, null),
        displayName: normalizeText(item.displayName, `Member ${index + 1}`),
        agentCode: normalizeText(item.agentCode, null)?.toUpperCase() || null,
        headline: normalizeText(item.headline, null),
        online: item.online === true,
        score: normalizeInteger(item.score, 0),
        matchedFieldIds: normalizeStringList(item.matchedFieldIds),
        reasonSummary: normalizeText(item.reasonSummary, null),
        profileSummary: projectMemberProfileSummary(item.profileSummary || {}),
        worldFeedbackSummary: projectWorldFeedbackSummary(item.worldFeedbackSummary),
        requestChat: projectRequestChatPayload(item.requestChat, { accountId }),
      }))
      : [],
  };
}

export function projectToolFeedbackSubmissionResponse(result = {}) {
  const feedback = result.feedback && typeof result.feedback === 'object' ? result.feedback : {};
  const reporter = feedback.reporter && typeof feedback.reporter === 'object' ? feedback.reporter : {};
  const context = feedback.context && typeof feedback.context === 'object' ? feedback.context : {};
  const runtimeContext = feedback.runtimeContext && typeof feedback.runtimeContext === 'object'
    ? feedback.runtimeContext
    : {};

  return {
    status: normalizeText(result.status, 'recorded'),
    feedbackId: normalizeText(feedback.feedbackId, null),
    category: normalizeText(feedback.category, null),
    impact: normalizeText(feedback.impact, 'medium'),
    title: normalizeText(feedback.title, null),
    accountId: normalizeText(feedback.accountId, null),
    reporterAgentId: normalizeText(reporter.agentId, null),
    reporterIdentity: normalizeText(reporter.publicIdentity?.displayIdentity, null),
    worldId: normalizeText(context.worldId, null),
    conversationKey: normalizeText(context.conversationKey, null),
    turnId: normalizeText(context.turnId, null),
    deliveryId: normalizeText(context.deliveryId, null),
    tags: normalizeStringList(context.tags),
    createdAt: normalizeText(feedback.createdAt, null),
    runtime: {
      channelId: normalizeText(runtimeContext.channelId, null),
      toolName: normalizeText(runtimeContext.toolName, null),
      accountToolAction: normalizeText(runtimeContext.accountToolAction, null),
      toolCallId: normalizeText(runtimeContext.toolCallId, null),
      openclawVersion: normalizeText(runtimeContext.openclawVersion, null),
      pluginVersion: normalizeText(runtimeContext.pluginVersion, null),
      modelProvider: normalizeText(runtimeContext.modelProvider, null),
      modelId: normalizeText(runtimeContext.modelId, null),
      osCategory: normalizeText(runtimeContext.osCategory, null),
    },
    nextAction: 'keep_feedback_id_for_follow_up',
  };
}

function projectToolAgentSummary(agent = {}) {
  if (!agent || typeof agent !== 'object') return null;
  return {
    agentId: normalizeText(agent.agentId, null),
    displayName: normalizeText(agent.displayName, null),
    identity: normalizeText(agent.publicIdentity?.displayIdentity, null),
    online: agent.online === true,
    visibilityMode: normalizeText(agent.visibilityMode, null),
    contactPolicy: normalizeText(agent.contactPolicy, null),
  };
}

function projectToolWorldSummary(world = {}) {
  if (!world || typeof world !== 'object') return null;
  return {
    worldId: normalizeText(world.worldId, null),
    slug: normalizeText(world.slug, null),
    displayName: normalizeText(world.displayName, null),
    summary: normalizeText(world.summary, null),
  };
}

function normalizeConversationScopeDetails(input = {}) {
  const conversation = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const worldId = normalizeText(conversation.worldId, null);
  return {
    mode: worldId ? 'world' : 'direct',
    worldId,
    world: projectToolWorldSummary(conversation.world),
  };
}

function projectChatRequestKickoff(kickoff = {}) {
  const normalizedKickoff = normalizeAcceptedChatKickoffRecord(kickoff, { fallbackStatus: 'skipped' });
  if (!normalizedKickoff) return null;
  return {
    status: normalizeText(normalizedKickoff.status, 'skipped'),
    deliveredAt: normalizeText(normalizedKickoff.deliveredAt, null),
    senderKickoffDeliveredAt: normalizeText(
      normalizedKickoff.senderKickoffDeliveredAt,
      normalizeText(normalizedKickoff.deliveredAt, null),
    ),
    openerAcceptedAt: normalizeText(normalizedKickoff.openerAcceptedAt, null),
    openerDeliveredAt: normalizeText(normalizedKickoff.openerDeliveredAt, null),
    liveChatEstablishedAt: normalizeText(normalizedKickoff.liveChatEstablishedAt, null),
    conversationKey: normalizeText(normalizedKickoff.conversationKey, null),
    localSessionKey: normalizeText(
      normalizedKickoff.localSessionKey,
      normalizeText(normalizedKickoff.sessionKey, null),
    ),
    turnId: normalizeText(normalizedKickoff.turnId, null),
    deliveryId: normalizeText(normalizedKickoff.deliveryId, null),
    created: typeof normalizedKickoff.created === 'boolean' ? normalizedKickoff.created : null,
    reason: normalizeText(normalizedKickoff.reason, null),
  };
}

function projectChatRequestOrigin(origin = {}) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return null;
  return {
    type: normalizeText(origin.type, 'chat_request'),
    broadcastId: normalizeText(origin.broadcastId, null),
  };
}

function projectChatRequestItem(request = {}) {
  if (!request || typeof request !== 'object') return null;
  const requestContext = request.requestContext && typeof request.requestContext === 'object' && !Array.isArray(request.requestContext)
    ? request.requestContext
    : {};
  const kickoffBrief = request.kickoffBrief && typeof request.kickoffBrief === 'object' && !Array.isArray(request.kickoffBrief)
    ? request.kickoffBrief
    : requestContext.kickoffBrief && typeof requestContext.kickoffBrief === 'object' && !Array.isArray(requestContext.kickoffBrief)
      ? requestContext.kickoffBrief
      : null;
  const conversation = normalizeConversationScopeDetails(
    request.conversation && typeof request.conversation === 'object' && !Array.isArray(request.conversation)
      ? request.conversation
      : requestContext.conversation,
  );
  return {
    chatRequestId: normalizeText(request.chatRequestId || request.requestId, null),
    status: normalizeText(request.status, 'pending'),
    direction: normalizeText(request.direction, null),
    openingMessage: normalizeText(
      request.openingMessage,
      normalizeText(kickoffBrief?.text, normalizeText(requestContext.openingPayload?.text, normalizeText(requestContext.message, null))),
    ),
    kickoffBrief: kickoffBrief
      ? {
          text: normalizeText(kickoffBrief.text, null),
          payload: kickoffBrief.payload && typeof kickoffBrief.payload === 'object' && !Array.isArray(kickoffBrief.payload)
            ? kickoffBrief.payload
            : null,
          source: normalizeText(kickoffBrief.source, 'chat_request_brief'),
        }
      : null,
    createdAt: normalizeText(request.createdAt, null),
    respondedAt: normalizeText(request.respondedAt, null),
    expiresAt: normalizeText(request.expiresAt, null),
    origin: projectChatRequestOrigin(request.origin),
    fromAgent: projectToolAgentSummary(request.fromAgent),
    toAgent: projectToolAgentSummary(request.toAgent),
    counterparty: projectToolAgentSummary(request.counterparty),
    conversation,
  };
}

function projectChatInboxChatItem(chat = {}) {
  if (!chat || typeof chat !== 'object' || Array.isArray(chat)) return null;
  return {
    chatRequestId: normalizeText(chat.chatRequestId, null),
    status: normalizeText(chat.status, null),
    direction: normalizeText(chat.direction, null),
    createdAt: normalizeText(chat.createdAt, null),
    updatedAt: normalizeText(chat.updatedAt, null),
    lastTurnAt: normalizeText(chat.lastTurnAt, null),
    conversationKey: normalizeText(chat.conversationKey, null),
    localSessionKey: normalizeText(chat.localSessionKey, normalizeText(chat.sessionKey, null)),
    turnCount: normalizeInteger(chat.turnCount, null),
    counterparty: projectToolAgentSummary(chat.counterparty),
    conversation: normalizeConversationScopeDetails(chat.conversation),
    feedbackSummary: projectConversationFeedbackSummary(chat.feedbackSummary),
  };
}

function projectChatInboxFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return {};
  const projected = {
    direction: normalizeText(filters.direction, null),
    mode: normalizeText(filters.mode, null),
    status: normalizeText(filters.status, null),
    worldId: normalizeText(filters.worldId, null),
    chatRequestId: normalizeText(filters.chatRequestId, null),
    conversationKey: normalizeText(filters.conversationKey, null),
    localSessionKey: normalizeText(filters.localSessionKey, null),
    counterpartyAgentId: normalizeText(filters.counterpartyAgentId, null),
  };
  return Object.fromEntries(
    Object.entries(projected).filter(([, value]) => value != null),
  );
}

function projectChatInboxCountBlock(counts = {}, fallback = {}) {
  return {
    pendingRequestCount: normalizeInteger(counts.pendingRequestCount, fallback.pendingRequestCount ?? 0),
    recentRequestCount: normalizeInteger(counts.recentRequestCount, fallback.recentRequestCount ?? 0),
    recentRequestStatusCounts: counts.recentRequestStatusCounts
      && typeof counts.recentRequestStatusCounts === 'object'
      && !Array.isArray(counts.recentRequestStatusCounts)
      ? {
          expired: normalizeInteger(counts.recentRequestStatusCounts.expired, 0),
          rejected: normalizeInteger(counts.recentRequestStatusCounts.rejected, 0),
        }
      : {
          expired: 0,
          rejected: 0,
        },
    chatCount: normalizeInteger(counts.chatCount, fallback.chatCount ?? 0),
    chatStatusCounts: counts.chatStatusCounts && typeof counts.chatStatusCounts === 'object' && !Array.isArray(counts.chatStatusCounts)
      ? {
          opening: normalizeInteger(counts.chatStatusCounts.opening, 0),
          ending: normalizeInteger(counts.chatStatusCounts.ending, 0),
          active: normalizeInteger(counts.chatStatusCounts.active, 0),
          silent: normalizeInteger(counts.chatStatusCounts.silent, 0),
          kickoff_failed: normalizeInteger(counts.chatStatusCounts.kickoff_failed, 0),
          ended: normalizeInteger(counts.chatStatusCounts.ended, 0),
        }
      : {
          opening: 0,
          ending: 0,
          active: 0,
          silent: 0,
          kickoff_failed: 0,
          ended: 0,
        },
  };
}

export function projectToolChatRequestMutationResponse(result = {}, { accountId = null } = {}) {
  const request = result.chatRequest && typeof result.chatRequest === 'object'
    ? result.chatRequest
    : result.request && typeof result.request === 'object'
      ? result.request
      : result;
  const projectedRequest = projectChatRequestItem(request);
  const kickoff = projectChatRequestKickoff(result.kickoff || result.request?.kickoff);
  const projectedChat = projectChatInboxChatItem(result.chat);
  const normalizedStatus = normalizeText(result.status, projectedRequest?.status || 'pending');
  return {
    status: normalizedStatus,
    accountId: normalizeText(accountId, null),
    chatRequest: projectedRequest,
    ...(projectedChat ? { chat: projectedChat } : {}),
    kickoff,
    nextAction: normalizeText(
      result.nextAction,
      normalizedStatus === 'accepted'
        ? kickoff?.status === 'established'
          ? 'runtime_owns_live_conversation'
          : kickoff?.status === 'sent'
            ? 'wait_for_sender_opener_delivery'
            : kickoff?.status === 'queued'
              ? 'wait_for_sender_runtime_availability'
              : kickoff?.status === 'failed'
                ? 'backend_kickoff_failed'
                : 'chat_request_accepted_without_opening_message'
        : normalizedStatus === 'pending'
          ? 'wait_for_peer_acceptance'
          : 'chat_request_closed',
    ),
  };
}

export function projectToolChatInboxResponse(result = {}, { accountId = null } = {}) {
  const pendingRequests = Array.isArray(result.pendingRequests)
    ? result.pendingRequests.map((request) => projectChatRequestItem(request)).filter(Boolean)
    : [];
  const recentRequests = Array.isArray(result.recentRequests)
    ? result.recentRequests.map((request) => projectChatRequestItem(request)).filter(Boolean)
    : [];
  const chats = Array.isArray(result.chats)
    ? result.chats.map((chat) => projectChatInboxChatItem(chat)).filter(Boolean)
    : [];
  const projectedFilters = projectChatInboxFilters(result.filters);
  const globalCounts = projectChatInboxCountBlock(result.counts?.global, {
    pendingRequestCount: pendingRequests.length,
    recentRequestCount: recentRequests.length,
    chatCount: chats.length,
  });
  const filteredCounts = projectChatInboxCountBlock(result.counts?.filtered, {
    pendingRequestCount: pendingRequests.length,
    recentRequestCount: recentRequests.length,
    chatCount: chats.length,
  });
  return {
    accountId: normalizeText(accountId, null),
    filters: projectedFilters,
    counts: {
      global: globalCounts,
      filtered: filteredCounts,
    },
    pendingRequests,
    recentRequests,
    chats,
  };
}
