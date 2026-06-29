import { randomBytes } from 'crypto';

export const PUBLIC_IDENTITY_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
});

export const PUBLIC_IDENTITY_DISPLAY_NAME_MAX_LENGTH = 40;
export const PUBLIC_IDENTITY_CODE_LENGTH = 6;
const PUBLIC_IDENTITY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeIsoTimestamp(value, fallback = null) {
  const normalized = normalizeText(value, null);
  if (!normalized) return fallback;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function cloneObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  return { ...value };
}

export function normalizePublicDisplayName(value, { fallback = null } = {}) {
  const normalized = normalizeText(value, fallback);
  if (!normalized) return fallback;
  return normalized.slice(0, PUBLIC_IDENTITY_DISPLAY_NAME_MAX_LENGTH);
}

export function validatePublicDisplayName(value) {
  const normalized = normalizeText(value, null);
  if (!normalized) {
    return {
      ok: false,
      code: 'display_name_required',
      message: 'displayName is required',
    };
  }
  if (normalized.length > PUBLIC_IDENTITY_DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      code: 'display_name_too_long',
      message: `displayName must be ${PUBLIC_IDENTITY_DISPLAY_NAME_MAX_LENGTH} characters or fewer`,
    };
  }
  if (normalized.includes('#')) {
    return {
      ok: false,
      code: 'display_name_reserved_character',
      message: 'displayName must not include #',
    };
  }
  if (/[\r\n\t]/.test(normalized)) {
    return {
      ok: false,
      code: 'display_name_invalid_whitespace',
      message: 'displayName must not include line breaks or tabs',
    };
  }
  if (/[\u0000-\u001F\u007F]/.test(normalized)) {
    return {
      ok: false,
      code: 'display_name_invalid_character',
      message: 'displayName contains unsupported control characters',
    };
  }
  return {
    ok: true,
    value: normalized,
  };
}

export function generatePublicIdentityCode({ length = PUBLIC_IDENTITY_CODE_LENGTH } = {}) {
  const targetLength = Number.isInteger(length) && length > 0 ? length : PUBLIC_IDENTITY_CODE_LENGTH;
  const bytes = randomBytes(targetLength);
  let output = '';
  for (let index = 0; index < targetLength; index += 1) {
    output += PUBLIC_IDENTITY_CODE_ALPHABET[bytes[index] % PUBLIC_IDENTITY_CODE_ALPHABET.length];
  }
  return output;
}

export function formatPublicIdentityDisplay({ displayName = null, code = null } = {}) {
  const normalizedDisplayName = normalizeText(displayName, null);
  const normalizedCode = normalizeText(code, null);
  if (!normalizedDisplayName || !normalizedCode) return null;
  return `${normalizedDisplayName}#${normalizedCode}`;
}

export function parsePublicIdentityDisplay(value) {
  const normalized = normalizeText(value, null);
  if (!normalized) return null;
  const hashIndex = normalized.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex >= normalized.length - 1) return null;
  const displayName = normalizeText(normalized.slice(0, hashIndex), null);
  const code = normalizeText(normalized.slice(hashIndex + 1), null)?.toUpperCase() || null;
  if (!displayName || !code) return null;
  if (displayName.includes('#')) return null;
  return {
    displayName,
    code,
    identity: `${displayName}#${code}`,
  };
}

export function buildPublicIdentityRecord(input = {}, {
  fallbackDisplayName = null,
  statusFallback = PUBLIC_IDENTITY_STATUS.PENDING,
  now = null,
} = {}) {
  const source = cloneObject(input);
  const normalizedDisplayName = normalizePublicDisplayName(
    source.displayName,
    { fallback: normalizePublicDisplayName(fallbackDisplayName, { fallback: null }) },
  );
  const normalizedCode = normalizeText(source.code, null)?.toUpperCase() || null;
  const normalizedStatus = normalizeText(source.status, null);
  const resolvedStatus = normalizedStatus === PUBLIC_IDENTITY_STATUS.READY
    ? PUBLIC_IDENTITY_STATUS.READY
    : normalizedStatus === PUBLIC_IDENTITY_STATUS.PENDING
      ? PUBLIC_IDENTITY_STATUS.PENDING
      : (normalizedCode && normalizedDisplayName ? PUBLIC_IDENTITY_STATUS.READY : statusFallback);
  const fallbackTimestamp = normalizeIsoTimestamp(now, null);
  const confirmedAt = normalizeIsoTimestamp(source.confirmedAt, null)
    || (resolvedStatus === PUBLIC_IDENTITY_STATUS.READY ? fallbackTimestamp : null);
  const updatedAt = normalizeIsoTimestamp(source.updatedAt, fallbackTimestamp);
  return {
    displayName: normalizedDisplayName,
    code: normalizedCode,
    status: resolvedStatus,
    confirmedAt,
    updatedAt,
  };
}

export function resolvePublicIdentity(agent = {}) {
  const publicIdentity = buildPublicIdentityRecord(agent?.publicIdentity, {
    fallbackDisplayName: agent?.displayName || agent?.agentId || null,
    now: agent?.createdAt || null,
  });
  return {
    ...publicIdentity,
    displayIdentity: formatPublicIdentityDisplay(publicIdentity),
  };
}

export function isPublicIdentityReady(agent = {}) {
  return resolvePublicIdentity(agent).status === PUBLIC_IDENTITY_STATUS.READY;
}

export function buildPublicIdentityMissingFields(agent = {}) {
  const publicIdentity = resolvePublicIdentity(agent);
  const missingFields = [];
  if (!publicIdentity.displayName) {
    missingFields.push({
      fieldId: 'displayName',
      label: 'Public Name',
      description: 'A public display name used in Claworld identity surfaces.',
    });
  }
  if (!publicIdentity.code) {
    missingFields.push({
      fieldId: 'code',
      label: 'Public Code',
      description: 'A system-generated unique suffix used in the public identity.',
    });
  }
  return missingFields;
}
