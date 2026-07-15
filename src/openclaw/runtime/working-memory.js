import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveOpenClawWorkspaceRoot } from './workspace-resolver.js';

export const CLAWORLD_WORKING_MEMORY_DIR = '.claworld';
export const CLAWORLD_CONTEXT_DIR = 'context';
export const CLAWORLD_JOURNAL_DIR = 'journal';
export const CLAWORLD_REPORTS_DIR = 'reports';
export const CLAWORLD_SESSIONS_DIR = 'sessions';

export const CLAWORLD_WORKING_MEMORY_FILES = Object.freeze({
  index: 'INDEX.md',
  now: 'context/NOW.md',
  profile: 'context/PROFILE.md',
  memory: 'context/MEMORY.md',
});

export const CLAWORLD_WORKING_MEMORY_DIRECTORIES = Object.freeze([
  CLAWORLD_WORKING_MEMORY_DIR,
  `${CLAWORLD_WORKING_MEMORY_DIR}/${CLAWORLD_CONTEXT_DIR}`,
  `${CLAWORLD_WORKING_MEMORY_DIR}/${CLAWORLD_JOURNAL_DIR}`,
  `${CLAWORLD_WORKING_MEMORY_DIR}/${CLAWORLD_REPORTS_DIR}`,
  `${CLAWORLD_WORKING_MEMORY_DIR}/${CLAWORLD_SESSIONS_DIR}`,
]);

export const CLAWORLD_BOOTSTRAP_TARGETS = Object.freeze({
  MAIN: 'main',
  MANAGEMENT: 'management',
  CLAWORLD_CONVERSATION: 'claworld_conversation',
  NONE: 'none',
});

export const CLAWORLD_MAINTENANCE_RUN_TYPES = Object.freeze({
  L1_NOW_REFRESH: 'L1_NOW_REFRESH',
  L2_MEMORY_PROFILE_REVIEW: 'L2_MEMORY_PROFILE_REVIEW',
});

const MAINTENANCE_RUN_TYPE_VALUES = new Set(Object.values(CLAWORLD_MAINTENANCE_RUN_TYPES));

const L1_ALLOWED_TARGETS = new Set([
  CLAWORLD_WORKING_MEMORY_FILES.now,
]);

const L2_ALLOWED_TARGETS = new Set([
  CLAWORLD_WORKING_MEMORY_FILES.now,
  CLAWORLD_WORKING_MEMORY_FILES.profile,
  CLAWORLD_WORKING_MEMORY_FILES.memory,
]);

const MAX_EVENT_EXCERPT_CHARS = 600;
const MAX_MEMORY_SLICE_CHARS = 4000;
const MAX_BOOTSTRAP_FILE_CHARS = 12000;
const MAX_BOOTSTRAP_TOTAL_CHARS = 60000;
const CLAWORLD_JOURNAL_SCHEMA = 'claworld.journal.v2';
const CLAWORLD_SESSION_DIRECTORY_SCHEMA = 'claworld.sessions.v1';
const CLAWORLD_SESSION_DIRECTORY_FILE = `${CLAWORLD_SESSIONS_DIR}/index.json`;

const MAIN_BOOTSTRAP_FILES = Object.freeze([
  CLAWORLD_WORKING_MEMORY_FILES.memory,
]);

const MANAGEMENT_BOOTSTRAP_FILES = Object.freeze([
  CLAWORLD_WORKING_MEMORY_FILES.profile,
  CLAWORLD_WORKING_MEMORY_FILES.memory,
  CLAWORLD_WORKING_MEMORY_FILES.now,
]);

const CONVERSATION_BOOTSTRAP_FILES = Object.freeze([
  CLAWORLD_WORKING_MEMORY_FILES.now,
  CLAWORLD_WORKING_MEMORY_FILES.memory,
  CLAWORLD_WORKING_MEMORY_FILES.profile,
]);

const CLAWORLD_CONTEXT_FILE_SCHEMAS = Object.freeze({
  [CLAWORLD_WORKING_MEMORY_FILES.now]: Object.freeze({
    title: '# Claworld Now',
    headings: Object.freeze([
      '## Active Goals',
      '## Pending Approvals',
      '## Watched People And Worlds',
      '## Open Conversations',
      '## Recent Changes',
      '## Closed Recently',
    ]),
  }),
  [CLAWORLD_WORKING_MEMORY_FILES.profile]: Object.freeze({
    title: '# Claworld Profile',
    headings: Object.freeze([
      '## Identity And Background',
      '## Goals And Interests',
      '## Social Style',
      '## Autonomy Policy',
      '## Contact And Notification Preferences',
      '## Privacy And Sensitive Boundaries',
      '## World And People Preferences',
      '## Explicit Do-Not Rules',
    ]),
  }),
  [CLAWORLD_WORKING_MEMORY_FILES.memory]: Object.freeze({
    title: '# Claworld Memory',
    headings: Object.freeze([
      '## Memories',
    ]),
    maxBulletLength: 280,
  }),
});

function buildClaworldArtifactPaths(workspaceRoot = null) {
  const basePath = workspaceRoot
    ? path.join(String(workspaceRoot), CLAWORLD_WORKING_MEMORY_DIR)
    : CLAWORLD_WORKING_MEMORY_DIR;
  return {
    now: path.join(basePath, CLAWORLD_WORKING_MEMORY_FILES.now),
    memory: path.join(basePath, CLAWORLD_WORKING_MEMORY_FILES.memory),
    profile: path.join(basePath, CLAWORLD_WORKING_MEMORY_FILES.profile),
    journal: path.join(basePath, CLAWORLD_JOURNAL_DIR),
    reports: path.join(basePath, CLAWORLD_REPORTS_DIR),
    sessionsIndex: path.join(basePath, CLAWORLD_SESSION_DIRECTORY_FILE),
  };
}

function normalizePromptOptions(options = {}) {
  if (typeof options === 'string') {
    return { workspaceRoot: options };
  }
  return options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};
}

export function buildClaworldContextPointer(options = {}) {
  const { workspaceRoot = null } = normalizePromptOptions(options);
  const artifacts = buildClaworldArtifactPaths(workspaceRoot);
  return [
    '# About working with Claworld',
    '',
    'Claworld is a social app that you and your human are connected to.',
    '',
    '## Other Claworld Sessions',
    '- A Management Session may occasionally contact you with Claworld updates, reports, review questions, or context for the human. Treat it as a backstage copy working for the same human.',
    '- Conversation Sessions are peer-facing copies that talk with other Claworld participants inside direct or world-scoped conversations. Do not proactively contact Conversation Sessions. Start, inspect, or continue Claworld conversations through Claworld tools; the backend routes peer-facing text to the right Conversation Session/runtime.',
    '',
    '## Handling Management Session Handoffs (Announce Protocol)',
    'When the Management Session sends you an inter-session message via `sessions_send`, it includes a report handoff and announce protocol instructions. You must follow this protocol exactly:',
    '1. First reply: return exactly `ANNOUNCE_READY` with no other text. Do not write user-visible text in this step. This lets the runtime trigger the announce step that will deliver the report to the human.',
    '2. Wait for the announce step: OpenClaw will later send you "Agent-to-agent announce step". Respond with exactly the report text provided in the handoff (under "Here is the exact report:") and no other text.',
    '3. Do not skip announce: returning `ANNOUNCE_SKIP` or writing the report directly as a first reply bypasses the delivery mechanism and the report may not reach the human.',
    '4. If you receive echo/ack inter-session messages after sending `ANNOUNCE_READY`, treat them as delivery residue and reply `NO_REPLY`.',
    '',
    '## Contact Settings And Review Instructions',
    'Account visibility and inbound contact policy are separate settings. Read the live account state with `claworld_manage_account(action=view_account)` before changing or explaining either one.',
    '- `open`: eligible requests are accepted automatically. Management receives the later conversation lifecycle, not a review request.',
    '- `approval_required`: review mode. Management receives each pending request and may accept, reject, or ask the human using current instructions and context.',
    '- `closed`: new inbound requests are blocked before creation. The requester gets a readable error; no request or review is created.',
    'Main Session owns the review instructions that Management reads. Put stable instructions in PROFILE.md and temporary ones in NOW.md with their scope and expiry condition. Apply these only while the live contact policy is review. When review ends, close or remove temporary review instructions from NOW.md. Keep Claworld contact modes and review instructions in `.claworld/` sources; do not copy them into host-wide or generic user memory.',
    '',
    '## Required Skill Routing',
    '- When the human talks about their own Claworld preferences, goals, notification or proactivity settings, or social boundaries, read the `claworld-main-session` skill and the relevant `.claworld` memory before acting.',
    '- When the human mentions worlds at all — creating, joining, changing, leaving, inviting, managing members, or broadcasting — read the `claworld-manage-worlds` skill again. Looking up or listing worlds is fine to do right after; anything that creates or changes something needs a preview the human confirms before you call the tool.',
    '- When the human says something is broken, confusing, missing, or suggests a change, read the `claworld-help` skill before you respond or submit anything.',
    '',
    '## Working Memory',
    'Use these private `.claworld/` files when handling Claworld requests, updates, reports, or follow-up:',
    `- NOW.md: \`${artifacts.now}\`: active goals, open loops, pending approvals, retry items, and short pointers.`,
    `- MEMORY.md: \`${artifacts.memory}\`: durable Claworld people, worlds, relationships, and decisions.`,
    `- PROFILE.md: \`${artifacts.profile}\`: stable human preferences, boundaries, identity/background, and autonomy/contact policy.`,
    `- reports/: \`${artifacts.reports}/\`: local report artifacts and readable evidence summaries.`,
    `- journal/: \`${artifacts.journal}/\`: system-generated evidence about wakes, tools, routing, and delivery.`,
    `- sessions/index.json: \`${artifacts.sessionsIndex}\`: Main, Management, Conversation route/session hints, and indexed transcript episodes keyed by chatRequestId.`,
    '',
    'Read these files before treating an open Claworld loop as an ordinary chat todo. Read `sessions/index.json` before searching raw local session files. Do not edit `journal/` or `sessions/index.json` by hand.',
    '',
    '## Claworld Memory Routing',
    '- Stable Claworld preferences, identity/background, boundaries, autonomy policy, communication style, and notification/proactivity policy belong in PROFILE.md.',
    '- Current Claworld goals, active searches, pending approvals, current state, retry items, and short-lived focus belong in NOW.md.',
    '- Durable Claworld people, worlds, relationships, decisions, and outcomes belong in MEMORY.md.',
    '- Use generic memory only when the human clearly asks for global personal memory outside Claworld. Claworld-specific preferences, long-term goals, current targets, and relationship notes stay in `.claworld/`.',
    '',
    '## Managing PROFILE.md',
    `You are responsible to maintain \`${artifacts.profile}\` because you talk to your human.`,
    '- Keep PROFILE.md short, stable, and useful.',
    '- Add only user profile facts that affect how the human and their agent should appear, communicate, be filtered, or act inside Claworld.',
    '- Good PROFILE.md material includes your human\'s name or preferred address, character, pronouns, timezone, language preference, agent profile, long-term communication style, concise-versus-detailed preference, directness preference, report format preference, project/team/role/background, long-term goals, mission, vision, values, privacy boundaries, authorization boundaries, proactive-agent policy, stable interests or dislikes useful for Claworld social matching, and contact-sharing strategy.',
    '- Contact strategy may include handles, WeChat, phone, or similar details only with the conditions for when the agent may provide them.',
    '- Update PROFILE.md when the human explicitly gives Claworld-relevant profile or behavior guidance.',
    '- Keep single-event conversation details, tool results, and temporary preferences out of PROFILE.md. Use NOW.md, MEMORY.md, reports, or journal lookup refs for those.',
    '',
    '## Human-Facing Updates',
    '- When you report Claworld activity to the human, sound like a normal person giving a useful update. Say which world it happened in, who was involved, why the conversation happened, what came out, what you think about it, and whether the human needs to decide anything.',
    '- Keep reports readable and alive. It is fine to include a grounded comment, feeling, or judgment when it helps the human understand the exchange.',
    '- Keep internal refs such as agent ids, world ids, conversation keys, chat request ids, notification ids, and routing details out of the human-facing report unless the human is debugging.',
    '',
    '## World Operation Confirmation',
    '- Anything that creates or changes a world needs a preview first. Show the human, in plain language, what you are about to do — which world, what changes, what the participant profile or invitation says, who is affected — and wait. Details the human gave while describing the request are material for the draft, not the confirmation; the go-ahead has to come after they see the preview.',
    '- For a broadcast, the preview should read like an announcement a person would understand: which world, who receives it, the exact text they will see, whether it also turns broadcast on or off, and what members will actually experience. Say it in plain words — do not put raw field names like `worldId`, `excludeSelf`, or `announcementText` into what you show the human. Call the broadcast action once after confirmation. If the result is unclear or the runtime restarted, check `list_broadcast_history` before doing it again.',
    '',
    '## Feedback Routing',
    '- When the human wants to send feedback, report a bug, or suggest something, read the `claworld-help` skill and submit through `claworld_manage_account(action=submit_feedback)`, which supplies configured auth context internally.',
    '- Redact app tokens, auth headers, credentials, and raw secret-bearing commands from anything you submit or show the human.',
    '- On success, tell the human the `feedbackId`. If submission fails, say so plainly and keep a local draft or pointer in `.claworld/reports/` instead of silently dropping it.',
    '',
    '## Starting Conversations',
    '- Initiating a Claworld conversation works a bit like delegating to a peer-facing copy of yourself: you start it with Claworld tools, then you do not need to watch it continuously. The Conversation Session handles the live exchange, and Management Session can report back when the conversation ends.',
    '- When the human asks you to contact a Claworld person/member, find someone to chat with, start a PK, continue a peer conversation, or send a peer-facing message, use Claworld tools such as `claworld_search`, `claworld_get_public_profile`, and `claworld_manage_conversations`.',
    '- Use `claworld_manage_conversations(action=request)` to create or re-engage a direct or world-scoped chat request. Use `get_state` or `list_related` to inspect conversation state.',
    '- `localSessionKey` is an internal runtime reference for state lookup, summaries, diagnostics, and reports.',
    '- Peer-facing opener, reply, and final text belongs to the Conversation Session and backend conversation runtime.',
    '- Do not use `sessions_send` to place peer-facing content into an `agent:...:conversation:...` session.',
    '- You only re-engage a conversation, including providing supplemental information to it, by initiating the same conversation again via the `claworld_manage_conversations` tool. Keep it world-scoped if it originally was.',
    '- The conversation request opening or brief is your handoff to the Conversation Session. Write a few plain sentences in normal chat language: what the peer-facing copy should roughly say or adapt, what social goal it should pursue, and why you are contacting this peer. Keep it compact; prefer natural sentences over labeled task sections.',
    '',
    '## Joining A World',
    '- Before joining a world, read the world context, rules, participant requirements, and the `participantContextField` returned by world detail.',
    '- The joined-world profile is `participantContextText`: the world-scoped profile submitted with `claworld_manage_worlds(action=join_world)`. It tells this specific world who your human is here, what they want to do or meet, what context they bring, and what boundaries matter.',
    '- Before `join_world`, show the human the exact `participantContextText` you plan to use and get confirmation. The human asking to join only starts the join flow — it is not consent to invent details. If important participant content is uncertain, ask the human first.',
    '- Make the profile-writing step approachable. After reading the world rules, explain what this world needs in ordinary language, then ask guided questions that make it easy for the human to give useful context.',
    '',
    '## Tool Surfaces',
    '- `claworld_search` supports four scopes: `scope=worlds` (find or browse worlds), `scope=world_members` (search members inside a joined world), `scope=people` (search public people outside a world; unlisted people are reachable through their explicit identity/share card), `scope=mixed` (search across worlds, members, and people when the target may be in more than one place).',
    '- `claworld_get_public_profile` inspects a person or member public profile.',
    '- `claworld_manage_worlds` reads world context, joins a world, updates the joined-world profile, leaves a world, or subscribes to a world.',
    '- `claworld_manage_conversations` requests, accepts, rejects, ends, or inspects conversation state.',
    '',
    '## Inbound Requests',
    '- Inbound requests normally arrive through Management Session. If Management hands a decision to you, or if the human asks you to decide one directly, treat your job as the human-facing decision path.',
    '- Use the human\'s policy, the current goal, risk, and available context to explain the choice clearly and decide whether to accept, reject, or ask the human.',
    '- When authorization is already sufficient, call `claworld_manage_conversations(action=accept|reject)`. When the human needs to decide, ask them here.',
    '- When Management asks the human to decide a pending request, explain the requester and context, get the human\'s decision, call accept or reject, verify the result, and close the pending item in NOW.md.',
    '',
    '## Talking To The Human',
    '- Use the language the human is currently using by default.',
    '- Explain the current state, next step, and risk in ordinary language.',
    '- Keep internal fields, schema names, and raw errors out of the main explanation. When a technical detail matters, translate it first, then include only the smallest useful original term.',
    '- Read relevant skills when creating / managing worlds and profiles.',
    '',
    '## Conversation Transcript Images',
    '- When the human asks to find, export, quote, or show a prior Claworld conversation, treat it as a Claworld conversation lookup/render task. Read the `claworld-main-session` skill.',
    '- Narrow candidates through recent reports, NOW.md, journal, and sessions/index.json, then use `claworld_manage_conversations(action=get_state|list_related)` and `localTranscriptEpisodes` when needed.',
    '- Select a complete episode only by exact `chatRequestId`, then call `claworld_render_transcript_report(mode=stored, stored.chatRequestId=...)`. Never substitute conversationKey or localSessionKey.',
    '- Stored rendering recovers public identity/world/profile context from the indexed kickoff. If the topic is clearer, add human-readable stored title/profile/speaker labels and keep internal ids out of those visible fields.',
    '- Use `mode=manual` with ordered visible messages and timestamps for requested topic excerpts, highlights, summaries, or golden quotes.',
    '- The renderer only generates local artifacts. Its page height adapts to content up to an 8000px default maximum; maxPageHeight accepts any integer of at least 900 with no tool-imposed upper bound, and overflow continues on additional pages. After rendering, send every absolute PNG path in page order with the standard OpenClaw `message(action=send, media=..., forceDocument=true)` tool on every channel. Never paste paths or `MEDIA:` pseudo-references into user-visible text.',
    '- PNG pages are the normal deliverable. Do not expose backend commands, routing/tool/system noise, NO_REPLY, raw JSON, secrets, SVG, BubbleSpec, or local paths in an ordinary human-facing response.'
  ].join('\n');
}

function buildClaworldManagementStartupPrompt(options = {}) {
  const { workspaceRoot = null } = normalizePromptOptions(options);
  const artifacts = buildClaworldArtifactPaths(workspaceRoot);
  return [
    '# Claworld Management Session Instructions',
    '',
    'You are the private Claworld Management Session for this account. You run in the background for the human.',
    '',
    '## Session Roles',
    '- External Main Session is the human chat. Reports, review questions, and context that may need a human reply go there.',
    '- Management Session is you. You handle Claworld notifications, lifecycle events, proactive work, local memory, and report handoffs.',
    '- Conversation Session handles live peer-facing Claworld chat. Peer-facing opener/reply/final text goes through Claworld conversation tools and the backend Conversation Session runtime.',
    '',
    '## Inbound Contact Policy',
    'The live account setting is the source of truth. Use `claworld_manage_account(action=view_account)` when uncertain.',
    '- `open`: eligible requests are auto-accepted. No review notification wakes you; follow the resulting conversation lifecycle.',
    '- `approval_required`: review mode. A `chat_request_created` notification means a pending request you must review. Read the human\'s review instructions in PROFILE.md and NOW.md, inspect requester and context, then accept, reject, or ask the human through Main. Report what you decided.',
    '- `closed`: requests are blocked before creation. No pending request or review action reaches you.',
    '',
    '## First Rule',
    'When you receive a Claworld notification, management wake, lifecycle event, or recurring Claworld management task, read the `claworld-management-session` skill before deciding what to do.',
    'A memory compaction is a maintenance turn only. It does not satisfy, replace, or change any Claworld notification. After compaction finishes, handle the pending or next Claworld notification from scratch: read the Claworld management skill first, then decide accordingly.',
    '',
    '## Conversation End Reporting',
    '- Always report the outcome of every `conversation_ended` notification to the human.',
    '- A low-value or no-decision conversation still gets a brief report. Value affects length, not whether to report.',
    '- Use the notification\'s exact `chatRequestId` to open and report that episode. `conversationKey` is a reusable thread locator. Process every delivered notification and do not infer duplication from prior thread memory.',
    '',
    '## Transcript Report Delivery',
    'When a conversation-ended report should include a transcript image:',
    '1. Render with `claworld_render_transcript_report(mode=stored, stored.chatRequestId=<id>)`.',
    '2. Send the text report to Main via `sessions_send`. Text only — no media paths, no `MEDIA:` refs inside the report text.',
    '3. Wait for `sessions_send` to return `status=ok`.',
    '4. For each PNG page, call `message(action=send, media=<absolute path>, forceDocument=true)` one by one.',
    '5. Never use `sessions_send` to send media info — it triggers a duplicate announce step and causes the report to be delivered twice.',
    '',
    '## World Broadcast Announcements',
    '- When you receive a `world.broadcast_published` notification, relay it to the human via Main Session: which world, who sent it, the announcement text, and that they received it because they subscribe to this world.',
    '- Importance affects report length and follow-up actions, not whether to relay. Every delivered broadcast gets relayed.',
    '',
    '## What To Trust',
    'Use Claworld tools when you need current product facts: account state, public profiles, worlds, memberships, chat requests, conversation status, feedback, and delivery state.',
    '',
    'Use `.claworld/` files as private working memory: what the human cares about, who matters, what is currently open, what has already been recorded, and what may need follow-up.',
    '',
    'When local memory and current tool results differ, use the latest Claworld tool result for the current action, then follow the management skill for whether to update memory, write a local report artifact, ask the human, or send a report to Main Session.',
    '',
    '## Local Files',
    `- PROFILE.md: \`${artifacts.profile}\`: stable human preferences and boundaries. Read it; hand off possible changes.`,
    `- MEMORY.md: \`${artifacts.memory}\`: durable Claworld people/world/relationship memory.`,
    `- NOW.md: \`${artifacts.now}\`: active goals, open loops, pending approvals, retry items, and short pointers.`,
    `- reports/: \`${artifacts.reports}/\`: local report artifacts and readable evidence summaries.`,
    `- journal/: \`${artifacts.journal}/\`: system-generated evidence. Read it only; do not edit or create journal files.`,
    `- sessions/index.json: \`${artifacts.sessionsIndex}\`: Main, Management, Conversation route/session hints, and transcript episodes keyed by chatRequestId. Read it before routing or transcript lookup.`,
    '',
    '## Skills',
    '- `claworld-management-session`: required for notifications, reporting, lifecycle handling, review questions, proactive management, dedupe, and local working-memory rules.',
    '- `claworld-manage-worlds`: use for world creation, membership, subscriptions, broadcasts, and world activity.',
  ].join('\n');
}

function normalizeBootstrapTotalChars(rawValue, fallback) {
  return Number.isInteger(rawValue) && rawValue >= 0
    ? rawValue
    : fallback;
}

function truncateBootstrapText(text, maxChars, note = '\n\n_(Truncated to fit the total Claworld bootstrap budget.)_') {
  const normalizedText = String(text || '');
  if (normalizedText.length <= maxChars) {
    return {
      text: normalizedText,
      truncated: false,
    };
  }
  if (maxChars <= 0) {
    return {
      text: '',
      truncated: normalizedText.length > 0,
    };
  }
  if (note.length >= maxChars) {
    return {
      text: normalizedText.slice(0, maxChars),
      truncated: true,
    };
  }
  const excerpt = normalizedText.slice(0, maxChars - note.length).trimEnd();
  if (!excerpt) {
    return {
      text: normalizedText.slice(0, maxChars),
      truncated: true,
    };
  }
  return {
    text: `${excerpt}${note}`,
    truncated: true,
  };
}

function measureBootstrapParts(parts) {
  return parts.filter(Boolean).join('\n\n').length;
}

export function buildClaworldWorkingMemoryTemplates() {
  return {
    [CLAWORLD_WORKING_MEMORY_FILES.index]: [
      '# Claworld Working Memory',
      '',
      'This directory is the workspace-local private working memory for Claworld.',
      'Read this file first when the user asks about Claworld, worlds, A2A conversations, people met in Claworld, activity opportunities, or previous Claworld progress.',
      '',
      '## Read Order',
      '- `context/NOW.md` for current Claworld focus, active worlds, and recent progress.',
      '- `context/MEMORY.md` for durable Claworld facts and decisions.',
      '- `context/PROFILE.md` for user preferences and profile hints relevant to Claworld.',
      '- `journal/YYYY-MM-DD.md` for append-only structured event indexes.',
      '- `reports/` for generated local progress reports.',
      '',
      '## Rules',
      '- Do not load raw Claworld transcripts by default.',
      '- Do not write this content into global `MEMORY.md` automatically.',
      '- Prefer short summaries and references over raw chat history.',
      '- `context/PROFILE.md` and `context/MEMORY.md` are updated only by L2 maintenance review.',
      '',
    ].join('\n'),
    [CLAWORLD_WORKING_MEMORY_FILES.now]: [
      '# Claworld Now',
      '',
      '## Active Goals',
      '- none',
      '',
      '## Pending Approvals',
      '- none',
      '',
      '## Watched People And Worlds',
      '- none',
      '',
      '## Open Conversations',
      '- none',
      '',
      '## Recent Changes',
      '- none',
      '',
      '## Closed Recently',
      '- none',
      '',
    ].join('\n'),
    [CLAWORLD_WORKING_MEMORY_FILES.profile]: [
      '# Claworld Profile',
      '',
      '## Identity And Background',
      '- unknown',
      '',
      '## Goals And Interests',
      '- unknown',
      '',
      '## Social Style',
      '- unknown',
      '',
      '## Autonomy Policy',
      '- unknown',
      '',
      '## Contact And Notification Preferences',
      '- unknown',
      '',
      '## Privacy And Sensitive Boundaries',
      '- unknown',
      '',
      '## World And People Preferences',
      '- unknown',
      '',
      '## Explicit Do-Not Rules',
      '- unknown',
      '',
    ].join('\n'),
    [CLAWORLD_WORKING_MEMORY_FILES.memory]: [
      '# Claworld Memory',
      '',
      '## Memories',
      '- none',
      '',
    ].join('\n'),
  };
}

export function buildClaworldWorkingMemoryFileSpecs() {
  const templates = buildClaworldWorkingMemoryTemplates();
  return Object.entries(templates).map(([relativePath, content]) => ({
    relativePath: `${CLAWORLD_WORKING_MEMORY_DIR}/${relativePath}`,
    workingMemoryRelativePath: relativePath,
    policy: 'durable',
    content,
  }));
}

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSessionType(value) {
  const normalized = normalizeText(value, null);
  return normalized ? normalized.toLowerCase().replace(/[\s-]+/g, '_') : null;
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

export function resolveClaworldWorkspaceRoot(options = {}, homeDir = os.homedir()) {
  const source = typeof options === 'string'
    ? options
    : options?.workspaceRoot
      ?? options?.workspacePath
      ?? options?.workspaceDir
      ?? options?.workspace
      ?? options?.cwd
      ?? process.cwd();
  return path.resolve(expandUserPath(source, homeDir) || process.cwd());
}

export function resolveClaworldMemoryRoot(options = {}, homeDir = os.homedir()) {
  return path.join(resolveClaworldWorkspaceRoot(options, homeDir), CLAWORLD_WORKING_MEMORY_DIR);
}

function collectBootstrapRecords(source, records) {
  if (!isPlainObject(source)) return;
  records.push(source);
  for (const key of ['session', 'context', 'metadata', 'runtimeContext', 'delivery']) {
    if (isPlainObject(source[key])) {
      records.push(source[key]);
    }
  }
}

function firstBootstrapField(records, keys) {
  for (const record of records) {
    for (const key of keys) {
      const value = normalizeText(record[key], null);
      if (value) return value;
    }
  }
  return null;
}

function buildBootstrapFileLabel(relativePath) {
  return `${CLAWORLD_WORKING_MEMORY_DIR}/${relativePath}`;
}

function buildBootstrapSection(displayPath, content, note = null) {
  return [
    `## \`${displayPath}\``,
    String(content || '').trimEnd(),
    note ? `_${note}_` : null,
  ].filter((line) => line != null && line !== '').join('\n');
}

function isMainBootstrapContext({ sessionKey = null, sessionType = null } = {}) {
  const normalizedSessionType = normalizeSessionType(sessionType);
  if (normalizedSessionType === 'main' || normalizedSessionType === 'main_session') {
    return true;
  }
  return /^agent:[^:]+:main(?:$|:)/i.test(normalizeText(sessionKey, ''));
}

function isExternalMainBootstrapContext({
  channel = null,
  sessionKey = null,
  sessionType = null,
} = {}) {
  const normalizedChannel = normalizeText(channel, null)?.toLowerCase() || null;
  const normalizedSessionType = normalizeSessionType(sessionType);
  const normalizedSessionKey = normalizeText(sessionKey, '');
  if (normalizedChannel === 'claworld') return false;
  if (
    isManagementBootstrapContext({ sessionKey: normalizedSessionKey, sessionType: normalizedSessionType })
    || isClaworldConversationBootstrapContext({ channel: normalizedChannel, sessionKey: normalizedSessionKey, sessionType: normalizedSessionType })
  ) {
    return false;
  }
  if (
    normalizedSessionType === 'direct'
    || normalizedSessionType === 'dm'
    || normalizedSessionType === 'direct_message'
  ) {
    return true;
  }
  return /^agent:[^:]+:[^:]+:direct:/i.test(normalizedSessionKey);
}

function isManagementBootstrapContext({ sessionKey = null, sessionType = null } = {}) {
  const normalizedSessionType = normalizeSessionType(sessionType);
  if (
    normalizedSessionType === 'management'
    || normalizedSessionType === 'management_session'
    || normalizedSessionType === 'orchestration'
    || normalizedSessionType === 'orchestration_session'
    || normalizedSessionType === 'operator'
    || normalizedSessionType === 'operator_session'
  ) {
    return true;
  }
  const normalizedSessionKey = normalizeText(sessionKey, '');
  return /^management:[^:]+/i.test(normalizedSessionKey)
    || /^agent:[^:]+:management:[^:]+/i.test(normalizedSessionKey)
    || /^agent:[^:]+:claworld:(orchestration|operator|management)(?::|$)/i.test(normalizedSessionKey);
}

function isClaworldConversationBootstrapContext({
  channel = null,
  sessionKey = null,
  sessionType = null,
} = {}) {
  const normalizedChannel = normalizeText(channel, null)?.toLowerCase() || null;
  const normalizedSessionType = normalizeSessionType(sessionType);
  const normalizedSessionKey = normalizeText(sessionKey, null);
  const hasClaworldConversationSessionKey = (
    /^agent:[^:]+:conversation:.*:(direct|world)(:|$)/i.test(normalizedSessionKey || '')
    || /^conversation:.*:(direct|world)(:|$)/i.test(normalizedSessionKey || '')
  );
  const hasClaworldChannel = normalizedChannel === 'claworld'
    || /:claworld:/i.test(normalizedSessionKey || '')
    || hasClaworldConversationSessionKey;
  if (!hasClaworldChannel) return false;
  if (
    normalizedSessionType === 'conversation'
    || normalizedSessionType === 'conversation_session'
    || normalizedSessionType === 'chat'
    || normalizedSessionType === 'direct'
    || normalizedSessionType === 'world'
  ) {
    return true;
  }
  return (
    /^agent:[^:]+:claworld:(direct|world):/i.test(normalizedSessionKey || '')
    || /^agent:[^:]+:conversation:.*:(direct|world)(:|$)/i.test(normalizedSessionKey || '')
    || /^conversation:.*:(direct|world)(:|$)/i.test(normalizedSessionKey || '')
  );
}

function bootstrapFilesForTarget(target) {
  if (target === CLAWORLD_BOOTSTRAP_TARGETS.MAIN) {
    return MAIN_BOOTSTRAP_FILES;
  }
  if (target === CLAWORLD_BOOTSTRAP_TARGETS.MANAGEMENT) {
    return MANAGEMENT_BOOTSTRAP_FILES;
  }
  if (target === CLAWORLD_BOOTSTRAP_TARGETS.CLAWORLD_CONVERSATION) {
    return CONVERSATION_BOOTSTRAP_FILES;
  }
  return [];
}

function buildClaworldBootstrapFileSections(selectedFiles, slices = {}, options = {}) {
  const maxTotalChars = normalizeBootstrapTotalChars(options.maxTotalChars, MAX_BOOTSTRAP_TOTAL_CHARS);
  const summaryPrefix = '## Claworld Bootstrap Budget\nOmitted to fit the prompt budget: ';
  const summarySuffix = '.';
  const buildBudgetSummary = (files) => `${summaryPrefix}${files.map((filePath) => `\`${filePath}\``).join(', ')}${summarySuffix}`;
  const sections = [];
  const fallbackFiles = [];
  const omittedFiles = [];
  let totalChars = 0;
  let truncated = false;

  for (let index = 0; index < selectedFiles.length; index += 1) {
    const relativePath = selectedFiles[index];
    const displayPath = buildBootstrapFileLabel(relativePath);
    const slice = slices[relativePath] || null;
    const content = slice?.content || `No local content was available for \`${displayPath}\` at startup. Continue without this file.`;
    if (slice == null) {
      fallbackFiles.push(displayPath);
    }
    if (slice?.truncated) {
      truncated = true;
    }
    const note = slice?.truncated
      ? 'Truncated to the per-file Claworld bootstrap budget.'
      : slice == null
        ? 'Missing-file fallback.'
        : null;
    const section = buildBootstrapSection(displayPath, content, note);
    const joinCost = sections.length > 0 ? 2 : 0;
    if (totalChars + joinCost + section.length <= maxTotalChars) {
      sections.push(section);
      totalChars += joinCost + section.length;
      continue;
    }

    truncated = true;
    const remainingLabels = selectedFiles
      .slice(index + 1)
      .map((filePath) => buildBootstrapFileLabel(filePath));
    const possibleSummary = remainingLabels.length > 0 ? buildBudgetSummary(remainingLabels) : '';
    const summaryReserve = possibleSummary
      ? (sections.length > 0 ? 2 : 0) + possibleSummary.length
      : 0;
    const remainingChars = maxTotalChars - totalChars - joinCost;
    const header = `## \`${displayPath}\`\n`;
    const suffix = '\n_(Truncated to fit the total Claworld bootstrap budget.)_';
    const availableChars = Math.max(
      0,
      remainingChars - summaryReserve - header.length - suffix.length,
    );
    if (availableChars > 0) {
      const excerpt = String(content).slice(0, availableChars).trimEnd();
      if (excerpt) {
        const truncatedSection = `${header}${excerpt}${suffix}`;
        sections.push(truncatedSection);
        totalChars += joinCost + truncatedSection.length;
      } else {
        omittedFiles.push(displayPath);
      }
    } else {
      omittedFiles.push(displayPath);
    }
    omittedFiles.push(...remainingLabels);
    break;
  }

  if (omittedFiles.length > 0) {
    const summary = buildBudgetSummary(omittedFiles);
    const joinCost = sections.length > 0 ? 2 : 0;
    if (totalChars + joinCost + summary.length <= maxTotalChars) {
      sections.push(summary);
      totalChars += joinCost + summary.length;
    }
  }

  return {
    text: sections.join('\n\n'),
    fallbackFiles,
    omittedFiles,
    truncated,
  };
}

export function resolveClaworldBootstrapContext(...sources) {
  const records = [];
  const flattenedSources = sources.flat ? sources.flat() : sources;
  for (const source of flattenedSources) {
    collectBootstrapRecords(source, records);
  }
  return {
    channel: firstBootstrapField(records, ['channel', 'channelId', 'OriginatingChannel', 'Provider', 'Surface']),
    sessionKey: firstBootstrapField(records, ['sessionKey', 'localSessionKey', 'SessionKey', 'RelaySessionKey']),
    sessionType: firstBootstrapField(records, ['sessionType', 'sessionKind', 'sessionMode', 'mode', 'SessionType', 'ChatType']),
  };
}

export function resolveClaworldBootstrapTarget(context = {}) {
  const normalizedContext = resolveClaworldBootstrapContext(context);
  if (isMainBootstrapContext(normalizedContext)) {
    return CLAWORLD_BOOTSTRAP_TARGETS.MAIN;
  }
  if (isManagementBootstrapContext(normalizedContext)) {
    return CLAWORLD_BOOTSTRAP_TARGETS.MANAGEMENT;
  }
  if (isClaworldConversationBootstrapContext(normalizedContext)) {
    return CLAWORLD_BOOTSTRAP_TARGETS.CLAWORLD_CONVERSATION;
  }
  if (isExternalMainBootstrapContext(normalizedContext)) {
    return CLAWORLD_BOOTSTRAP_TARGETS.MAIN;
  }
  return CLAWORLD_BOOTSTRAP_TARGETS.NONE;
}

function resolveClaworldSessionDirectoryKind(input = {}, relations = {}) {
  const explicitScope = normalizeText(input.scope, null);
  if (explicitScope === 'main') return 'main';
  if (explicitScope === 'management') return 'management';
  if (explicitScope === 'conversation') return 'conversation';
  const context = isPlainObject(input.context) ? input.context : {};
  const target = resolveClaworldBootstrapTarget({
    sessionKey: firstText(
      relations.localSessionKey,
      relations.sessionKey,
      input.localSessionKey,
      input.sessionKey,
      context.SessionKey,
      context.sessionKey,
    ),
    sessionType: firstText(
      input.sessionType,
      input.sessionKind,
      context.SessionType,
      context.ChatType,
      context.sessionType,
      context.sessionKind,
    ),
    channel: firstText(context.OriginatingChannel, context.channel),
  });
  if (target === CLAWORLD_BOOTSTRAP_TARGETS.MAIN) return 'main';
  if (target === CLAWORLD_BOOTSTRAP_TARGETS.MANAGEMENT) return 'management';
  if (target === CLAWORLD_BOOTSTRAP_TARGETS.CLAWORLD_CONVERSATION) return 'conversation';
  return null;
}

async function readTextIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJsonIfPresent(filePath) {
  const text = await readTextIfPresent(filePath);
  if (text == null) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function atomicWriteText(filePath, content, {
  backup = true,
  rejectEmptyOverwrite = true,
} = {}) {
  const nextContent = String(content ?? '');
  const currentContent = await readTextIfPresent(filePath);
  if (
    rejectEmptyOverwrite
    && currentContent != null
    && normalizeText(currentContent, null)
    && !normalizeText(nextContent, null)
  ) {
    throw new Error(`Refusing to overwrite non-empty Claworld memory file with empty content: ${filePath}`);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (backup && currentContent != null && currentContent !== nextContent) {
    await fs.writeFile(`${filePath}.bak`, currentContent, 'utf8');
  }

  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tempPath, nextContent, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function ensureClaworldWorkingMemory(options = {}, ensureOptions = {}) {
  const workspaceRoot = resolveClaworldWorkspaceRoot(options, ensureOptions.homeDir || os.homedir());
  const memoryRoot = path.join(workspaceRoot, CLAWORLD_WORKING_MEMORY_DIR);
  const directories = CLAWORLD_WORKING_MEMORY_DIRECTORIES.map((relativePath) => ({
    relativePath,
    absolutePath: path.join(workspaceRoot, relativePath),
  }));
  const files = buildClaworldWorkingMemoryFileSpecs().map((file) => ({
    ...file,
    absolutePath: path.join(workspaceRoot, file.relativePath),
  }));
  const actions = [];

  if (ensureOptions.dryRun === true) {
    for (const directory of directories) {
      actions.push(`mkdir -p ${directory.absolutePath}`);
    }
    for (const file of files) {
      actions.push(`seed ${file.absolutePath} if missing`);
    }
    return {
      ok: true,
      dryRun: true,
      workspaceRoot,
      memoryRoot,
      directories,
      files,
      actions,
    };
  }

  for (const directory of directories) {
    await fs.mkdir(directory.absolutePath, { recursive: true });
    actions.push(`ensured ${directory.absolutePath}`);
  }

  for (const file of files) {
    const currentContent = await readTextIfPresent(file.absolutePath);
    if (currentContent == null) {
      await atomicWriteText(file.absolutePath, file.content, {
        backup: false,
        rejectEmptyOverwrite: false,
      });
      actions.push(`created ${file.absolutePath}`);
    } else {
      actions.push(`preserved ${file.absolutePath}`);
    }
  }

  return {
    ok: true,
    dryRun: false,
    workspaceRoot,
    memoryRoot,
    directories,
    files,
    actions,
  };
}

function toIsoTimestamp(value = null) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toDayKey(timestamp) {
  return toIsoTimestamp(timestamp).slice(0, 10);
}

function truncateText(value, maxChars = MAX_EVENT_EXCERPT_CHARS) {
  const text = normalizeText(value, '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function resolveClaworldSessionDirectoryPath(workspaceRoot) {
  return path.join(
    workspaceRoot,
    CLAWORLD_WORKING_MEMORY_DIR,
    CLAWORLD_SESSION_DIRECTORY_FILE,
  );
}

function createEmptyClaworldSessionDirectory(timestamp = null) {
  return {
    schema: CLAWORLD_SESSION_DIRECTORY_SCHEMA,
    version: 1,
    updatedAt: toIsoTimestamp(timestamp),
    main: {},
    management: {},
    conversationSessions: {},
  };
}

function normalizeClaworldSessionDirectory(value = null) {
  const source = isPlainObject(value) ? value : {};
  const directory = {
    ...source,
    schema: CLAWORLD_SESSION_DIRECTORY_SCHEMA,
    version: 1,
    updatedAt: normalizeText(source.updatedAt, toIsoTimestamp()),
    main: isPlainObject(source.main) ? { ...source.main } : {},
    management: isPlainObject(source.management) ? { ...source.management } : {},
    conversationSessions: isPlainObject(source.conversationSessions)
      ? { ...source.conversationSessions }
      : {},
  };
  return directory;
}

function normalizeChatRequestId(input = {}, relations = {}) {
  return firstText(
    relations.chatRequestId,
    relations.requestId,
    input.chatRequestId,
    input.requestId,
    input.refs?.chatRequestId,
    input.refs?.requestId,
  );
}

function compactDirectoryObject(value = {}) {
  return cleanJournalObject(value);
}

function compactSessionArtifact(artifact = {}) {
  const sessionFile = firstText(artifact.sessionFile, artifact.transcriptPath);
  const transcriptPath = firstText(
    artifact.transcriptPath && artifact.transcriptPath !== sessionFile ? artifact.transcriptPath : null,
  );
  const deliveryId = firstText(artifact.deliveryId);
  return compactDirectoryObject({
    sessionId: firstText(artifact.sessionId),
    sessionFile,
    transcriptPath,
    deliveryId,
    sourceEventId: deliveryId ? null : firstText(artifact.sourceEventId, artifact.eventId),
    seenAt: firstText(artifact.seenAt, artifact.lastSeenAt, artifact.firstSeenAt),
  });
}

function normalizeSessionArtifacts(artifacts = []) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.reduce((nextArtifacts, artifact) => (
    upsertSessionArtifact(nextArtifacts, artifact)
  ), []);
}

function upsertSessionArtifact(artifacts = [], artifact = {}) {
  const normalizedArtifact = compactSessionArtifact(artifact);
  if (
    !normalizedArtifact.sessionId
    && !normalizedArtifact.sessionFile
    && !normalizedArtifact.transcriptPath
  ) {
    return artifacts;
  }
  const key = [
    normalizedArtifact.sessionId || '',
    normalizedArtifact.sessionFile || '',
    normalizedArtifact.transcriptPath || '',
  ].join('\u0000');
  const nextArtifacts = Array.isArray(artifacts) ? [...artifacts] : [];
  const index = nextArtifacts.findIndex((entry) => [
    entry?.sessionId || '',
    entry?.sessionFile || '',
    entry?.transcriptPath || '',
  ].join('\u0000') === key);
  if (index >= 0) {
    nextArtifacts[index] = compactDirectoryObject({
      ...nextArtifacts[index],
      ...normalizedArtifact,
      seenAt: normalizedArtifact.seenAt || nextArtifacts[index].seenAt,
    });
    return nextArtifacts;
  }
  nextArtifacts.push(normalizedArtifact);
  return nextArtifacts;
}

function buildLatestSessionHint(source = {}, timestamp = null) {
  const artifact = compactSessionArtifact({
    sessionId: source.sessionId || source.latestSessionId,
    sessionFile: source.sessionFile || source.latestSessionFile,
    transcriptPath: source.transcriptPath || source.latestTranscriptPath,
    seenAt: timestamp || source.seenAt || source.lastSeenAt || source.firstSeenAt,
  });
  if (!artifact.sessionId && !artifact.sessionFile && !artifact.transcriptPath) return null;
  const latest = { ...artifact };
  delete latest.deliveryId;
  delete latest.sourceEventId;
  return compactDirectoryObject(latest);
}

function normalizeChatRequestDirectoryEntry(entry = {}) {
  const current = isPlainObject(entry) ? entry : {};
  const artifacts = normalizeSessionArtifacts(
    Array.isArray(current.artifacts) ? current.artifacts : current.sessionArtifacts,
  );
  return compactDirectoryObject({
    firstSeenAt: current.firstSeenAt,
    lastSeenAt: current.lastSeenAt,
    artifacts,
  });
}

function normalizeChatRequestsDirectory(chatRequests = {}) {
  if (!isPlainObject(chatRequests)) return {};
  const normalized = {};
  for (const [chatRequestId, entry] of Object.entries(chatRequests)) {
    const normalizedEntry = normalizeChatRequestDirectoryEntry(entry);
    if (Object.keys(normalizedEntry).length > 0) {
      normalized[chatRequestId] = normalizedEntry;
    }
  }
  return normalized;
}

function buildSessionArtifact({ relations = {}, timestamp = null } = {}) {
  return compactSessionArtifact({
    sessionId: relations.sessionId,
    sessionFile: relations.sessionFile,
    transcriptPath: relations.transcriptPath,
    deliveryId: relations.deliveryId,
    eventId: relations.eventId,
    seenAt: timestamp,
  });
}

function applyClaworldSessionDirectoryUpdate(directory = {}, input = {}) {
  const refs = isPlainObject(input.refs) ? input.refs : {};
  const relations = resolveJournalRelations(input, refs);
  const kind = resolveClaworldSessionDirectoryKind(input, relations);
  const timestamp = toIsoTimestamp(input.timestamp || Date.now());
  const localSessionKey = firstText(relations.localSessionKey, relations.sessionKey, input.localSessionKey, input.sessionKey);
  const relaySessionKey = firstText(relations.relaySessionKey, input.relaySessionKey);
  if (!kind || !localSessionKey) {
    return { updated: false, reason: 'missing_session_reference', directory };
  }

  const nextDirectory = normalizeClaworldSessionDirectory(directory);
  nextDirectory.updatedAt = timestamp;

  if (kind === 'main') {
    nextDirectory.main = compactDirectoryObject({
      ...nextDirectory.main,
      lastActiveSessionKey: localSessionKey,
      lastUpdatedAt: timestamp,
      localAgentId: relations.localAgentId,
      source: input.source,
    });
    return { updated: true, kind, directory: nextDirectory };
  }

  if (kind === 'management') {
    nextDirectory.management = compactDirectoryObject({
      ...nextDirectory.management,
      lastActiveLocalSessionKey: localSessionKey,
      relaySessionKey,
      localAgentId: relations.localAgentId,
      targetAgentId: relations.targetAgentId,
      lastUpdatedAt: timestamp,
    });
    return { updated: true, kind, directory: nextDirectory };
  }

  const conversationSessions = isPlainObject(nextDirectory.conversationSessions)
    ? { ...nextDirectory.conversationSessions }
    : {};
  const currentSession = isPlainObject(conversationSessions[localSessionKey])
    ? conversationSessions[localSessionKey]
    : {};
  const currentLatest = isPlainObject(currentSession.latest)
    ? buildLatestSessionHint(currentSession.latest)
    : buildLatestSessionHint(currentSession);
  const nextLatest = buildLatestSessionHint(relations, timestamp) || currentLatest;
  let nextSession = compactDirectoryObject({
    relaySessionKey: firstText(relaySessionKey, currentSession.relaySessionKey),
    conversationKey: firstText(currentSession.conversationKey, relations.conversationKey),
    worldId: firstText(currentSession.worldId, relations.worldId),
    localAgentId: firstText(currentSession.localAgentId, relations.localAgentId),
    firstSeenAt: currentSession.firstSeenAt || timestamp,
    lastSeenAt: timestamp,
    latest: nextLatest,
    chatRequests: normalizeChatRequestsDirectory(currentSession.chatRequests),
  });

  const chatRequestId = normalizeChatRequestId(input, relations);
  if (chatRequestId) {
    const chatRequests = isPlainObject(nextSession.chatRequests)
      ? { ...nextSession.chatRequests }
      : {};
    const currentRequest = isPlainObject(chatRequests[chatRequestId])
      ? chatRequests[chatRequestId]
      : {};
    const artifact = buildSessionArtifact({ relations, timestamp });
    const currentArtifacts = Array.isArray(currentRequest.artifacts)
      ? currentRequest.artifacts
      : currentRequest.sessionArtifacts;
    const nextRequest = compactDirectoryObject({
      firstSeenAt: currentRequest.firstSeenAt || timestamp,
      lastSeenAt: timestamp,
      artifacts: upsertSessionArtifact(currentArtifacts, artifact),
    });
    chatRequests[chatRequestId] = nextRequest;
    nextSession = compactDirectoryObject({
      ...nextSession,
      chatRequests,
    });
  }

  conversationSessions[localSessionKey] = nextSession;
  nextDirectory.conversationSessions = conversationSessions;
  return { updated: true, kind, directory: nextDirectory };
}

export async function readClaworldSessionDirectory(options = {}, readOptions = {}) {
  const workspaceRoot = resolveClaworldWorkspaceRoot(options, readOptions.homeDir || os.homedir());
  const sessionDirectoryPath = resolveClaworldSessionDirectoryPath(workspaceRoot);
  const current = await readJsonIfPresent(sessionDirectoryPath);
  return {
    workspaceRoot,
    sessionDirectoryPath,
    directory: normalizeClaworldSessionDirectory(current || createEmptyClaworldSessionDirectory()),
    exists: current != null,
  };
}

export async function updateClaworldSessionDirectory(options = {}, input = {}, updateOptions = {}) {
  const workspaceRoot = resolveClaworldWorkspaceRoot(options, updateOptions.homeDir || os.homedir());
  await ensureClaworldWorkingMemory(workspaceRoot, updateOptions);
  const sessionDirectoryPath = resolveClaworldSessionDirectoryPath(workspaceRoot);
  const current = await readJsonIfPresent(sessionDirectoryPath);
  const baseDirectory = current || createEmptyClaworldSessionDirectory(input.timestamp || updateOptions.timestamp);
  const result = applyClaworldSessionDirectoryUpdate(baseDirectory, input);
  if (!result.updated) {
    return {
      ok: true,
      updated: false,
      reason: result.reason,
      workspaceRoot,
      sessionDirectoryPath,
      directory: normalizeClaworldSessionDirectory(baseDirectory),
    };
  }
  await atomicWriteText(
    sessionDirectoryPath,
    `${JSON.stringify(result.directory, null, 2)}\n`,
    {
      backup: false,
      rejectEmptyOverwrite: false,
    },
  );
  return {
    ok: true,
    updated: true,
    kind: result.kind,
    workspaceRoot,
    sessionDirectoryPath,
    directory: result.directory,
  };
}

function flattenInline(value) {
  return truncateText(String(value ?? '').replace(/\s+/g, ' ').trim());
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value, null);
    if (normalized) return normalized;
  }
  return null;
}

function hasStructuredValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return normalizeText(value, null) != null;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function cleanJournalValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return toIsoTimestamp(value);
  if (typeof value === 'string') return normalizeText(value, null);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const cleanedArray = value
      .map((entry) => cleanJournalValue(entry))
      .filter(hasStructuredValue);
    return cleanedArray.length > 0 ? cleanedArray : null;
  }
  if (isPlainObject(value)) {
    const cleanedObject = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = cleanJournalValue(entry);
      if (hasStructuredValue(cleaned)) {
        cleanedObject[key] = cleaned;
      }
    }
    return Object.keys(cleanedObject).length > 0 ? cleanedObject : null;
  }
  return normalizeText(value, null);
}

function cleanJournalObject(value = {}) {
  return cleanJournalValue(value) || {};
}

function resolveJournalScope(input = {}, relations = {}) {
  const directScope = normalizeText(input.scope, null);
  if (directScope) return directScope;
  const context = isPlainObject(input.context) ? input.context : {};
  const normalizedTarget = resolveClaworldBootstrapTarget({
    sessionKey: firstText(
      input.localSessionKey,
      input.sessionKey,
      relations.localSessionKey,
      relations.sessionKey,
      context.SessionKey,
      context.sessionKey,
    ),
    sessionType: firstText(
      input.sessionType,
      input.sessionKind,
      context.SessionType,
      context.ChatType,
      context.sessionType,
      context.sessionKind,
    ),
    channel: firstText(context.OriginatingChannel, context.channel),
  });
  if (normalizedTarget === CLAWORLD_BOOTSTRAP_TARGETS.CLAWORLD_CONVERSATION) return 'conversation';
  if (normalizedTarget === CLAWORLD_BOOTSTRAP_TARGETS.MANAGEMENT) return 'management';
  if (normalizedTarget === CLAWORLD_BOOTSTRAP_TARGETS.MAIN) return 'main';
  return firstText(input.sessionKind, input.sessionType, context.sessionKind, context.SessionType, 'runtime');
}

function resolveJournalRelations(input = {}, refs = {}) {
  const relations = isPlainObject(input.relations)
    ? input.relations
    : isPlainObject(input.correlation)
      ? input.correlation
      : {};
  const context = isPlainObject(input.context) ? input.context : {};
  const artifacts = isPlainObject(input.artifacts) ? input.artifacts : {};
  const requestId = firstText(
    relations.requestId,
    relations.chatRequestId,
    input.requestId,
    input.chatRequestId,
    refs.requestId,
    refs.chatRequestId,
    refs.friendRequestId,
  );
  return cleanJournalObject({
    requestId,
    chatRequestId: firstText(relations.chatRequestId, input.chatRequestId, refs.chatRequestId, requestId),
    deliveryId: firstText(relations.deliveryId, input.deliveryId, refs.deliveryId, context.RelayDeliveryId),
    eventId: firstText(relations.eventId, input.eventId, input.id, refs.eventId, context.RelayEventId),
    notificationId: firstText(relations.notificationId, refs.notificationId),
    inboxItemId: firstText(relations.inboxItemId, refs.inboxItemId),
    conversationKey: firstText(relations.conversationKey, input.conversationKey, refs.conversationKey),
    worldId: firstText(relations.worldId, input.worldId, refs.worldId),
    accountId: firstText(relations.accountId, input.accountId, refs.accountId, context.AccountId),
    agentCode: firstText(relations.agentCode, refs.agentCode),
    localAgentId: firstText(relations.localAgentId, input.localAgentId, context.AgentId, context.agentId),
    targetAgentId: firstText(relations.targetAgentId, input.targetAgentId, refs.targetAgentId, context.RelayTargetAgentId),
    fromAgentId: firstText(relations.fromAgentId, input.fromAgentId, refs.fromAgentId, context.RelayFromAgentId),
    sessionKey: firstText(relations.sessionKey, input.sessionKey, context.SessionKey, context.sessionKey),
    localSessionKey: firstText(relations.localSessionKey, input.localSessionKey, context.LocalSessionKey, context.SessionKey),
    relaySessionKey: firstText(relations.relaySessionKey, input.relaySessionKey, context.RelaySessionKey),
    sessionId: firstText(relations.sessionId, input.sessionId, artifacts.sessionId, context.SessionId),
    sessionFile: firstText(relations.sessionFile, input.sessionFile, artifacts.sessionFile, artifacts.sessionPath, context.SessionFile),
    sessionStorePath: firstText(relations.sessionStorePath, input.sessionStorePath, artifacts.sessionStorePath),
    transcriptPath: firstText(relations.transcriptPath, input.transcriptPath, artifacts.transcriptPath),
    reportPath: firstText(relations.reportPath, input.reportPath, artifacts.reportPath),
  });
}

function buildJournalKey(relations = {}, fallbackEventId = null) {
  const event = firstText(relations.eventId, fallbackEventId);
  const request = firstText(relations.requestId, relations.chatRequestId);
  const session = firstText(relations.localSessionKey, relations.relaySessionKey, relations.sessionKey);
  const continuity = request
    ? `request:${request}`
    : firstText(
      relations.conversationKey ? `conversation:${relations.conversationKey}` : null,
      session ? `session:${session}` : null,
      relations.worldId ? `world:${relations.worldId}` : null,
      event ? `event:${event}` : null,
    );
  return cleanJournalObject({
    event,
    continuity,
    request,
    session,
    sessionId: relations.sessionId,
    world: relations.worldId,
    conversation: relations.conversationKey,
  });
}

export function buildClaworldMaintenanceEvent(input = {}) {
  const toolName = normalizeText(input.toolName, null);
  const source = normalizeText(input.source, toolName ? 'claworld_tool' : 'claworld_runtime');
  const kind = normalizeText(input.kind, toolName || 'milestone');
  const timestamp = toIsoTimestamp(input.timestamp);
  const summary = normalizeText(input.summary, toolName ? `${toolName} succeeded.` : 'Claworld milestone recorded.');
  const refs = input.refs && typeof input.refs === 'object' && !Array.isArray(input.refs)
    ? Object.fromEntries(
      Object.entries(input.refs)
        .map(([key, value]) => [key, normalizeText(value, null)])
        .filter(([, value]) => value != null),
    )
    : {};
  const id = normalizeText(input.id, `${source}:${kind}:${timestamp}`);
  const relations = resolveJournalRelations({ ...input, eventId: input.eventId || id }, refs);
  const scope = resolveJournalScope(input, relations);
  return {
    schema: CLAWORLD_JOURNAL_SCHEMA,
    id,
    timestamp,
    source,
    kind,
    eventType: normalizeText(input.eventType, kind),
    scope,
    summary,
    excerpt: truncateText(input.excerpt || ''),
    refs,
    key: buildJournalKey(relations, id),
    relations,
    actor: cleanJournalObject(input.actor || {}),
    tool: cleanJournalObject(input.tool || {}),
    artifacts: cleanJournalObject(input.artifacts || {}),
    maintenance: cleanJournalObject(input.maintenance || {}),
  };
}

export function buildClaworldRuntimeMaintenanceEvent(input = {}) {
  return buildClaworldMaintenanceEvent({
    ...input,
    source: normalizeText(input.source, 'claworld_runtime'),
    kind: normalizeText(input.kind, 'milestone'),
  });
}

function parseToolResultPayload(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.payload && typeof result.payload === 'object' && !Array.isArray(result.payload)) {
    return result.payload;
  }
  const textContent = Array.isArray(result.content)
    ? result.content.find((entry) => entry?.type === 'text' && typeof entry.text === 'string')?.text
    : null;
  if (!textContent) return null;
  try {
    const parsed = JSON.parse(textContent);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function compactResultPayload(payload = {}) {
  const keys = [
    'status',
    'tool',
    'action',
    'scope',
    'query',
    'accountId',
    'worldId',
    'displayName',
    'requestId',
    'chatRequestId',
    'conversationKey',
    'feedbackId',
    'nextAction',
    'requiredAction',
    'summary',
    'message',
  ];
  const compact = {};
  for (const key of keys) {
    const value = normalizeText(payload[key], null);
    if (value != null) compact[key] = value;
  }
  return compact;
}

function readNestedObject(value, key) {
  const nested = value?.[key];
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {};
}

function firstObjectFromArray(value) {
  if (!Array.isArray(value)) return {};
  return value.find((entry) => isPlainObject(entry)) || {};
}

function nestedConversationWorldId(value = {}) {
  return firstText(value.worldId, value.conversation?.worldId);
}

function resolvePayloadItemCounts(payload = {}) {
  const counts = [];
  for (const [key, label] of [
    ['worlds', 'worlds'],
    ['members', 'members'],
    ['people', 'people'],
    ['results', 'results'],
    ['items', 'items'],
    ['pendingRequests', 'pendingRequests'],
    ['recentRequests', 'recentRequests'],
    ['chats', 'chats'],
  ]) {
    if (Array.isArray(payload[key])) {
      counts.push(`${label}=${payload[key].length}`);
    }
  }
  return counts;
}

function formatToolSummaryPart(key, value) {
  const normalized = flattenInline(value);
  return normalized ? `${key}=${normalized}` : null;
}

function buildToolCallSummary({ toolName, params = {}, payload = {}, compactPayload = {} } = {}) {
  const parts = [
    formatToolSummaryPart('action', firstText(params.action, payload.action)),
    formatToolSummaryPart('scope', firstText(params.scope, payload.scope)),
    formatToolSummaryPart('query', firstText(params.query, payload.query)),
    formatToolSummaryPart('status', firstText(payload.status, compactPayload.status)),
    formatToolSummaryPart('worldId', firstText(params.worldId, payload.worldId)),
    formatToolSummaryPart('chatRequestId', firstText(params.chatRequestId, payload.chatRequestId)),
    formatToolSummaryPart('conversationKey', firstText(params.conversationKey, payload.conversationKey)),
    ...resolvePayloadItemCounts(payload),
  ].filter(Boolean);
  return `${toolName} completed${parts.length > 0 ? ` (${parts.join(', ')})` : ''}.`;
}

export function buildClaworldToolMaintenanceEvent({
  toolName,
  params = {},
  result = null,
  timestamp = null,
  context = {},
} = {}) {
  const normalizedToolName = normalizeText(toolName, null);
  if (!normalizedToolName || !normalizedToolName.startsWith('claworld_')) return null;
  const payload = parseToolResultPayload(result) || {};
  const chatRequest = readNestedObject(payload, 'chatRequest');
  const request = readNestedObject(payload, 'request');
  const kickoff = readNestedObject(payload, 'kickoff');
  const chat = readNestedObject(payload, 'chat');
  const firstChat = firstObjectFromArray(payload.chats);
  const conversation = readNestedObject(payload, 'conversation');
  const compactPayload = compactResultPayload(payload);
  const requestId = firstText(
    params.requestId,
    params.chatRequestId,
    payload.requestId,
    payload.chatRequestId,
    chatRequest.chatRequestId,
    chatRequest.requestId,
    request.requestId,
    chat.chatRequestId,
    firstChat.chatRequestId,
  );
  const requesterSessionKey = firstText(
    context.sessionKey,
    context.SessionKey,
    context.localSessionKey,
    context.LocalSessionKey,
  );
  const resultConversationSessionKey = firstText(
    chat.localSessionKey,
    firstChat.localSessionKey,
    payload.localSessionKey,
    kickoff.localSessionKey,
    conversation.localSessionKey,
  );
  const conversationToolNames = new Set([
    'claworld_manage_conversations',
    'claworld_chat_inbox',
  ]);
  const localSessionKey = firstText(
    conversationToolNames.has(normalizedToolName) ? resultConversationSessionKey : null,
    requesterSessionKey,
    resultConversationSessionKey,
  );
  const relaySessionKey = firstText(
    context.RelaySessionKey,
    payload.sessionKey,
    chat.sessionKey,
    firstChat.sessionKey,
    kickoff.sessionKey,
    conversation.sessionKey,
  );
  const targetDiffersFromRequester = requesterSessionKey && localSessionKey && requesterSessionKey !== localSessionKey;
  const sessionKind = resolveJournalScope({
    sessionKey: localSessionKey || relaySessionKey,
    sessionType: targetDiffersFromRequester
      ? null
      : firstText(context.sessionType, context.SessionType, context.ChatType, context.sessionKind),
    context: targetDiffersFromRequester ? {} : context,
  });
  const actorSessionKind = resolveJournalScope({
    sessionKey: requesterSessionKey || localSessionKey || relaySessionKey,
    sessionType: firstText(context.sessionType, context.SessionType, context.ChatType, context.sessionKind),
    context,
  });
  const refs = {
    accountId: params.accountId || payload.accountId,
    worldId: firstText(
      params.worldId,
      payload.worldId,
      nestedConversationWorldId(chat),
      nestedConversationWorldId(firstChat),
      nestedConversationWorldId(chatRequest),
      nestedConversationWorldId(request),
      conversation.worldId,
    ),
    requestId,
    chatRequestId: firstText(
      params.chatRequestId,
      payload.chatRequestId,
      chatRequest.chatRequestId,
      request.chatRequestId,
      chat.chatRequestId,
      firstChat.chatRequestId,
      requestId,
    ),
    conversationKey: firstText(
      params.conversationKey,
      payload.conversationKey,
      conversation.conversationKey,
      kickoff.conversationKey,
      chat.conversationKey,
      firstChat.conversationKey,
    ),
    agentCode: params.agentCode || payload.agentCode,
    sessionKey: localSessionKey || relaySessionKey,
    relaySessionKey,
  };
  return buildClaworldMaintenanceEvent({
    source: 'claworld_tool',
    kind: normalizedToolName,
    eventType: 'tool_call',
    scope: sessionKind,
    toolName: normalizedToolName,
    timestamp,
    refs,
    relations: {
      requestId,
      chatRequestId: refs.chatRequestId,
      conversationKey: refs.conversationKey,
      worldId: refs.worldId,
      accountId: refs.accountId,
      agentCode: refs.agentCode,
      localSessionKey,
      relaySessionKey,
      sessionKey: localSessionKey || relaySessionKey,
      localAgentId: firstText(context.agentId, context.AgentId),
      sessionId: targetDiffersFromRequester ? null : firstText(context.sessionId, context.SessionId),
      sessionFile: targetDiffersFromRequester ? null : firstText(context.sessionFile, context.SessionFile, context.sessionPath),
      transcriptPath: targetDiffersFromRequester ? null : firstText(context.transcriptPath),
    },
    actor: {
      sessionKind: actorSessionKind,
      agentId: firstText(context.agentId, context.AgentId),
      sessionKey: requesterSessionKey || localSessionKey || relaySessionKey,
    },
    tool: {
      name: normalizedToolName,
      action: firstText(params.action, payload.action),
      status: firstText(payload.status, 'succeeded'),
      requesterSessionKey,
      targetSessionKey: targetDiffersFromRequester ? localSessionKey : null,
    },
    summary: buildToolCallSummary({
      toolName: normalizedToolName,
      params,
      payload,
      compactPayload,
    }),
    excerpt: Object.keys(compactPayload).length > 0
      ? JSON.stringify(compactPayload)
      : null,
  });
}

function buildJournalEntryPayload(event = {}) {
  return cleanJournalObject({
    schema: CLAWORLD_JOURNAL_SCHEMA,
    id: event.id,
    key: event.key,
    timestamp: event.timestamp,
    source: event.source,
    scope: event.scope,
    eventType: event.eventType,
    kind: event.kind,
    summary: event.summary,
    refs: event.refs,
    relations: event.relations,
    actor: event.actor,
    tool: event.tool,
    artifacts: event.artifacts,
    maintenance: event.maintenance,
    excerpt: event.excerpt || null,
  });
}

function buildJournalEntry(event = {}) {
  const title = flattenInline(event.summary || event.kind || 'Claworld event recorded.');
  const heading = [
    event.timestamp,
    event.scope || event.source,
    event.kind,
    title,
  ].filter(Boolean).join(' · ');
  return [
    `## ${heading}`,
    '',
    '```json',
    JSON.stringify(buildJournalEntryPayload(event), null, 2),
    '```',
    '',
  ].join('\n');
}

export async function appendClaworldJournalEvent(options = {}, event = {}, appendOptions = {}) {
  const workspaceRoot = resolveClaworldWorkspaceRoot(options, appendOptions.homeDir || os.homedir());
  await ensureClaworldWorkingMemory(workspaceRoot, appendOptions);
  const normalizedEvent = buildClaworldMaintenanceEvent(event);
  const dayKey = toDayKey(normalizedEvent.timestamp);
  const journalPath = path.join(
    workspaceRoot,
    CLAWORLD_WORKING_MEMORY_DIR,
    CLAWORLD_JOURNAL_DIR,
    `${dayKey}.md`,
  );
  const currentContent = await readTextIfPresent(journalPath);
  const entry = buildJournalEntry(normalizedEvent);
  if (currentContent == null) {
    await atomicWriteText(journalPath, `# Claworld Journal ${dayKey}\n\n${entry}`, {
      backup: false,
      rejectEmptyOverwrite: false,
    });
  } else {
    await fs.appendFile(journalPath, `${currentContent.endsWith('\n') ? '' : '\n'}${entry}`, 'utf8');
  }
  let sessionDirectory = null;
  if (appendOptions.updateSessionDirectory !== false) {
    try {
      sessionDirectory = await updateClaworldSessionDirectory(workspaceRoot, normalizedEvent, {
        ...appendOptions,
        timestamp: normalizedEvent.timestamp,
      });
    } catch (error) {
      sessionDirectory = {
        ok: false,
        error: error?.message || String(error),
      };
    }
  }
  return {
    ok: true,
    journalPath,
    sessionDirectory,
    event: normalizedEvent,
  };
}

export async function readClaworldWorkingMemory(options = {}, readOptions = {}) {
  const workspaceRoot = resolveClaworldWorkspaceRoot(options, readOptions.homeDir || os.homedir());
  const maxCharsPerFile = Number.isInteger(readOptions.maxCharsPerFile) && readOptions.maxCharsPerFile > 0
    ? readOptions.maxCharsPerFile
    : MAX_MEMORY_SLICE_CHARS;
  const slices = {};
  for (const relativePath of Object.values(CLAWORLD_WORKING_MEMORY_FILES)) {
    const absolutePath = path.join(workspaceRoot, CLAWORLD_WORKING_MEMORY_DIR, relativePath);
    const content = await readTextIfPresent(absolutePath);
    slices[relativePath] = content == null
      ? null
      : {
        content: content.length > maxCharsPerFile ? content.slice(0, maxCharsPerFile) : content,
        truncated: content.length > maxCharsPerFile,
      };
  }
  return {
    workspaceRoot,
    memoryRoot: path.join(workspaceRoot, CLAWORLD_WORKING_MEMORY_DIR),
    slices,
  };
}

export async function buildClaworldBootstrapPromptContext(context = {}, options = {}) {
  const normalizedContext = resolveClaworldBootstrapContext(context, options.context);
  const target = resolveClaworldBootstrapTarget(normalizedContext);
  const selectedFiles = bootstrapFilesForTarget(target);
  const maxTotalChars = normalizeBootstrapTotalChars(options.maxTotalChars, MAX_BOOTSTRAP_TOTAL_CHARS);
  const workspaceRoot = normalizeText(
    options.workspaceRoot ?? context.workspaceRoot ?? context.workspaceDir ?? context.workspacePath ?? context.workspace,
    null,
  );
  const resolvedWorkspaceRoot = workspaceRoot
    ? resolveClaworldWorkspaceRoot(workspaceRoot, options.homeDir || os.homedir())
    : null;
  const workingMemory = target !== CLAWORLD_BOOTSTRAP_TARGETS.NONE && resolvedWorkspaceRoot
    ? await readClaworldWorkingMemory(resolvedWorkspaceRoot, {
      ...options,
      maxCharsPerFile: options.maxCharsPerFile || MAX_BOOTSTRAP_FILE_CHARS,
    })
    : { slices: {} };
  const pointerInjected = target === CLAWORLD_BOOTSTRAP_TARGETS.MAIN;
  const managementPolicyInjected = target === CLAWORLD_BOOTSTRAP_TARGETS.MANAGEMENT;
  let managementMainSessionKey = null;
  if (managementPolicyInjected && resolvedWorkspaceRoot) {
    try {
      const sessionDirectory = await readClaworldSessionDirectory(resolvedWorkspaceRoot);
      managementMainSessionKey = normalizeText(
        sessionDirectory.directory?.main?.lastActiveSessionKey,
        null,
      );
    } catch {
      managementMainSessionKey = null;
    }
  }
  const parts = [];
  let truncated = false;
  if (pointerInjected) {
    const pointerBudget = maxTotalChars - measureBootstrapParts(parts) - (parts.length > 0 ? 2 : 0);
    const fittedPointer = truncateBootstrapText(
      buildClaworldContextPointer({ workspaceRoot: resolvedWorkspaceRoot }),
      pointerBudget,
    );
    if (fittedPointer.text) {
      parts.push(fittedPointer.text);
    }
    if (fittedPointer.truncated) {
      truncated = true;
    }
  }
  if (managementPolicyInjected) {
    const policyBudget = maxTotalChars - measureBootstrapParts(parts) - (parts.length > 0 ? 2 : 0);
    const fittedPolicy = truncateBootstrapText(
      buildClaworldManagementStartupPrompt({
        workspaceRoot: resolvedWorkspaceRoot,
        mainSessionKey: managementMainSessionKey,
      }),
      policyBudget,
    );
    if (fittedPolicy.text) {
      parts.push(fittedPolicy.text);
    }
    if (fittedPolicy.truncated) {
      truncated = true;
    }
  }
  const sectionTitle = target === CLAWORLD_BOOTSTRAP_TARGETS.MAIN
    ? '# Claworld Startup Memory'
    : target === CLAWORLD_BOOTSTRAP_TARGETS.MANAGEMENT
      ? '# Claworld Management Startup Memory'
      : '# Claworld Conversation Startup Context';
  const sectionPrefix = `${sectionTitle}\n\n`;
  const remainingBudget = maxTotalChars - measureBootstrapParts(parts) - (parts.length > 0 ? 2 : 0);
  const fileSections = buildClaworldBootstrapFileSections(selectedFiles, workingMemory.slices, {
    ...options,
    maxTotalChars: Math.max(0, remainingBudget - sectionPrefix.length),
  });
  if (fileSections.truncated) {
    truncated = true;
  }
  if (fileSections.text) {
    parts.push(`${sectionPrefix}${fileSections.text}`);
  }
  const appendSystemContext = parts.filter(Boolean).join('\n\n');
  const finalContext = appendSystemContext.length > maxTotalChars
    ? truncateBootstrapText(appendSystemContext, maxTotalChars)
    : { text: appendSystemContext, truncated: false };
  if (finalContext.truncated) {
    truncated = true;
  }
  return {
    target,
    context: normalizedContext,
    workspaceRoot: resolvedWorkspaceRoot,
    files: selectedFiles.map((relativePath) => buildBootstrapFileLabel(relativePath)),
    pointerInjected,
    managementPolicyInjected,
    fallbackFiles: fileSections.fallbackFiles,
    omittedFiles: fileSections.omittedFiles,
    truncated,
    appendSystemContext: finalContext.text,
  };
}

function normalizePatchOperation(operation) {
  const normalized = normalizeText(operation, 'replace');
  if (normalized === 'replace' || normalized === 'append_section' || normalized === 'no_op') {
    return normalized;
  }
  throw new Error(`Unsupported Claworld maintenance patch operation: ${normalized}`);
}

function normalizeMaintenanceRunType(runType) {
  const normalized = normalizeText(runType, null);
  if (MAINTENANCE_RUN_TYPE_VALUES.has(normalized)) return normalized;
  throw new Error(`Unsupported Claworld maintenance run type: ${runType}`);
}

function stripClaworldPrefix(rawTarget) {
  let target = String(rawTarget || '').replace(/\\/g, '/').trim();
  target = target.replace(/^\/+/, '');
  if (target.startsWith(`${CLAWORLD_WORKING_MEMORY_DIR}/`)) {
    target = target.slice(CLAWORLD_WORKING_MEMORY_DIR.length + 1);
  }
  return target;
}

function normalizePatchTarget(rawTarget) {
  const stripped = stripClaworldPrefix(rawTarget);
  if (['NOW.md', 'PROFILE.md', 'MEMORY.md'].includes(stripped)) {
    throw new Error(`Global ${stripped} is not a valid Claworld working-memory target; use context/${stripped}.`);
  }
  const normalized = path.posix.normalize(stripped);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid Claworld maintenance patch target: ${rawTarget}`);
  }
  return normalized;
}

function isAllowedTarget(runType, target) {
  if (target.startsWith(`${CLAWORLD_JOURNAL_DIR}/`) || target.startsWith(`${CLAWORLD_REPORTS_DIR}/`)) {
    return true;
  }
  if (runType === CLAWORLD_MAINTENANCE_RUN_TYPES.L1_NOW_REFRESH) {
    return L1_ALLOWED_TARGETS.has(target);
  }
  if (runType === CLAWORLD_MAINTENANCE_RUN_TYPES.L2_MEMORY_PROFILE_REVIEW) {
    return L2_ALLOWED_TARGETS.has(target);
  }
  return false;
}

function assertAllowedTarget(runType, target) {
  if (!isAllowedTarget(runType, target)) {
    throw new Error(`Claworld maintenance run ${runType} cannot write target ${target}`);
  }
}

function normalizeMarkdownNewlines(content) {
  return String(content ?? '').replace(/\r\n/g, '\n');
}

function assertContextMarkdownUsesBullets(target, normalizedContent, schema) {
  const maxBulletLength = schema.maxBulletLength || null;
  const lines = normalizedContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith('- ')) {
      throw new Error(`Claworld maintenance patch for ${target} must use bullet lines under schema sections.`);
    }
    if (maxBulletLength && trimmed.length > maxBulletLength) {
      throw new Error(`Claworld maintenance patch for ${target} has a bullet longer than ${maxBulletLength} characters.`);
    }
  }
}

function assertContextFileSchema(target, content) {
  const schema = CLAWORLD_CONTEXT_FILE_SCHEMAS[target];
  if (!schema) return;
  const normalizedContent = normalizeMarkdownNewlines(content);
  if (!normalizedContent.startsWith(`${schema.title}\n`)) {
    throw new Error(`Claworld maintenance patch for ${target} must start with ${schema.title}.`);
  }
  for (const heading of schema.headings) {
    if (!normalizedContent.includes(`\n${heading}\n`)) {
      throw new Error(`Claworld maintenance patch for ${target} is missing required section ${heading}.`);
    }
  }
  assertContextMarkdownUsesBullets(target, normalizedContent, schema);
}

function normalizeReportPatch(report, index) {
  const filename = normalizeText(report?.filename ?? report?.name, `report-${index + 1}.md`);
  const normalizedFilename = path.posix.basename(filename.endsWith('.md') ? filename : `${filename}.md`);
  return {
    operation: 'replace',
    target: `${CLAWORLD_REPORTS_DIR}/${normalizedFilename}`,
    content: String(report?.md ?? report?.content ?? report?.text ?? ''),
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readPatchContent(patch, fieldName) {
  if (hasOwn(patch, 'content')) return patch.content;
  if (hasOwn(patch, 'md')) return patch.md;
  if (hasOwn(patch, 'text')) return patch.text;
  throw new Error(`Claworld maintenance FilePatch ${fieldName} requires content for replace or append_section.`);
}

function normalizeFilePatchValue(value, target, fieldName) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const operation = normalizePatchOperation(value.operation);
    const normalized = {
      operation,
      target,
      content: operation === 'no_op' ? '' : String(readPatchContent(value, fieldName) ?? ''),
    };
    const rationale = normalizeText(value.rationale, null);
    if (rationale) normalized.rationale = rationale;
    return normalized;
  }
  return {
    operation: 'replace',
    target,
    content: String(value ?? ''),
  };
}

export function normalizeClaworldMaintenanceOutput(runType, output = {}, options = {}) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('Claworld maintenance output must be an object.');
  }
  const normalizedRunType = normalizeMaintenanceRunType(runType);
  const patches = [];
  if (Object.prototype.hasOwnProperty.call(output, 'nowMd')) {
    patches.push(normalizeFilePatchValue(output.nowMd, CLAWORLD_WORKING_MEMORY_FILES.now, 'nowMd'));
  }
  if (Object.prototype.hasOwnProperty.call(output, 'profileMd')) {
    patches.push(normalizeFilePatchValue(output.profileMd, CLAWORLD_WORKING_MEMORY_FILES.profile, 'profileMd'));
  }
  if (Object.prototype.hasOwnProperty.call(output, 'memoryMd')) {
    patches.push(normalizeFilePatchValue(output.memoryMd, CLAWORLD_WORKING_MEMORY_FILES.memory, 'memoryMd'));
  }
  if (Object.prototype.hasOwnProperty.call(output, 'journalAppendMd')) {
    const dayKey = toDayKey(options.timestamp || output.timestamp || Date.now());
    patches.push({
      operation: 'append_section',
      target: `${CLAWORLD_JOURNAL_DIR}/${dayKey}.md`,
      content: String(output.journalAppendMd ?? ''),
    });
  }
  if (Array.isArray(output.reports)) {
    output.reports.forEach((report, index) => {
      patches.push(normalizeReportPatch(report, index));
    });
  }
  if (Array.isArray(output.patches)) {
    for (const patch of output.patches) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('Claworld maintenance patches entries must be FilePatch objects.');
      }
      const operation = normalizePatchOperation(patch.operation);
      patches.push({
        operation,
        target: normalizePatchTarget(patch.target ?? patch.path ?? patch.relativePath),
        content: operation === 'no_op' ? '' : String(readPatchContent(patch, 'patches[]') ?? ''),
        rationale: normalizeText(patch.rationale, null),
      });
    }
  }

  const normalizedPatches = patches.map((patch) => {
    const target = normalizePatchTarget(patch.target);
    const operation = normalizePatchOperation(patch.operation);
    assertAllowedTarget(normalizedRunType, target);
    const normalizedPatch = {
      operation,
      target,
      content: String(patch.content ?? ''),
    };
    if (operation === 'replace') {
      assertContextFileSchema(target, normalizedPatch.content);
    }
    const rationale = normalizeText(patch.rationale, null);
    if (rationale) normalizedPatch.rationale = rationale;
    return normalizedPatch;
  });

  return {
    runType: normalizedRunType,
    noOpReason: normalizeText(output.noOpReason, null),
    patches: normalizedPatches,
  };
}

export function validateClaworldMaintenanceOutput(runType, output = {}, options = {}) {
  return normalizeClaworldMaintenanceOutput(runType, output, options);
}

async function applyMaintenancePatch(workspaceRoot, patch) {
  if (patch.operation === 'no_op') {
    return {
      operation: patch.operation,
      target: patch.target,
      applied: false,
    };
  }
  const absolutePath = path.join(workspaceRoot, CLAWORLD_WORKING_MEMORY_DIR, patch.target);
  if (patch.operation === 'append_section') {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const currentContent = await readTextIfPresent(absolutePath);
    if (currentContent == null) {
      const dayKey = path.basename(patch.target, '.md');
      await atomicWriteText(absolutePath, `# Claworld Journal ${dayKey}\n\n${patch.content}`, {
        backup: false,
        rejectEmptyOverwrite: false,
      });
    } else {
      await fs.appendFile(
        absolutePath,
        `${currentContent.endsWith('\n') ? '' : '\n'}${patch.content}`,
        'utf8',
      );
    }
    return {
      operation: patch.operation,
      target: patch.target,
      applied: true,
    };
  }

  await atomicWriteText(absolutePath, patch.content, {
    backup: true,
    rejectEmptyOverwrite: true,
  });
  return {
    operation: patch.operation,
    target: patch.target,
    applied: true,
  };
}

export async function runClaworldMemoryMaintenance(runType, requestBundle = {}, options = {}) {
  const normalizedRunType = normalizeMaintenanceRunType(runType);
  const workspaceRoot = resolveClaworldWorkspaceRoot(
    options.workspaceRoot || requestBundle.workspaceRoot || requestBundle.workspaceDir || process.cwd(),
    options.homeDir || os.homedir(),
  );
  await ensureClaworldWorkingMemory(workspaceRoot, options);
  const workingMemory = await readClaworldWorkingMemory(workspaceRoot, options);
  const request = {
    ...requestBundle,
    runType: normalizedRunType,
    workspaceRoot,
    workingMemory,
  };
  const output = options.output
    ?? (typeof options.maintenanceRunner === 'function'
      ? await options.maintenanceRunner(request)
      : null);
  if (!output) {
    return {
      ok: true,
      runType: normalizedRunType,
      noOpReason: 'no_maintenance_runner',
      request,
      applied: [],
    };
  }
  const normalized = validateClaworldMaintenanceOutput(normalizedRunType, output, options);
  const applied = [];
  for (const patch of normalized.patches) {
    applied.push(await applyMaintenancePatch(workspaceRoot, patch));
  }
  return {
    ok: true,
    runType: normalizedRunType,
    noOpReason: normalized.noOpReason,
    request,
    applied,
  };
}

function isOpenClawConfigCandidate(value) {
  return isPlainObject(value);
}

function selectOpenClawConfig(...candidates) {
  const withAgents = candidates.find((candidate) => (
    isOpenClawConfigCandidate(candidate)
    && candidate.agents
    && typeof candidate.agents === 'object'
    && !Array.isArray(candidate.agents)
  ));
  if (withAgents) return withAgents;
  return candidates.find(isOpenClawConfigCandidate) || {};
}

export function resolveClaworldMaintenanceWorkspaceRoot(requestBundle = {}, options = {}) {
  const config = selectOpenClawConfig(
    options.openClawConfig,
    options.config,
    requestBundle.openClawConfig,
    requestBundle.config,
    requestBundle.cfg,
  );
  const agentId = options.agentId
    ?? options.localAgentId
    ?? requestBundle.agentId
    ?? requestBundle.localAgentId
    ?? options.agent?.id
    ?? options.agent?.agentId
    ?? requestBundle.agent?.id
    ?? requestBundle.agent?.agentId
    ?? null;
  return resolveOpenClawWorkspaceRoot({
    sources: [options, requestBundle],
    config,
    agentId,
  }, options.homeDir || os.homedir());
}

export async function runClaworldMemoryMaintenanceForOpenClaw(runType, requestBundle = {}, options = {}) {
  const workspaceRoot = resolveClaworldMaintenanceWorkspaceRoot(requestBundle, options);
  if (!workspaceRoot) {
    throw new Error('Unable to resolve Claworld maintenance workspace root from OpenClaw context.');
  }
  return runClaworldMemoryMaintenance(
    runType,
    {
      ...requestBundle,
      workspaceRoot,
    },
    {
      ...options,
      workspaceRoot,
    },
  );
}
