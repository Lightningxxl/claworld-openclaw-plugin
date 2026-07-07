export const SEARCH_ITEM_ENVELOPE_TYPES = Object.freeze([
  'world',
  'world_member',
  'person',
]);

export const SEARCH_TOOL_SCOPES = Object.freeze([
  'worlds',
  'world_members',
  'people',
  'mixed',
]);

export const TERMINAL_PUBLIC_TOOLS = Object.freeze([
  'claworld_search',
  'claworld_get_public_profile',
  'claworld_manage_account',
  'claworld_manage_worlds',
  'claworld_manage_conversations',
]);

export const PUBLIC_TOOL_ACTION_CATALOG = Object.freeze({
  claworld_search: Object.freeze([
    'worlds',
    'world_members',
    'people',
    'mixed',
  ]),
  claworld_get_public_profile: Object.freeze([
    'get_profile',
    'lookup_profile',
  ]),
  claworld_manage_account: Object.freeze([
    'view_account',
    'start_email_verification',
    'complete_email_verification',
    'update_display_name',
    'update_human_profile',
    'update_agent_profile',
    'set_visibility_mode',
    'set_contact_policy',
    'set_proactivity',
    'subscribe_person',
    'unsubscribe_person',
  ]),
  claworld_manage_worlds: Object.freeze([
    'list_owned_worlds',
    'list_joined_worlds',
    'get_world',
    'create_world',
    'update_world',
    'join_world',
    'update_world_profile',
    'leave_world',
    'subscribe_world',
    'unsubscribe_world',
    'set_world_broadcast_preference',
    'publish_broadcast',
    'list_world_activity',
    'list_broadcast_history',
    'manage_members',
    'list_invites',
    'invite_member',
    'revoke_invite',
  ]),
  claworld_manage_conversations: Object.freeze([
    'request',
    'accept',
    'reject',
    'close',
    'get_state',
    'list_related',
  ]),
});

export const SEARCH_RESULT_ACTIONS = Object.freeze({
  world: Object.freeze([
    'open_world_context',
    'join_world',
    'subscribe_world',
  ]),
  world_member: Object.freeze([
    'open_public_profile',
    'subscribe_person',
    'request_chat',
  ]),
  person: Object.freeze([
    'open_public_profile',
    'subscribe_person',
    'request_chat',
  ]),
});

export const MODULE_OWNERSHIP_MAP = Object.freeze({
  AccountSurface: Object.freeze({
    ownerTool: 'claworld_manage_account',
    modules: Object.freeze([
      'src/product-shell/profile/*',
      'src/lib/agent-profile.js',
      'src/lib/public-identity.js',
    ]),
  }),
  PublicProfileSurface: Object.freeze({
    ownerTool: 'claworld_get_public_profile',
    modules: Object.freeze([
      'src/product-shell/profile/public-profile-service.js',
      'src/product-shell/profile/public-profile-routes.js',
    ]),
  }),
  SearchSurface: Object.freeze({
    ownerTool: 'claworld_search',
    modules: Object.freeze([
      'src/product-shell/search/*',
      'src/lib/search/*',
      'src/lib/store/*',
      'src/product-shell/contracts/search-item.js',
    ]),
  }),
  WorldSurface: Object.freeze({
    ownerTool: 'claworld_manage_worlds',
    modules: Object.freeze([
      'src/product-shell/worlds/*',
      'src/product-shell/membership/*',
      'src/product-shell/contracts/world-manifest.js',
    ]),
  }),
  ConversationSurface: Object.freeze({
    ownerTool: 'claworld_manage_conversations',
    modules: Object.freeze([
      'src/product-shell/social/chat-request-service.js',
      'src/lib/relay/*',
    ]),
  }),
});

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeList(values = []) {
  return Array.isArray(values) ? values.filter((value) => normalizeText(value, null)) : [];
}

function isKnownSearchType(type) {
  return SEARCH_ITEM_ENVELOPE_TYPES.includes(type);
}

function assertKnownAction(type, actionName) {
  const allowedActions = SEARCH_RESULT_ACTIONS[type] || [];
  if (!allowedActions.includes(actionName)) {
    throw new Error(`unsupported_search_item_action:${type}:${actionName}`);
  }
}

export function buildSearchItemAction({ name, tool, action = null, scope = null, payload = null } = {}) {
  const normalizedName = normalizeText(name, null);
  const normalizedTool = normalizeText(tool, null);
  if (!normalizedName) throw new Error('search_item_action_name_required');
  if (!TERMINAL_PUBLIC_TOOLS.includes(normalizedTool)) throw new Error(`unsupported_public_tool:${normalizedTool}`);
  if (normalizedTool === 'claworld_search') {
    if (!SEARCH_TOOL_SCOPES.includes(scope)) throw new Error(`unsupported_search_scope:${scope}`);
    return {
      name: normalizedName,
      tool: normalizedTool,
      scope,
      payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? { scope, ...payload } : { scope },
    };
  }
  const normalizedAction = normalizeText(action, null);
  if (!PUBLIC_TOOL_ACTION_CATALOG[normalizedTool]?.includes(normalizedAction)) {
    throw new Error(`unsupported_public_tool_action:${normalizedTool}:${normalizedAction}`);
  }
  return {
    name: normalizedName,
    tool: normalizedTool,
    action: normalizedAction,
    payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {},
  };
}

export function buildSearchItemEnvelope({
  type,
  id,
  title,
  subtitle = null,
  summary = null,
  score = 0,
  matchedFieldIds = [],
  visibility = null,
  actions = {},
  subject = null,
  source = null,
  extra = {},
} = {}) {
  const normalizedType = normalizeText(type, null);
  if (!isKnownSearchType(normalizedType)) throw new Error(`unsupported_search_item_type:${normalizedType}`);
  const normalizedId = normalizeText(id, null);
  if (!normalizedId) throw new Error('search_item_id_required');
  const normalizedTitle = normalizeText(title, normalizedId);
  Object.keys(actions || {}).forEach((actionName) => assertKnownAction(normalizedType, actionName));
  return {
    type: normalizedType,
    itemType: normalizedType,
    resultType: normalizedType,
    id: normalizedId,
    title: normalizedTitle,
    subtitle: normalizeText(subtitle, null),
    summary: normalizeText(summary, null),
    score: normalizeNumber(score, 0),
    matchedFieldIds: normalizeList(matchedFieldIds),
    visibility: visibility && typeof visibility === 'object' && !Array.isArray(visibility) ? { ...visibility } : null,
    actions: { ...actions },
    subject: subject && typeof subject === 'object' && !Array.isArray(subject) ? { ...subject } : null,
    source: source ?? null,
    ...extra,
  };
}
