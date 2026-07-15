import os from 'os';
import path from 'path';
import {
  CLAWORLD_PLUGIN_CURRENT_VERSION,
  normalizeClaworldPluginVersion,
} from '../plugin-version.js';
import {
  CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES,
  CLAWORLD_PUBLIC_TOOL_NAMES,
  CLAWORLD_READ_ONLY_OPENCLAW_TOOL_NAMES,
  CLAWORLD_TOOL_PROFILES,
} from '../runtime/tool-inventory.js';

export const CLAWORLD_STAGING_SERVER_URL = 'https://staging.claworld.love';
export const CLAWORLD_PRODUCTION_SERVER_URL = 'https://claworld.love';
export function isClaworldTestingPluginVersion(version = CLAWORLD_PLUGIN_CURRENT_VERSION) {
  const normalized = normalizeClaworldPluginVersion(version, null);
  return Boolean(normalized && /-testing(?:\.|$)/.test(normalized));
}
export function resolveDefaultClaworldServerUrl(version = CLAWORLD_PLUGIN_CURRENT_VERSION) {
  return isClaworldTestingPluginVersion(version)
    ? CLAWORLD_STAGING_SERVER_URL
    : CLAWORLD_PRODUCTION_SERVER_URL;
}
export const DEFAULT_CLAWORLD_SERVER_URL = resolveDefaultClaworldServerUrl();
export const DEFAULT_CLAWORLD_API_KEY = 'local-test';
export const DEFAULT_CLAWORLD_AGENT_ID = 'main';
export const DEFAULT_CLAWORLD_ACCOUNT_ID = 'claworld';
export const DEFAULT_CLAWORLD_TOOL_PROFILE = 'default';
export const DEFAULT_CLAWORLD_DM_SCOPE = 'per-channel-peer';
export const DEFAULT_CLAWORLD_SESSION_RESET_MODE = 'idle';
export const DEFAULT_CLAWORLD_SESSION_RESET_IDLE_MINUTES = 43200;
export const DEFAULT_CLAWORLD_SESSION_TARGET = 'mainagent';
export const DEFAULT_CLAWORLD_FALLBACK_TARGET = 'mainagent';
export const CLAWORLD_MANAGED_AGENT_TOOL_ALLOW_ENTRIES = Object.freeze([
  'claworld',
  'message',
]);
export const MIN_MANAGED_SESSION_VISIBILITY = 'agent';
export const REQUIRED_SANDBOX_SESSION_TOOLS_VISIBILITY = 'all';
export const CLAWORLD_INSTALLER_STATE_ROOT_KEY = 'claworldInstaller';
export const CLAWORLD_MANAGED_RUNTIME_BACKUP_VERSION = 1;

export const TOOL_PROFILES = CLAWORLD_TOOL_PROFILES;

export function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function titleCase(value) {
  const normalized = normalizeText(value, '') || '';
  if (!normalized) return 'Claworld';
  return normalized
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ensureObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function buildDefaultClaworldSessionResetOverride() {
  return {
    mode: DEFAULT_CLAWORLD_SESSION_RESET_MODE,
    idleMinutes: DEFAULT_CLAWORLD_SESSION_RESET_IDLE_MINUTES,
  };
}

function normalizeRegistrationDisplayName(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return normalized || fallback;
}

export function expandUserPath(input, homeDir = os.homedir()) {
  const normalized = normalizeText(input, null);
  if (!normalized) return normalized;
  if (normalized === '~') return homeDir;
  if (normalized.startsWith('~/')) return path.join(homeDir, normalized.slice(2));
  return normalized;
}

function asStringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item, null))
      .filter(Boolean);
  }
  const normalized = normalizeText(value, null);
  return normalized ? [normalized] : [];
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeText(value, null);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function mergeManagedAgentToolExposure(existingTools = {}) {
  const tools = ensureObject(existingTools);
  const allow = asStringArray(tools.allow);
  const alsoAllow = asStringArray(tools.alsoAllow);

  if (allow.length > 0) {
    return {
      ...tools,
      allow: uniqueStrings([...allow, ...CLAWORLD_MANAGED_AGENT_TOOL_ALLOW_ENTRIES]),
    };
  }

  return {
    ...tools,
    alsoAllow: uniqueStrings([...alsoAllow, ...CLAWORLD_MANAGED_AGENT_TOOL_ALLOW_ENTRIES]),
  };
}

function findAgentIndex(agentList = [], agentId) {
  return agentList.findIndex((item) => ensureObject(item).id === agentId);
}

function findAgentEntry(config = {}, agentId) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list
    .map((item) => ensureObject(item))
    .find((item) => item.id === agentId) || null;
}

function findManagedAccountEntry(config = {}, accountId) {
  const claworldRoot = ensureObject(config?.channels?.claworld);
  const accounts = ensureObject(claworldRoot.accounts);
  if (accounts[accountId]) return ensureObject(accounts[accountId]);
  if (normalizeText(claworldRoot.accountId, null) === accountId) return claworldRoot;
  return {};
}

function ensureMutableInstallerStateRoot(installerState = {}) {
  installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY] = ensureObject(installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY]);
  const rootState = ensureObject(installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY]);
  rootState.managedRuntime = ensureObject(rootState.managedRuntime);
  rootState.managedRuntime.accounts = ensureObject(rootState.managedRuntime.accounts);
  installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY] = rootState;
  return rootState.managedRuntime.accounts;
}

function trimInstallerStateRoot(installerState = {}) {
  const rootState = ensureObject(installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY]);
  const managedRuntime = ensureObject(rootState.managedRuntime);
  const accounts = ensureObject(managedRuntime.accounts);
  if (Object.keys(accounts).length === 0) {
    delete managedRuntime.accounts;
  } else {
    managedRuntime.accounts = accounts;
  }
  if (Object.keys(managedRuntime).length === 0) {
    delete rootState.managedRuntime;
  } else {
    rootState.managedRuntime = managedRuntime;
  }
  if (Object.keys(rootState).length === 0) {
    delete installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY];
  } else {
    installerState[CLAWORLD_INSTALLER_STATE_ROOT_KEY] = rootState;
  }
}

export function findClaworldManagedRuntimeBackup(installerState = {}, accountId = DEFAULT_CLAWORLD_ACCOUNT_ID) {
  const normalizedAccountId = normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID);
  const rootState = ensureObject(installerState?.[CLAWORLD_INSTALLER_STATE_ROOT_KEY]);
  const managedRuntime = ensureObject(rootState.managedRuntime);
  const accounts = ensureObject(managedRuntime.accounts);
  return ensureObject(accounts[normalizedAccountId]);
}

export function setClaworldManagedRuntimeBackupState(
  installerState = {},
  accountId = DEFAULT_CLAWORLD_ACCOUNT_ID,
  value = null,
) {
  const normalizedAccountId = normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID);
  const accounts = ensureMutableInstallerStateRoot(installerState);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    accounts[normalizedAccountId] = JSON.parse(JSON.stringify(value));
  } else {
    delete accounts[normalizedAccountId];
  }
  trimInstallerStateRoot(installerState);
  return installerState;
}

function removeManagedAgentToolExposure(existingTools = {}) {
  const tools = ensureObject(existingTools);
  const managedEntries = new Set(CLAWORLD_MANAGED_AGENT_TOOL_ALLOW_ENTRIES);
  const allow = asStringArray(tools.allow).filter((toolName) => !managedEntries.has(toolName));
  const alsoAllow = asStringArray(tools.alsoAllow).filter((toolName) => !managedEntries.has(toolName));
  const nextTools = { ...tools };
  if (allow.length > 0) nextTools.allow = uniqueStrings(allow);
  else delete nextTools.allow;
  if (alsoAllow.length > 0) nextTools.alsoAllow = uniqueStrings(alsoAllow);
  else delete nextTools.alsoAllow;
  return Object.keys(nextTools).length > 0 ? nextTools : null;
}

const SESSION_VISIBILITY_RANK = Object.freeze({
  self: 0,
  tree: 1,
  agent: 2,
  all: 3,
});

const SANDBOX_SESSION_TOOLS_VISIBILITY_RANK = Object.freeze({
  spawned: 0,
  all: 1,
});

function normalizeSessionVisibility(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return Object.prototype.hasOwnProperty.call(SESSION_VISIBILITY_RANK, normalized)
    ? normalized
    : fallback;
}

function normalizeSandboxSessionToolsVisibility(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return Object.prototype.hasOwnProperty.call(SANDBOX_SESSION_TOOLS_VISIBILITY_RANK, normalized)
    ? normalized
    : fallback;
}

function compareRankedSetting(value, target, rankMap) {
  const nextValue = normalizeText(value, null);
  const nextTarget = normalizeText(target, null);
  const valueRank = Object.prototype.hasOwnProperty.call(rankMap, nextValue) ? rankMap[nextValue] : null;
  const targetRank = Object.prototype.hasOwnProperty.call(rankMap, nextTarget) ? rankMap[nextTarget] : null;
  if (valueRank == null && targetRank == null) return 0;
  if (valueRank == null) return -1;
  if (targetRank == null) return 1;
  return valueRank - targetRank;
}

export function getEffectiveAgentSandboxMode(config = {}, agentId = DEFAULT_CLAWORLD_AGENT_ID) {
  const normalizedAgentId = normalizeText(agentId, DEFAULT_CLAWORLD_AGENT_ID);
  const agentEntry = findAgentEntry(config, normalizedAgentId);
  const agentSandboxMode = normalizeText(agentEntry?.sandbox?.mode, null);
  if (agentSandboxMode) return agentSandboxMode;
  return normalizeText(config?.agents?.defaults?.sandbox?.mode, 'off');
}

export function sandboxModeNeedsSessionToolsVisibility(mode) {
  return mode === 'all' || mode === 'non-main';
}

function ensureManagedSessionRoutingVisibility(config = {}, {
  agentId = DEFAULT_CLAWORLD_AGENT_ID,
  summary = [],
} = {}) {
  config.tools = ensureObject(config.tools);
  const existingSessionTools = ensureObject(config.tools.sessions);
  const existingVisibility = normalizeSessionVisibility(existingSessionTools.visibility, null);
  if (compareRankedSetting(existingVisibility, MIN_MANAGED_SESSION_VISIBILITY, SESSION_VISIBILITY_RANK) < 0) {
    config.tools.sessions = {
      ...existingSessionTools,
      visibility: MIN_MANAGED_SESSION_VISIBILITY,
    };
    summary.push(
      existingVisibility
        ? `tools.sessions.visibility raised from ${existingVisibility} to ${MIN_MANAGED_SESSION_VISIBILITY}`
        : `tools.sessions.visibility set to ${MIN_MANAGED_SESSION_VISIBILITY}`,
    );
  } else if (Object.keys(existingSessionTools).length > 0) {
    config.tools.sessions = existingSessionTools;
  }

  const effectiveSandboxMode = getEffectiveAgentSandboxMode(config, agentId);
  if (!sandboxModeNeedsSessionToolsVisibility(effectiveSandboxMode)) {
    return;
  }

  config.agents = ensureObject(config.agents);
  config.agents.defaults = ensureObject(config.agents.defaults);
  const existingSandbox = ensureObject(config.agents.defaults.sandbox);
  const existingSessionToolsVisibility = normalizeSandboxSessionToolsVisibility(
    existingSandbox.sessionToolsVisibility,
    null,
  );
  if (
    compareRankedSetting(
      existingSessionToolsVisibility,
      REQUIRED_SANDBOX_SESSION_TOOLS_VISIBILITY,
      SANDBOX_SESSION_TOOLS_VISIBILITY_RANK,
    ) < 0
  ) {
    config.agents.defaults.sandbox = {
      ...existingSandbox,
      sessionToolsVisibility: REQUIRED_SANDBOX_SESSION_TOOLS_VISIBILITY,
    };
    summary.push(
      existingSessionToolsVisibility
        ? `agents.defaults.sandbox.sessionToolsVisibility raised from ${existingSessionToolsVisibility} to ${REQUIRED_SANDBOX_SESSION_TOOLS_VISIBILITY}`
        : `agents.defaults.sandbox.sessionToolsVisibility set to ${REQUIRED_SANDBOX_SESSION_TOOLS_VISIBILITY}`,
    );
  } else if (Object.keys(existingSandbox).length > 0) {
    config.agents.defaults.sandbox = existingSandbox;
  }
}

function ensureManagedCrossContextMessaging(config = {}, { summary = [] } = {}) {
  config.tools = ensureObject(config.tools);
  const existingMessage = ensureObject(config.tools.message);
  const existingCrossContext = ensureObject(existingMessage.crossContext);

  if (existingCrossContext.allowAcrossProviders === true) {
    if (Object.keys(existingMessage).length > 0) {
      config.tools.message = existingMessage;
    }
    return;
  }

  config.tools.message = {
    ...existingMessage,
    crossContext: {
      ...existingCrossContext,
      allowAcrossProviders: true,
    },
  };
  summary.push('tools.message.crossContext.allowAcrossProviders set to true');
}

function inferExistingAgentId(config = {}, accountId = DEFAULT_CLAWORLD_ACCOUNT_ID) {
  const bindings = Array.isArray(config?.bindings) ? config.bindings : [];
  const bindingMatch = bindings
    .map((item) => ensureObject(item))
    .find((item) => ensureObject(item.match).channel === 'claworld'
      && normalizeText(ensureObject(item.match).accountId, null) === accountId
      && normalizeText(item.agentId, null));
  if (bindingMatch?.agentId) return normalizeText(bindingMatch.agentId, null);

  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  if (agents.some((item) => ensureObject(item).id === DEFAULT_CLAWORLD_AGENT_ID)) {
    return DEFAULT_CLAWORLD_AGENT_ID;
  }
  if (agents.length === 1) {
    return normalizeText(ensureObject(agents[0]).id, DEFAULT_CLAWORLD_AGENT_ID);
  }
  return DEFAULT_CLAWORLD_AGENT_ID;
}

function buildManagedRoutingEntry(options = {}, existingRouting = {}) {
  return {
    ...ensureObject(existingRouting),
    sessionTarget: normalizeText(options.sessionTarget, DEFAULT_CLAWORLD_SESSION_TARGET),
    fallbackTarget: normalizeText(options.fallbackTarget, DEFAULT_CLAWORLD_FALLBACK_TARGET),
    allowHumanInterrupt: existingRouting?.allowHumanInterrupt !== false,
  };
}

function buildManagedAccountEntry(options = {}) {
  const base = {
    enabled: true,
    serverUrl: options.serverUrl,
    apiKey: options.apiKey,
    accountId: options.accountId,
    name: normalizeText(options.name, normalizeText(options.displayName, null)),
    routing: buildManagedRoutingEntry(options),
  };

  if (options.appToken) {
    base.appToken = options.appToken;
  } else if (normalizeText(options.registrationDisplayName, null)) {
    base.registration = {
      enabled: true,
      displayName: normalizeText(options.registrationDisplayName, options.displayName),
    };
  }

  const relay = {
    ...(normalizeText(options.relayAgentId, null) ? { agentId: normalizeText(options.relayAgentId, null) } : {}),
    ...(normalizeText(options.defaultTargetAgentId, null)
      ? { defaultTargetAgentId: normalizeText(options.defaultTargetAgentId, null) }
      : {}),
  };
  if (Object.keys(relay).length === 0) {
    return base;
  }

  return {
    ...base,
    relay,
  };
}

function buildMergedAccountEntry(existingAccount = {}, options = {}) {
  const existingRelay = ensureObject(existingAccount.relay);
  const existingRegistration = ensureObject(existingAccount.registration);
  const relayAgentId = normalizeText(options.relayAgentId, null);
  const defaultTargetAgentId = normalizeText(options.defaultTargetAgentId, null);
  const mergedRelay = {
    ...existingRelay,
    ...(relayAgentId ? { agentId: relayAgentId } : {}),
    ...(defaultTargetAgentId ? { defaultTargetAgentId } : {}),
  };
  const shouldPersistRelay = Boolean(existingAccount.relay || relayAgentId || defaultTargetAgentId);
  const merged = {
    ...existingAccount,
    enabled: true,
    serverUrl: options.serverUrl,
    apiKey: options.apiKey,
    accountId: options.accountId,
    name: normalizeText(options.name, normalizeText(existingAccount.name, normalizeText(options.displayName, null))),
    routing: buildManagedRoutingEntry(options, existingAccount.routing),
    ...(shouldPersistRelay ? { relay: mergedRelay } : {}),
  };
  delete merged.toolProfile;

  if (options.appToken) {
    const withToken = {
      ...merged,
      appToken: options.appToken,
    };
    delete withToken.registration;
    return withToken;
  }

  if (!normalizeText(options.registrationDisplayName, null)) {
    const withoutRegistration = { ...merged };
    delete withoutRegistration.registration;
    return withoutRegistration;
  }

  return {
    ...merged,
    registration: {
      ...existingRegistration,
      enabled: true,
      displayName: normalizeText(options.registrationDisplayName, options.displayName),
    },
  };
}

export function normalizeClaworldToolProfile(toolProfile = DEFAULT_CLAWORLD_TOOL_PROFILE) {
  const normalized = normalizeText(toolProfile, DEFAULT_CLAWORLD_TOOL_PROFILE);
  if (normalized === 'world') return 'default';
  return normalized;
}

export function inferClaworldToolProfile(config = {}) {
  const allow = new Set(asStringArray(config?.tools?.allow));
  if (allow.has('*')) return 'full';
  if (CLAWORLD_READ_ONLY_OPENCLAW_TOOL_NAMES.some((toolName) => allow.has(toolName))) {
    return 'default';
  }
  if (CLAWORLD_PUBLIC_TOOL_NAMES.some((toolName) => allow.has(toolName))) {
    return 'minimal';
  }
  return DEFAULT_CLAWORLD_TOOL_PROFILE;
}

function resolveStoredClaworldToolProfile(account = {}) {
  const persistedToolProfile = normalizeText(account?.toolProfile, null);
  return persistedToolProfile
    ? normalizeClaworldToolProfile(persistedToolProfile)
    : null;
}

function resolveManagedToolProfile({
  cfg = {},
  existingAccount = {},
  explicitToolProfile = null,
} = {}) {
  const normalizedExplicitToolProfile = normalizeText(explicitToolProfile, null);
  if (normalizedExplicitToolProfile) {
    return normalizeClaworldToolProfile(normalizedExplicitToolProfile);
  }

  const persistedToolProfile = resolveStoredClaworldToolProfile(existingAccount);
  if (persistedToolProfile) {
    return persistedToolProfile;
  }

  const inferredToolProfile = inferClaworldToolProfile(cfg);
  if (inferredToolProfile === 'minimal') {
    const allow = new Set(asStringArray(cfg?.tools?.allow));
    const hasMinimalCoreAnchor = CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES
      .some((toolName) => allow.has(toolName));
    if (!hasMinimalCoreAnchor) {
      // Legacy managed installs stored only the old public claworld allowlist.
      // Treat that shape as the historical default/world profile during refresh.
      return DEFAULT_CLAWORLD_TOOL_PROFILE;
    }
  }
  return normalizeClaworldToolProfile(inferredToolProfile);
}

export function resolveToolNames({ toolProfile = DEFAULT_CLAWORLD_TOOL_PROFILE } = {}) {
  const normalizedProfile = normalizeClaworldToolProfile(toolProfile);
  const baseProfile = TOOL_PROFILES[normalizedProfile];
  if (!baseProfile) {
    throw new Error(`Unsupported tool profile: ${toolProfile}`);
  }
  return [...baseProfile];
}

function buildBoundAgentEntry(existingAgent = {}, agentId) {
  const nextAgent = {
    ...ensureObject(existingAgent),
    id: agentId,
  };
  nextAgent.tools = mergeManagedAgentToolExposure(existingAgent.tools);
  return nextAgent;
}

export function resolveDefaultManagedDisplayName(accountId = DEFAULT_CLAWORLD_ACCOUNT_ID) {
  return `${titleCase(accountId)} Channel`;
}

export function resolveClaworldManagedRuntimeOptions({
  cfg = {},
  accountId = null,
  input = {},
  overrides = {},
  installerState = null,
} = {}) {
  const resolvedAccountId = normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID);
  const existingBackup = findClaworldManagedRuntimeBackup(installerState, resolvedAccountId);
  const inferredAgentId = inferExistingAgentId(cfg, resolvedAccountId)
    || normalizeText(existingBackup.agentId, null);
  const agentId = normalizeText(overrides.agentId, inferredAgentId);
  const existingAgent = findAgentEntry(cfg, agentId);
  const existingAccount = findManagedAccountEntry(cfg, resolvedAccountId);
  const replaceManagedRuntime = overrides.replaceManagedRuntime !== false;
  const workspace = normalizeText(existingAgent?.workspace, normalizeText(existingBackup.workspace, null));
  const serverUrl = normalizeText(
    overrides.serverUrl,
    normalizeText(input.httpUrl, normalizeText(input.url, normalizeText(existingBackup.serverUrl, DEFAULT_CLAWORLD_SERVER_URL))),
  );
  const apiKey = normalizeText(overrides.apiKey, normalizeText(existingBackup.apiKey, DEFAULT_CLAWORLD_API_KEY));
  const explicitAppToken = normalizeText(
    overrides.appToken,
    normalizeText(input.appToken, null),
  );
  const explicitRegistrationDisplayName = normalizeRegistrationDisplayName(
    overrides.registrationDisplayName,
    normalizeRegistrationDisplayName(input.name, null),
  );
  const appToken = explicitRegistrationDisplayName && !explicitAppToken
    ? null
    : normalizeText(
        explicitAppToken,
        normalizeText(
          existingAccount.appToken,
          normalizeText(
            existingAccount?.relay?.appToken,
            normalizeText(existingAccount?.relay?.credentialToken, normalizeText(existingBackup.appToken, null)),
          ),
        ),
      );
  const displayName = normalizeText(
    overrides.displayName,
    normalizeText(input.name, normalizeText(existingBackup.displayName, resolveDefaultManagedDisplayName(resolvedAccountId))),
  );
  const name = normalizeText(overrides.name, normalizeText(existingBackup.name, displayName));
  const existingRegistrationDisplayName = normalizeRegistrationDisplayName(
    existingAccount?.registration?.displayName,
    normalizeRegistrationDisplayName(existingBackup.registrationDisplayName, null),
  );
  const registrationDisplayName = appToken && !explicitRegistrationDisplayName
    ? null
    : normalizeRegistrationDisplayName(
        explicitRegistrationDisplayName,
        existingRegistrationDisplayName,
      );

  return {
    repoRoot: normalizeText(overrides.repoRoot, null),
    agentId,
    accountId: resolvedAccountId,
    workspace,
    serverUrl,
    apiKey,
    appToken,
    registrationDisplayName,
    displayName,
    name,
    relayAgentId: normalizeText(overrides.relayAgentId, normalizeText(existingAccount?.relay?.agentId, null)),
    defaultTargetAgentId: normalizeText(overrides.defaultTargetAgentId, null),
    sessionDmScope: normalizeText(
      overrides.sessionDmScope,
      normalizeText(existingBackup.sessionDmScope, DEFAULT_CLAWORLD_DM_SCOPE),
    ),
    replaceManagedRuntime,
    preserveDefaultAccount: overrides.preserveDefaultAccount === true,
    forceDefaultAccount: overrides.forceDefaultAccount === true,
    pluginInstallMode: normalizeText(overrides.pluginInstallMode, 'skip'),
    installPlugin: overrides.installPlugin !== false,
    sessionTarget: normalizeText(overrides.sessionTarget, DEFAULT_CLAWORLD_SESSION_TARGET),
    fallbackTarget: normalizeText(overrides.fallbackTarget, DEFAULT_CLAWORLD_FALLBACK_TARGET),
  };
}

export function applyClaworldManagedRuntimeConfig(inputConfig = {}, options = {}) {
  const config = JSON.parse(JSON.stringify(ensureObject(inputConfig)));
  const summary = [];
  const replaceManagedRuntime = options.replaceManagedRuntime !== false;
  const preserveDefaultAccount = options.preserveDefaultAccount === true;
  const sessionDmScope = normalizeText(options.sessionDmScope, DEFAULT_CLAWORLD_DM_SCOPE);

  const removedManagedToolNames = new Set(CLAWORLD_PUBLIC_TOOL_NAMES);
  if (inputConfig?.tools && typeof inputConfig.tools === 'object') {
    config.tools = ensureObject(config.tools);
    const existingAllow = asStringArray(config.tools.allow);
    const filteredAllow = existingAllow.filter((toolName) => !removedManagedToolNames.has(toolName));
    const removedManagedTools = existingAllow.filter((toolName) => removedManagedToolNames.has(toolName));
    if (removedManagedTools.length > 0) {
      if (filteredAllow.length > 0) {
        config.tools.allow = uniqueStrings(filteredAllow);
      } else {
        delete config.tools.allow;
      }
      summary.push(`tools.allow removed managed claworld entries (${removedManagedTools.join(',')})`);
    }
    if (Object.keys(config.tools).length === 0) {
      delete config.tools;
    }
  }

  config.session = ensureObject(config.session);
  if (!Object.prototype.hasOwnProperty.call(config.session, 'dmScope')) {
    config.session.dmScope = sessionDmScope;
    summary.push(`session.dmScope set to ${sessionDmScope}`);
  }
  const resetByChannel = ensureObject(config.session.resetByChannel);
  if (!Object.prototype.hasOwnProperty.call(resetByChannel, 'claworld')) {
    config.session.resetByChannel = {
      ...resetByChannel,
      claworld: buildDefaultClaworldSessionResetOverride(),
    };
    summary.push(
      `session.resetByChannel.claworld set to ${DEFAULT_CLAWORLD_SESSION_RESET_MODE}/${DEFAULT_CLAWORLD_SESSION_RESET_IDLE_MINUTES}m`,
    );
  }

  config.agents = ensureObject(config.agents);
  const existingAgentList = Array.isArray(config.agents.list) ? [...config.agents.list] : [];
  const agentIndex = findAgentIndex(existingAgentList, options.agentId);
  if (agentIndex >= 0) {
    const existingAgent = ensureObject(existingAgentList[agentIndex]);
    existingAgentList[agentIndex] = buildBoundAgentEntry(existingAgent, options.agentId);
    config.agents.list = existingAgentList;
    summary.push(`updated bound agent tool exposure ${options.agentId}`);
  } else {
    existingAgentList.push(buildBoundAgentEntry({}, options.agentId));
    config.agents.list = existingAgentList;
    summary.push(`added bound agent entry ${options.agentId}`);
  }
  summary.push(`attached claworld account ${options.accountId} to local agent ${options.agentId}`);

  config.channels = ensureObject(config.channels);
  const existingClaworldRoot = ensureObject(config.channels.claworld);
  const claworldRoot = replaceManagedRuntime ? {} : { ...existingClaworldRoot };
  const existingDefaultAccount = normalizeText(existingClaworldRoot.defaultAccount, null);
  const existingAccounts = ensureObject(existingClaworldRoot.accounts);
  const targetExistingAccount = ensureObject(existingAccounts[options.accountId]);
  const nextAccounts = { ...existingAccounts };
  nextAccounts[options.accountId] = replaceManagedRuntime
    ? buildManagedAccountEntry(options)
    : buildMergedAccountEntry(targetExistingAccount, options);
  claworldRoot.accounts = nextAccounts;
  const shouldKeepDefaultAccount = preserveDefaultAccount
    && existingDefaultAccount
    && Object.prototype.hasOwnProperty.call(nextAccounts, existingDefaultAccount);
  if (!shouldKeepDefaultAccount || options.forceDefaultAccount) {
    claworldRoot.defaultAccount = options.accountId;
    summary.push(`channels.claworld.defaultAccount set to ${options.accountId}`);
  } else {
    claworldRoot.defaultAccount = existingDefaultAccount;
    summary.push(`channels.claworld.defaultAccount preserved as ${existingDefaultAccount}`);
  }
  config.channels.claworld = claworldRoot;
  summary.push(
    replaceManagedRuntime
      ? `replaced managed channels.claworld.accounts.${options.accountId}`
      : `configured channels.claworld.accounts.${options.accountId}`,
  );

  const existingBindings = Array.isArray(config.bindings) ? [...config.bindings] : [];
  const remainingBindings = existingBindings.filter((binding) => {
    const candidate = ensureObject(binding);
    const match = ensureObject(candidate.match);
    const bindingChannel = normalizeText(match.channel, null);
    const bindingAccountId = normalizeText(match.accountId, null);
    const bindingAgentId = normalizeText(candidate.agentId, null);

    if (bindingChannel === 'claworld' && bindingAccountId === options.accountId) return false;
    if (bindingChannel === 'claworld' && bindingAgentId === options.agentId) return false;
    return true;
  });
  remainingBindings.push({
    agentId: options.agentId,
    match: {
      channel: 'claworld',
      accountId: options.accountId,
    },
  });
  config.bindings = remainingBindings;
  summary.push(
    replaceManagedRuntime
      ? `replaced claworld binding for ${options.accountId}`
      : `reconciled claworld binding for ${options.accountId}`,
  );

  ensureManagedSessionRoutingVisibility(config, {
    agentId: options.agentId,
    summary,
  });
  ensureManagedCrossContextMessaging(config, { summary });

  return {
    config,
    summary,
    bootstrapDisplayName: normalizeText(options.registrationDisplayName, null),
  };
}

export function stripClaworldManagedRuntimeConfig(inputConfig = {}, {
  accountId = DEFAULT_CLAWORLD_ACCOUNT_ID,
  agentId = null,
  preserveBackup = true,
} = {}) {
  const config = JSON.parse(JSON.stringify(ensureObject(inputConfig)));
  const summary = [];
  const resolvedAccountId = normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID);
  const resolvedAgentId = normalizeText(agentId, inferExistingAgentId(config, resolvedAccountId));
  const existingAgent = findAgentEntry(config, resolvedAgentId);
  const existingAccount = findManagedAccountEntry(config, resolvedAccountId);
  const existingToolProfile = resolveStoredClaworldToolProfile(existingAccount) || inferClaworldToolProfile(config);
  const backup = preserveBackup
    ? {
        version: CLAWORLD_MANAGED_RUNTIME_BACKUP_VERSION,
        accountId: resolvedAccountId,
        agentId: resolvedAgentId,
        workspace: normalizeText(existingAgent?.workspace, null),
        serverUrl: normalizeText(existingAccount.serverUrl, null),
        apiKey: normalizeText(existingAccount.apiKey, null),
        appToken: normalizeText(
          existingAccount.appToken,
          normalizeText(existingAccount?.relay?.appToken, normalizeText(existingAccount?.relay?.credentialToken, null)),
        ),
        displayName: normalizeText(existingAccount.name, normalizeText(existingAgent?.name, null)),
        name: normalizeText(existingAccount.name, null),
        registrationDisplayName: normalizeRegistrationDisplayName(existingAccount?.registration?.displayName, null),
        sessionDmScope: normalizeText(config?.session?.dmScope, DEFAULT_CLAWORLD_DM_SCOPE),
        toolProfile: existingToolProfile,
        preservedAt: new Date().toISOString(),
      }
    : null;
  if (backup) {
    summary.push(`prepared managed claworld runtime backup for ${resolvedAccountId}`);
  }

  if (resolvedAgentId) {
    const agentList = Array.isArray(config?.agents?.list) ? [...config.agents.list] : [];
    const agentIndex = findAgentIndex(agentList, resolvedAgentId);
    if (agentIndex >= 0) {
      const nextAgent = { ...ensureObject(agentList[agentIndex]) };
      const nextTools = removeManagedAgentToolExposure(nextAgent.tools);
      if (nextTools) nextAgent.tools = nextTools;
      else delete nextAgent.tools;
      agentList[agentIndex] = nextAgent;
      config.agents = ensureObject(config.agents);
      config.agents.list = agentList;
      summary.push(`removed managed claworld tool exposure from agent ${resolvedAgentId}`);
    }
  }

  const claworldRoot = ensureObject(config?.channels?.claworld);
  const accounts = ensureObject(claworldRoot.accounts);
  if (Object.prototype.hasOwnProperty.call(accounts, resolvedAccountId)) {
    delete accounts[resolvedAccountId];
    summary.push(`removed channels.claworld.accounts.${resolvedAccountId}`);
  }
  const nextClaworldRoot = { ...claworldRoot };
  if (Object.keys(accounts).length > 0) {
    nextClaworldRoot.accounts = accounts;
    const currentDefaultAccount = normalizeText(nextClaworldRoot.defaultAccount, null);
    if (currentDefaultAccount === resolvedAccountId) {
      nextClaworldRoot.defaultAccount = Object.keys(accounts)[0];
      summary.push(`repointed channels.claworld.defaultAccount to ${nextClaworldRoot.defaultAccount}`);
    }
  } else {
    delete nextClaworldRoot.accounts;
    delete nextClaworldRoot.defaultAccount;
  }
  if (Object.keys(nextClaworldRoot).length > 0) {
    config.channels = ensureObject(config.channels);
    config.channels.claworld = nextClaworldRoot;
  } else if (config.channels && typeof config.channels === 'object' && !Array.isArray(config.channels)) {
    delete config.channels.claworld;
    if (Object.keys(config.channels).length === 0) {
      delete config.channels;
    }
    summary.push('removed channels.claworld root');
  }

  if (Array.isArray(config.bindings)) {
    const nextBindings = config.bindings.filter((binding) => {
      const candidate = ensureObject(binding);
      const match = ensureObject(candidate.match);
      const bindingChannel = normalizeText(match.channel, null);
      const bindingAccountId = normalizeText(match.accountId, null);
      const bindingAgentId = normalizeText(candidate.agentId, null);
      if (bindingChannel !== 'claworld') return true;
      if (bindingAccountId === resolvedAccountId) return false;
      if (!bindingAccountId && resolvedAgentId && bindingAgentId === resolvedAgentId) return false;
      return true;
    });
    if (nextBindings.length !== config.bindings.length) {
      config.bindings = nextBindings;
      summary.push(`removed claworld bindings for ${resolvedAccountId}`);
    }
    if (config.bindings.length === 0) {
      delete config.bindings;
    }
  }

  config.plugins = ensureObject(config.plugins);
  const nextPluginAllow = asStringArray(config.plugins.allow).filter((pluginId) => pluginId !== 'claworld');
  if (nextPluginAllow.length > 0) config.plugins.allow = uniqueStrings(nextPluginAllow);
  else delete config.plugins.allow;

  const nextPluginEntries = ensureObject(config.plugins.entries);
  if (Object.prototype.hasOwnProperty.call(nextPluginEntries, 'claworld')) {
    delete nextPluginEntries.claworld;
    summary.push('removed plugins.entries.claworld');
  }
  if (Object.keys(nextPluginEntries).length > 0) config.plugins.entries = nextPluginEntries;
  else delete config.plugins.entries;

  const nextPluginInstalls = ensureObject(config.plugins.installs);
  const claworldInstallRecord = ensureObject(nextPluginInstalls.claworld);
  if (Object.prototype.hasOwnProperty.call(nextPluginInstalls, 'claworld')) {
    delete nextPluginInstalls.claworld;
    summary.push('removed plugins.installs.claworld');
  }
  if (Object.keys(nextPluginInstalls).length > 0) config.plugins.installs = nextPluginInstalls;
  else delete config.plugins.installs;

  const nextPluginLoad = ensureObject(config.plugins.load);
  const sourcePath = normalizeText(claworldInstallRecord.sourcePath, null);
  const filteredLoadPaths = asStringArray(nextPluginLoad.paths).filter((entry) => entry !== sourcePath);
  if (sourcePath && filteredLoadPaths.length !== asStringArray(nextPluginLoad.paths).length) {
    if (filteredLoadPaths.length > 0) {
      nextPluginLoad.paths = uniqueStrings(filteredLoadPaths);
    } else {
      delete nextPluginLoad.paths;
    }
    summary.push('removed plugins.load.paths claworld sourcePath');
  }
  if (Object.keys(nextPluginLoad).length > 0) config.plugins.load = nextPluginLoad;
  else delete config.plugins.load;

  const nextPluginSlots = ensureObject(config.plugins.slots);
  if (normalizeText(nextPluginSlots.memory, null) === 'claworld') {
    delete nextPluginSlots.memory;
    summary.push('removed plugins.slots.memory claworld');
  }
  if (Object.keys(nextPluginSlots).length > 0) config.plugins.slots = nextPluginSlots;
  else delete config.plugins.slots;

  if (Object.keys(config.plugins).length === 0) {
    delete config.plugins;
  }

  return {
    config,
    summary,
    backup,
  };
}

export function applyClaworldBootstrapConfig(inputConfig = {}, options = {}) {
  const config = JSON.parse(JSON.stringify(ensureObject(inputConfig)));
  const summary = [];

  config.plugins = ensureObject(config.plugins);
  config.plugins.allow = uniqueStrings([...asStringArray(config.plugins.allow), 'claworld']);
  config.plugins.entries = ensureObject(config.plugins.entries);
  config.plugins.entries.claworld = {
    ...ensureObject(config.plugins.entries.claworld),
    enabled: true,
  };
  config.plugins.load = ensureObject(config.plugins.load);
  const shouldEnsureLoadPath = options.pluginInstallMode === 'link' || options.installPlugin === false;
  if (shouldEnsureLoadPath) {
    config.plugins.load.paths = uniqueStrings([
      ...asStringArray(config.plugins.load.paths),
      options.repoRoot,
    ]);
    summary.push(`plugins.load.paths includes ${options.repoRoot}`);
  }
  summary.push('plugins.allow includes claworld');

  const runtimeResult = applyClaworldManagedRuntimeConfig(config, options);
  return {
    ...runtimeResult,
    summary: [...summary, ...runtimeResult.summary],
  };
}
