export const CLAWORLD_TOOL_CONTRACT_VERSION = 'v2';

export const CLAWORLD_ACCOUNT_TOOL_NAMES = Object.freeze([
  'claworld_manage_account',
]);

export const CLAWORLD_SEARCH_TOOL_NAMES = Object.freeze([
  'claworld_search',
  'claworld_get_public_profile',
]);

export const CLAWORLD_WORLD_TOOL_NAMES = Object.freeze([
  'claworld_manage_worlds',
]);

export const CLAWORLD_CONVERSATION_TOOL_NAMES = Object.freeze([
  'claworld_manage_conversations',
  'claworld_render_transcript_report',
  'claworld_report_to_human',
]);


export const CLAWORLD_REGISTERED_TOOL_NAMES = Object.freeze([
  ...CLAWORLD_ACCOUNT_TOOL_NAMES,
  ...CLAWORLD_SEARCH_TOOL_NAMES,
  ...CLAWORLD_WORLD_TOOL_NAMES,
  ...CLAWORLD_CONVERSATION_TOOL_NAMES,
]);

export const CLAWORLD_PUBLIC_TOOL_NAMES = Object.freeze([
  ...CLAWORLD_REGISTERED_TOOL_NAMES,
]);

export const CLAWORLD_RETIRED_PUBLIC_TOOL_NAMES = Object.freeze([
]);

export const CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES = Object.freeze([
  'session_status',
]);

export const CLAWORLD_READ_ONLY_OPENCLAW_TOOL_NAMES = Object.freeze([
  'memory_search',
  'memory_get',
  'read',
  'sessions_list',
  'sessions_history',
]);

export const CLAWORLD_PLUGIN_SMOKE_REQUIRED_TOOL_NAMES = Object.freeze([
  ...CLAWORLD_REGISTERED_TOOL_NAMES,
]);

export const CLAWORLD_TOOL_PROFILES = Object.freeze({
  minimal: Object.freeze([
    ...CLAWORLD_PUBLIC_TOOL_NAMES,
    ...CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES,
  ]),
  default: Object.freeze([
    ...CLAWORLD_PUBLIC_TOOL_NAMES,
    ...CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES,
    ...CLAWORLD_READ_ONLY_OPENCLAW_TOOL_NAMES,
  ]),
  world: Object.freeze([
    ...CLAWORLD_PUBLIC_TOOL_NAMES,
    ...CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES,
    ...CLAWORLD_READ_ONLY_OPENCLAW_TOOL_NAMES,
  ]),
  full: Object.freeze([
    ...CLAWORLD_PUBLIC_TOOL_NAMES,
    ...CLAWORLD_MINIMAL_OPENCLAW_TOOL_NAMES,
    ...CLAWORLD_READ_ONLY_OPENCLAW_TOOL_NAMES,
    '*',
  ]),
});
