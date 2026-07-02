import {
  CLAWORLD_CLIENT_CHANNEL_HEADER,
  CLAWORLD_CLIENT_HEADER,
  CLAWORLD_CLIENT_VERSION_HEADER,
  CLAWORLD_OPENCLAW_PLUGIN_CLIENT,
  CLAWORLD_PLUGIN_CURRENT_VERSION,
  CLAWORLD_PLUGIN_VERSION_HEADER,
  inferClaworldClientChannel,
} from '../plugin-version.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function normalizeRuntimeRegistration(candidate = {}) {
  const registration = candidate.registration && typeof candidate.registration === 'object'
    ? candidate.registration
    : {};
  const enabled = registration.enabled === true;

  if (!enabled) return { enabled: false };

  return {
    enabled: true,
    displayName: normalizeText(registration.displayName, null),
  };
}

export function resolveRuntimeAppToken(candidate = {}) {
  return normalizeText(
    candidate.appToken,
    normalizeText(
      candidate.relay?.appToken,
      normalizeText(candidate.relay?.credentialToken, null),
    ),
  );
}

export function applyRuntimeIdentity(runtimeConfig = {}, { agentId = null, appToken = null } = {}) {
  const resolvedAppToken = normalizeText(appToken, resolveRuntimeAppToken(runtimeConfig));
  const registration = normalizeRuntimeRegistration(runtimeConfig);
  const relay = runtimeConfig.relay && typeof runtimeConfig.relay === 'object'
    ? runtimeConfig.relay
    : {};

  return {
    ...runtimeConfig,
    appToken: resolvedAppToken,
    registration,
    localAgent: registration,
    relay: {
      ...relay,
      agentId: normalizeText(agentId, normalizeText(relay.agentId, null)),
      appToken: resolvedAppToken,
      credentialToken: resolvedAppToken,
      defaultTargetAgentId: normalizeText(relay.defaultTargetAgentId, null),
    },
  };
}

export function buildRuntimeAuthHeaders(runtimeConfig = {}, headers = {}) {
  const appToken = resolveRuntimeAppToken(runtimeConfig);
  const nextHeaders = {
    ...headers,
    [CLAWORLD_CLIENT_HEADER]: CLAWORLD_OPENCLAW_PLUGIN_CLIENT,
    [CLAWORLD_CLIENT_VERSION_HEADER]: CLAWORLD_PLUGIN_CURRENT_VERSION,
    [CLAWORLD_CLIENT_CHANNEL_HEADER]: inferClaworldClientChannel(),
    [CLAWORLD_PLUGIN_VERSION_HEADER]: CLAWORLD_PLUGIN_CURRENT_VERSION,
  };
  if (!appToken) return nextHeaders;
  return {
    ...nextHeaders,
    authorization: `Bearer ${appToken}`,
    'x-claworld-app-token': appToken,
  };
}
