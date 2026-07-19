import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createRuntimeBoundaryError } from '../../lib/runtime-errors.js';
import { readClaworldSessionDirectory } from './working-memory.js';
import { renderTranscriptReport } from './transcript-report.js';

const REPORT_LEDGER_SCHEMA = 'claworld.management-report-delivery.v1';
const REPORT_LEDGER_RELATIVE_PATH = path.join(
  '.claworld',
  'reports',
  'management-report-delivery.json',
);
const MAX_REPORT_LEDGER_ENTRIES = 200;
const MAIN_CONTEXT_SYNC_TIMEOUT_MS = 180000;
const REPORT_DELIVERY_QUEUES = new Map();
const REPORT_LEDGER_QUEUES = new Map();

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

function reportBoundaryError({
  code,
  category,
  message,
  recoverable = false,
  context = null,
}) {
  return createRuntimeBoundaryError({
    code,
    category,
    message,
    publicMessage: message,
    recoverable,
    context,
  });
}

function reportInputError(code, message, context = null) {
  return reportBoundaryError({ code, category: 'input', message, context });
}

function reportConflictError(code, message, context = null) {
  return reportBoundaryError({
    code,
    category: 'conflict',
    message,
    recoverable: true,
    context,
  });
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function reportLedgerPath(workspaceRoot) {
  return path.join(workspaceRoot, REPORT_LEDGER_RELATIVE_PATH);
}

function emptyReportLedger() {
  const now = new Date().toISOString();
  return {
    schema: REPORT_LEDGER_SCHEMA,
    version: 1,
    createdAt: now,
    updatedAt: now,
    reports: {},
  };
}

async function readReportLedger(workspaceRoot) {
  try {
    const parsed = JSON.parse(await fs.readFile(reportLedgerPath(workspaceRoot), 'utf8'));
    if (!isObject(parsed)) throw new Error('management report delivery ledger must be a JSON object');
    if (parsed.schema !== REPORT_LEDGER_SCHEMA || parsed.version !== 1) {
      throw new Error('management report delivery ledger has an unsupported schema');
    }
    if (!isObject(parsed.reports)) {
      throw new Error('management report delivery ledger reports must be an object');
    }
    return {
      ...parsed,
      schema: REPORT_LEDGER_SCHEMA,
      version: 1,
      reports: parsed.reports,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyReportLedger();
    throw error;
  }
}

async function atomicWriteReportLedger(workspaceRoot, ledger) {
  const filePath = reportLedgerPath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function pruneReportLedger(reports = {}) {
  const entries = Object.entries(reports);
  if (entries.length <= MAX_REPORT_LEDGER_ENTRIES) return reports;
  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || '')))
      .slice(0, MAX_REPORT_LEDGER_ENTRIES),
  );
}

function withQueue(queueMap, key, operation) {
  const previous = queueMap.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queueMap.set(key, current);
  return current.finally(() => {
    if (queueMap.get(key) === current) queueMap.delete(key);
  });
}

async function updateReportState(workspaceRoot, reportId, update) {
  const queueKey = path.resolve(workspaceRoot);
  return withQueue(REPORT_LEDGER_QUEUES, queueKey, async () => {
    const ledger = await readReportLedger(workspaceRoot);
    const current = isObject(ledger.reports[reportId]) ? ledger.reports[reportId] : {};
    const next = await update({ ...current });
    const now = new Date().toISOString();
    ledger.updatedAt = now;
    ledger.reports = pruneReportLedger({
      ...ledger.reports,
      [reportId]: {
        ...current,
        ...next,
        reportId,
        updatedAt: now,
      },
    });
    await atomicWriteReportLedger(workspaceRoot, ledger);
    return ledger.reports[reportId];
  });
}

async function getReportState(workspaceRoot, reportId) {
  const ledger = await readReportLedger(workspaceRoot);
  return isObject(ledger.reports[reportId]) ? ledger.reports[reportId] : null;
}

function resolveAgentIdFromSessionKey(sessionKey, fallback = null) {
  const match = /^agent:([^:]+):/u.exec(String(sessionKey || ''));
  return text(match?.[1], text(fallback, null));
}

function resolveDeliveryRoute(entry = null) {
  const route = isObject(entry?.deliveryContext) ? entry.deliveryContext : {};
  const channel = text(route.channel, null);
  const to = text(route.to, null);
  if (!channel || !to) return null;
  return compactObject({
    channel,
    to,
    accountId: text(route.accountId, null),
    threadId: route.threadId ?? null,
  });
}

async function resolveMainSessionTarget({ api, workspaceRoot, localAgentId }) {
  const sessionDirectory = await readClaworldSessionDirectory(workspaceRoot);
  const mainSessionKey = text(sessionDirectory.directory?.main?.lastActiveSessionKey, null);
  if (!mainSessionKey) {
    throw reportConflictError(
      'management_report_main_session_missing',
      'Management report needs an active Main Session before it can be delivered.',
    );
  }
  const getSessionEntry = api?.runtime?.agent?.session?.getSessionEntry;
  if (typeof getSessionEntry !== 'function') {
    throw new Error('management report requires the OpenClaw session runtime');
  }
  const agentId = resolveAgentIdFromSessionKey(mainSessionKey, localAgentId);
  const entry = getSessionEntry({
    ...(agentId ? { agentId } : {}),
    sessionKey: mainSessionKey,
    readConsistency: 'latest',
  });
  if (!entry) {
    throw reportConflictError(
      'management_report_main_session_unavailable',
      'The selected Main Session is unavailable. Open a current human-facing Main Session, then retry the same report.',
      { mainSessionKey },
    );
  }
  const route = resolveDeliveryRoute(entry);
  if (!route) {
    throw reportConflictError(
      'management_report_route_missing',
      'The selected Main Session has no human-facing delivery route. Open it from a supported channel, then retry the same report.',
      { mainSessionKey },
    );
  }
  return { mainSessionKey, agentId, route };
}

function normalizeReportSource(input = {}) {
  if (!isObject(input)) throw reportInputError('management_report_source_required', 'management report source is required');
  const kind = text(input.kind, null);
  if (!['conversation', 'notification', 'proactive'].includes(kind)) {
    throw reportInputError('management_report_source_kind_invalid', 'management report source.kind must be conversation, notification, or proactive');
  }
  const id = text(input.id, null);
  if (!id) throw reportInputError('management_report_source_id_required', 'management report source.id is required');
  return compactObject({
    kind,
    id,
    eventName: text(input.eventName, null),
    chatRequestId: text(input.chatRequestId, kind === 'conversation' ? id : null),
  });
}

function normalizeTranscriptRequest(input, chatRequestId) {
  if (input == null) return null;
  const transcript = isObject(input) ? input : {};
  const unsupportedFields = Object.keys(transcript)
    .filter((field) => !['mode', 'topic', 'manual', 'maxPageHeight'].includes(field))
    .sort();
  if (unsupportedFields.length) {
    throw reportInputError(
      'management_report_transcript_field_invalid',
      `management report transcript contains unsupported field(s): ${unsupportedFields.join(', ')}`,
    );
  }
  const mode = text(transcript.mode, null);
  if (!['stored', 'manual'].includes(mode)) {
    throw reportInputError('management_report_transcript_mode_invalid', 'management report transcript.mode must be stored or manual');
  }
  const maxPageHeight = Number.isInteger(transcript.maxPageHeight)
    ? transcript.maxPageHeight
    : null;
  if (mode === 'stored') {
    if (!chatRequestId) {
      throw reportInputError('management_report_chat_request_id_required', 'management report stored transcript requires source.chatRequestId');
    }
    const topic = text(transcript.topic, null);
    if (!topic) {
      throw reportInputError('management_report_transcript_topic_required', 'management report stored transcript requires a topic summarizing the exact episode');
    }
    return compactObject({
      mode,
      chatRequestId,
      topic,
      maxPageHeight,
    });
  }
  if (!isObject(transcript.manual)) {
    throw reportInputError('management_report_manual_transcript_required', 'management report transcript.manual is required for manual mode');
  }
  return compactObject({
    mode,
    manual: transcript.manual,
    maxPageHeight,
  });
}

function buildReportIdentity({ source, reportText, renderArgs }) {
  const sourceIdentity = canonicalValue({ kind: source.kind, id: source.id });
  const request = canonicalValue({ source, reportText, renderArgs });
  const requestFingerprint = sha256Text(JSON.stringify(request));
  const sourceFingerprint = sha256Text(JSON.stringify(sourceIdentity));
  return {
    reportId: `claworld-report-${sourceFingerprint.slice(0, 24)}`,
    requestFingerprint,
  };
}

function buildMainContextMessage({ reportId, source, reportText, renderResult }) {
  const metadata = [
    `Report ID: ${reportId}`,
    `Source kind: ${source.kind}`,
    `Source ID: ${source.id}`,
    ...(source.eventName ? [`Event name: ${source.eventName}`] : []),
    ...(source.chatRequestId ? [`Chat request ID: ${source.chatRequestId}`] : []),
    ...(renderResult ? [
      `Transcript mode: ${renderResult.mode}`,
      `Transcript pages: ${renderResult.pageCount}`,
    ] : []),
  ];
  return [
    '# Claworld Management Report Context',
    '',
    'A Claworld Management Session prepared the following report for your human. Keep this exact report in this Main Session so you can answer later follow-up questions without asking Management to repeat it.',
    '',
    ...metadata,
    '',
    '## Exact report text',
    reportText,
    '',
    renderResult
      ? 'The Claworld plugin owns the human-facing delivery of this text and its transcript pages. Record the context only.'
      : 'The Claworld plugin owns the human-facing delivery of this text. Record the context only.',
  ].join('\n');
}

function buildMainContextSystemPrompt(reportId) {
  return [
    'This is a plugin-owned Claworld report context synchronization turn.',
    'Do not call any tool and do not send any external or human-facing message.',
    'Read and retain the supplied report context in this Main Session.',
    `Reply with exactly CLAWORLD_REPORT_CONTEXT_RECORDED:${reportId}`,
  ].join(' ');
}

function messageTextContent(message = null) {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function messagesContainReportAcknowledgement(messages = [], reportId) {
  const expected = `CLAWORLD_REPORT_CONTEXT_RECORDED:${reportId}`;
  return messages.some((message) => (
    message?.role === 'assistant' && messageTextContent(message) === expected
  ));
}

async function syncReportToMainContext({
  api,
  workspaceRoot,
  mainSessionKey,
  reportId,
  source,
  reportText,
  renderResult,
}) {
  const subagent = api?.runtime?.subagent;
  if (
    typeof subagent?.run !== 'function'
    || typeof subagent?.waitForRun !== 'function'
    || typeof subagent?.getSessionMessages !== 'function'
  ) {
    throw new Error('management report requires the OpenClaw plugin subagent runtime');
  }
  const lane = `claworld-report-context-${sha256Text(mainSessionKey).slice(0, 16)}`;
  const { runId } = await subagent.run({
    sessionKey: mainSessionKey,
    message: buildMainContextMessage({ reportId, source, reportText, renderResult }),
    extraSystemPrompt: buildMainContextSystemPrompt(reportId),
    lane,
    lightContext: true,
    deliver: false,
    idempotencyKey: `${reportId}:main-context`,
    cwd: workspaceRoot,
  });
  const waitResult = await subagent.waitForRun({
    runId,
    timeoutMs: MAIN_CONTEXT_SYNC_TIMEOUT_MS,
  });
  if (waitResult?.status !== 'ok') {
    throw new Error(`management report Main context sync ${waitResult?.status || 'failed'}${waitResult?.error ? `: ${waitResult.error}` : ''}`);
  }
  const session = await subagent.getSessionMessages({ sessionKey: mainSessionKey, limit: 20 });
  if (!messagesContainReportAcknowledgement(session?.messages, reportId)) {
    throw new Error('management report Main context sync completed without the required acknowledgement');
  }
  return { runId, lane };
}

function deliveryReceipt(result = null) {
  if (result?.success === false || result?.ok === false) {
    throw new Error(text(result?.error, 'channel delivery failed'));
  }
  return compactObject({
    kind: text(result?.receipt?.kind, text(result?.kind, null)),
    messageId: text(
      result?.receipt?.messageId,
      text(result?.messageId, text(result?.id, null)),
    ),
  });
}

function routeSendFields(route) {
  return compactObject({
    accountId: route.accountId,
    threadId: route.threadId,
  });
}

function reportToolResult(state, { deduplicated = false } = {}) {
  const pages = Array.isArray(state?.delivery?.pages) ? state.delivery.pages : [];
  return compactObject({
    status: state?.status || 'unknown',
    reportId: state?.reportId,
    source: state?.source,
    chatRequestId: state?.chatRequestId,
    mainSessionKey: state?.mainSessionKey,
    contextSynced: state?.contextSync?.status === 'complete',
    render: isObject(state?.render)
      ? {
        mode: state.render.mode,
        pageCount: state.render.pageCount,
        artifactId: state.render.artifactId,
      }
      : null,
    delivery: {
      textSent: state?.delivery?.text?.status === 'sent',
      pagesSent: pages.filter((page) => page?.status === 'sent').length,
      pageCount: state?.render?.pageCount || pages.length,
    },
    deduplicated,
    instruction: state?.status === 'complete'
      ? 'The report is recorded in Main context and delivered to the human. Finish this Management turn without any second delivery.'
      : null,
  });
}

export async function deliverClaworldManagementReport({
  api,
  cfg,
  workspaceRoot,
  localAgentId = null,
  request = {},
} = {}) {
  if (!workspaceRoot) {
    throw reportInputError('management_report_workspace_required', 'management report requires an OpenClaw workspace');
  }
  const source = normalizeReportSource(request.source);
  const reportText = text(request.reportText, null);
  if (!reportText) throw reportInputError('management_report_text_required', 'management report reportText is required');
  if (source.kind === 'conversation' && request.transcript == null) {
    throw reportInputError('management_report_transcript_required', 'management report conversation source requires a transcript');
  }
  if (request.transcript != null && source.kind !== 'conversation') {
    throw reportInputError('management_report_transcript_not_allowed', 'management report transcript is available only for conversation sources');
  }
  const renderArgs = normalizeTranscriptRequest(request.transcript, source.chatRequestId);
  const identity = buildReportIdentity({
    source,
    reportText,
    renderArgs,
  });
  const queueKey = `${path.resolve(workspaceRoot)}\u0000${identity.reportId}`;

  return withQueue(REPORT_DELIVERY_QUEUES, queueKey, async () => {
    let state = await getReportState(workspaceRoot, identity.reportId);
    if (state?.requestFingerprint && state.requestFingerprint !== identity.requestFingerprint) {
      throw reportConflictError(
        'management_report_source_conflict',
        `Management report source ${source.kind}:${source.id} already has a different report. Retry the original arguments or use a new source id for a new outcome.`,
        { source },
      );
    }
    if (state?.status === 'complete') return reportToolResult(state, { deduplicated: true });
    const target = state?.mainSessionKey && isObject(state?.route)
      ? {
        mainSessionKey: state.mainSessionKey,
        agentId: resolveAgentIdFromSessionKey(state.mainSessionKey, localAgentId),
        route: state.route,
      }
      : await resolveMainSessionTarget({ api, workspaceRoot, localAgentId });

    let renderResult = null;
    if (renderArgs) {
      const recordedPages = Array.isArray(state?.render?.pngPages) ? state.render.pngPages : [];
      const recordedPagesExist = recordedPages.length > 0 && (await Promise.all(
        recordedPages.map((page) => fs.access(page.path).then(() => true).catch(() => false)),
      )).every(Boolean);
      if (recordedPagesExist) {
        renderResult = {
          mode: state.render.mode,
          artifactId: state.render.artifactId,
          pageCount: state.render.pageCount,
          artifacts: { pngPages: recordedPages },
        };
      } else {
        renderResult = await renderTranscriptReport({
          workspaceRoot,
          localAgentId,
          args: renderArgs,
        });
      }
    }

    state = await updateReportState(workspaceRoot, identity.reportId, (current) => ({
      ...current,
      status: current.status || 'prepared',
      requestFingerprint: identity.requestFingerprint,
      source,
      chatRequestId: source.chatRequestId,
      mainSessionKey: target.mainSessionKey,
      route: target.route,
      ...(renderResult ? { render: {
        status: 'complete',
        mode: renderResult.mode,
        artifactId: renderResult.artifactId,
        pageCount: renderResult.pageCount,
        pngPages: renderResult.artifacts.pngPages,
      } } : {}),
      delivery: isObject(current.delivery) ? current.delivery : { pages: [] },
    }));

    if (state?.contextSync?.status !== 'complete') {
      const contextSync = await syncReportToMainContext({
        api,
        workspaceRoot,
        mainSessionKey: target.mainSessionKey,
        reportId: identity.reportId,
        source,
        reportText,
        renderResult,
      });
      state = await updateReportState(workspaceRoot, identity.reportId, (current) => ({
        ...current,
        status: 'context_synced',
        contextSync: {
          status: 'complete',
          runId: contextSync.runId,
          lane: contextSync.lane,
          completedAt: new Date().toISOString(),
        },
      }));
    }

    const loadAdapter = api?.runtime?.channel?.outbound?.loadAdapter;
    if (typeof loadAdapter !== 'function') {
      throw new Error('management report requires the OpenClaw channel outbound runtime');
    }
    const adapter = await loadAdapter(target.route.channel);
    if (typeof adapter?.sendText !== 'function') {
      throw new Error(`management report text delivery is unavailable for channel ${target.route.channel}`);
    }
    if (renderResult && typeof adapter?.sendMedia !== 'function') {
      throw new Error(`management report media delivery is unavailable for channel ${target.route.channel}`);
    }
    const routeFields = routeSendFields(target.route);

    if (state?.delivery?.text?.status !== 'sent') {
      const result = await adapter.sendText({
        cfg,
        to: target.route.to,
        text: reportText,
        ...routeFields,
      });
      const receipt = deliveryReceipt(result);
      state = await updateReportState(workspaceRoot, identity.reportId, (current) => ({
        ...current,
        status: 'delivering',
        delivery: {
          ...(isObject(current.delivery) ? current.delivery : {}),
          text: {
            status: 'sent',
            sentAt: new Date().toISOString(),
            receipt,
          },
          pages: Array.isArray(current.delivery?.pages) ? current.delivery.pages : [],
        },
      }));
    }

    for (const page of renderResult?.artifacts?.pngPages || []) {
      const deliveredPages = Array.isArray(state?.delivery?.pages) ? state.delivery.pages : [];
      if (deliveredPages.some((entry) => entry?.page === page.page && entry?.sha256 === page.sha256 && entry?.status === 'sent')) {
        continue;
      }
      const result = await adapter.sendMedia({
        cfg,
        to: target.route.to,
        text: '',
        mediaUrl: page.path,
        forceDocument: true,
        ...routeFields,
      });
      const receipt = deliveryReceipt(result);
      state = await updateReportState(workspaceRoot, identity.reportId, (current) => {
        const pages = Array.isArray(current.delivery?.pages) ? [...current.delivery.pages] : [];
        const nextPage = {
          page: page.page,
          sha256: page.sha256,
          status: 'sent',
          sentAt: new Date().toISOString(),
          receipt,
        };
        const existingIndex = pages.findIndex((entry) => entry?.page === page.page && entry?.sha256 === page.sha256);
        if (existingIndex >= 0) pages[existingIndex] = nextPage;
        else pages.push(nextPage);
        return {
          ...current,
          status: 'delivering',
          delivery: {
            ...(isObject(current.delivery) ? current.delivery : {}),
            pages,
          },
        };
      });
    }

    state = await updateReportState(workspaceRoot, identity.reportId, (current) => ({
      ...current,
      status: 'complete',
      completedAt: new Date().toISOString(),
    }));
    return reportToolResult(state);
  });
}
