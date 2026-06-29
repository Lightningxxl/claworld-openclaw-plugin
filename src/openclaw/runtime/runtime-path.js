export const OPENCLAW_RUNTIME_PATH = [
  'gateway(channel)',
  'subagent',
  'mainagent',
  'human(optional)',
  'mainagent',
  'subagent',
  'gateway(channel)',
];

export function createRuntimePathTrace({ sessionKey = null, eventId = null, direction = 'inbound' } = {}) {
  return {
    sessionKey: sessionKey || null,
    eventId,
    direction,
    path: [...OPENCLAW_RUNTIME_PATH],
    startedAt: new Date().toISOString(),
  };
}
