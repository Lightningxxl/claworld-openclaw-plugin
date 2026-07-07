import {
  projectToolChatInboxResponse,
  projectToolChatRequestMutationResponse,
  projectToolManagedWorldResponse,
  projectToolOwnedWorldsResponse,
  projectToolWorldBroadcastResponse,
  projectToolWorldMembershipListResponse,
  projectToolWorldMembershipResponse,
} from '../runtime/tool-contracts.js';
import {
  buildPublicErrorPayload,
  createRuntimeBoundaryError,
  logRuntimeBoundary,
  normalizeRuntimeBoundaryError,
} from '../../lib/runtime-errors.js';
import {
  normalizeBackendFieldError,
  normalizeBackendMissingField,
  normalizeBackendPublicIdentity,
} from '../runtime/backend-error-context.js';

export const INTERNAL_REQUESTER_SESSION_KEY_PARAM = '__claworldRequesterSessionKey';

export function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function normalizeObject(value, fallback = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value;
}

function resolveRuntimeAppToken(runtimeConfig = {}) {
  return normalizeText(
    runtimeConfig?.appToken,
    normalizeText(
      runtimeConfig?.relay?.appToken,
      normalizeText(runtimeConfig?.relay?.credentialToken, null),
    ),
  );
}

async function buildPendingPublicIdentityError({
  plugin,
  cfg,
  accountId,
  runtimeConfig,
  agentId = null,
  capability,
} = {}) {
  const getPublicIdentity = plugin?.runtime?.productShell?.profile?.getPublicIdentity;
  const capabilityLabel = normalizeText(capability, 'this Claworld capability');
  const fallbackMessage = `${capabilityLabel} requires a public Claworld identity`;
  if (typeof getPublicIdentity !== 'function') {
    return createRuntimeBoundaryError({
      code: 'public_identity_incomplete',
      category: 'conflict',
      status: 409,
      message: fallbackMessage,
      publicMessage: fallbackMessage,
      recoverable: true,
      context: {
        accountId: normalizeText(accountId, null),
        agentId: normalizeText(agentId, null),
        httpStatus: 409,
        backendCode: 'public_identity_incomplete',
        backendMessage: fallbackMessage,
        requiredAction: 'set_public_identity',
        nextAction: 'set_public_identity',
        nextTool: 'claworld_manage_account',
      },
    });
  }

  const identityPayload = await getPublicIdentity({
    cfg,
    accountId,
    runtimeConfig,
    agentId: normalizeText(agentId, null),
    generateShareCard: false,
    expiresInSeconds: null,
  });
  const publicMessage = normalizeText(identityPayload?.message, fallbackMessage);
  return createRuntimeBoundaryError({
    code: 'public_identity_incomplete',
    category: 'conflict',
    status: 409,
    message: publicMessage,
    publicMessage,
    recoverable: true,
    context: {
      accountId: normalizeText(accountId, null),
      agentId: normalizeText(
        agentId,
        normalizeText(identityPayload?.agentId, null),
      ),
      httpStatus: 409,
      backendCode: 'public_identity_incomplete',
      backendMessage: publicMessage,
      requiredAction: normalizeText(identityPayload?.requiredAction, 'set_public_identity'),
      nextAction: normalizeText(identityPayload?.nextAction, 'set_public_identity'),
      nextTool: normalizeText(identityPayload?.nextTool, 'claworld_manage_account'),
      missingFields: Array.isArray(identityPayload?.missingFields) ? identityPayload.missingFields : [],
      publicIdentity: normalizeObject(identityPayload?.publicIdentity, null),
    },
  });
}

function normalizePublicFieldError(fieldError = {}) {
  const fieldId = normalizeText(fieldError.fieldId, null);
  const message = normalizeText(fieldError.message, null);
  const code = normalizeText(fieldError.code, null);
  if (!fieldId && !message && !code) return null;
  return {
    ...(fieldId ? { fieldId } : {}),
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
  };
}

export function buildPublicToolErrorExtras(error) {
  const context = normalizeObject(error?.context, null);
  if (!context) return null;

  const httpStatus = Number(context.httpStatus);
  const backendCode = normalizeText(context.backendCode, null);
  const backendMessage = normalizeText(context.backendMessage, null);
  const fieldErrors = Array.isArray(context.fieldErrors)
    ? context.fieldErrors
      .map((fieldError) => normalizeBackendFieldError(fieldError) || normalizePublicFieldError(fieldError))
      .filter(Boolean)
    : [];
  const requiredAction = normalizeText(context.requiredAction, null);
  const nextAction = normalizeText(context.nextAction, null);
  const nextTool = normalizeText(context.nextTool, null);
  const missingFields = Array.isArray(context.missingFields)
    ? context.missingFields
      .map((field) => normalizeBackendMissingField(field))
      .filter(Boolean)
    : [];
  const publicIdentity = normalizeBackendPublicIdentity(context.publicIdentity);

  const extra = {
    ...(Number.isInteger(httpStatus) && httpStatus > 0 ? { httpStatus } : {}),
    ...(backendCode ? { backendCode } : {}),
    ...(backendMessage ? { backendMessage } : {}),
    ...(fieldErrors.length > 0 ? { fieldErrors } : {}),
    ...(requiredAction ? { requiredAction } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(nextTool ? { nextTool } : {}),
    ...(missingFields.length > 0 ? { missingFields } : {}),
    ...(publicIdentity ? { publicIdentity } : {}),
  };

  return Object.keys(extra).length > 0 ? extra : null;
}

export async function loadCurrentConfig(api) {
  if (api?.config && typeof api.config.loadConfig === 'function') {
    return await api.config.loadConfig();
  }
  if (api?.config && typeof api.config === 'object') {
    return api.config;
  }
  if (api?.runtime?.config && typeof api.runtime.config.loadConfig === 'function') {
    return await api.runtime.config.loadConfig();
  }
  return {};
}

export function buildToolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function buildToolErrorResult(toolName, error) {
  const normalized = normalizeRuntimeBoundaryError(error, {
    code: 'claworld_tool_execution_failed',
    category: 'runtime',
    publicMessage: 'tool execution failed',
    recoverable: true,
  });
  return buildToolResult({
    status: 'error',
    tool: toolName,
    ...buildPublicErrorPayload(normalized, {
      errorType: 'claworld_tool_failed',
      fallbackMessage: 'tool execution failed',
      exposeMessage: normalized.status < 500 || Boolean(normalized.publicMessage),
      extra: buildPublicToolErrorExtras(normalized),
    }),
  });
}

export function withToolErrorBoundary(toolName, execute) {
  return async (toolCallId, params = {}) => {
    try {
      return await execute(toolCallId, params);
    } catch (error) {
      const normalized = logRuntimeBoundary(console, `[claworld:tool:${toolName}] execution failed`, error, {
        tool: toolName,
      }, {
        includeStack: false,
        fallback: {
          code: 'claworld_tool_execution_failed',
          category: 'runtime',
          publicMessage: 'tool execution failed',
          recoverable: true,
        },
      });
      return buildToolErrorResult(toolName, normalized);
    }
  };
}

export async function resolveToolContext(
  api,
  plugin,
  params = {},
  {
    bindRuntime = true,
    requiredPublicIdentityCapability = null,
  } = {},
) {
  const cfg = await loadCurrentConfig(api);
  const accountId = normalizeText(params.accountId, plugin.config.defaultAccountId(cfg) || null);
  const runtimeConfig = plugin.config.resolveRuntimeConfig(cfg, accountId);

  if (bindRuntime && typeof plugin.helpers?.resolveToolRuntimeContext === 'function') {
    const resolvedContext = await plugin.helpers.resolveToolRuntimeContext({
      cfg,
      runtime: api?.runtime || null,
      accountId,
      runtimeConfig,
      agentId: normalizeText(params.agentId, runtimeConfig.relay?.agentId || null),
      requesterSessionKey: normalizeText(params[INTERNAL_REQUESTER_SESSION_KEY_PARAM], null),
    });
    if (
      requiredPublicIdentityCapability
      && (
        !normalizeText(resolvedContext?.agentId, null)
        || !resolveRuntimeAppToken(resolvedContext?.runtimeConfig || runtimeConfig)
      )
    ) {
      throw await buildPendingPublicIdentityError({
        plugin,
        cfg,
        accountId: resolvedContext?.accountId || accountId,
        runtimeConfig: resolvedContext?.runtimeConfig || runtimeConfig,
        agentId: resolvedContext?.agentId || null,
        capability: requiredPublicIdentityCapability,
      });
    }
    return resolvedContext;
  }

  const agentId = normalizeText(params.agentId, runtimeConfig.relay?.agentId || null);
  if (
    requiredPublicIdentityCapability
    && (!agentId || !resolveRuntimeAppToken(runtimeConfig))
  ) {
    throw await buildPendingPublicIdentityError({
      plugin,
      cfg,
      accountId,
      runtimeConfig,
      agentId,
      capability: requiredPublicIdentityCapability,
    });
  }
  return {
    cfg,
    accountId,
    runtimeConfig,
    agentId,
    requesterSessionKey: normalizeText(params[INTERNAL_REQUESTER_SESSION_KEY_PARAM], null),
  };
}

export function cloneMetadataValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function stringParam({
  description = null,
  minLength = null,
  enumValues = null,
  pattern = null,
  examples = [],
} = {}) {
  return {
    type: 'string',
    ...(description ? { description } : {}),
    ...(Number.isInteger(minLength) && minLength > 0 ? { minLength } : {}),
    ...(Array.isArray(enumValues) && enumValues.length > 0 ? { enum: enumValues } : {}),
    ...(pattern ? { pattern } : {}),
    ...(Array.isArray(examples) && examples.length > 0 ? { examples } : {}),
  };
}

export function integerParam({
  description = null,
  minimum = null,
  maximum = null,
  examples = [],
} = {}) {
  return {
    type: 'integer',
    ...(description ? { description } : {}),
    ...(Number.isInteger(minimum) ? { minimum } : {}),
    ...(Number.isInteger(maximum) ? { maximum } : {}),
    ...(Array.isArray(examples) && examples.length > 0 ? { examples } : {}),
  };
}

export function booleanParam({
  description = null,
  defaultValue = null,
} = {}) {
  return {
    type: 'boolean',
    ...(description ? { description } : {}),
    ...(typeof defaultValue === 'boolean' ? { default: defaultValue } : {}),
  };
}

export function objectParam({
  description = null,
  properties = {},
  required = [],
  additionalProperties = false,
  examples = [],
} = {}) {
  return {
    type: 'object',
    additionalProperties,
    ...(description ? { description } : {}),
    ...(Array.isArray(required) && required.length > 0 ? { required } : {}),
    properties,
    ...(Array.isArray(examples) && examples.length > 0 ? { examples: examples.map(cloneMetadataValue) } : {}),
  };
}

export function arrayParam({
  description = null,
  items = {},
  maxItems = null,
  examples = [],
} = {}) {
  return {
    type: 'array',
    items,
    ...(description ? { description } : {}),
    ...(Number.isInteger(maxItems) ? { maxItems } : {}),
    ...(Array.isArray(examples) && examples.length > 0 ? { examples: examples.map(cloneMetadataValue) } : {}),
  };
}

export function buildToolMetadata({
  category,
  usageNotes = [],
  examples = [],
} = {}) {
  return {
    surface: 'canonical_public',
    canonical: true,
    category: normalizeText(category, 'general'),
    usageNotes: Array.isArray(usageNotes) ? usageNotes.filter(Boolean) : [],
    examples: Array.isArray(examples)
      ? examples.map((example) => cloneMetadataValue(example)).filter(Boolean)
      : [],
  };
}

export const MANAGE_WORLD_ACTIONS = Object.freeze([
  'list',
  'get',
  'broadcast',
  'update_context',
  'pause',
  'close',
  'resume',
  'list_memberships',
  'get_membership',
  'update_profile',
  'leave',
]);

export function normalizeManageWorldAction(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return MANAGE_WORLD_ACTIONS.includes(normalized) ? normalized : fallback;
}

export function inferManageWorldAction(params = {}) {
  const explicitAction = normalizeManageWorldAction(params.action, null);
  if (explicitAction) return explicitAction;
  if (!normalizeText(params.worldId, null)) return 'list';
  if (normalizeText(params.announcementText, null)) return 'broadcast';
  if (normalizeText(params.participantContextText, null)) return 'update_profile';
  if (
    normalizeText(params.worldContextText, null)
    || normalizeText(params.displayName, null)
    || normalizeObject(params.broadcast, null)
    || normalizeText(params.visibility, null)
    || normalizeText(params.identityMode, null)
    || normalizeText(params.joinPolicy, null)
    || normalizeText(params.approvalPolicy, null)
  ) {
    return 'update_context';
  }
  return 'get';
}

export function requireManageWorldField(fieldId, message = `${fieldId} is required`) {
  throw createRuntimeBoundaryError({
    code: 'tool_input_invalid',
    category: 'input',
    status: 400,
    message,
    publicMessage: message,
    recoverable: true,
    context: { field: fieldId },
  });
}

export function projectToolManageWorldActionResponse(payload = {}, { accountId = null, action = null } = {}) {
  const resolvedAction = normalizeManageWorldAction(action, null) || 'get';
  if (resolvedAction === 'list') {
    return {
      action: resolvedAction,
      ...projectToolOwnedWorldsResponse(payload, { accountId }),
    };
  }
  if (resolvedAction === 'broadcast') {
    return {
      action: resolvedAction,
      ...projectToolWorldBroadcastResponse(payload, { accountId }),
    };
  }
  if (resolvedAction === 'list_memberships') {
    return {
      action: resolvedAction,
      ...projectToolWorldMembershipListResponse(payload, { accountId }),
    };
  }
  if (['get_membership', 'update_profile', 'leave'].includes(resolvedAction)) {
    return {
      action: resolvedAction,
      ...projectToolWorldMembershipResponse(payload, { accountId }),
    };
  }
  return {
    action: resolvedAction,
    ...projectToolManagedWorldResponse(payload, { accountId }),
  };
}

export const CHAT_INBOX_ACTIONS = Object.freeze([
  'list',
  'accept',
  'reject',
]);

function normalizeChatInboxAction(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return CHAT_INBOX_ACTIONS.includes(normalized) ? normalized : fallback;
}

export function inferChatInboxAction(params = {}) {
  return normalizeChatInboxAction(params.action, 'list');
}

export function projectToolChatInboxActionResponse(payload = {}, { accountId = null, action = 'list' } = {}) {
  const resolvedAction = normalizeChatInboxAction(action, 'list');
  if (resolvedAction === 'list') {
    return {
      action: resolvedAction,
      ...projectToolChatInboxResponse(payload, { accountId }),
    };
  }
  return {
    action: resolvedAction,
    ...projectToolChatRequestMutationResponse(payload, { accountId }),
  };
}

export const ACCOUNT_ACTIONS = Object.freeze([
  'view',
  'update_identity',
  'update_profile',
  'update_chat_request_policy',
]);

function normalizeAccountAction(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return ACCOUNT_ACTIONS.includes(normalized) ? normalized : fallback;
}

export function inferAccountAction(params = {}) {
  const explicitAction = normalizeAccountAction(params.action, null);
  if (explicitAction) return explicitAction;
  if (normalizeText(params.displayName, null)) return 'update_identity';
  if (Object.prototype.hasOwnProperty.call(params, 'profile')) return 'update_profile';
  if (normalizeObject(params.chatRequestPolicy, null)) return 'update_chat_request_policy';
  return 'view';
}

function projectToolPublicIdentity(payload = null) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    status: payload.status || null,
    ready: payload.ready ?? null,
    publicIdentity: payload.publicIdentity && typeof payload.publicIdentity === 'object'
      ? {
          status: payload.publicIdentity.status || null,
          displayIdentity: payload.publicIdentity.displayIdentity || null,
          displayName: payload.publicIdentity.displayName || null,
          code: payload.publicIdentity.code || null,
          confirmedAt: payload.publicIdentity.confirmedAt || null,
          updatedAt: payload.publicIdentity.updatedAt || null,
        }
      : null,
    recommendedDisplayName: payload.recommendedDisplayName || null,
    requiredAction: payload.requiredAction || null,
    nextAction: payload.nextAction || null,
    nextTool: payload.nextTool || null,
    missingFields: Array.isArray(payload.missingFields) ? payload.missingFields : [],
    feedbackSummary: payload.feedbackSummary && typeof payload.feedbackSummary === 'object'
      ? {
          totalLikesReceived: Number(payload.feedbackSummary.totalLikesReceived || 0),
          totalDislikesReceived: Number(payload.feedbackSummary.totalDislikesReceived || 0),
          totalLikesGiven: Number(payload.feedbackSummary.totalLikesGiven || 0),
          totalDislikesGiven: Number(payload.feedbackSummary.totalDislikesGiven || 0),
        }
      : null,
  };
}

function projectToolShareCard(payload = null) {
  const imageUrl = normalizeText(payload?.imageUrl, null);
  const downloadUrl = normalizeText(payload?.downloadUrl, imageUrl);
  const templateId = normalizeText(payload?.templateId, null);
  const variant = normalizeText(payload?.variant, null);
  const imageFormat = normalizeText(payload?.imageFormat, null);
  const mimeType = normalizeText(payload?.mimeType, null);
  const expiresAt = normalizeText(payload?.expiresAt, null);
  const description = normalizeText(payload?.description, null);
  if (!imageUrl && !downloadUrl && !templateId && !variant && !imageFormat && !mimeType && !expiresAt && !description) {
    return {
      status: normalizeText(payload?.status, 'unavailable'),
      reason: normalizeText(payload?.reason, null),
      message: normalizeText(payload?.message, null),
    };
  }
  return {
    status: normalizeText(payload?.status, 'ready'),
    imageUrl,
    downloadUrl,
    templateId,
    variant,
    imageFormat,
    mimeType,
    expiresAt,
    description,
  };
}

function projectToolAccountIdentityFields(identityPayload = null) {
  const projectedIdentity = projectToolPublicIdentity(identityPayload);
  if (projectedIdentity) {
    return {
      publicIdentity: projectedIdentity.publicIdentity,
      recommendedDisplayName: projectedIdentity.recommendedDisplayName,
      requiredAction: projectedIdentity.requiredAction,
      nextAction: projectedIdentity.nextAction,
      nextTool: projectedIdentity.nextTool,
      missingFields: projectedIdentity.missingFields,
      feedbackSummary: projectedIdentity.feedbackSummary,
    };
  }
  return {
    publicIdentity: null,
    recommendedDisplayName: null,
    requiredAction: null,
    nextAction: null,
    nextTool: null,
    missingFields: [],
    feedbackSummary: null,
  };
}

function projectToolAccountProfile(identityPayload = null) {
  return normalizeText(identityPayload?.profile, null);
}

function projectToolAccountProfileState(identityPayload = null) {
  const profilePayload = normalizeObject(identityPayload?.accountProfile, null);
  const profile = normalizeText(profilePayload?.profile, projectToolAccountProfile(identityPayload));
  const ready = profilePayload
    ? profilePayload.ready === true
    : Boolean(profile);
  return {
    status: normalizeText(profilePayload?.status, ready ? 'ready' : 'pending'),
    ready,
    profile,
    reason: normalizeText(profilePayload?.reason, ready ? null : 'account_profile_missing'),
    requiredAction: normalizeText(profilePayload?.requiredAction, ready ? null : 'update_agent_profile'),
    nextAction: normalizeText(profilePayload?.nextAction, ready ? null : 'update_agent_profile'),
    nextTool: normalizeText(profilePayload?.nextTool, ready ? null : 'claworld_manage_account'),
    missingFields: Array.isArray(profilePayload?.missingFields)
      ? profilePayload.missingFields
      : (ready
          ? []
          : [
              {
                fieldId: 'profile',
                label: 'Account Profile',
                description: 'A non-empty global Claworld account profile used when other agents need to know who you are.',
              },
            ]),
  };
}

function projectToolChatRequestApprovalPolicy(payload = null) {
  const policy = normalizeObject(payload, null);
  if (!policy) return null;
  return {
    agentId: normalizeText(policy.agentId, null),
    schemaVersion: Number.isInteger(policy.schemaVersion) ? policy.schemaVersion : null,
    syncedAt: normalizeText(policy.syncedAt, null),
    credentialId: normalizeText(policy.credentialId, null),
    source: normalizeObject(policy.source, {})
      ? {
          channel: normalizeText(policy.source?.channel, null),
          integration: normalizeText(policy.source?.integration, null),
          accountId: normalizeText(policy.source?.accountId, null),
        }
      : {},
    policy: normalizeObject(policy.policy, {})
      ? {
          mode: normalizeText(policy.policy?.mode, null),
          blocks: {
            originTypes: Array.isArray(policy.policy?.blocks?.originTypes) ? policy.policy.blocks.originTypes : [],
            worldIds: Array.isArray(policy.policy?.blocks?.worldIds) ? policy.policy.blocks.worldIds : [],
          },
        }
      : null,
  };
}

function projectToolPluginVersionStatus(payload = null) {
  const versionStatus = normalizeObject(payload, null);
  if (!versionStatus) return null;

  const warning = normalizeObject(versionStatus.warning, null);
  return {
    reportedVersion: normalizeText(versionStatus.reportedVersion, null),
    minSupportedVersion: normalizeText(versionStatus.minSupportedVersion, null),
    latestVersion: normalizeText(versionStatus.latestVersion, null),
    compatible: typeof versionStatus.compatible === 'boolean' ? versionStatus.compatible : null,
    status: normalizeText(versionStatus.status, 'unknown'),
    upgradeCommand: normalizeText(versionStatus.upgradeCommand, null),
    message: normalizeText(versionStatus.message, null),
    ...(warning
      ? {
          warning: {
            level: normalizeText(warning.level, null),
            code: normalizeText(warning.code, null),
            message: normalizeText(warning.message, null),
          },
        }
      : {}),
  };
}

export function projectToolAccountViewResponse({
  accountId = null,
  pairingPayload = null,
  identityPayload = null,
} = {}) {
  const publicIdentityState = projectToolAccountIdentityFields(identityPayload);
  const accountProfile = projectToolAccountProfileState(identityPayload);
  const publicIdentityReady = identityPayload?.ready === true;
  const accountProfileReady = accountProfile.ready === true;
  const emailVerified = pairingPayload?.emailVerified === true;
  const runtimePaired = pairingPayload?.status === 'paired';
  const bindingReady = typeof pairingPayload?.bindingReady === 'boolean'
    ? pairingPayload.bindingReady
    : runtimePaired;
  const bindingStatus = normalizeText(
    pairingPayload?.bindingStatus,
    runtimePaired
      ? (bindingReady ? 'bound' : 'identity_unresolved')
      : 'unbound',
  );
  const ready = emailVerified && publicIdentityReady && accountProfileReady;
  const blockedAction = !emailVerified
    ? {
        requiredAction: 'start_email_verification',
        nextAction: 'start_email_verification',
        nextTool: 'claworld_manage_account',
        missingFields: [{ fieldId: 'email', label: 'Identity Email', description: 'Email-based identity verification is required before using other account features.' }],
        reason: 'email_verification_required',
      }
    : !publicIdentityReady
    ? {
        requiredAction: publicIdentityState.requiredAction,
        nextAction: publicIdentityState.nextAction,
        nextTool: publicIdentityState.nextTool,
        missingFields: publicIdentityState.missingFields,
        reason: 'public_identity_incomplete',
      }
    : !accountProfileReady
      ? {
          requiredAction: accountProfile.requiredAction,
          nextAction: accountProfile.nextAction,
          nextTool: accountProfile.nextTool,
          missingFields: accountProfile.missingFields,
          reason: accountProfile.reason,
        }
      : {
          requiredAction: null,
          nextAction: null,
          nextTool: null,
          missingFields: [],
          reason: null,
        };
  const relayResolved = pairingPayload?.relayAgent?.resolved ?? null;
  const relayOnline = pairingPayload?.relayAgent?.online ?? null;
  const resolvedShareCard = identityPayload && Object.prototype.hasOwnProperty.call(identityPayload, 'shareCard')
    ? projectToolShareCard(identityPayload.shareCard)
    : undefined;
  return {
    action: 'view',
    status: ready ? 'ready' : 'pending',
    ready,
    readiness: !emailVerified
      ? 'email_verification_required'
      : !publicIdentityReady
        ? 'public_identity_incomplete'
        : accountProfileReady
          ? 'ready'
          : 'account_profile_incomplete',
    accountId: normalizeText(pairingPayload?.runtimeConfig?.accountId, normalizeText(accountId, null)),
    reason: blockedAction.reason,
    bindingReason: normalizeText(pairingPayload?.reason, null),
    bindingSource: normalizeText(pairingPayload?.bindingSource, null),
    emailVerification: {
      status: emailVerified ? 'verified' : 'pending',
      email: normalizeText(pairingPayload?.email, null),
      verifiedAt: normalizeText(pairingPayload?.verifiedAt, null),
    },
    diagnostics: {
      toolReachable: true,
      emailVerified,
      bindingReady,
      bindingStatus,
      publicIdentityReady,
      accountProfileReady,
      relayPresenceResolved: relayResolved,
      relayOnline,
    },
    relay: {
      agentId: normalizeText(
        pairingPayload?.runtimeConfig?.relay?.agentId,
        normalizeText(pairingPayload?.relayAgent?.agentId, null),
      ),
      displayName: normalizeText(pairingPayload?.relayAgent?.displayName, null),
      visibilityMode: normalizeText(pairingPayload?.relayAgent?.visibilityMode, null),
      contactMode: normalizeText(pairingPayload?.relayAgent?.contactMode, null),
      online: relayOnline,
      resolved: relayResolved,
      bindingStatus,
    },
    profile: accountProfile.profile,
    ...publicIdentityState,
    accountProfile,
    requiredAction: blockedAction.requiredAction,
    nextAction: blockedAction.nextAction,
    nextTool: blockedAction.nextTool,
    missingFields: blockedAction.missingFields,
    pluginVersionStatus: projectToolPluginVersionStatus(identityPayload?.pluginVersionStatus),
    chatRequestPolicy: projectToolChatRequestApprovalPolicy(identityPayload?.chatRequestPolicy),
    ...(resolvedShareCard !== undefined ? { shareCard: resolvedShareCard } : {}),
  };
}

export function projectToolAccountMutationResponse({
  action = 'update_identity',
  accountId = null,
  identityPayload = null,
  shareCard = undefined,
  runtimeIdentity = null,
} = {}) {
  const publicIdentityState = projectToolAccountIdentityFields(identityPayload);
  const accountProfile = projectToolAccountProfileState(identityPayload);
  const resolvedShareCard = shareCard !== undefined
    ? shareCard
    : (identityPayload && Object.prototype.hasOwnProperty.call(identityPayload, 'shareCard')
        ? projectToolShareCard(identityPayload.shareCard)
        : undefined);
  const publicIdentityReady = identityPayload?.ready === true;
  const accountProfileReady = accountProfile.ready === true;
  const emailVerificationPayload = normalizeObject(identityPayload?.emailVerification, null);
  const emailVerified = identityPayload?.emailVerified === true
    || normalizeText(emailVerificationPayload?.status, null) === 'verified';
  const ready = emailVerified && publicIdentityReady && accountProfileReady;
  const blockedAction = !emailVerified
    ? {
        requiredAction: 'start_email_verification',
        nextAction: 'start_email_verification',
        nextTool: 'claworld_manage_account',
        missingFields: [{ fieldId: 'email', label: 'Identity Email', description: 'Email-based identity verification is required before using other account features.' }],
        reason: 'email_verification_required',
      }
    : !publicIdentityReady
    ? {
        requiredAction: publicIdentityState.requiredAction,
        nextAction: publicIdentityState.nextAction,
        nextTool: publicIdentityState.nextTool,
        missingFields: publicIdentityState.missingFields,
        reason: 'public_identity_incomplete',
      }
    : !accountProfileReady
      ? {
          requiredAction: accountProfile.requiredAction,
          nextAction: accountProfile.nextAction,
          nextTool: accountProfile.nextTool,
          missingFields: accountProfile.missingFields,
          reason: accountProfile.reason,
        }
      : {
          requiredAction: null,
          nextAction: null,
          nextTool: null,
          missingFields: [],
          reason: null,
        };
  return {
    action,
    status: ready ? 'ready' : 'pending',
    ready,
    readiness: !emailVerified
      ? 'email_verification_required'
      : !publicIdentityReady
        ? 'public_identity_incomplete'
        : accountProfileReady
          ? 'ready'
          : 'account_profile_incomplete',
    accountId: normalizeText(accountId, null),
    emailVerification: {
      status: emailVerified ? 'verified' : 'pending',
      email: normalizeText(emailVerificationPayload?.email, null),
      verifiedAt: normalizeText(emailVerificationPayload?.verifiedAt, null),
    },
    diagnostics: {
      emailVerified,
      publicIdentityReady,
      accountProfileReady,
    },
    profile: accountProfile.profile,
    ...publicIdentityState,
    accountProfile,
    requiredAction: blockedAction.requiredAction,
    nextAction: blockedAction.nextAction,
    nextTool: blockedAction.nextTool,
    missingFields: blockedAction.missingFields,
    reason: blockedAction.reason,
    pluginVersionStatus: projectToolPluginVersionStatus(identityPayload?.pluginVersionStatus),
    chatRequestPolicy: projectToolChatRequestApprovalPolicy(identityPayload?.chatRequestPolicy),
    ...(resolvedShareCard !== undefined ? { shareCard: resolvedShareCard } : {}),
    ...(runtimeIdentity ? { runtimeIdentity } : {}),
    ...(action === 'update_identity'
      ? {
          updated: resolvedShareCard && resolvedShareCard.status === 'ready'
            ? ['publicIdentity', 'shareCard']
            : ['publicIdentity'],
        }
      : action === 'update_profile'
        ? {
            updated: ['profile'],
          }
      : action === 'update_chat_request_policy'
        ? {
            updated: ['chatRequestPolicy'],
          }
          : {}),
  };
}
