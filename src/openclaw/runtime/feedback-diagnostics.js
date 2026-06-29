import { CLAWORLD_PLUGIN_CURRENT_VERSION } from '../plugin-version.js';
import { getClaworldRuntime } from '../plugin/runtime.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function readPath(source, path) {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function normalizeModelProvider(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'string') return normalizeText(value, fallback);
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeText(value.provider, fallback);
  }
  return fallback;
}

function normalizeModelId(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'string') return normalizeText(value, fallback);
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeText(value.id, normalizeText(value.modelId, normalizeText(value.name, fallback)));
  }
  return fallback;
}

function normalizeOsCategory(platform = process.platform) {
  switch (platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'other';
  }
}

function resolveRuntimeCandidate(contextRuntime = null) {
  const normalizedContextRuntime = normalizeObject(contextRuntime);
  if (normalizedContextRuntime) return normalizedContextRuntime;
  try {
    return normalizeObject(getClaworldRuntime());
  } catch {
    return null;
  }
}

async function loadRuntimeConfig(runtime = null) {
  if (!runtime?.config || typeof runtime.config.loadConfig !== 'function') {
    return null;
  }
  try {
    return normalizeObject(await runtime.config.loadConfig());
  } catch {
    return null;
  }
}

const MODEL_PROVIDER_PATHS = [
  ['agent', 'defaults', 'provider'],
  ['agent', 'defaults', 'modelProvider'],
  ['agent', 'defaults', 'model', 'provider'],
  ['defaults', 'provider'],
  ['defaults', 'modelProvider'],
  ['defaults', 'model', 'provider'],
  ['runtime', 'agent', 'defaults', 'provider'],
  ['runtime', 'agent', 'defaults', 'modelProvider'],
  ['runtime', 'agent', 'defaults', 'model', 'provider'],
  ['runtime', 'defaults', 'provider'],
  ['runtime', 'defaults', 'modelProvider'],
  ['runtime', 'defaults', 'model', 'provider'],
  ['model', 'provider'],
  ['provider'],
  ['modelProvider'],
];

const MODEL_ID_PATHS = [
  ['agent', 'defaults', 'modelId'],
  ['agent', 'defaults', 'model', 'id'],
  ['agent', 'defaults', 'model', 'modelId'],
  ['agent', 'defaults', 'model', 'name'],
  ['agent', 'defaults', 'model'],
  ['defaults', 'modelId'],
  ['defaults', 'model', 'id'],
  ['defaults', 'model', 'modelId'],
  ['defaults', 'model', 'name'],
  ['defaults', 'model'],
  ['runtime', 'agent', 'defaults', 'modelId'],
  ['runtime', 'agent', 'defaults', 'model', 'id'],
  ['runtime', 'agent', 'defaults', 'model', 'modelId'],
  ['runtime', 'agent', 'defaults', 'model', 'name'],
  ['runtime', 'agent', 'defaults', 'model'],
  ['runtime', 'defaults', 'modelId'],
  ['runtime', 'defaults', 'model', 'id'],
  ['runtime', 'defaults', 'model', 'modelId'],
  ['runtime', 'defaults', 'model', 'name'],
  ['runtime', 'defaults', 'model'],
  ['modelId'],
  ['model', 'id'],
  ['model', 'modelId'],
  ['model', 'name'],
  ['model'],
];

const OPENCLAW_VERSION_PATHS = [
  ['version'],
  ['host', 'version'],
  ['openclaw', 'version'],
  ['meta', 'hostVersion'],
  ['meta', 'openclawVersion'],
  ['hostVersion'],
];

function pickDiagnosticValue(sources, paths, normalizer) {
  for (const source of sources) {
    const normalizedSource = normalizeObject(source);
    if (!normalizedSource) continue;
    for (const path of paths) {
      const value = readPath(normalizedSource, path);
      const normalizedValue = normalizer(value, null);
      if (normalizedValue) return normalizedValue;
    }
  }
  return null;
}

function resolveModelDiagnostics(sources = []) {
  return {
    modelProvider: pickDiagnosticValue(sources, MODEL_PROVIDER_PATHS, normalizeModelProvider),
    modelId: pickDiagnosticValue(sources, MODEL_ID_PATHS, normalizeModelId),
  };
}

function detectOpenclawVersion(runtime = null) {
  return pickDiagnosticValue([runtime], OPENCLAW_VERSION_PATHS, normalizeText);
}

export async function collectFeedbackDiagnostics({
  cfg = {},
  runtime = null,
  pluginVersion = null,
} = {}) {
  const resolvedRuntime = resolveRuntimeCandidate(runtime);
  const loadedConfig = await loadRuntimeConfig(resolvedRuntime);
  const openclawVersion = detectOpenclawVersion(resolvedRuntime);
  const modelDiagnostics = resolveModelDiagnostics([
    resolvedRuntime,
    loadedConfig,
    cfg,
  ]);

  return {
    openclawVersion: normalizeText(openclawVersion, null),
    pluginVersion: normalizeText(pluginVersion, CLAWORLD_PLUGIN_CURRENT_VERSION),
    modelProvider: normalizeText(modelDiagnostics.modelProvider, null),
    modelId: normalizeText(modelDiagnostics.modelId, null),
    osCategory: normalizeOsCategory(process.platform),
  };
}
