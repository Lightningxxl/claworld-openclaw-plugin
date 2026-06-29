import { createRuntimeBoundaryError } from '../../lib/runtime-errors.js';

export async function fetchJson(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw createRuntimeBoundaryError({
      code: 'relay_fetch_failed',
      category: 'transport',
      status: 502,
      message: `fetch failed: ${error?.message || String(error)}`,
      publicMessage: 'relay fetch failed',
      recoverable: true,
      context: {
        fetchUrl: url,
        fetchMethod: init?.method || 'GET',
      },
      cause: error,
    });
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { ok: response.ok, status: response.status, body };
}

export function normalizeRelayHttpBaseUrl(serverUrl) {
  const parsed = new URL(serverUrl);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function inferHttpErrorCategory(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'policy';
  if (status === 409) return 'conflict';
  if (status >= 400 && status < 500) return 'input';
  return 'runtime';
}
