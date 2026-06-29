import repoPackageJson from '../../package.json' with { type: 'json' };

export const CLAWORLD_PLUGIN_PACKAGE_NAME = '@xfxstudio/claworld';
export const CLAWORLD_PLUGIN_VERSION_HEADER = 'x-claworld-plugin-version';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0]);
  }
  const normalized = normalizeText(value, null);
  if (!normalized) return null;
  return normalized.split(',')[0]?.trim() || null;
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

export function readClaworldPluginVersionFromHeaders(headers = {}) {
  const rawVersion = normalizeHeaderValue(headers?.[CLAWORLD_PLUGIN_VERSION_HEADER]);
  return {
    rawVersion,
    reportedVersion: normalizeClaworldPluginVersion(rawVersion, rawVersion),
    normalizedVersion: normalizeClaworldPluginVersion(rawVersion, null),
    source: rawVersion ? CLAWORLD_PLUGIN_VERSION_HEADER : null,
  };
}

export function buildClaworldRelayClientVersion(version = CLAWORLD_PLUGIN_CURRENT_VERSION) {
  return `claworld-plugin/${normalizeClaworldPluginVersion(version, CLAWORLD_PLUGIN_CURRENT_VERSION)}`;
}
