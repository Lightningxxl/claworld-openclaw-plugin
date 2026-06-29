import os from 'os';
import path from 'path';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function expandUserPath(inputPath, homeDir = os.homedir()) {
  const text = normalizeText(inputPath, null);
  if (!text) return null;
  if (text === '~') return homeDir;
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.join(homeDir, text.slice(2));
  }
  return text;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function firstWorkspaceCandidate(...sources) {
  for (const source of sources) {
    if (!isObject(source)) continue;
    const candidates = [
      source.workspaceRoot,
      source.workspaceDir,
      source.workspacePath,
      source.workspace,
      source.cwd,
      source.agent?.workspaceRoot,
      source.agent?.workspaceDir,
      source.agent?.workspace,
      source.context?.workspaceRoot,
      source.context?.workspaceDir,
      source.context?.workspace,
      source.session?.workspaceRoot,
      source.session?.workspaceDir,
      source.session?.workspace,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate, null);
      if (normalized) return normalized;
    }
  }
  return null;
}

export function resolveOpenClawAgentId(...sources) {
  for (const source of sources) {
    if (!isObject(source)) continue;
    const candidates = [
      source.agentId,
      source.localAgentId,
      source.agent?.id,
      source.agent?.agentId,
      source.context?.agentId,
      source.context?.localAgentId,
      source.session?.agentId,
      source.session?.localAgentId,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate, null);
      if (normalized) return normalized;
    }
  }
  return null;
}

export function resolveAgentConfigEntry(config = {}, agentId = null) {
  const normalizedAgentId = normalizeText(agentId, null);
  if (!normalizedAgentId || !isObject(config?.agents)) return null;

  const list = config.agents.list;
  if (Array.isArray(list)) {
    const arrayEntry = list.find((entry) => (
      isObject(entry)
      && normalizeText(entry.id ?? entry.agentId ?? entry.name, null) === normalizedAgentId
    ));
    if (arrayEntry) return arrayEntry;
  } else if (isObject(list) && isObject(list[normalizedAgentId])) {
    return list[normalizedAgentId];
  }

  const directEntry = config.agents[normalizedAgentId];
  return isObject(directEntry) ? directEntry : null;
}

export function resolveOpenClawWorkspaceCandidate({
  sources = [],
  config = {},
  agentId = null,
} = {}) {
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const directCandidate = firstWorkspaceCandidate(...sourceList);
  if (directCandidate) return directCandidate;

  const resolvedAgentId = normalizeText(agentId, null) || resolveOpenClawAgentId(...sourceList);
  const agentEntry = resolveAgentConfigEntry(config, resolvedAgentId);
  return firstWorkspaceCandidate(agentEntry, config?.agents?.defaults);
}

export function resolveOpenClawWorkspaceRoot(input = {}, homeDir = os.homedir()) {
  const candidate = resolveOpenClawWorkspaceCandidate(input);
  const expanded = expandUserPath(candidate, homeDir);
  return expanded ? path.resolve(expanded) : null;
}
