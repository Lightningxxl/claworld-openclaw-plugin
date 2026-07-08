import { resolveClaworldRuntimeConfig } from '../plugin/config-schema.js';
import { buildRuntimeAuthHeaders, resolveRuntimeAppToken } from '../plugin/account-identity.js';
import { collectFeedbackDiagnostics } from './feedback-diagnostics.js';
import { fetchJson, normalizeRelayHttpBaseUrl } from './http-boundary.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeText(value, null)).filter(Boolean))];
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

export async function submitFeedbackReport({
  cfg = {},
  accountId = null,
  runtimeConfig = null,
  runtime = null,
  agentId = null,
  category = null,
  title = null,
  goal = null,
  actualBehavior = null,
  expectedBehavior = null,
  impact = null,
  details = null,
  reproductionSteps = [],
  context = {},
  fetchImpl,
  logger = console,
  toolCallId = null,
  source = 'openclaw_runtime',
  runtimeToolName = 'claworld_feedback_helper',
  accountToolAction = null,
  pluginVersion = null,
  toolContractVersion = null,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for claworld feedback helper');
  }

  const normalizedContext = normalizeObject(context);
  const resolvedRuntimeConfig = runtimeConfig || resolveClaworldRuntimeConfig(cfg, accountId);
  const resolvedAgentId = normalizeText(agentId, null);
  if (!resolvedAgentId) {
    throw new Error('claworld feedback helper requires agentId');
  }
  if (!resolveRuntimeAppToken(resolvedRuntimeConfig)) {
    throw new Error('claworld feedback helper requires appToken');
  }
  const diagnostics = await collectFeedbackDiagnostics({
    cfg,
    runtime,
    pluginVersion,
  });
  const baseUrl = normalizeRelayHttpBaseUrl(resolvedRuntimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/feedback`, {
    method: 'POST',
    headers: buildRuntimeAuthHeaders(resolvedRuntimeConfig, {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(resolvedRuntimeConfig.apiKey ? { 'x-api-key': resolvedRuntimeConfig.apiKey } : {}),
    }),
    body: JSON.stringify({
      agentId: resolvedAgentId,
      accountId: normalizeText(resolvedRuntimeConfig.accountId, normalizeText(accountId, null)),
      category,
      title,
      goal,
      actualBehavior,
      expectedBehavior,
      impact,
      details,
      reproductionSteps,
      context: {
        worldId: normalizeText(normalizedContext.worldId, null),
        conversationKey: normalizeText(normalizedContext.conversationKey, null),
        turnId: normalizeText(normalizedContext.turnId, null),
        deliveryId: normalizeText(normalizedContext.deliveryId, null),
        targetAgentId: normalizeText(normalizedContext.targetAgentId, null),
        tags: normalizeStringList(normalizedContext.tags),
        metadata: normalizeObject(normalizedContext.metadata),
      },
      source: normalizeText(source, 'openclaw_runtime'),
      runtimeContext: {
        channelId: 'claworld',
        toolName: normalizeText(runtimeToolName, 'claworld_feedback_helper'),
        accountToolAction: normalizeText(accountToolAction, null),
        toolCallId: normalizeText(toolCallId, null),
        ...diagnostics,
        toolContractVersion: normalizeText(toolContractVersion, null),
        accountId: normalizeText(resolvedRuntimeConfig.accountId, normalizeText(accountId, null)),
        serverUrl: baseUrl,
        relayAgentId: resolvedAgentId,
        defaultTargetAgentId: normalizeText(resolvedRuntimeConfig.relay?.defaultTargetAgentId, null),
      },
    }),
  });

  if (!result.ok) {
    logger.error?.('[claworld:feedback] feedback submit failed', {
      status: result.status,
      accountId: resolvedRuntimeConfig.accountId || accountId || null,
      body: result.body,
    });
    throw new Error(`claworld feedback submit failed: ${result.status}`);
  }

  return result.body;
}
