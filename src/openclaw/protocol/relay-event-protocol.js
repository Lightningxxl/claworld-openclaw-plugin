export const CLAWORLD_PLUGIN_BRIDGE_PROTOCOL = 'claworld.delivery_reply.v1';

const DELIVERY_EVENT_TYPE = 'delivery';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizePayload(payload = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return { ...payload };
}

export function createRelayEventProtocol() {
  return {
    version: CLAWORLD_PLUGIN_BRIDGE_PROTOCOL,
    eventTypes: [DELIVERY_EVENT_TYPE],
    requiredEnvelopeFields: ['eventType', 'deliveryId', 'sessionKey', 'payload'],
    describeEvent(event = {}) {
      const payload = normalizePayload(event.payload);
      const missing = [];
      const eventType = normalizeText(event.eventType, null);
      if (eventType !== DELIVERY_EVENT_TYPE) {
        missing.push('eventType');
      }
      if (eventType === DELIVERY_EVENT_TYPE && !normalizeText(event.deliveryId, null)) {
        missing.push('deliveryId');
      }
      if (!normalizeText(event.sessionKey, null)) {
        missing.push('sessionKey');
      }
      if (eventType === DELIVERY_EVENT_TYPE && !normalizeText(payload.text, null)) {
        missing.push('payload.text');
      }
      return {
        ok: missing.length === 0,
        missing,
        role: 'delivery',
      };
    },
  };
}
