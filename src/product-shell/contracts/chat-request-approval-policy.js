const DEFAULT_MODE = 'open';
const SUPPORTED_MODES = Object.freeze([
  'manual_review',
  'world_only',
  'trusted_only',
  'trusted_or_world',
  'open',
  'reject_all',
]);
const SUPPORTED_ORIGIN_TYPES = Object.freeze([
  'chat_request',
  'world_broadcast',
]);

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeToken(value, fallback = null) {
  const normalized = normalizeText(value, fallback);
  return normalized ? normalized.toLowerCase().replace(/[\s-]+/g, '_') : fallback;
}

function uniqueStrings(values = [], normalizer = (value) => normalizeText(value, null)) {
  const seen = new Set();
  const items = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizer(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

export const CHAT_REQUEST_APPROVAL_POLICY_SCHEMA_VERSION = 1;
export const CHAT_REQUEST_APPROVAL_POLICY_MODES = SUPPORTED_MODES;
export const CHAT_REQUEST_APPROVAL_POLICY_ORIGIN_TYPES = SUPPORTED_ORIGIN_TYPES;
export const DEFAULT_CHAT_REQUEST_APPROVAL_POLICY_MODE = DEFAULT_MODE;

export function normalizeChatRequestApprovalMode(value, fallback = DEFAULT_MODE) {
  const normalized = normalizeToken(value, null);
  switch (normalized) {
    case 'manual':
    case 'manual_review':
    case 'review':
      return 'manual_review';
    case 'world':
    case 'world_only':
      return 'world_only';
    case 'trusted':
    case 'trusted_only':
      return 'trusted_only';
    case 'trusted_or_world':
    case 'world_or_trusted':
      return 'trusted_or_world';
    case 'open':
    case 'auto_accept':
    case 'all':
      return 'open';
    case 'reject':
    case 'reject_all':
    case 'closed':
    case 'do_not_disturb':
      return 'reject_all';
    default:
      return SUPPORTED_MODES.includes(fallback) ? fallback : DEFAULT_MODE;
  }
}

export function normalizeChatRequestApprovalOriginType(value, fallback = null) {
  const normalized = normalizeToken(value, fallback);
  return SUPPORTED_ORIGIN_TYPES.includes(normalized) ? normalized : fallback;
}

export function normalizeChatRequestApprovalBlocks(value = {}) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    originTypes: uniqueStrings(candidate.originTypes, (entry) => normalizeChatRequestApprovalOriginType(entry, null)).sort(),
    worldIds: uniqueStrings(candidate.worldIds, (entry) => normalizeText(entry, null)).sort(),
  };
}

export function normalizeChatRequestApprovalPolicy(
  value = {},
  { fallbackMode = DEFAULT_MODE } = {},
) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mode = normalizeText(candidate.mode, null)
    ? normalizeChatRequestApprovalMode(candidate.mode, fallbackMode)
    : normalizeChatRequestApprovalMode(fallbackMode, DEFAULT_MODE);

  return {
    mode,
    blocks: normalizeChatRequestApprovalBlocks(candidate.blocks),
  };
}
