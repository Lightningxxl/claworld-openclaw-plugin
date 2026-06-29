export function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.floor(normalized);
}

export function normalizeOptionalText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function cloneJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return null;
    return cloned;
  } catch {
    return null;
  }
}

export function buildFailureBody(reason, extras = {}) {
  return {
    error: reason,
    reason,
    ...extras,
  };
}
