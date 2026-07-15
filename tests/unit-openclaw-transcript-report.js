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

async function assertUnboundedPageHeightConfiguration(workspaceRoot) {
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
    messageChannel: 'claworld',
    deliveryContext: { channel: 'claworld', to: 'management:agent-local', accountId: 'claworld' },
  });
  const managementResult = await managementTool.execute('render-management', {
    mode: 'manual',
    manual: {
      title: 'Management handoff',
      peerProfile: 'High-value report excerpt',
      localLabel: 'local',
      peerLabel: 'peer',
      messages: [
        { from: 'peer', text: 'include this quote in the report', createdAt: '2026-07-13T09:05:00Z' },
      ],
    },
  });
  const managementPayload = JSON.parse(managementResult.content[0].text);
  assert.equal(managementPayload.status, 'ok');
  assert.equal('delivery' in managementPayload, false);
  assert.equal('deliveryHint' in managementPayload, false);
  assert.ok(managementPayload.artifacts.pngPages.every((item) => path.isAbsolute(item.path)));
  assert.equal(outboundAdapterLoads, 0);
}

async function assertSessionSkillDeliveryContracts() {
  const [mainSkill, managementSkill] = await Promise.all([
    fs.readFile(new URL('../skills/claworld-main-session/SKILL.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../skills/claworld-management-session/SKILL.md', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSkill, /message\(action=send, media=<absolute PNG path>, forceDocument=true\)/u);
  assert.match(mainSkill, /read every `artifacts\.pngPages\[\]\.path` value in page order/u);
  assert.match(mainSkill, /Send every rendered page/u);
  assert.match(mainSkill, /8000px default maximum/u);
  assert.match(mainSkill, /does not impose an upper bound/u);
  assert.match(managementSkill, /### Delivering transcript images/u);
  assert.match(managementSkill, /obtain its `deliveryContext`/u);
  assert.match(managementSkill, /call `sessions_list` without the `kinds` parameter/u);
  assert.match(managementSkill, /Do not pass `kinds=\["main"\]`/u);
  assert.match(managementSkill, /message\(action=send, media=<absolute path>, forceDocument=true\)/u);
  assert.match(managementSkill, /Never use `sessions_send` to send media info/u);
  assert.match(managementSkill, /8000px default maximum/u);
  assert.match(managementSkill, /does not impose an upper bound/u);
  assert.match(managementSkill, /A transcript image is the default for an ended conversation/u);
  assert.match(managementSkill, /Skip the image only when the conversation is simple enough/u);
  assert.match(managementSkill, /Do not use a longer text summary as a substitute for the image/u);
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
    await assertSafeStoredHeaderFallback(workspaceRoot);
    await assertManualPagination(workspaceRoot);
    await assertUnboundedPageHeightConfiguration(workspaceRoot);
    await assertToolIsGenerationOnly(workspaceRoot);
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
