import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { registerClaworldPlugin } from '../src/openclaw/index.js';
import {
  augmentConversationPayloadWithLocalTranscriptIndex,
  recordClaworldTranscriptEpisode,
  renderTranscriptReport,
} from '../src/openclaw/runtime/transcript-report.js';
import {
  ensureClaworldWorkingMemory,
  updateClaworldSessionDirectory,
} from '../src/openclaw/runtime/working-memory.js';

function indexedKickoffText() {
  return [
    'Start this Claworld conversation and reply naturally.',
    '',
    '# Background',
    '',
    '## Conversation Facts',
    '- Mode: `world`',
    '- World: 暮色档案室-0710 (`wld-private-01`)',
    '',
    '## Participant Facts',
    '',
    '## You',
    '- Identity: `Mira#LOCAL01`',
    '',
    '### Global Profile',
    '```text',
    'Mira public profile',
    '```',
    '',
    '## Peer',
    '- Identity: `Peer Direct#PEER01`',
    '',
    '### Global Profile',
    '```text',
    'structured global profile',
    '```',
    '',
    '### World Membership Profile',
    '```text',
    'structured world profile',
    '```',
  ].join('\n');
}

async function seedStoredEpisode(workspaceRoot) {
  await recordClaworldTranscriptEpisode(workspaceRoot, {
    chatRequestId: 'req-new',
    deliveryId: 'new-kickoff',
    localSessionKey: 'agent:main:claworld:conversation:pair-a-b',
    relaySessionKey: 'conversation:pair-a-b',
    conversationKey: 'pair:a::b:world:wld-private-01',
    worldId: 'wld-private-01',
    targetAgentId: 'agent-peer',
    fromAgentId: 'agent-peer',
    fromDisplayIdentity: 'Peer Direct#PEER01',
    localAgentId: 'agent-local',
    deliveryType: 'kickoff',
    commandText: indexedKickoffText(),
    createdAt: '2026-07-09T17:00:00Z',
  });
  await recordClaworldTranscriptEpisode(workspaceRoot, {
    chatRequestId: 'req-new',
    deliveryId: 'new-1',
    localSessionKey: 'agent:main:claworld:conversation:pair-a-b',
    relaySessionKey: 'conversation:pair-a-b',
    conversationKey: 'pair:a::b:world:wld-private-01',
    worldId: 'wld-private-01',
    targetAgentId: 'agent-peer',
    fromAgentId: 'agent-peer',
    localAgentId: 'agent-local',
    deliveryType: 'turn',
    commandText: 'new peer hello user@example.com [[like]]',
    createdAt: '2026-07-09T17:01:00Z',
    replyText: 'new local reply api_key=secret-value',
    replyCreatedAt: '2026-07-09T17:01:01Z',
  });
  await recordClaworldTranscriptEpisode(workspaceRoot, {
    chatRequestId: 'req-new',
    deliveryId: 'notice-1',
    localSessionKey: 'agent:main:claworld:conversation:pair-a-b',
    relaySessionKey: 'conversation:pair-a-b',
    conversationKey: 'pair:a::b:world:wld-private-01',
    worldId: 'wld-private-01',
    targetAgentId: 'agent-peer',
    fromAgentId: 'agent-peer',
    localAgentId: 'agent-local',
    deliveryType: 'turn',
    commandText: '◐ Session automatically reset (inactive for 24h). Conversation history cleared.',
    createdAt: '2026-07-09T17:02:00Z',
  });
  for (let index = 0; index < 2; index += 1) {
    await recordClaworldTranscriptEpisode(workspaceRoot, {
      chatRequestId: 'req-new',
      deliveryId: 'new-2',
      localSessionKey: 'agent:main:claworld:conversation:pair-a-b',
      relaySessionKey: 'conversation:pair-a-b',
      conversationKey: 'pair:a::b:world:wld-private-01',
      worldId: 'wld-private-01',
      targetAgentId: 'agent-peer',
      fromAgentId: 'agent-peer',
      localAgentId: 'agent-local',
      deliveryType: 'turn',
      commandText: 'new peer final [[request_conversation_end]]',
      createdAt: '2026-07-09T17:03:00Z',
      replyText: 'new local final [[request_conversation_end]]',
      replyCreatedAt: '2026-07-09T17:03:01Z',
    });
  }
}

async function assertStoredRendering(workspaceRoot) {
  await seedStoredEpisode(workspaceRoot);
  const index = JSON.parse(await fs.readFile(path.join(workspaceRoot, '.claworld', 'sessions', 'index.json'), 'utf8'));
  assert.equal(index.conversationEpisodes['req-new'].lastSeenAt, '2026-07-09T17:03:01Z');
  const report = await renderTranscriptReport({
    workspaceRoot,
    localAgentId: 'agent-local',
    args: { mode: 'stored', stored: { chatRequestId: 'req-new' } },
  });
  assert.equal(report.mode, 'stored');
  assert.equal(report.chatRequestId, 'req-new');
  assert.equal(report.messageCount, 4);
  assert.equal(report.pageCount, report.artifacts.pngPages.length);
  assert.equal('delivery' in report, false);
  assert.equal('deliveryHint' in report, false);
  assert.ok(report.artifacts.pngPages.every((page) => path.isAbsolute(page.path)));
  assert.ok(report.artifacts.svgPages.every((page) => path.isAbsolute(page.path)));
  assert.ok(report.artifacts.pngPages.every((page) => !('mediaRef' in page)));

  const spec = JSON.parse(await fs.readFile(report.artifacts.bubbleSpec.path, 'utf8'));
  const serialized = JSON.stringify(spec);
  assert.equal(spec.canvas.maxPageHeight, 8000);
  assert.ok(report.artifacts.pngPages.every((page) => page.height <= 8000));
  assert.equal(spec.scene.peerId, 'Peer Direct — 暮色档案室-0710');
  assert.equal(spec.scene.peerProfile, 'Peer Direct#PEER01 · structured world profile');
  assert.equal(spec.scene.peerProfileSource, 'rawKickoffText');
  assert.deepEqual(new Set(spec.participants.map((item) => item.name)), new Set(['Mira#LOCAL01', 'Peer Direct#PEER01']));
  assert.ok(serialized.includes('new peer hello'));
  assert.ok(serialized.includes('new local reply'));
  assert.ok(serialized.includes('"like"'));
  assert.ok(serialized.includes('"request end"'));
  assert.ok(serialized.includes('[redacted-email]'));
  assert.ok(serialized.includes('api_key=[redacted]'));
  assert.equal(serialized.includes('secret-value'), false);
  assert.equal(serialized.includes('Start this Claworld conversation'), false);
  assert.equal(serialized.includes('Session automatically reset'), false);

  const visibleSvg = (await Promise.all(
    report.artifacts.svgPages.map((page) => fs.readFile(page.path, 'utf8')),
  )).join('\n');
  for (const internalValue of ['req-new', 'pair:a::b:world:wld-private-01', 'agent-local']) {
    assert.equal(visibleSvg.includes(internalValue), false);
  }

  const overridden = await renderTranscriptReport({
    workspaceRoot,
    localAgentId: 'agent-local',
    args: {
      mode: 'stored',
      stored: {
        chatRequestId: 'req-new',
        title: 'Moza — 老友重逢聊搭桥',
        peerProfile: 'Moza#Z99TMV · 帮 rx 打理 Claworld',
        localLabel: 'Mira',
        peerLabel: 'Moza',
      },
    },
  });
  const overriddenSpec = JSON.parse(await fs.readFile(overridden.artifacts.bubbleSpec.path, 'utf8'));
  assert.equal(overriddenSpec.scene.title, 'Moza — 老友重逢聊搭桥');
  assert.equal(overriddenSpec.scene.subtitle, 'Moza#Z99TMV · 帮 rx 打理 Claworld');
  assert.equal(overriddenSpec.scene.peerProfileSource, 'explicit');
  assert.deepEqual(new Set(overriddenSpec.participants.map((item) => item.name)), new Set(['Mira', 'Moza']));

  const pngMetadata = await sharp(report.artifacts.pngPages[0].path).metadata();
  assert.equal(pngMetadata.format, 'png');
  assert.equal(pngMetadata.width, 720);
  assert.equal(pngMetadata.height, report.artifacts.pngPages[0].height);

  const augmented = await augmentConversationPayloadWithLocalTranscriptIndex({
    workspaceRoot,
    payload: {
      status: 'ok',
      items: [{ chatRequestId: 'req-new', conversationKey: 'pair:a::b:world:wld-private-01' }],
    },
    filters: { chatRequestId: 'req-new' },
  });
  assert.equal(augmented.localTranscriptSummary.episodeCount, 1);
  assert.equal(augmented.localTranscriptEpisodes[0].renderableMessages, 4);
  assert.equal(augmented.localTranscriptEpisodes[0].peerMessages, 2);
  assert.equal(augmented.localTranscriptEpisodes[0].localMessages, 2);
  assert.deepEqual(augmented.localTranscriptEpisode.messages.map((message) => message.from), [
    'peer',
    'local',
    'peer',
    'local',
  ]);
  assert.equal(augmented.localTranscriptEpisode.messages.length, 4);
  assert.ok(augmented.localTranscriptEpisode.messages.every((message) => message.text));
  assert.ok(augmented.localTranscriptEpisode.messages[0].text.includes('[redacted-email]'));
  assert.deepEqual(augmented.localTranscriptEpisode.messages[0].tags, ['like']);
  assert.ok(augmented.localTranscriptEpisode.messages[1].text.includes('api_key=[redacted]'));
  assert.equal(augmented.localTranscriptEpisode.messages[1].text.includes('secret-value'), false);
  assert.deepEqual(augmented.localTranscriptEpisode.messages[2].tags, ['request end']);
  assert.equal(augmented.items[0].localTranscriptEpisodes[0].chatRequestId, 'req-new');
}

async function assertManualPagination(workspaceRoot) {
  const messages = [];
  for (let index = 0; index < 12; index += 1) {
    messages.push(
      {
        from: 'peer',
        text: `Round ${index + 1}: peer message with 中文 and enough English text to wrap cleanly.`,
        createdAt: new Date(1_700_000_000_000 + index * 360_000).toISOString(),
      },
      {
        from: 'local',
        text: 'Local response with enough detail to exercise visual pagination.',
        createdAt: new Date(1_700_000_001_000 + index * 360_000).toISOString(),
      },
    );
  }
  const report = await renderTranscriptReport({
    workspaceRoot,
    localAgentId: 'agent-local',
    args: {
      mode: 'manual',
      manual: {
        title: 'Paging test',
        peerProfile: 'Peer profile',
        localLabel: 'local-agent',
        peerLabel: 'peer-agent',
        messages,
      },
      maxPageHeight: 980,
    },
  });
  assert.ok(report.pageCount >= 2);
  assert.equal(report.pageCount, report.artifacts.pngPages.length);
  assert.equal(report.pageCount, report.artifacts.svgPages.length);
  assert.ok(report.artifacts.pngPages.every((page) => path.isAbsolute(page.path)));
  assert.ok(report.artifacts.pngPages.every((page) => page.height <= 980));
}

async function assertPageHeightHardLimit(workspaceRoot) {
  const report = await renderTranscriptReport({
    workspaceRoot,
    localAgentId: 'agent-local',
    args: {
      mode: 'manual',
      manual: {
        title: 'Tall transcript test',
        peerProfile: 'Peer profile',
        localLabel: 'local-agent',
        peerLabel: 'peer-agent',
        messages: [
          {
            from: 'peer',
            text: Array.from({ length: 280 }, (_, index) => `line ${index + 1}`).join('\n'),
            createdAt: '2026-07-15T09:00:00Z',
          },
        ],
      },
      maxPageHeight: 12000,
    },
  });
  assert.equal(report.pageCount, 1);
  assert.ok(report.artifacts.pngPages[0].height > 8000);
  assert.ok(report.artifacts.pngPages[0].height <= 12000);
  const spec = JSON.parse(await fs.readFile(report.artifacts.bubbleSpec.path, 'utf8'));
  assert.equal(spec.canvas.maxPageHeight, 12000);

  const capped = await renderTranscriptReport({
    workspaceRoot,
    localAgentId: 'agent-local',
    args: {
      mode: 'manual',
      manual: {
        title: 'Capped transcript test',
        peerProfile: 'Peer profile',
        localLabel: 'local-agent',
        peerLabel: 'peer-agent',
        messages: [
          {
            from: 'peer',
            text: 'A short message keeps the rendered page adaptive.',
            createdAt: '2026-07-15T09:01:00Z',
          },
        ],
      },
      maxPageHeight: 300000,
    },
  });
  const cappedSpec = JSON.parse(await fs.readFile(capped.artifacts.bubbleSpec.path, 'utf8'));
  assert.equal(cappedSpec.canvas.maxPageHeight, 32000);
  assert.ok(capped.artifacts.pngPages[0].height < 32000);
}

async function assertConcurrentSessionIndexWrites(workspaceRoot) {
  await ensureClaworldWorkingMemory(workspaceRoot);
  const episodeCount = 24;
  const directoryCount = 24;
  const sharedDeliveryCount = 24;
  const episodeWrites = Array.from({ length: episodeCount }, (_, index) => (
    recordClaworldTranscriptEpisode(workspaceRoot, {
      chatRequestId: `concurrent-episode-${index}`,
      deliveryId: `concurrent-delivery-${index}`,
      localSessionKey: `agent:main:claworld:conversation:concurrent-${index}`,
      relaySessionKey: `conversation:concurrent-${index}`,
      conversationKey: `pair:concurrent-${index}`,
      localAgentId: 'agent-local',
      deliveryType: 'turn',
      commandText: `concurrent peer message ${index}`,
      createdAt: `2026-07-15T10:${String(index).padStart(2, '0')}:00Z`,
    })
  ));
  const directoryWrites = Array.from({ length: directoryCount }, (_, index) => (
    updateClaworldSessionDirectory(workspaceRoot, {
      timestamp: `2026-07-15T11:${String(index).padStart(2, '0')}:00Z`,
      source: 'unit',
      scope: 'conversation',
      relations: {
        chatRequestId: `concurrent-directory-request-${index}`,
        localSessionKey: `agent:main:conversation:directory-${index}`,
        relaySessionKey: `conversation:directory-${index}`,
        conversationKey: `pair:directory-${index}`,
        localAgentId: 'agent-local',
        sessionId: `directory-session-${index}`,
      },
    })
  ));
  const sharedEpisodeWrites = Array.from({ length: sharedDeliveryCount }, (_, index) => (
    recordClaworldTranscriptEpisode(workspaceRoot, {
      chatRequestId: 'concurrent-shared-episode',
      deliveryId: `concurrent-shared-delivery-${index}`,
      localSessionKey: 'agent:main:claworld:conversation:concurrent-shared',
      relaySessionKey: 'conversation:concurrent-shared',
      conversationKey: 'pair:concurrent-shared',
      localAgentId: 'agent-local',
      deliveryType: 'turn',
      commandText: `shared peer message ${index}`,
      createdAt: `2026-07-15T12:${String(index).padStart(2, '0')}:00Z`,
    })
  ));

  await Promise.all([...episodeWrites, ...directoryWrites, ...sharedEpisodeWrites]);

  const index = JSON.parse(await fs.readFile(
    path.join(workspaceRoot, '.claworld', 'sessions', 'index.json'),
    'utf8',
  ));
  for (let current = 0; current < episodeCount; current += 1) {
    assert.ok(index.conversationEpisodes[`concurrent-episode-${current}`]);
  }
  for (let current = 0; current < directoryCount; current += 1) {
    assert.ok(index.conversationSessions[`agent:main:conversation:directory-${current}`]);
  }
  assert.equal(
    index.conversationEpisodes['concurrent-shared-episode'].deliveryCount,
    sharedDeliveryCount,
  );
}

async function assertSafeStoredHeaderFallback(workspaceRoot) {
  await recordClaworldTranscriptEpisode(workspaceRoot, {
    chatRequestId: 'req-fallback',
    deliveryId: 'fallback-1',
    localSessionKey: 'agent:main:claworld:conversation:fallback',
    relaySessionKey: 'conversation:fallback',
    conversationKey: 'conversation-private',
    targetAgentId: 'agt_peer',
    fromAgentId: 'agt_peer',
    localAgentId: 'agt_internal',
    deliveryType: 'turn',
    commandText: 'peer message',
    createdAt: '2026-07-10T04:14:24Z',
    replyText: 'local reply',
    replyCreatedAt: '2026-07-10T04:14:25Z',
  });
  const report = await renderTranscriptReport({
    workspaceRoot,
    localAgentId: 'agt_internal',
    args: {
      mode: 'stored',
      stored: {
        chatRequestId: 'req-fallback',
        title: 'req-fallback',
        peerProfile: 'conversation-private',
        localLabel: 'agt_internal',
        peerLabel: 'agt_peer',
      },
    },
  });
  const spec = JSON.parse(await fs.readFile(report.artifacts.bubbleSpec.path, 'utf8'));
  assert.equal(spec.scene.title, 'Peer');
  assert.equal(spec.scene.subtitle, 'Peer');
  assert.deepEqual(new Set(spec.participants.map((item) => item.name)), new Set(['Me', 'Peer']));
  const visibleSvg = (await Promise.all(
    report.artifacts.svgPages.map((page) => fs.readFile(page.path, 'utf8')),
  )).join('\n');
  for (const internalValue of ['req-fallback', 'conversation-private', 'agt_internal', 'agt_peer']) {
    assert.equal(visibleSvg.includes(internalValue), false);
  }
}

async function assertToolIsGenerationOnly(workspaceRoot) {
  const toolFactories = new Map();
  const tools = [];
  let outboundAdapterLoads = 0;
  const cfg = {
    agents: { list: [{ id: 'agent-local', workspace: workspaceRoot }] },
  };
  const toolContext = {
    workspaceRoot,
    agentId: 'agent-local',
    messageChannel: 'feishu',
    deliveryContext: { channel: 'feishu', to: 'chat:owner', accountId: 'default' },
    getRuntimeConfig: () => cfg,
  };
  registerClaworldPlugin({
    registerChannel() {},
    registerHttpRoute() {},
    registerTool(tool, options) {
      if (typeof tool === 'function') {
        toolFactories.set(options.name, tool);
        tools.push(tool(toolContext));
      } else {
        tools.push(tool);
      }
    },
    config: { async loadConfig() { return cfg; } },
    runtime: {
      channel: {
        outbound: {
          async loadAdapter() {
            outboundAdapterLoads += 1;
            throw new Error('transcript renderer must not load a channel adapter');
          },
        },
      },
    },
  });
  assert.ok(toolFactories.has('claworld_render_transcript_report'));
  const renderTool = tools.find((tool) => tool.name === 'claworld_render_transcript_report');
  const result = await renderTool.execute('render-main', {
    mode: 'manual',
    manual: {
      title: 'Direct delivery',
      peerProfile: 'Peer profile',
      localLabel: 'local',
      peerLabel: 'peer',
      messages: [
        { from: 'peer', text: 'show this as an image', createdAt: '2026-07-13T09:00:00Z' },
        { from: 'local', text: 'delivered', createdAt: '2026-07-13T09:00:01Z' },
      ],
    },
  });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.status, 'ok');
  assert.equal('delivery' in payload, false);
  assert.equal('deliveryHint' in payload, false);
  assert.ok(payload.artifacts.pngPages.every((item) => path.isAbsolute(item.path)));
  assert.equal(outboundAdapterLoads, 0);

  const managementTool = toolFactories.get('claworld_render_transcript_report')({
    ...toolContext,
    sessionKey: 'agent:main:management:agent-local',
    messageChannel: 'claworld',
    deliveryContext: { channel: 'claworld', to: 'management:agent-local', accountId: 'claworld' },
  });
  assert.equal(managementTool, null);
  assert.equal(outboundAdapterLoads, 0);
}

async function assertFirstClassManagementReporting(workspaceRoot) {
  const mainSessionKey = 'agent:main:feishu:direct:user-owner';
  await updateClaworldSessionDirectory(workspaceRoot, {
    timestamp: '2026-07-18T01:00:00Z',
    source: 'unit',
    scope: 'main',
    relations: {
      localSessionKey: mainSessionKey,
      sessionKey: mainSessionKey,
      localAgentId: 'main',
    },
  });

  const toolFactories = new Map();
  const events = [];
  const contextRuns = [];
  let mediaCallCount = 0;
  let failMediaCall = null;
  const cfg = { agents: { list: [{ id: 'main', workspace: workspaceRoot }] } };
  const toolContext = {
    workspaceRoot,
    agentId: 'main',
    sessionKey: 'agent:main:management:agent-local',
    messageChannel: 'claworld',
    deliveryContext: { channel: 'claworld', to: 'management:agent-local' },
    getRuntimeConfig: () => cfg,
  };

  registerClaworldPlugin({
    registerChannel() {},
    registerHttpRoute() {},
    registerTool(tool, options) {
      if (typeof tool === 'function') toolFactories.set(options.name, tool);
    },
    config: { async loadConfig() { return cfg; } },
    runtime: {
      agent: {
        session: {
          getSessionEntry(params) {
            events.push({ kind: 'session.get', params });
            assert.equal(params.sessionKey, mainSessionKey);
            assert.equal(params.agentId, 'main');
            return {
              sessionId: 'main-session-id',
              updatedAt: Date.now(),
              deliveryContext: {
                channel: 'feishu',
                to: 'user:owner',
                accountId: 'default',
                threadId: 'thread-1',
              },
            };
          },
        },
      },
      subagent: {
        async run(params) {
          events.push({ kind: 'context.run', params });
          contextRuns.push(params);
          return { runId: `context-run-${contextRuns.length}` };
        },
        async waitForRun(params) {
          events.push({ kind: 'context.wait', params });
          return { status: 'ok' };
        },
        async getSessionMessages(params) {
          events.push({ kind: 'context.messages', params });
          const reportId = /Report ID: (claworld-report-[a-f0-9]+)/u.exec(contextRuns.at(-1).message)?.[1];
          return {
            messages: [{
              role: 'assistant',
              content: [{
                type: 'text',
                text: `CLAWORLD_REPORT_CONTEXT_RECORDED:${reportId}`,
              }],
            }],
          };
        },
      },
      channel: {
        outbound: {
          async loadAdapter(channel) {
            events.push({ kind: 'adapter.load', channel });
            assert.equal(channel, 'feishu');
            return {
              deliveryMode: 'direct',
              async sendText(input) {
                events.push({ kind: 'delivery.text', input });
                return {
                  success: true,
                  receipt: { kind: 'text', messageId: `text-${events.length}` },
                };
              },
              async sendMedia(input) {
                mediaCallCount += 1;
                events.push({ kind: 'delivery.media', input, mediaCallCount });
                if (mediaCallCount === failMediaCall) {
                  return { success: false, error: 'injected page delivery failure' };
                }
                return {
                  success: true,
                  receipt: { kind: 'document', messageId: `media-${mediaCallCount}` },
                };
              },
            };
          },
        },
      },
    },
  });

  const reportTool = toolFactories.get('claworld_report_to_human')(toolContext);
  const storedRequest = {
    accountId: 'claworld',
    source: {
      kind: 'conversation',
      id: 'req-new',
      eventName: 'conversation_ended',
    },
    reportText: '刚和 Peer 聊完这轮。他提出了一个值得继续追的合作方向；最有意思的一句是：“下周我可以带着原型再来聊。”',
    transcript: { mode: 'stored' },
  };
  const first = JSON.parse((await reportTool.execute('report-stored', storedRequest)).content[0].text);
  assert.equal(first.status, 'complete');
  assert.equal(first.contextSynced, true);
  assert.equal(first.delivery.textSent, true);
  assert.equal(first.delivery.pagesSent, first.delivery.pageCount);
  assert.equal(first.deduplicated, false);
  assert.equal(first.mainSessionKey, mainSessionKey);
  assert.match(first.reportId, /^claworld-report-[a-f0-9]{24}$/u);

  const firstKinds = events.map((event) => event.kind);
  assert.deepEqual(firstKinds, [
    'session.get',
    'context.run',
    'context.wait',
    'context.messages',
    'adapter.load',
    'delivery.text',
    'delivery.media',
  ]);
  const firstContext = contextRuns[0];
  assert.equal(firstContext.sessionKey, mainSessionKey);
  assert.equal(firstContext.deliver, false);
  assert.equal(firstContext.lightContext, true);
  assert.equal(firstContext.idempotencyKey, `${first.reportId}:main-context`);
  assert.match(firstContext.lane, /^claworld-report-context-/u);
  assert.ok(firstContext.message.includes(storedRequest.reportText));
  assert.ok(firstContext.message.includes('# Claworld Management Report Context'));
  assert.ok(firstContext.message.includes('Source kind: conversation'));
  assert.ok(firstContext.message.includes('req-new'));
  assert.ok(firstContext.extraSystemPrompt.includes('Do not call any tool'));
  const firstText = events.find((event) => event.kind === 'delivery.text').input;
  assert.equal(firstText.text, storedRequest.reportText);
  assert.equal(firstText.to, 'user:owner');
  assert.equal(firstText.accountId, 'default');
  assert.equal(firstText.threadId, 'thread-1');
  const firstMedia = events.find((event) => event.kind === 'delivery.media').input;
  assert.equal(firstMedia.forceDocument, true);
  assert.equal(firstMedia.to, 'user:owner');
  assert.ok(path.isAbsolute(firstMedia.mediaUrl));

  const eventCountAfterFirst = events.length;
  const duplicate = JSON.parse((await reportTool.execute('report-stored-duplicate', storedRequest)).content[0].text);
  assert.equal(duplicate.status, 'complete');
  assert.equal(duplicate.reportId, first.reportId);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(events.length, eventCountAfterFirst);

  const notificationRequest = {
    accountId: 'claworld',
    source: {
      kind: 'notification',
      id: 'world.broadcast_published:brd-world-broadcast-1',
      eventName: 'world.broadcast_published',
    },
    reportText: '问号剧场刚发了一条新公告：周末会开放一轮即兴对战，想参加的话我可以帮你报名。',
  };
  const notificationMediaStart = mediaCallCount;
  const notificationTextStart = events.filter((event) => event.kind === 'delivery.text').length;
  const notificationContextStart = contextRuns.length;
  const notification = JSON.parse((await reportTool.execute('report-notification', notificationRequest)).content[0].text);
  assert.equal(notification.status, 'complete');
  assert.equal(notification.source.kind, 'notification');
  assert.equal(notification.source.id, 'world.broadcast_published:brd-world-broadcast-1');
  assert.equal(notification.contextSynced, true);
  assert.equal(notification.delivery.textSent, true);
  assert.equal(notification.delivery.pageCount, 0);
  assert.equal(notification.delivery.pagesSent, 0);
  assert.equal(mediaCallCount, notificationMediaStart);
  assert.equal(events.filter((event) => event.kind === 'delivery.text').length, notificationTextStart + 1);
  assert.equal(contextRuns.length, notificationContextStart + 1);
  assert.ok(contextRuns.at(-1).message.includes('Source kind: notification'));
  assert.ok(contextRuns.at(-1).message.includes('Event name: world.broadcast_published'));
  assert.equal(contextRuns.at(-1).message.includes('Transcript pages:'), false);

  const notificationEventCount = events.length;
  const notificationDuplicate = JSON.parse((await reportTool.execute('report-notification-duplicate', notificationRequest)).content[0].text);
  assert.equal(notificationDuplicate.status, 'complete');
  assert.equal(notificationDuplicate.deduplicated, true);
  assert.equal(events.length, notificationEventCount);

  const notificationConflict = JSON.parse((await reportTool.execute('report-notification-conflict', {
    ...notificationRequest,
    reportText: '同一个通知被改写成另一段文字。',
  })).content[0].text);
  assert.equal(notificationConflict.status, 'error');
  assert.equal(notificationConflict.code, 'management_report_source_conflict');
  assert.match(notificationConflict.message, /already has a different report/u);
  assert.equal(events.length, notificationEventCount);

  const manualMessages = Array.from({ length: 24 }, (_, index) => ({
    from: index % 2 === 0 ? 'peer' : 'local',
    text: `Selected highlight ${index + 1}: ${'a detailed visible excerpt '.repeat(5)}`,
    createdAt: new Date(Date.parse('2026-07-18T02:00:00Z') + index * 1000).toISOString(),
  }));
  const manualRequest = {
    source: {
      kind: 'conversation',
      id: 'req-manual',
      eventName: 'conversation_ended',
    },
    reportText: '这次挑了关键片段给你看。对方那句“先把体验做稳，再谈规模”很准确，我建议下轮直接追问验证指标。',
    transcript: {
      mode: 'manual',
      manual: {
        title: '关键片段',
        peerProfile: '一次关于产品验证的交流',
        localLabel: 'Mira',
        peerLabel: 'Peer',
        messages: manualMessages,
      },
      maxPageHeight: 900,
    },
  };
  const mediaStart = mediaCallCount;
  const textStart = events.filter((event) => event.kind === 'delivery.text').length;
  const contextStart = contextRuns.length;
  failMediaCall = mediaStart + 2;
  const partial = JSON.parse((await reportTool.execute('report-manual-partial', manualRequest)).content[0].text);
  assert.equal(partial.status, 'error');
  assert.equal(partial.message, 'tool execution failed');
  assert.equal(events.filter((event) => event.kind === 'delivery.text').length, textStart + 1);
  assert.equal(contextRuns.length, contextStart + 1);

  failMediaCall = null;
  const resumed = JSON.parse((await reportTool.execute('report-manual-resume', manualRequest)).content[0].text);
  assert.equal(resumed.status, 'complete');
  assert.ok(resumed.delivery.pageCount > 1);
  assert.equal(resumed.delivery.pagesSent, resumed.delivery.pageCount);
  assert.equal(events.filter((event) => event.kind === 'delivery.text').length, textStart + 1);
  assert.equal(contextRuns.length, contextStart + 1);
  const manualMediaEvents = events
    .filter((event) => event.kind === 'delivery.media')
    .slice(mediaStart);
  assert.equal(manualMediaEvents.length, resumed.delivery.pageCount + 1);
  assert.notEqual(manualMediaEvents[0].input.mediaUrl, firstMedia.mediaUrl);

  const ledger = JSON.parse(await fs.readFile(
    path.join(workspaceRoot, '.claworld', 'reports', 'management-report-delivery.json'),
    'utf8',
  ));
  assert.equal(ledger.schema, 'claworld.management-report-delivery.v1');
  assert.equal(ledger.reports[first.reportId].status, 'complete');
  assert.equal(ledger.reports[notification.reportId].status, 'complete');
  assert.equal(ledger.reports[resumed.reportId].status, 'complete');
  assert.equal(Object.prototype.hasOwnProperty.call(ledger.reports[first.reportId], 'reportText'), false);

  const noRouteRoot = path.join(workspaceRoot, 'no-main-route');
  await ensureClaworldWorkingMemory(noRouteRoot);
  const eventCountBeforeMissingRoute = events.length;
  const noRouteTool = toolFactories.get('claworld_report_to_human')({
    ...toolContext,
    workspaceRoot: noRouteRoot,
  });
  const missingRoute = JSON.parse((await noRouteTool.execute('report-no-route', {
    source: {
      kind: 'conversation',
      id: 'req-missing-route',
      eventName: 'conversation_ended',
    },
    reportText: '这条报告应该在缺少 Main route 时明确失败。',
    transcript: {
      mode: 'manual',
      manual: {
        title: 'Route check',
        peerProfile: 'Route check',
        localLabel: 'local',
        peerLabel: 'peer',
        messages: [{
          from: 'peer',
          text: 'route check',
          createdAt: '2026-07-18T03:00:00Z',
        }],
      },
    },
  })).content[0].text);
  assert.equal(missingRoute.status, 'error');
  assert.equal(missingRoute.code, 'management_report_main_session_missing');
  assert.match(missingRoute.message, /active Main Session/u);
  assert.equal(events.length, eventCountBeforeMissingRoute);
}

async function assertSessionSkillDeliveryContracts() {
  const [mainSkill, managementSkill] = await Promise.all([
    fs.readFile(new URL('../skills/claworld-main-session/SKILL.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../skills/claworld-management-session/SKILL.md', import.meta.url), 'utf8'),
  ]);
  const compactMainSkill = mainSkill.replace(/\s+/gu, ' ');
  const compactManagementSkill = managementSkill.replace(/\s+/gu, ' ');
  assert.match(compactMainSkill, /message\(action=send, media=<absolute PNG path>, forceDocument=true\)/u);
  assert.match(compactMainSkill, /read every `artifacts\.pngPages\[\]\.path` value in page order/u);
  assert.match(compactMainSkill, /Send every rendered page/u);
  assert.match(compactMainSkill, /up to 8000px per page by default/u);
  assert.match(compactMainSkill, /values from 900px through 32000px/u);
  assert.match(compactManagementSkill, /make one `claworld_report_to_human` call/u);
  assert.match(compactManagementSkill, /reads the authoritative `main\.lastActiveSessionKey`/u);
  assert.match(compactManagementSkill, /accepts no Main `sessionKey`, channel, target, account, thread, or PNG path/u);
  assert.match(compactManagementSkill, /Choose `transcript\.mode=stored` for the complete episode/u);
  assert.match(compactManagementSkill, /Choose `transcript\.mode=manual` for an intentional set/u);
  assert.match(compactManagementSkill, /contextSynced=true/u);
  assert.match(compactManagementSkill, /retry the same `claworld_report_to_human` arguments/u);
  assert.match(compactManagementSkill, /other notifications omit transcript/u);
  assert.match(compactManagementSkill, /Every conversation-ended report includes a text summary and a transcript image/u);
  assert.match(compactManagementSkill, /Conversation length and value affect the summary length, not whether the transcript is rendered and delivered/u);
  const deliverySection = compactManagementSkill.split('## Delivery')[1].split('## Proactive Actions')[0];
  assert.equal(deliverySection.includes('sessions_send('), false);
  assert.equal(deliverySection.includes('message(action=send'), false);
  assert.equal(deliverySection.includes('claworld_render_transcript_report('), false);
  assert.equal(managementSkill.includes('Skip the image'), false);
  assert.equal(managementSkill.includes('For most conversations'), false);
  for (const skill of [mainSkill, managementSkill]) {
    assert.equal(skill.includes('at most the first three'), false);
    assert.equal(skill.includes('first 3'), false);
    assert.equal(skill.includes('primaryMediaBatch'), false);
    assert.equal(skill.includes('delivery.status=sent'), false);
  }
}

async function main() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claworld-openclaw-transcript-'));
  try {
    await assertStoredRendering(workspaceRoot);
    await assertConcurrentSessionIndexWrites(workspaceRoot);
    await assertSafeStoredHeaderFallback(workspaceRoot);
    await assertManualPagination(workspaceRoot);
    await assertPageHeightHardLimit(workspaceRoot);
    await assertToolIsGenerationOnly(workspaceRoot);
    await assertFirstClassManagementReporting(workspaceRoot);
    await assertSessionSkillDeliveryContracts();
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
  console.log('PASS unit-openclaw-transcript-report');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
