import repoPackageJson from '../../package.json' with { type: 'json' };

export const CLAWORLD_PLUGIN_PACKAGE_NAME = '@xfxstudio/claworld';
export const CLAWORLD_CLIENT_HEADER = 'x-claworld-client';
export const CLAWORLD_CLIENT_VERSION_HEADER = 'x-claworld-client-version';
export const CLAWORLD_CLIENT_CHANNEL_HEADER = 'x-claworld-client-channel';
export const CLAWORLD_OPENCLAW_PLUGIN_CLIENT = 'openclaw-plugin';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function normalizeClaworldPluginVersion(value, fallback = null) {
  const normalized = normalizeText(value, null);
  if (!normalized) return fallback;
  const withoutPrefix = normalized.replace(/^v/i, '');
  if (!/^\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(withoutPrefix)) {
    return fallback;
  }
  return withoutPrefix;
}

function resolveCurrentPluginVersion() {
  const repoVersion = normalizeClaworldPluginVersion(repoPackageJson?.version, null);
  if (repoPackageJson?.name === CLAWORLD_PLUGIN_PACKAGE_NAME && repoVersion) {
    return repoVersion;
  }

  return repoVersion || '0.0.0';
}

export const CLAWORLD_PLUGIN_CURRENT_VERSION = resolveCurrentPluginVersion();

export function inferClaworldClientChannel(version = CLAWORLD_PLUGIN_CURRENT_VERSION, fallback = null) {
  const normalized = normalizeClaworldPluginVersion(version, null);
  if (!normalized) return fallback;
  if (/-testing(?:\.|$)/.test(normalized)) return 'testing';
  return 'stable';
}
