import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CLAWORLD_ACCOUNT_ID,
  findClaworldManagedRuntimeBackup,
  setClaworldManagedRuntimeBackupState,
  stripClaworldManagedRuntimeConfig,
} from './managed-config.js';
import { resolveRuntimeAppToken } from './account-identity.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function resolveDefaultOpenClawConfigPath() {
  return path.resolve(normalizeText(
    process.env.OPENCLAW_CONFIG_PATH,
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  ));
}

export function resolveClaworldInstallerStatePath(configPath = resolveDefaultOpenClawConfigPath()) {
  const resolvedConfigPath = path.resolve(String(configPath));
  return path.join(path.dirname(resolvedConfigPath), '.claworld-installer-state.json');
}

async function loadInstallerStateFromDisk(installerStatePath) {
  try {
    const raw = await fs.readFile(installerStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeInstallerStateToDisk(installerStatePath, installerState) {
  const nextState = installerState && typeof installerState === 'object' && !Array.isArray(installerState)
    ? installerState
    : {};
  if (Object.keys(nextState).length === 0) {
    await fs.rm(installerStatePath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(installerStatePath), { recursive: true });
  await fs.writeFile(installerStatePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

export async function loadClaworldRuntimeBackup({
  accountId = DEFAULT_CLAWORLD_ACCOUNT_ID,
  configPath = resolveDefaultOpenClawConfigPath(),
} = {}) {
  const installerStatePath = resolveClaworldInstallerStatePath(configPath);
  const installerState = await loadInstallerStateFromDisk(installerStatePath);
  return {
    installerStatePath,
    installerState,
    backup: findClaworldManagedRuntimeBackup(installerState, accountId),
  };
}

export async function persistClaworldRuntimeBackup({
  runtime = null,
  accountId = DEFAULT_CLAWORLD_ACCOUNT_ID,
  configPath = resolveDefaultOpenClawConfigPath(),
  runtimeConfig = null,
  appToken = null,
  relayAgentId = null,
} = {}) {
  if (!runtime?.config?.loadConfig && !runtimeConfig && !appToken) {
    return { skipped: true, reason: 'missing_runtime_config_loader' };
  }

  let currentConfig = {};
  if (runtime?.config?.loadConfig) {
    try {
      currentConfig = await runtime.config.loadConfig();
    } catch (error) {
      if (!runtimeConfig && !appToken) throw error;
      currentConfig = {};
    }
  }
  const { backup: configBackup } = stripClaworldManagedRuntimeConfig(currentConfig, {
    accountId,
    preserveBackup: true,
  });
  const explicitRuntimeConfig = runtimeConfig && typeof runtimeConfig === 'object' && !Array.isArray(runtimeConfig)
    ? runtimeConfig
    : {};
  const backup = {
    ...configBackup,
    version: configBackup?.version || 1,
    accountId: normalizeText(configBackup?.accountId, normalizeText(explicitRuntimeConfig.accountId, accountId)),
    agentId: normalizeText(relayAgentId, normalizeText(configBackup?.agentId, normalizeText(explicitRuntimeConfig?.relay?.agentId, null))),
    serverUrl: normalizeText(configBackup?.serverUrl, normalizeText(explicitRuntimeConfig.serverUrl, null)),
    apiKey: normalizeText(configBackup?.apiKey, normalizeText(explicitRuntimeConfig.apiKey, null)),
    appToken: normalizeText(appToken, normalizeText(configBackup?.appToken, resolveRuntimeAppToken(explicitRuntimeConfig))),
    displayName: normalizeText(
      configBackup?.displayName,
      normalizeText(explicitRuntimeConfig.name, normalizeText(explicitRuntimeConfig.registration?.displayName, null)),
    ),
    name: normalizeText(configBackup?.name, normalizeText(explicitRuntimeConfig.name, null)),
    registrationDisplayName: normalizeText(
      configBackup?.registrationDisplayName,
      normalizeText(explicitRuntimeConfig.registration?.displayName, null),
    ),
    sessionDmScope: normalizeText(configBackup?.sessionDmScope, null),
    toolProfile: normalizeText(configBackup?.toolProfile, null),
    preservedAt: new Date().toISOString(),
  };

  if (!backup.appToken) {
    return { skipped: true, reason: 'missing_app_token', backup: null };
  }

  const installerStatePath = resolveClaworldInstallerStatePath(configPath);
  const installerState = await loadInstallerStateFromDisk(installerStatePath);
  const previousBackup = findClaworldManagedRuntimeBackup(installerState, accountId);
  if (JSON.stringify(previousBackup || null) === JSON.stringify(backup)) {
    return {
      skipped: true,
      reason: 'already_persisted',
      installerStatePath,
      backup,
    };
  }

  setClaworldManagedRuntimeBackupState(installerState, accountId, backup);
  await writeInstallerStateToDisk(installerStatePath, installerState);
  return {
    skipped: false,
    ok: true,
    installerStatePath,
    backup,
  };
}
