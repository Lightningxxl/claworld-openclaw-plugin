import { OPENCLAW_RUNTIME_PATH, createRuntimePathTrace } from './runtime-path.js';
import { resolveRuntimeSessionTarget } from './session-routing.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizePayload(payload = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return { ...payload };
}

export function createInboundSessionRouter() {
  return {
    runtimePath: OPENCLAW_RUNTIME_PATH,
    routeInboundEvent(event = {}, options = {}) {
      const eventType = normalizeText(event.eventType || event.type, null);
      const deliveryId = normalizeText(event.deliveryId || event.event_id || event.eventId, null);
      const payload = normalizePayload(event.payload);
      const target = resolveRuntimeSessionTarget(event, options);
      const sessionKey = target.sessionKey;
      return {
        target: target.target,
        fallbackTarget: normalizeText(options.fallbackTarget, 'mainagent'),
        sessionKind: target.sessionKind,
        eventType,
        deliveryId,
        sessionKey,
        managementSessionKey: target.managementSessionKey,
        conversationSessionKey: target.conversationSessionKey,
        targetAgentId: target.targetAgentId,
        conversationKey: target.conversationKey,
        payload,
        metadata: event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? { ...event.metadata }
          : {},
        trace: createRuntimePathTrace({
          sessionKey,
          eventId: deliveryId,
          direction: 'inbound',
        }),
        status: (
          target.sessionKind === 'management'
          && sessionKey
          && eventType
        ) || (
          eventType === 'delivery'
          && deliveryId
          && sessionKey
          && normalizeText(payload.text, null)
        )
          ? 'resolved'
          : 'invalid',
      };
    },
  };
}
