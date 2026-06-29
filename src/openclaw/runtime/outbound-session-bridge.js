function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function clonePayload(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function buildManagementSessionKey(agentId = null) {
  const normalizedAgentId = normalizeText(agentId, null);
  return normalizedAgentId ? `management:${normalizedAgentId}` : null;
}

export function createOutboundSessionBridge() {
  return {
    createReplyEnvelope({
      deliveryId,
      sessionKey,
      replyText,
      source = 'subagent',
    } = {}) {
      const normalizedReplyText = normalizeText(replyText, '');
      const normalizedDeliveryId = normalizeText(deliveryId, null);
      const normalizedSessionKey = normalizeText(sessionKey, null);
      return {
        eventType: 'reply',
        deliveryId: normalizedDeliveryId,
        sessionKey: normalizedSessionKey,
        payload: {
          text: normalizedReplyText,
          source: normalizeText(source, 'subagent'),
        },
      };
    },
    createLongRunningIntentHandoffEnvelope({
      agentId,
      intentId = null,
      summary,
      allowedActions = [],
      reportPolicy = 'material_updates',
      sourceSessionKey = null,
      payload = {},
    } = {}) {
      const sessionKey = buildManagementSessionKey(agentId);
      return {
        eventType: 'management_wake',
        sessionKind: 'management',
        sessionKey,
        payload: {
          eventType: 'management_wake',
          reason: 'external_main_long_running_intent_handoff',
          intentId: normalizeText(intentId, null),
          summary: normalizeText(summary, ''),
          allowedActions: Array.isArray(allowedActions)
            ? allowedActions.map((action) => normalizeText(action, null)).filter(Boolean)
            : [],
          reportPolicy: normalizeText(reportPolicy, 'material_updates'),
          sourceSessionKey: normalizeText(sourceSessionKey, null),
          targetAgentId: normalizeText(agentId, null),
          ...clonePayload(payload),
        },
      };
    },
    createManagementReportEnvelope({
      agentId,
      reportId = null,
      reportText,
      targetSessionKey = null,
      payload = {},
    } = {}) {
      return {
        eventType: 'management_report',
        sessionKind: 'external_main',
        sessionKey: normalizeText(targetSessionKey, null),
        payload: {
          eventType: 'management_report',
          reportId: normalizeText(reportId, null),
          text: normalizeText(reportText, ''),
          sourceSessionKey: buildManagementSessionKey(agentId),
          sourceAgentId: normalizeText(agentId, null),
          ...clonePayload(payload),
        },
      };
    },
  };
}
