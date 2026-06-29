import {
  applyRuntimeIdentity,
  normalizeRuntimeRegistration,
  resolveRuntimeAppToken,
} from './account-identity.js';

const REQUIRED_KEYS = ['enabled', 'serverUrl', 'apiKey', 'accountId'];

export const CLAWORLD_CHANNEL_ID = 'claworld';

export const claworldPluginConfigJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const AGENT_REGISTRATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: {
      type: 'boolean',
      description: 'Enable relay agent registration when this account does not already have an app token.',
      default: false,
    },
    displayName: {
      type: 'string',
      minLength: 1,
      description: 'Public display name to use when the relay agent is created or refreshed.',
    },
  },
};

export const LOCAL_AGENT_BOOTSTRAP_SCHEMA = AGENT_REGISTRATION_SCHEMA;
export const LOCAL_AGENT_BOOTSTRAP_REQUIRED = ['displayName'];

export const MANUAL_RELAY_BINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    appToken: {
      type: 'string',
      minLength: 1,
      description: 'Canonical Claworld app token for this account. The runtime resolves the bound relay agent from this token.',
    },
    agentId: {
      type: 'string',
      minLength: 1,
      description: 'Optional relay agent id hint. The current flow resolves the binding from appToken at runtime.',
    },
    credentialToken: {
      type: 'string',
      minLength: 1,
      description: 'Optional credential token for this account. appToken is the current field.',
    },
    defaultTargetAgentId: {
      type: 'string',
      minLength: 1,
      description: 'Default relay target agentId for minimal outbound testing.',
    },
  },
};

const SINGLE_ACCOUNT_PROPERTIES = {
  name: {
    type: 'string',
    minLength: 1,
    description: 'Optional operator-facing name for this local Claworld account.',
  },
  enabled: { type: 'boolean', description: 'Enable the Claworld channel plugin.' },
  serverUrl: {
    type: 'string',
    minLength: 1,
    description: 'Relay backend base URL or websocket URL (http/https/ws/wss).',
  },
  apiKey: {
    type: 'string',
    minLength: 1,
    description: 'Plugin/backend API key for future backend-authenticated control paths.',
  },
  appToken: {
    type: 'string',
    minLength: 1,
    description: 'Canonical Claworld app token for this channel account.',
  },
  accountId: {
    type: 'string',
    minLength: 1,
    description: 'Local OpenClaw-facing account id bound to this channel instance.',
  },
  toolProfile: {
    type: 'string',
    enum: ['minimal', 'default', 'world', 'full'],
    description: 'Optional ignored profile selector. Current tool exposure is backend-defined.',
  },
  heartbeatSeconds: {
    type: 'integer',
    minimum: 1,
    description: 'Heartbeat cadence for the relay websocket client.',
    default: 15,
  },
  reconnect: {
    type: 'boolean',
    description: 'Whether reconnect attempts are allowed after disconnect.',
    default: true,
  },
  routing: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sessionTarget: {
        type: 'string',
        enum: ['subagent', 'mainagent'],
        default: 'mainagent',
      },
      fallbackTarget: {
        type: 'string',
        enum: ['mainagent', 'human(optional)'],
        default: 'mainagent',
      },
      allowHumanInterrupt: {
        type: 'boolean',
        default: true,
      },
    },
  },
  testing: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowBridgedCommandDispatch: {
        type: 'boolean',
        description: 'Test-only switch that allows bridged relay turns beginning with slash commands to use the OpenClaw command fast-path.',
        default: false,
      },
    },
  },
  registration: AGENT_REGISTRATION_SCHEMA,
  relay: MANUAL_RELAY_BINDING_SCHEMA,
};

export const claworldChannelConfigJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SINGLE_ACCOUNT_PROPERTIES,
    defaultAccount: {
      type: 'string',
      minLength: 1,
      description: 'Default account id to use when multiple claworld accounts are configured.',
    },
    accounts: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: REQUIRED_KEYS,
        properties: SINGLE_ACCOUNT_PROPERTIES,
      },
    },
  },
};

export const claworldChannelConfigSchema = {
  channelId: CLAWORLD_CHANNEL_ID,
  required: REQUIRED_KEYS,
  optional: ['name', 'heartbeatSeconds', 'reconnect', 'routing', 'testing', 'appToken', 'registration', 'relay', 'toolProfile', 'defaultAccount', 'accounts'],
  jsonSchema: claworldChannelConfigJsonSchema,
  description:
    '最小 OpenClaw claworld channel 配置；支持单账号或 accounts.<id> 多账号模式。canonical flow uses appToken + registration.displayName bootstrap.',
  routingShape: {
    sessionTarget: 'mainagent',
    fallbackTarget: 'mainagent',
    allowHumanInterrupt: true,
  },
};

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function readRawClaworldRoot(config = {}) {
  if (config?.channels?.[CLAWORLD_CHANNEL_ID]) return config.channels[CLAWORLD_CHANNEL_ID];
  if (config?.[CLAWORLD_CHANNEL_ID]) return config[CLAWORLD_CHANNEL_ID];
  return config;
}

function listConfiguredClaworldAccountIds(config = {}) {
  const root = readRawClaworldRoot(config);
  if (root?.accounts && typeof root.accounts === 'object') {
    return Object.keys(root.accounts).filter(Boolean);
  }
  const single = root;
  if (single?.accountId) return [single.accountId];
  return [];
}

function readDefaultAccountId(config = {}) {
  const root = readRawClaworldRoot(config);
  const configuredIds = listConfiguredClaworldAccountIds(config);
  const explicit = String(root?.defaultAccount || '').trim();
  if (explicit && configuredIds.includes(explicit)) return explicit;
  if (root?.accounts?.default) return 'default';
  return configuredIds[0] || null;
}

function readClaworldConfigSection(config = {}, accountId = null) {
  const root = readRawClaworldRoot(config);
  if (root?.accounts && typeof root.accounts === 'object') {
    const normalizedAccountId = String(accountId || '').trim();
    if (normalizedAccountId && root.accounts[normalizedAccountId]) return root.accounts[normalizedAccountId];

    const defaultAccountId = readDefaultAccountId(config);
    if (defaultAccountId && root.accounts[defaultAccountId]) return root.accounts[defaultAccountId];

    const [firstAccount] = Object.values(root.accounts);
    if (firstAccount) return firstAccount;
  }
  return root;
}

function determineCredentialStatus(candidate = {}) {
  if (resolveRuntimeAppToken(candidate)) {
    return { tokenSource: 'config', tokenStatus: 'available' };
  }
  if (normalizeRuntimeRegistration(candidate).enabled) {
    return { tokenSource: 'registration', tokenStatus: 'registration_required' };
  }
  return { tokenSource: 'none', tokenStatus: 'missing' };
}

function determineBindingStatus(candidate = {}) {
  if (resolveRuntimeAppToken(candidate)) return 'bound';
  if (normalizeRuntimeRegistration(candidate).enabled) return 'registration_pending';
  return 'unbound';
}

export function validateClaworldChannelConfig(config = {}, accountId = null) {
  const root = readRawClaworldRoot(config);
  const candidate = readClaworldConfigSection(config, accountId) || {};
  const missing = REQUIRED_KEYS.filter((key) => candidate[key] == null || candidate[key] === '');
  const errors = [];
  const registration = normalizeRuntimeRegistration(candidate);
  const appToken = resolveRuntimeAppToken(candidate);
  const configuredIds = listConfiguredClaworldAccountIds(config);
  const hasMultipleAccounts = configuredIds.length > 1;
  const explicitDefaultAccount = String(root?.defaultAccount || '').trim();

  if (hasMultipleAccounts && !explicitDefaultAccount && !String(accountId || '').trim()) {
    errors.push({ code: 'missing_default_account' });
  }
  if (explicitDefaultAccount && root?.accounts && !root.accounts[explicitDefaultAccount]) {
    errors.push({ code: 'invalid_default_account', value: explicitDefaultAccount });
  }

  if (missing.length > 0) {
    errors.push({ code: 'missing_required_keys', keys: missing });
  }

  if (candidate.serverUrl != null) {
    try {
      const parsed = new URL(candidate.serverUrl);
      if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol)) {
        errors.push({ code: 'invalid_server_url_protocol', value: parsed.protocol });
      }
    } catch {
      errors.push({ code: 'invalid_server_url', value: candidate.serverUrl });
    }
  }

  if (
    candidate.heartbeatSeconds != null
    && (!Number.isFinite(Number(candidate.heartbeatSeconds)) || Number(candidate.heartbeatSeconds) <= 0)
  ) {
    errors.push({ code: 'invalid_heartbeat_seconds', value: candidate.heartbeatSeconds });
  }

  const sessionTarget = candidate.routing?.sessionTarget || 'mainagent';
  const fallbackTarget = candidate.routing?.fallbackTarget || 'mainagent';
  if (!['subagent', 'mainagent'].includes(sessionTarget)) {
    errors.push({ code: 'invalid_session_target', value: sessionTarget });
  }
  if (!['mainagent', 'human(optional)'].includes(fallbackTarget)) {
    errors.push({ code: 'invalid_fallback_target', value: fallbackTarget });
  }

  if (registration.enabled && !registration.displayName) {
    errors.push({ code: 'missing_registration_display_name' });
  }

  if (candidate.relay?.agentId && !appToken) {
    errors.push({ code: 'missing_relay_app_token' });
  }

  const runtimeIdentity = applyRuntimeIdentity({
    enabled: Boolean(candidate.enabled),
    serverUrl: candidate.serverUrl || null,
    apiKey: candidate.apiKey || null,
    appToken,
    accountId: candidate.accountId || null,
    defaultAccount: explicitDefaultAccount || null,
    heartbeatSeconds: candidate.heartbeatSeconds == null ? 15 : Math.floor(Number(candidate.heartbeatSeconds)),
    reconnect: candidate.reconnect !== false,
    routing: {
      sessionTarget,
      fallbackTarget,
      allowHumanInterrupt: candidate.routing?.allowHumanInterrupt !== false,
    },
    testing: {
      allowBridgedCommandDispatch: candidate.testing?.allowBridgedCommandDispatch === true,
    },
    registration,
    relay: {
      agentId: candidate.relay?.agentId || null,
      appToken,
      credentialToken: appToken,
      defaultTargetAgentId: candidate.relay?.defaultTargetAgentId || null,
    },
  });

  return {
    ok: errors.length === 0,
    errors,
    normalized: runtimeIdentity,
  };
}

export function inspectClaworldChannelAccount(config = {}, accountId = null) {
  const result = validateClaworldChannelConfig(config, accountId);
  const normalized = result.normalized;
  const configuredIds = listConfiguredClaworldAccountIds(config);
  const { tokenSource, tokenStatus } = determineCredentialStatus(normalized);
  const bindingStatus = determineBindingStatus(normalized);
  const configured = Boolean(normalized.serverUrl && normalized.apiKey && normalized.accountId);
  return {
    accountId: normalized.accountId || accountId || readDefaultAccountId(config) || configuredIds[0] || 'default',
    name: normalizeText(normalized.name, normalizeText(normalized.registration?.displayName, null)),
    enabled: normalized.enabled,
    configured,
    configuredStatus: configured ? 'configured' : 'missing_required_config',
    serverUrl: normalized.serverUrl,
    heartbeatSeconds: normalized.heartbeatSeconds,
    reconnect: normalized.reconnect,
    routing: normalized.routing,
    testing: normalized.testing,
    appToken: normalized.appToken || null,
    registration: normalized.registration,
    relay: normalized.relay,
    defaultAccount: normalized.defaultAccount,
    bindingStatus,
    tokenSource,
    tokenStatus,
    issues: result.errors,
  };
}

export function projectClaworldStatusAccount(inspection = {}) {
  // Keep the steady-state credential nested under relay/runtimeConfig so
  // generic OpenClaw status does not misclassify Claworld as a bot+app token
  // channel.
  const { appToken: _appToken, ...statusAccount } = inspection || {};
  return statusAccount;
}

export function resolveClaworldRuntimeConfig(config = {}, accountId = null) {
  const result = validateClaworldChannelConfig(config, accountId);
  if (!result.ok) {
    const detail = result.errors.map((error) => error.code).join(', ') || 'invalid_config';
    throw new Error(`invalid claworld config: ${detail}`);
  }
  return {
    ...result.normalized,
    accountId: result.normalized.accountId || accountId || readDefaultAccountId(config) || 'default',
    relay: result.normalized.relay,
  };
}

export function resolveClaworldChannelAccount(config = {}, accountId = null) {
  const runtimeConfig = resolveClaworldRuntimeConfig(config, accountId);
  const inspection = inspectClaworldChannelAccount(config, accountId);
  return {
    ...projectClaworldStatusAccount(inspection),
    runtimeReady: true,
    resolvedFrom: accountId ? 'requested_account' : 'default_account',
    runtimeConfig,
  };
}

export function listClaworldAccountIds(config = {}) {
  return listConfiguredClaworldAccountIds(config);
}

export function defaultClaworldAccountId(config = {}) {
  return readDefaultAccountId(config) || 'default';
}
