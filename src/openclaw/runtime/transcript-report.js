import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CLAWORLD_TRANSCRIPT_STYLE_NAME,
  measureTranscriptItem,
  paginateTranscriptItems,
  renderTranscriptPageSvg,
} from './transcript-report-comic-grid.js';
import { displayCols } from './transcript-report-stylekit.js';
import { appendClaworldJournalEvent } from './working-memory.js';

const DEFAULT_WIDTH = 720;
const DEFAULT_MAX_PAGE_HEIGHT = 8000;
const TIME_SPLIT_SECONDS = 5 * 60;
const SESSION_INDEX_RELATIVE_PATH = path.join('.claworld', 'sessions', 'index.json');

const TOP_LEVEL_RENDER_FIELDS = new Set(['mode', 'stored', 'manual', 'style', 'maxPageHeight']);
const MANUAL_RENDER_FIELDS = new Set(['messages', 'title', 'peerProfile', 'localLabel', 'peerLabel']);
const STORED_RENDER_FIELDS = new Set(['chatRequestId', 'title', 'peerProfile', 'localLabel', 'peerLabel']);
const MANUAL_MESSAGE_FIELDS = new Set(['from', 'text', 'createdAt']);

const OPERATIONAL_NOTICE_PATTERNS = [
  /^🧭\s*New session:\s+\S+/iu,
  /^🧹\s*Auto-compaction complete(?:\s*\(count \d+\))?\.$/iu,
  /^↪️?\s*Model Fallback:/iu,
  /^↪️?\s*Model Fallback cleared:/iu,
  /^⚠️?\s*Agent failed before reply:/iu,
  /^Sent the (?:reply|opener|Claworld reply)\.?$/iu,
  /^◐\s*Session automatically reset\b/iu,
];
const RUNTIME_ERROR_PATTERNS = [
  /^⚠️?\s*Agent failed before reply:/iu,
  /^LLM request failed:/iu,
  /^LLM request timed out\.$/iu,
  /^LLM request unauthorized\.$/iu,
  /^The AI service is temporarily overloaded\.$/iu,
  /^The AI service returned an error\.$/iu,
  /^⚠️?\s*API rate limit reached\.$/iu,
  /^⚠️?\s*.+\s+returned a billing error\b/iu,
];
const OPERATIONAL_SUFFIX_PATTERNS = [
  /^Usage:\s+.+\s+in\s+\/\s+.+\s+out(?:\s+·\s+est\s+.+)?$/iu,
];

function text(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => (
    entry != null && entry !== '' && (!Array.isArray(entry) || entry.length > 0)
  )));
}

function isoNow() {
  return new Date().toISOString();
}

async function readJsonObject(filePath, fallback = {}) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return isObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function atomicWriteText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function atomicWriteJson(filePath, payload) {
  await atomicWriteText(filePath, JSON.stringify(payload, null, 2));
}

function sessionIndexPath(workspaceRoot) {
  return path.join(workspaceRoot, SESSION_INDEX_RELATIVE_PATH);
}

function emptySessionIndex() {
  const now = isoNow();
  return {
    schema: 'claworld.sessions.v1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    main: {},
    management: {},
    conversationSessions: {},
    conversationEpisodes: {},
  };
}

async function readSessionIndex(workspaceRoot) {
  const index = await readJsonObject(sessionIndexPath(workspaceRoot), emptySessionIndex());
  if (!isObject(index.main)) index.main = {};
  if (!isObject(index.management)) index.management = {};
  if (!isObject(index.conversationSessions)) index.conversationSessions = {};
  if (!isObject(index.conversationEpisodes)) index.conversationEpisodes = {};
  return index;
}

function appendUniqueDelivery(deliveries, delivery) {
  const deliveryId = text(delivery?.deliveryId, null);
  if (!deliveryId || (!text(delivery?.commandText, null) && !text(delivery?.contextText, null))) return deliveries;
  const next = Array.isArray(deliveries) ? [...deliveries] : [];
  const existingIndex = next.findIndex((item) => text(item?.deliveryId, null) === deliveryId);
  if (existingIndex >= 0) {
    next[existingIndex] = compactObject({ ...next[existingIndex], ...delivery });
  } else {
    next.push(compactObject(delivery));
  }
  return next;
}

export async function recordClaworldTranscriptEpisode(workspaceRoot, input = {}) {
  const chatRequestId = text(input.chatRequestId, null);
  const deliveryId = text(input.deliveryId, null);
  const commandText = text(input.commandText, null);
  const contextText = text(input.contextText, null);
  if (!workspaceRoot || !chatRequestId || !deliveryId || (!commandText && !contextText)) {
    return { ok: false, updated: false, reason: 'missing_transcript_identity' };
  }

  const index = await readSessionIndex(workspaceRoot);
  const previous = isObject(index.conversationEpisodes[chatRequestId])
    ? index.conversationEpisodes[chatRequestId]
    : {};
  let deliveries = appendUniqueDelivery(previous.deliveries, {
    deliveryId,
    direction: 'inbound',
    fromAgentId: text(input.fromAgentId, null),
    fromAgentCode: text(input.fromAgentCode, null),
    fromDisplayIdentity: text(input.fromDisplayIdentity, null),
    deliveryType: text(input.deliveryType, null),
    commandText,
    contextText,
    untrustedContext: text(input.untrustedContext, null),
    createdAt: text(input.createdAt, null),
    turnCreatedAt: text(input.turnCreatedAt, null),
  });
  const replyText = text(input.replyText, null);
  if (replyText) {
    deliveries = appendUniqueDelivery(deliveries, {
      deliveryId: `${deliveryId}:reply`,
      direction: 'outbound',
      deliveryType: 'reply',
      fromAgentId: text(input.localAgentId, null),
      commandText: replyText,
      createdAt: text(input.replyCreatedAt, isoNow()),
      turnCreatedAt: text(input.replyCreatedAt, isoNow()),
    });
  }

  const now = isoNow();
  const deliveryIds = deliveries.map((entry) => text(entry?.deliveryId, null)).filter(Boolean);
  index.conversationEpisodes[chatRequestId] = compactObject({
    ...previous,
    chatRequestId,
    chatId: text(input.chatId, previous.chatId),
    lastActiveSessionKey: text(input.localSessionKey, previous.lastActiveSessionKey),
    relaySessionKey: text(input.relaySessionKey, previous.relaySessionKey),
    conversationKey: text(input.conversationKey, previous.conversationKey),
    worldId: text(input.worldId, previous.worldId),
    targetAgentId: text(input.targetAgentId, previous.targetAgentId),
    fromAgentCode: text(input.fromAgentCode, previous.fromAgentCode),
    fromDisplayIdentity: text(input.fromDisplayIdentity, previous.fromDisplayIdentity),
    firstSeenAt: text(previous.firstSeenAt, text(input.createdAt, now)),
    lastSeenAt: replyText
      ? text(input.replyCreatedAt, now)
      : text(input.turnCreatedAt, text(input.createdAt, now)),
    deliveryIds,
    deliveryCount: deliveryIds.length,
    deliveries,
    updatedAt: now,
  });
  index.updatedAt = now;
  await atomicWriteJson(sessionIndexPath(workspaceRoot), index);
  return { ok: true, updated: true, chatRequestId, deliveryCount: deliveryIds.length };
}

function stripOperationalSuffix(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  while (lines.length) {
    const lastLine = String(lines.at(-1) ?? '').trim();
    if (!lastLine) {
      lines.pop();
      continue;
    }
    if (!OPERATIONAL_SUFFIX_PATTERNS.some((pattern) => pattern.test(lastLine))) break;
    lines.pop();
  }
  return lines.join('\n').trim();
}

function classifyReplyContent(content) {
  const rawText = String(content ?? '');
  const normalized = stripOperationalSuffix(rawText);
  if (!normalized) return { text: '', silenceReason: rawText.trim() ? 'operational_notice_only' : 'empty_reply' };
  if (normalized === 'NO_REPLY') return { text: '', silenceReason: 'no_reply' };
  if (RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { text: '', silenceReason: 'runtime_failed_before_reply' };
  }
  if (OPERATIONAL_NOTICE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { text: '', silenceReason: 'operational_notice_only' };
  }
  return { text: normalized, silenceReason: null };
}

function renderableTranscriptDelivery(delivery) {
  if (!isObject(delivery) || text(delivery.deliveryType, null) === 'kickoff') return false;
  const commandText = text(delivery.commandText, null);
  return Boolean(commandText && !classifyReplyContent(commandText).silenceReason);
}

function episodeSummary(chatRequestId, entry) {
  const deliveries = Array.isArray(entry.deliveries) ? entry.deliveries : [];
  const renderable = deliveries.filter(renderableTranscriptDelivery);
  const peerMessages = renderable.filter((delivery) => text(delivery.direction, null) !== 'outbound').length;
  return compactObject({
    chatRequestId: text(entry.chatRequestId, chatRequestId),
    chatId: entry.chatId,
    conversationKey: entry.conversationKey,
    relaySessionKey: entry.relaySessionKey,
    lastActiveSessionKey: entry.lastActiveSessionKey,
    worldId: entry.worldId,
    targetAgentId: entry.targetAgentId,
    fromAgentCode: entry.fromAgentCode,
    fromDisplayIdentity: entry.fromDisplayIdentity,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
    deliveryCount: entry.deliveryCount,
    renderableMessages: renderable.length,
    peerMessages,
    localMessages: renderable.length - peerMessages,
  });
}

function localEpisodeSummaries(index) {
  return Object.entries(isObject(index.conversationEpisodes) ? index.conversationEpisodes : {})
    .filter(([, entry]) => isObject(entry))
    .map(([chatRequestId, entry]) => episodeSummary(chatRequestId, entry))
    .sort((left, right) => String(right.lastSeenAt || right.firstSeenAt || '')
      .localeCompare(String(left.lastSeenAt || left.firstSeenAt || '')));
}

function matchesEpisodeFilters(episode, filters = {}) {
  const checks = {
    chatRequestId: 'chatRequestId',
    conversationKey: 'conversationKey',
    localSessionKey: 'relaySessionKey',
    counterpartyAgentId: 'targetAgentId',
    worldId: 'worldId',
  };
  return Object.entries(checks).every(([filterKey, episodeKey]) => {
    const expected = text(filters[filterKey], null);
    return !expected || text(episode[episodeKey], null) === expected;
  });
}

function filterLocalEpisodes(episodes, filters = {}) {
  return episodes.filter((episode) => matchesEpisodeFilters(episode, filters)).slice(0, 25);
}

function conversationItemFilters(item = {}) {
  const related = isObject(item.relatedObjects) ? item.relatedObjects : {};
  return compactObject({
    chatRequestId: text(item.chatRequestId, text(related.chatRequestId, null)),
    conversationKey: text(item.conversationKey, text(related.conversationKey, null)),
    localSessionKey: text(item.localSessionKey, text(related.localSessionKey, null)),
    counterpartyAgentId: text(item.counterpartyAgentId, text(related.counterpartyAgentId, null)),
    worldId: text(item.worldId, text(related.worldId, null)),
  });
}

export async function augmentConversationPayloadWithLocalTranscriptIndex({
  workspaceRoot,
  payload,
  filters = {},
} = {}) {
  if (!workspaceRoot || !isObject(payload)) return payload;
  const index = await readSessionIndex(workspaceRoot);
  const episodes = localEpisodeSummaries(index);
  const matching = filterLocalEpisodes(episodes, filters);
  const result = { ...payload };
  if (matching.length) {
    result.localTranscriptEpisodes = matching;
    result.localTranscriptSummary = {
      episodeCount: matching.length,
      chatRequestIds: matching.map((item) => item.chatRequestId).filter(Boolean),
    };
  }
  if (Array.isArray(result.items)) {
    result.items = result.items.map((item) => {
      if (!isObject(item)) return item;
      const itemFilters = conversationItemFilters(item);
      if (!Object.keys(itemFilters).length) return item;
      const itemMatches = filterLocalEpisodes(episodes, itemFilters);
      if (!itemMatches.length) return item;
      return {
        ...item,
        localTranscriptEpisodes: itemMatches,
        localTranscriptSummary: {
          episodeCount: itemMatches.length,
          chatRequestIds: itemMatches.map((match) => match.chatRequestId).filter(Boolean),
        },
      };
    });
  }
  return result;
}

function rejectUnknown(name, value, allowed) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (extra.length) throw new Error(`unsupported ${name} parameter(s): ${extra.join(', ')}`);
}

function normalizeRenderRequest(args = {}) {
  if (!isObject(args)) throw new Error('render arguments must be an object');
  rejectUnknown('transcript render', args, TOP_LEVEL_RENDER_FIELDS);
  const mode = text(args.mode, null);
  if (!['stored', 'manual'].includes(mode)) {
    throw new Error('mode is required and must be one of stored or manual');
  }
  const style = text(args.style, CLAWORLD_TRANSCRIPT_STYLE_NAME);
  if (style !== CLAWORLD_TRANSCRIPT_STYLE_NAME) {
    throw new Error(`unsupported transcript report style: ${style}; expected ${CLAWORLD_TRANSCRIPT_STYLE_NAME}`);
  }
  const renderArgs = { mode, style, maxPageHeight: args.maxPageHeight };
  if (mode === 'stored') {
    if (args.manual != null) throw new Error('manual must not be provided when mode=stored');
    if (!isObject(args.stored)) throw new Error('stored must be an object when mode=stored');
    rejectUnknown('stored', args.stored, STORED_RENDER_FIELDS);
    const chatRequestId = text(args.stored.chatRequestId, null);
    if (!chatRequestId) throw new Error('stored.chatRequestId is required when mode=stored');
    for (const key of ['title', 'peerProfile', 'localLabel', 'peerLabel']) {
      renderArgs[key] = args.stored[key];
    }
    return { mode, chatRequestId, renderArgs };
  }
  if (args.stored != null) throw new Error('stored must not be provided when mode=manual');
  if (!isObject(args.manual)) throw new Error('manual must be an object when mode=manual');
  rejectUnknown('manual', args.manual, MANUAL_RENDER_FIELDS);
  for (const key of ['title', 'peerProfile', 'localLabel', 'peerLabel']) {
    if (!text(args.manual[key], null)) throw new Error(`manual.${key} is required when mode=manual`);
    renderArgs[key] = args.manual[key];
  }
  if (!Array.isArray(args.manual.messages) || !args.manual.messages.length) {
    throw new Error('manual.messages must be a non-empty array when mode=manual');
  }
  args.manual.messages.forEach((message, index) => {
    const position = index + 1;
    if (!isObject(message)) throw new Error(`manual.messages[${position}] must be an object`);
    rejectUnknown(`manual.messages[${position}]`, message, MANUAL_MESSAGE_FIELDS);
    if (!['peer', 'local'].includes(text(message.from, null))) {
      throw new Error(`manual.messages[${position}].from must be peer or local`);
    }
    if (!text(message.text, null)) throw new Error(`manual.messages[${position}].text is required`);
    if (!text(message.createdAt, null)) throw new Error(`manual.messages[${position}].createdAt is required`);
  });
  return { mode, messages: args.manual.messages, renderArgs };
}

async function loadSourceMessages(request, workspaceRoot) {
  if (request.mode === 'manual') {
    return { messages: request.messages, summary: { kind: 'manual', messageCount: request.messages.length } };
  }
  const index = await readSessionIndex(workspaceRoot);
  const episode = isObject(index.conversationEpisodes?.[request.chatRequestId])
    ? index.conversationEpisodes[request.chatRequestId]
    : null;
  if (!episode) {
    throw new Error(`chatRequestId was not found in local Claworld transcript index: ${request.chatRequestId}`);
  }
  const deliveries = Array.isArray(episode.deliveries) ? episode.deliveries : [];
  if (!deliveries.length) {
    throw new Error(`chatRequestId was found but no deliveries were indexed: ${request.chatRequestId}`);
  }
  return {
    messages: deliveries,
    summary: compactObject({
      kind: 'chatRequestId',
      chatRequestId: request.chatRequestId,
      chatId: episode.chatId,
      conversationKey: episode.conversationKey,
      relaySessionKey: episode.relaySessionKey,
      lastActiveSessionKey: episode.lastActiveSessionKey,
      firstSeenAt: episode.firstSeenAt,
      lastSeenAt: episode.lastSeenAt,
      indexSource: 'conversationEpisodes',
    }),
  };
}

function markdownSection(value, title, level) {
  const hashes = '#'.repeat(level);
  const pattern = new RegExp(`^${hashes}\\s+${title}\\s*$`, 'imu');
  const match = pattern.exec(value);
  if (!match) return '';
  const start = match.index + match[0].length;
  const remainder = value.slice(start);
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`, 'mu').exec(remainder);
  return remainder.slice(0, nextHeading?.index ?? remainder.length).trim();
}

function markdownNamedCodeBlock(value, title, level) {
  const section = markdownSection(value, title, level);
  if (!section) return '';
  const fenced = /```[^\n]*\n([\s\S]*?)\n```/u.exec(section);
  if (fenced) return fenced[1].trim();
  return section.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).join('\n');
}

function squashWhitespace(value) {
  const lines = String(value ?? '').split(/\r?\n/).map((line) => line.replace(/[ \t]+/gu, ' ').trim());
  const compact = [];
  let blank = false;
  for (const line of lines) {
    if (!line) {
      if (!blank && compact.length) compact.push('');
      blank = true;
    } else {
      compact.push(line);
      blank = false;
    }
  }
  return compact.join('\n').trim();
}

function parseHeaderContextCandidate(value, source) {
  const content = String(value ?? '').trim();
  if (!content) return {};
  const parsed = {};
  const modeMatch = /^\s*-\s*Mode:\s*`?([A-Za-z_-]+)`?\s*$/imu.exec(content)
    || /\bconversation[_\s-]*mode\b\s*[:=]\s*`?([A-Za-z_-]+)`?/iu.exec(content);
  const mode = text(modeMatch?.[1]?.toLowerCase(), null);
  if (['world', 'direct'].includes(mode)) parsed.conversationMode = mode;
  const worldMatch = /^\s*-\s*World:\s*([^\n(`]+?)\s*(?:\(`([^`]+)`\))?\s*$/imu.exec(content);
  if (worldMatch) {
    parsed.worldName = text(worldMatch[1], null);
    parsed.worldId = text(worldMatch[2], null);
  }
  const localSection = markdownSection(content, 'You', 2);
  const peerSection = markdownSection(content, 'Peer', 2);
  const identity = (section) => text(/^\s*-\s*Identity:\s*`?([^`\n]+)`?\s*$/imu.exec(section)?.[1], null);
  if (localSection) parsed.localIdentity = identity(localSection);
  if (peerSection) {
    parsed.peerIdentity = identity(peerSection);
    const globalProfile = markdownNamedCodeBlock(peerSection, 'Global Profile', 3);
    const worldProfile = markdownNamedCodeBlock(peerSection, 'World Membership Profile', 3);
    if (globalProfile) {
      parsed.globalProfile = squashWhitespace(globalProfile);
      parsed.globalProfileSource = source;
    }
    if (worldProfile) {
      parsed.worldProfile = squashWhitespace(worldProfile);
      parsed.worldProfileSource = source;
    }
  }
  if (!localSection && !peerSection && source === 'untrustedContext') {
    const plainProfile = plainProfileCandidate(content);
    if (plainProfile) {
      parsed.globalProfile = plainProfile;
      parsed.globalProfileSource = source;
    }
  }
  return compactObject(parsed);
}

function plainProfileCandidate(value) {
  const candidate = squashWhitespace(value);
  if (!candidate || candidate.includes('# ') || candidate.includes('```')) return '';
  return displayCols(candidate) <= 420 ? candidate : '';
}

function headerProfileSourcePriority(source) {
  return { contextText: 4, untrustedContext: 3, rawKickoffText: 2, transcript: 1 }[source] || 0;
}

function mergeHeaderContextCandidate(merged, candidate, source) {
  if (!candidate) return;
  const parsed = parseHeaderContextCandidate(candidate, source);
  for (const [key, value] of Object.entries(parsed)) {
    if (!text(value, null)) continue;
    const sourceKey = {
      globalProfile: 'globalProfileSource',
      worldProfile: 'worldProfileSource',
      globalProfileSource: 'globalProfileSource',
      worldProfileSource: 'worldProfileSource',
    }[key];
    if (!sourceKey) {
      merged[key] = value;
    } else {
      const incomingSource = key.endsWith('Source') ? value : parsed[sourceKey];
      if (headerProfileSourcePriority(incomingSource) >= headerProfileSourcePriority(merged[sourceKey])) {
        merged[key] = value;
      }
    }
  }
}

function extractTranscriptHeaderContext(rawMessages) {
  const merged = {};
  for (const raw of rawMessages) {
    if (!isObject(raw)) continue;
    mergeHeaderContextCandidate(merged, text(raw.contextText, null), 'contextText');
    mergeHeaderContextCandidate(merged, text(raw.untrustedContext, null), 'untrustedContext');
    if (text(raw.deliveryType, null) === 'kickoff') {
      mergeHeaderContextCandidate(merged, text(raw.commandText, null), 'rawKickoffText');
    }
    if (!merged.peerIdentity && text(raw.fromDisplayIdentity, null)) {
      merged.peerIdentity = text(raw.fromDisplayIdentity, null);
    }
  }
  let peerProfile = '';
  let profileSource = '';
  if (merged.conversationMode === 'world' && merged.worldProfile) {
    peerProfile = merged.worldProfile;
    profileSource = merged.worldProfileSource || 'transcript';
  } else if (merged.conversationMode === 'direct' && merged.globalProfile) {
    peerProfile = merged.globalProfile;
    profileSource = merged.globalProfileSource || 'transcript';
  } else if (merged.worldProfile) {
    peerProfile = merged.worldProfile;
    profileSource = merged.worldProfileSource || 'transcript';
  } else if (merged.globalProfile) {
    peerProfile = merged.globalProfile;
    profileSource = merged.globalProfileSource || 'transcript';
  }
  return compactObject({ ...merged, peerProfile, profileSource });
}

function formatTimestamp(value) {
  if (value == null || value === '') return '';
  let date = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value * 1000);
  } else {
    const parsed = new Date(String(value).trim());
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date) return String(value).trim();
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTimeish(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (/^\d+(?:\.\d+)?$/u.test(String(value).trim())) return Number(value);
  const timestamp = Date.parse(String(value).trim());
  return Number.isNaN(timestamp) ? null : timestamp / 1000;
}

function extractControlTags(value) {
  const matches = [];
  const claimed = [];
  const patterns = [
    [/\[\[?\s*request[_\s-]*(?:conversation[_\s-]*)?end\s*\]?\]?/giu, 'request end'],
    [/\[\s*requeset\s+end\s*\]/giu, 'request end'],
    [/\[\[?\s*end\s*\]?\]?/giu, 'request end'],
    [/\[\[?\s*like\s*\]?\]?/giu, 'like'],
    [/\[\[?\s*dislike\s*\]?\]?/giu, 'dislike'],
  ];
  const record = (start, end, label) => {
    if (claimed.some(([claimedStart, claimedEnd]) => start < claimedEnd && end > claimedStart)) return;
    claimed.push([start, end]);
    matches.push([start, end, label]);
  };
  const source = String(value ?? '');
  for (const [pattern, label] of patterns) {
    for (const match of source.matchAll(pattern)) record(match.index, match.index + match[0].length, label);
  }
  for (const match of source.matchAll(/\[\[\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,24})\s*\]\]/gu)) {
    const label = squashWhitespace(match[1].replaceAll('_', ' ').replaceAll('-', ' ')).toLowerCase().slice(0, 24).trim();
    if (label) record(match.index, match.index + match[0].length, label);
  }
  const sorted = matches.sort((left, right) => left[0] - right[0]);
  const tags = [...new Set(sorted.map(([, , label]) => label))];
  let cursor = 0;
  const pieces = [];
  for (const [start, end] of sorted) {
    pieces.push(source.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  pieces.push(source.slice(cursor));
  return { text: squashWhitespace(pieces.join('')), tags };
}

function redactText(value) {
  return String(value ?? '')
    .replace(/\b(api[_-]?key|app[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|authorization|bearer)\b\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(/\b(?:sk|rk|pk|ghp|glpat)-[A-Za-z0-9_-]{12,}\b/gu, '[redacted-token]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu, '[redacted-email]')
    .replace(/(?<!\d)(?:\+?\d[\d\s().-]{8,}\d)(?!\d)/gu, '[redacted-phone]');
}

function stripInternalMarkup(value) {
  let cleaned = String(value ?? '').replace(/```(?:json|text|markdown)?/giu, '').replaceAll('```', '');
  for (const marker of [
    'Routing metadata:',
    'Claworld live conversation rules:',
    'Backend-authored Claworld context:',
    'Backend-authored Claworld command:',
    'Relay untrusted context:',
  ]) {
    if (cleaned.includes(marker)) cleaned = cleaned.split(marker, 1)[0];
  }
  return squashWhitespace(cleaned);
}

function normalizeMessages(rawMessages, localAgentId, args, headerContext = {}) {
  const localIdentity = text(headerContext.localIdentity, null);
  const peerIdentity = text(headerContext.peerIdentity, text(headerContext.peerId, null));
  const localId = text(localIdentity, text(localAgentId, 'local-agent'));
  const peerId = text(peerIdentity, 'peer-agent');
  const localLabel = publicHeaderValue(args.localLabel) || publicHeaderValue(localIdentity) || 'Me';
  const peerLabel = publicHeaderValue(args.peerLabel) || publicHeaderValue(peerIdentity) || 'Peer';
  const normalized = [];
  rawMessages.forEach((raw, index) => {
    if (!isObject(raw)) return;
    let side;
    let messageText;
    let createdAt;
    let messageId;
    let participantId;
    let participantLabel;
    if (['peer', 'local'].includes(raw.from)) {
      side = raw.from === 'peer' ? 'left' : 'right';
      messageText = text(raw.text, null);
      createdAt = formatTimestamp(raw.createdAt);
      messageId = text(raw.id, `msg-${index + 1}`);
      participantId = side === 'left' ? peerId : localId;
      participantLabel = side === 'left' ? peerLabel : localLabel;
    } else {
      if (text(raw.deliveryType, null) === 'kickoff') return;
      const classification = classifyReplyContent(text(raw.commandText, ''));
      if (classification.silenceReason) return;
      messageText = classification.text;
      createdAt = formatTimestamp(raw.turnCreatedAt || raw.createdAt);
      messageId = text(raw.deliveryId, `msg-${index + 1}`);
      side = text(raw.direction, null) === 'outbound'
        || (!text(raw.direction, null) && text(raw.fromAgentId, null) === text(localAgentId, null))
        ? 'right'
        : 'left';
      participantId = side === 'left' ? peerId : localId;
      participantLabel = side === 'left' ? peerLabel : localLabel;
    }
    if (!messageText) return;
    const extracted = extractControlTags(messageText);
    const cleanedText = stripInternalMarkup(redactText(extracted.text));
    if (!cleanedText && !extracted.tags.length) return;
    normalized.push({
      id: messageId,
      side,
      participantId,
      participantLabel,
      text: cleanedText,
      createdAt,
      tags: extracted.tags,
      sourceIndex: index,
    });
  });
  return normalized;
}

function selectionSummary(request, messageCount) {
  return compactObject({
    mode: request.mode,
    chatRequestId: request.mode === 'stored' ? request.chatRequestId : null,
    messageCount,
    omittedBefore: 0,
    omittedAfter: 0,
  });
}

function formatTimeMarker(value) {
  const timestamp = parseTimeish(value);
  if (timestamp != null) {
    const date = new Date(timestamp * 1000);
    if (!Number.isNaN(date.getTime())) {
      const pad = (part) => String(part).padStart(2, '0');
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  }
  const match = /(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})/u.exec(String(value ?? '').trim());
  return match ? `${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')} ${String(Number(match[4])).padStart(2, '0')}:${match[5]}` : '';
}

function decorateSelection(messages, selection) {
  const items = [];
  let previousTimestamp = null;
  messages.forEach((message, index) => {
    const timestamp = parseTimeish(message.createdAt);
    if (message.createdAt && (index === 0 || (
      previousTimestamp != null && timestamp != null && timestamp - previousTimestamp > TIME_SPLIT_SECONDS
    ))) {
      const label = formatTimeMarker(message.createdAt);
      if (label) items.push({ kind: 'time', label, timestamp: message.createdAt });
    }
    items.push({ kind: 'message', message });
    previousTimestamp = timestamp ?? previousTimestamp;
  });
  if (selection.omittedAfter > 0) {
    items.push({ kind: 'ellipsis', omitted: selection.omittedAfter, label: `${selection.omittedAfter} later messages omitted` });
  }
  return items;
}

function participants(messages) {
  const seen = new Map();
  for (const message of messages) {
    if (!seen.has(message.participantId)) seen.set(message.participantId, message);
  }
  return [...seen.entries()].map(([participantId, message]) => ({
    id: participantId,
    name: message.participantLabel,
    side: message.side,
    avatar: String(message.participantLabel || 'A').replace(/[^A-Za-z0-9]/gu, '').slice(0, 2).toUpperCase() || 'A',
  }));
}

function bubbleMessagePayload(item) {
  if (item.kind === 'time') return { kind: 'time', label: item.label, timestamp: item.timestamp || '' };
  if (item.kind === 'ellipsis') return { kind: 'ellipsis', omitted: item.omitted, label: item.label };
  const { message } = item;
  return {
    id: message.id,
    kind: 'text',
    from: message.participantId,
    side: message.side,
    speaker: message.participantLabel,
    text: message.text,
    createdAt: message.createdAt,
    tags: [...message.tags],
  };
}

function publicHeaderValue(value) {
  const normalized = text(value, '') || '';
  if (/(?:^|[\s(])(?:agt|req|wld|dlv|conversation|management)[_:-][a-z0-9]/iu.test(normalized)) {
    return '';
  }
  return normalized;
}

function displayName(identity) {
  return publicHeaderValue(String(identity || '').split('#', 1)[0]);
}

function semanticHeaderTitle(peerName, worldName) {
  if (peerName && worldName) return `${peerName} — ${worldName}`;
  return peerName || worldName || 'Claworld conversation';
}

function headerText(args, messages, headerContext) {
  const explicitTitle = publicHeaderValue(args.title);
  let peerIdentity = publicHeaderValue(headerContext.peerIdentity)
    || publicHeaderValue(headerContext.peerId);
  if (!peerIdentity) {
    peerIdentity = publicHeaderValue(
      messages.find((message) => message.side === 'left')?.participantLabel,
    );
  }
  const peerName = displayName(peerIdentity);
  const worldName = publicHeaderValue(headerContext.worldName);
  const title = explicitTitle || semanticHeaderTitle(peerName, worldName);
  const explicitProfile = publicHeaderValue(args.peerProfile);
  if (explicitProfile) return { title, subtitle: explicitProfile };
  const profile = publicHeaderValue(headerContext.peerProfile);
  const subtitleParts = [peerIdentity, profile].filter(Boolean);
  if (!subtitleParts.length && worldName) subtitleParts.push(worldName);
  return { title, subtitle: subtitleParts.join(' · ') || 'Conversation transcript' };
}

function outputDirectories(workspaceRoot) {
  const base = path.join(workspaceRoot, '.claworld', 'reports', 'transcripts');
  return { images: path.join(base, 'images'), documents: path.join(base, 'documents') };
}

function artifactId(source, selection, styleName) {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const styleSlug = styleName.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'style';
  const digest = createHash('sha256').update(JSON.stringify({ source, selection, style: styleName, now: timestamp })).digest('hex').slice(0, 10);
  return `claworld-transcript-${styleSlug}-${timestamp}-${digest}`;
}

async function sha256(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function intValue(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback);
}

async function writePng(svg, pngPath, page) {
  const sharpModule = await import('sharp');
  const sharp = sharpModule.default || sharpModule;
  await sharp(Buffer.from(svg), { density: 192 })
    .resize(page.width, page.height, { fit: 'fill' })
    .png()
    .toFile(pngPath);
  return { renderer: 'sharp-svg' };
}

function artifactPage(item) {
  return compactObject({
    page: item.page,
    format: item.format,
    path: item.path,
    width: item.width,
    height: item.height,
    sha256: item.sha256,
  });
}

export async function renderTranscriptReport({ workspaceRoot, localAgentId = null, args = {} } = {}) {
  if (!workspaceRoot) throw new Error('OpenClaw workspace root is required for transcript rendering');
  workspaceRoot = path.resolve(workspaceRoot);
  const request = normalizeRenderRequest(args);
  const source = await loadSourceMessages(request, workspaceRoot);
  const headerContext = extractTranscriptHeaderContext(source.messages);
  const normalized = normalizeMessages(source.messages, localAgentId, request.renderArgs, headerContext);
  if (!normalized.length) throw new Error('no visible transcript messages were found for rendering');

  const selection = selectionSummary(request, normalized.length);
  const width = DEFAULT_WIDTH;
  const maxPageHeight = intValue(request.renderArgs.maxPageHeight, DEFAULT_MAX_PAGE_HEIGHT, 900);
  const header = headerText(request.renderArgs, normalized, headerContext);
  const decorated = decorateSelection(normalized, selection);
  const measured = decorated.map((item) => measureTranscriptItem(item, width));
  const pages = paginateTranscriptItems(measured, width, maxPageHeight, header.title, header.subtitle);
  const currentArtifactId = artifactId(source.summary, selection, CLAWORLD_TRANSCRIPT_STYLE_NAME);
  const directories = outputDirectories(workspaceRoot);
  await Promise.all([fs.mkdir(directories.images, { recursive: true }), fs.mkdir(directories.documents, { recursive: true })]);

  const files = [];
  for (const page of pages) {
    const suffix = `p${String(page.page).padStart(2, '0')}`;
    const svgPath = path.join(directories.documents, `${currentArtifactId}-${suffix}.svg`);
    const pngPath = path.join(directories.images, `${currentArtifactId}-${suffix}.png`);
    const svg = renderTranscriptPageSvg(page);
    await atomicWriteText(svgPath, svg);
    const pngResult = await writePng(svg, pngPath, page);
    files.push({ page: page.page, format: 'svg', path: svgPath, width: page.width, height: page.height, sha256: await sha256(svgPath), role: 'source' });
    files.push({ page: page.page, format: 'png', path: pngPath, width: page.width, height: page.height, sha256: await sha256(pngPath), role: 'primary', renderer: pngResult.renderer });
  }

  const bubbleSpec = {
    version: '1',
    kind: 'claworld.transcript_report',
    scene: {
      title: header.title,
      subtitle: header.subtitle,
      peerId: header.title,
      peerProfile: header.subtitle,
      peerProfileSource: publicHeaderValue(request.renderArgs.peerProfile)
        ? 'explicit'
        : headerContext.profileSource || 'fallback',
      generatedAt: isoNow(),
      source: source.summary,
      selection,
    },
    canvas: { width, style: CLAWORLD_TRANSCRIPT_STYLE_NAME, maxPageHeight },
    participants: participants(normalized),
    messages: decorated.map(bubbleMessagePayload),
  };
  const specPath = path.join(directories.documents, `${currentArtifactId}.bubblespec.json`);
  await atomicWriteJson(specPath, bubbleSpec);

  const pngPages = files.filter((item) => item.format === 'png').map(artifactPage);
  const svgPages = files.filter((item) => item.format === 'svg').map(artifactPage);
  const stats = {
    sourceMessages: source.messages.length,
    normalizedMessages: normalized.length,
    renderedMessages: normalized.length,
    pages: pages.length,
    omittedBefore: selection.omittedBefore || 0,
    omittedAfter: selection.omittedAfter || 0,
  };
  const result = compactObject({
    status: 'ok',
    mode: request.mode,
    chatRequestId: request.mode === 'stored' ? request.chatRequestId : null,
    artifactId: currentArtifactId,
    messageCount: normalized.length,
    pageCount: pages.length,
    style: CLAWORLD_TRANSCRIPT_STYLE_NAME,
    artifacts: {
      bubbleSpec: { format: 'bubblespec', path: specPath, sha256: await sha256(specPath) },
      pngPages,
      svgPages,
    },
    diagnostics: { source: source.summary, stats },
  });
  await appendClaworldJournalEvent(workspaceRoot, {
    kind: 'transcript_report',
    scope: request.mode === 'stored' ? 'conversation' : 'main',
    summary: `Rendered ${normalized.length} visible Claworld transcript messages across ${pages.length} page(s).`,
    refs: { chatRequestId: request.mode === 'stored' ? request.chatRequestId : null },
    artifacts: { artifactId: currentArtifactId, bubbleSpec: specPath, pngPages: pngPages.map((item) => item.path), svgPages: svgPages.map((item) => item.path) },
    maintenance: { selection, stats },
  });
  return result;
}
