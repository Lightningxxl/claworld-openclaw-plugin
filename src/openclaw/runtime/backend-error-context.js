function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeFieldError(fieldError = {}) {
  const fieldId = normalizeText(fieldError.fieldId, null);
  const message = normalizeText(fieldError.message, null);
  const code = normalizeText(fieldError.code, null);
  if (!fieldId && !message && !code) return null;
  return {
    ...(fieldId ? { fieldId } : {}),
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
  };
}

function normalizeMissingField(field = {}) {
  const fieldId = normalizeText(field.fieldId, null);
  const label = normalizeText(field.label, null);
  const description = normalizeText(field.description, null);
  const message = normalizeText(field.message, null);
  const code = normalizeText(field.code, null);
  if (!fieldId && !label && !description && !message && !code) return null;
  return {
    ...(fieldId ? { fieldId } : {}),
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
  };
}

function normalizePublicIdentity(publicIdentity = {}) {
  const status = normalizeText(publicIdentity.status, null);
  const displayName = normalizeText(publicIdentity.displayName, null);
  const code = normalizeText(publicIdentity.code, null);
  const displayIdentity = normalizeText(publicIdentity.displayIdentity, null);
  const confirmedAt = normalizeText(publicIdentity.confirmedAt, null);
  const updatedAt = normalizeText(publicIdentity.updatedAt, null);
  if (!status && !displayName && !code && !displayIdentity && !confirmedAt && !updatedAt) return null;
  return {
    ...(status ? { status } : {}),
    ...(displayName ? { displayName } : {}),
    ...(code ? { code } : {}),
    ...(displayIdentity ? { displayIdentity } : {}),
    ...(confirmedAt ? { confirmedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function normalizeBackendFieldError(fieldError = {}) {
  return normalizeFieldError(fieldError);
}

export function normalizeBackendMissingField(field = {}) {
  return normalizeMissingField(field);
}

export function normalizeBackendPublicIdentity(publicIdentity = {}) {
  return normalizePublicIdentity(publicIdentity);
}

export function extractBackendErrorContext(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};

  const backendCode = normalizeText(payload.error, null);
  const backendMessage = normalizeText(payload.message, null);
  const requiredAction = normalizeText(payload.requiredAction, null);
  const nextAction = normalizeText(payload.nextAction, null);
  const nextTool = normalizeText(payload.nextTool, null);
  const fieldErrors = Array.isArray(payload.fieldErrors)
    ? payload.fieldErrors.map((fieldError) => normalizeFieldError(fieldError)).filter(Boolean)
    : [];
  const missingFields = Array.isArray(payload.missingFields)
    ? payload.missingFields.map((field) => normalizeMissingField(field)).filter(Boolean)
    : [];
  const publicIdentity = normalizePublicIdentity(payload.publicIdentity);

  return {
    ...(backendCode ? { backendCode } : {}),
    ...(backendMessage ? { backendMessage } : {}),
    ...(requiredAction ? { requiredAction } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(nextTool ? { nextTool } : {}),
    ...(fieldErrors.length > 0 ? { fieldErrors } : {}),
    ...(missingFields.length > 0 ? { missingFields } : {}),
    ...(publicIdentity ? { publicIdentity } : {}),
  };
}
