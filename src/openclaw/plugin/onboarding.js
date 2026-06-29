import {
  DEFAULT_CLAWORLD_ACCOUNT_ID,
  applyClaworldManagedRuntimeConfig,
  ensureObject,
  normalizeText,
  resolveClaworldManagedRuntimeOptions,
} from './managed-config.js';
import {
  defaultClaworldAccountId,
  inspectClaworldChannelAccount,
  listClaworldAccountIds,
} from './config-schema.js';
import {
  fetchJson,
  normalizeRelayHttpBaseUrl,
} from '../runtime/http-boundary.js';

function collectUnsupportedSetupFlags(input = {}) {
  const unsupported = [];
  const flagMap = [
    ['appToken', '--app-token'],
    ['token', '--token'],
    ['tokenFile', '--token-file'],
    ['botToken', '--bot-token'],
    ['signalNumber', '--signal-number'],
    ['cliPath', '--cli-path'],
    ['dbPath', '--db-path'],
    ['service', '--service'],
    ['region', '--region'],
    ['authDir', '--auth-dir'],
    ['httpHost', '--http-host'],
    ['httpPort', '--http-port'],
    ['webhookPath', '--webhook-path'],
    ['webhookUrl', '--webhook-url'],
    ['audienceType', '--audience-type'],
    ['audience', '--audience'],
    ['homeserver', '--homeserver'],
    ['userId', '--user-id'],
    ['accessToken', '--access-token'],
    ['password', '--password'],
    ['deviceName', '--device-name'],
    ['initialSyncLimit', '--initial-sync-limit'],
    ['ship', '--ship'],
  ];

  for (const [field, flag] of flagMap) {
    if (normalizeText(input[field], null)) unsupported.push(flag);
  }
  if (Array.isArray(input.groupChannels) && input.groupChannels.length > 0) unsupported.push('--group-channels');
  if (Array.isArray(input.dmAllowlist) && input.dmAllowlist.length > 0) unsupported.push('--dm-allowlist');
  if (input.autoDiscoverChannels === true) unsupported.push('--auto-discover-channels');
  if (input.useEnv === true) unsupported.push('--use-env');
  return unsupported;
}

export function validateClaworldSetupInput({ input = {} } = {}) {
  const unsupportedFlags = collectUnsupportedSetupFlags(input);
  if (unsupportedFlags.length > 0) {
    return (
      'Claworld host-native setup only supports an optional local account label and --http-url/--url overrides. '
      + `Unsupported flag(s): ${unsupportedFlags.join(', ')}.`
    );
  }

  const serverUrl = normalizeText(input.httpUrl, normalizeText(input.url, null));
  if (!serverUrl) {
    return null;
  }

  try {
    const parsed = new URL(serverUrl);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      return `Unsupported Claworld server URL protocol: ${parsed.protocol}`;
    }
  } catch {
    return `Invalid Claworld server URL: ${serverUrl}`;
  }

  return null;
}

function findAgentEntry(config = {}, agentId) {
  const normalizedAgentId = normalizeText(agentId, null);
  if (!normalizedAgentId) return null;
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list
    .map((entry) => ensureObject(entry))
    .find((entry) => entry.id === normalizedAgentId) || null;
}

function hasClaworldBinding(config = {}, { agentId, accountId } = {}) {
  const normalizedAgentId = normalizeText(agentId, null);
  const normalizedAccountId = normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID);
  const resolvedDefaultAccountId = defaultClaworldAccountId(config) || DEFAULT_CLAWORLD_ACCOUNT_ID;
  const bindings = Array.isArray(config?.bindings) ? config.bindings : [];
  return bindings.some((binding) => {
    const candidate = ensureObject(binding);
    const match = ensureObject(candidate.match);
    const bindingChannel = normalizeText(match.channel, null);
    const bindingAccountId = normalizeText(match.accountId, null);
    const bindingAgentId = normalizeText(candidate.agentId, null);
    if (bindingChannel !== 'claworld') return false;
    if (normalizedAgentId && bindingAgentId !== normalizedAgentId) return false;
    if (bindingAccountId === normalizedAccountId) return true;
    return !bindingAccountId && resolvedDefaultAccountId === normalizedAccountId;
  });
}

function hasRuntimeCredential(account = {}) {
  return Boolean(
    account?.configured
    && normalizeText(account?.appToken, null),
  );
}

export function inspectManagedClaworldInstall({
  cfg = {},
  accountId = DEFAULT_CLAWORLD_ACCOUNT_ID,
  input = {},
  overrides = {},
} = {}) {
  const configuredAccountIds = listClaworldAccountIds(cfg);
  const hasAnyConfig = configuredAccountIds.length > 0 || cfg?.channels?.claworld != null;
  const managedOptions = resolveClaworldManagedRuntimeOptions({
    cfg,
    accountId,
    input,
    overrides,
  });
  const managedAgentPresent = Boolean(findAgentEntry(cfg, managedOptions.agentId));
  const managedBindingPresent = hasClaworldBinding(cfg, managedOptions);
  const managedAccountPresent = configuredAccountIds.includes(managedOptions.accountId);
  const accountStatus = managedAccountPresent
    ? inspectClaworldChannelAccount(cfg, managedOptions.accountId)
    : inspectClaworldChannelAccount({}, managedOptions.accountId);
  const runtimeCredentialReady = hasRuntimeCredential(accountStatus);
  const setupReady = Boolean(
    managedAccountPresent
    && managedBindingPresent
  );

  let statusLabel = 'needs setup';
  let selectionHint = 'remote relay world channel';
  let quickstartScore = 5;

  if (setupReady && runtimeCredentialReady) {
    statusLabel = 'configured';
    selectionHint = 'configured · ready';
    quickstartScore = 2;
  } else if (setupReady) {
    statusLabel = 'configured (email verification pending)';
    selectionHint = 'configured · email verification pending';
    quickstartScore = 3;
  } else if (managedAccountPresent && !managedBindingPresent) {
    statusLabel = 'configured (binding pending)';
    selectionHint = 'configured · binding pending';
    quickstartScore = 4;
  } else if (hasAnyConfig) {
    statusLabel = 'configured (refresh recommended)';
    selectionHint = 'configured · refresh recommended';
    quickstartScore = 4;
  }

  return {
    hasAnyConfig,
    configuredAccountIds,
    defaultAccountId: defaultClaworldAccountId(cfg) || null,
    managedOptions,
    managedAccountPresent,
    managedAgentPresent,
    managedBindingPresent,
    accountStatus,
    runtimeCredentialReady,
    setupReady,
    statusLabel,
    selectionHint,
    quickstartScore,
  };
}

export function buildClaworldOnboardingStatus({
  cfg = {},
  accountId = DEFAULT_CLAWORLD_ACCOUNT_ID,
} = {}) {
  const inspection = inspectManagedClaworldInstall({ cfg, accountId });
  return {
    configured: inspection.setupReady,
    statusLines: [`Claworld: ${inspection.statusLabel}`],
    selectionHint: inspection.selectionHint,
    quickstartScore: inspection.quickstartScore,
    runtimeCredentialReady: inspection.runtimeCredentialReady,
  };
}

function applyManagedAccountName({ cfg = {}, accountId, name } = {}) {
  const normalizedName = normalizeText(name, null);
  if (!normalizedName) return cfg;

  const next = JSON.parse(JSON.stringify(ensureObject(cfg)));
  next.channels = ensureObject(next.channels);
  const claworldRoot = ensureObject(next.channels.claworld);
  const accounts = ensureObject(claworldRoot.accounts);
  const existingAccount = ensureObject(accounts[accountId]);
  accounts[accountId] = {
    ...existingAccount,
    name: normalizedName,
    ...(existingAccount.registration
      ? {
          registration: {
            ...ensureObject(existingAccount.registration),
            displayName: normalizedName,
          },
        }
      : {}),
  };
  next.channels.claworld = {
    ...claworldRoot,
    accounts,
  };
  return next;
}

function resolveManagedOptionsFromContext({ cfg = {}, accountId = null, input = {}, overrides = {} } = {}) {
  const normalizedInput = ensureObject(input);
  const resolvedInput = { ...normalizedInput };
  delete resolvedInput.name;
  return resolveClaworldManagedRuntimeOptions({
    cfg,
    accountId: normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID),
    input: resolvedInput,
    overrides: {
      ...overrides,
      ...(normalizeText(normalizedInput.name, null) ? { name: normalizedInput.name } : {}),
    },
  });
}

function resolveSetupFetchImpl(runtime = {}) {
  const candidate = runtime?.fetchImpl
    || runtime?.fetch
    || (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  if (typeof candidate !== 'function') {
    throw new Error('Claworld setup requires fetch support to complete email verification.');
  }
  return (url, init) => candidate(url, init);
}

function validateSetupEmail(value) {
  const normalized = normalizeText(value, null);
  if (!normalized) return 'Email is required.';
  if (!normalized.includes('@')) return 'Enter a valid email address.';
  return null;
}

function validateSetupVerificationCode(value) {
  return normalizeText(value, null) ? null : 'Verification code is required.';
}

function formatSetupApiError(result, fallbackMessage) {
  const body = ensureObject(result?.body);
  const detail = normalizeText(
    body.publicMessage,
    normalizeText(body.error, normalizeText(body.message, null)),
  );
  return detail ? `${fallbackMessage}: ${detail}` : fallbackMessage;
}

async function startSetupEmailVerification({
  runtimeConfig,
  email,
  displayName = null,
  fetchImpl,
} = {}) {
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const normalizedEmail = normalizeText(email, null);
  const normalizedDisplayName = normalizeText(displayName, null);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/identity/email/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
    },
    body: JSON.stringify({
      email: normalizedEmail,
      ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
    }),
  });
  if (!result.ok) {
    throw new Error(formatSetupApiError(result, 'Failed to start Claworld email verification'));
  }
  return ensureObject(result.body);
}

async function completeSetupEmailVerification({
  runtimeConfig,
  email,
  code,
  fetchImpl,
} = {}) {
  const baseUrl = normalizeRelayHttpBaseUrl(runtimeConfig.serverUrl);
  const result = await fetchJson(fetchImpl, `${baseUrl}/v1/identity/email/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runtimeConfig.apiKey ? { 'x-api-key': runtimeConfig.apiKey } : {}),
    },
    body: JSON.stringify({
      email: normalizeText(email, null),
      code: normalizeText(code, null),
    }),
  });
  if (!result.ok) {
    throw new Error(formatSetupApiError(result, 'Failed to complete Claworld email verification'));
  }
  return ensureObject(result.body);
}

async function resolveSetupCredential({
  managedOptions,
  prompter,
  runtime = {},
  input = {},
} = {}) {
  if (managedOptions.appToken) return null;

  const fetchImpl = resolveSetupFetchImpl(runtime);
  const email = normalizeText(await prompter.text({
    message: 'Claworld account email',
    placeholder: 'you@example.com',
    validate: validateSetupEmail,
  }), null);

  await startSetupEmailVerification({
    runtimeConfig: managedOptions,
    email,
    displayName: normalizeText(input?.name, null),
    fetchImpl,
  });

  const code = normalizeText(await prompter.text({
    message: `Verification code sent to ${email}`,
    placeholder: '123456',
    validate: validateSetupVerificationCode,
  }), null);

  const verification = await completeSetupEmailVerification({
    runtimeConfig: managedOptions,
    email,
    code,
    fetchImpl,
  });
  const appToken = normalizeText(verification.appToken, null);
  const relayAgentId = normalizeText(verification.agentId, null);
  if (!appToken || !relayAgentId) {
    throw new Error('Claworld email verification did not return appToken and agentId.');
  }
  return {
    email,
    appToken,
    relayAgentId,
    created: verification.created === true,
    recovered: verification.recovered === true,
  };
}

async function applyManagedOnboardingConfig({
  cfg = {},
  runtime = {},
  prompter,
  accountId = null,
  phase = 'setup',
  input = {},
} = {}) {
  const initialManagedOptions = resolveManagedOptionsFromContext({ cfg, accountId, input });
  const setupCredential = await resolveSetupCredential({
    managedOptions: initialManagedOptions,
    prompter,
    runtime,
    input,
  });
  const managedOptions = setupCredential
    ? {
        ...initialManagedOptions,
        appToken: setupCredential.appToken,
        relayAgentId: setupCredential.relayAgentId,
      }
    : initialManagedOptions;
  const next = applyClaworldManagedRuntimeConfig(cfg, managedOptions);

  const noteLines = [
    `Bound local agent/account: ${managedOptions.agentId}`,
    `Remote backend: ${managedOptions.serverUrl}`,
    setupCredential
      ? `Email verification: completed for ${setupCredential.email}; runtime credential saved to OpenClaw config`
      : managedOptions.appToken
      ? 'Runtime credential: configured appToken is present'
      : 'Email verification: pending until claworld_manage_account(action=start_email_verification|complete_email_verification) runs',
    managedOptions.relayAgentId
      ? `Remote agent identity: ${managedOptions.relayAgentId}`
      : 'Remote agent identity: pending',
    'Workspace memory: runtime prompt bootstrap maintains .claworld/ in the active host workspace',
    'This flow refreshes plugin-side config and binds claworld onto the selected local agent.',
    'Setup lifecycle: OpenClaw host-native setup; channel reload is handled by config reload.',
  ];
  await prompter.note(
    noteLines.join('\n'),
    phase === 'refresh' ? 'Claworld refresh' : 'Claworld setup',
  );

  return {
    cfg: next.config,
    accountId: managedOptions.accountId,
  };
}

export const claworldSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeText(accountId, DEFAULT_CLAWORLD_ACCOUNT_ID),
  resolveBindingAccountId: ({ cfg, agentId, accountId }) => {
    const explicit = normalizeText(accountId, null);
    if (explicit) return explicit;
    const normalizedAgentId = normalizeText(agentId, null);
    const accountIds = listClaworldAccountIds(cfg);
    if (normalizedAgentId && accountIds.includes(normalizedAgentId)) {
      return normalizedAgentId;
    }
    return accountIds.length > 0 ? defaultClaworldAccountId(cfg) : DEFAULT_CLAWORLD_ACCOUNT_ID;
  },
  applyAccountName: ({ cfg, accountId, name }) => applyManagedAccountName({ cfg, accountId, name }),
  validateInput: ({ input }) => validateClaworldSetupInput({ input }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const managedOptions = resolveManagedOptionsFromContext({ cfg, accountId, input });
    return applyClaworldManagedRuntimeConfig(cfg, managedOptions).config;
  },
};

export const claworldOnboardingAdapter = {
  channel: 'claworld',
  getStatus: async ({ cfg, accountOverrides }) => {
    const managedAccountId = normalizeText(accountOverrides?.claworld, DEFAULT_CLAWORLD_ACCOUNT_ID);
    return {
      channel: 'claworld',
      ...buildClaworldOnboardingStatus({
        cfg,
        accountId: managedAccountId,
      }),
    };
  },
  configure: async ({ cfg, runtime, prompter, accountOverrides }) =>
    applyManagedOnboardingConfig({
      cfg,
      runtime,
      prompter,
      accountId: accountOverrides?.claworld,
      phase: 'setup',
      input: {},
    }),
  configureWhenConfigured: async ({ cfg, runtime, prompter, accountOverrides }) =>
    applyManagedOnboardingConfig({
      cfg,
      runtime,
      prompter,
      accountId: accountOverrides?.claworld,
      phase: 'refresh',
      input: {},
    }),
};
