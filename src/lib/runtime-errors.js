const DEFAULT_STATUS_BY_CATEGORY = {
  auth: 401,
  bootstrap: 500,
  config: 400,
  conflict: 409,
  input: 400,
  policy: 403,
  runtime: 500,
  transport: 502,
};

function inferFallbackCode(error) {
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  if (!code) return null;
  return code.toLowerCase();
}

function normalizeContext(context = null) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  return context;
}

export class RuntimeBoundaryError extends Error {
  constructor({
    code = 'internal_runtime_error',
    category = 'runtime',
    status = null,
    message = 'internal runtime error',
    publicMessage = null,
    recoverable = false,
    context = null,
    cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RuntimeBoundaryError';
    this.code = code;
    this.category = category;
    this.status = status ?? DEFAULT_STATUS_BY_CATEGORY[category] ?? 500;
    this.publicMessage = publicMessage || null;
    this.recoverable = Boolean(recoverable);
    this.context = normalizeContext(context);
  }
}

export function createRuntimeBoundaryError(options = {}) {
  return new RuntimeBoundaryError(options);
}

export function isRuntimeBoundaryError(error) {
  return error instanceof RuntimeBoundaryError
    || (
      error?.name === 'RuntimeBoundaryError'
      && typeof error?.code === 'string'
      && typeof error?.category === 'string'
    );
}

export function normalizeRuntimeBoundaryError(error, fallback = {}) {
  if (isRuntimeBoundaryError(error)) {
    if (fallback?.context && !error.context) {
      error.context = normalizeContext(fallback.context);
    }
    return error;
  }

  return new RuntimeBoundaryError({
    code: fallback.code || inferFallbackCode(error) || 'internal_runtime_error',
    category: fallback.category || 'runtime',
    status: fallback.status ?? null,
    message: fallback.message || error?.message || String(error || 'internal runtime error'),
    publicMessage: fallback.publicMessage || null,
    recoverable: fallback.recoverable === true,
    context: fallback.context || null,
    cause: error || null,
  });
}

function serializeCause(error) {
  const cause = error?.cause;
  if (!cause || cause === error) return null;
  return {
    name: cause?.name || null,
    code: typeof cause?.code === 'string' ? cause.code : null,
    message: cause?.message || String(cause),
  };
}

export function serializeRuntimeBoundaryError(error, { includeStack = false } = {}) {
  const normalized = normalizeRuntimeBoundaryError(error);
  const payload = {
    name: normalized.name,
    code: normalized.code,
    category: normalized.category,
    status: normalized.status,
    recoverable: normalized.recoverable,
    message: normalized.message,
    publicMessage: normalized.publicMessage || null,
    context: normalized.context || null,
    cause: serializeCause(normalized),
  };
  if (includeStack && normalized.stack) {
    payload.stack = normalized.stack;
  }
  return payload;
}

export function buildPublicErrorPayload(
  error,
  {
    errorType = 'internal_runtime_error',
    fallbackMessage = 'internal runtime error',
    exposeMessage = false,
    extra = null,
  } = {},
) {
  const normalized = normalizeRuntimeBoundaryError(error, {
    code: errorType,
    category: 'runtime',
    message: fallbackMessage,
  });

  return {
    error: errorType,
    code: normalized.code,
    category: normalized.category,
    recoverable: normalized.recoverable,
    message: exposeMessage ? (normalized.publicMessage || normalized.message) : (normalized.publicMessage || fallbackMessage),
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

export function logRuntimeBoundary(
  logger,
  label,
  error,
  context = null,
  { includeStack = true, fallback = null } = {},
) {
  const mergedContext = {
    ...normalizeContext(fallback?.context || null),
    ...normalizeContext(context),
  };
  const normalized = normalizeRuntimeBoundaryError(error, {
    ...(fallback || {}),
    context: Object.keys(mergedContext).length > 0 ? mergedContext : null,
  });
  logger?.error?.(label, serializeRuntimeBoundaryError(normalized, { includeStack }));
  return normalized;
}
