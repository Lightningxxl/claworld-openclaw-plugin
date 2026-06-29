function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeText(value, null)).filter(Boolean))];
}

function normalizeBroadcastConfig(broadcast = {}) {
  const normalized = broadcast && typeof broadcast === 'object' && !Array.isArray(broadcast)
    ? broadcast
    : {};
  return {
    enabled: normalized.enabled === true,
    audience: normalizeText(normalized.audience, 'members'),
    replyPolicy: normalizeText(normalized.replyPolicy, 'zero'),
    excludeSelf: normalized.excludeSelf !== false,
  };
}

function normalizeLookupText(value) {
  return normalizeText(value, '')?.toLowerCase() || '';
}

function sentenceCase(value, fallback = '') {
  const normalized = normalizeText(value, fallback);
  if (!normalized) return fallback;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function quoteExample(example) {
  return `"${String(example).trim()}"`;
}

function joinAsNaturalLanguage(values = []) {
  const items = values.filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function summarizeWorldChoices(items = []) {
  return items.map((world) => `${world.displayName} [${world.worldId}]`);
}

function normalizeWorldSummary(world = {}) {
  const summary = world.agentSummary && typeof world.agentSummary === 'object' ? world.agentSummary : world;
  const rawWorldId = world.worldId || summary.worldId;

  return {
    worldId: normalizeText(rawWorldId, 'unknown-world'),
    displayName: normalizeText(summary.displayName || world.displayName, normalizeText(rawWorldId, 'Unknown World')),
    worldContextText: normalizeText(summary.worldContextText || world.worldContextText, ''),
    hotness: normalizeInteger(summary.hotness || world.hotness || world.activatedMemberCount, 0),
    requiredFieldCount: normalizeInteger(summary.requiredFieldCount || world.requiredFieldCount, 0),
  };
}

function normalizeField(field = {}, index = 0, { required = false } = {}) {
  const fieldId = normalizeText(field.fieldId || field.id, `field_${index + 1}`);
  return {
    fieldId,
    label: normalizeText(field.label, fieldId),
    type: normalizeText(field.type, 'string'),
    source: normalizeText(field.source, 'profile'),
    required: field.required === true || required,
    description: normalizeText(field.description, null),
    examples: normalizeStringList(field.examples),
    constraints: field.constraints && typeof field.constraints === 'object' ? field.constraints : {},
  };
}

function normalizeSearchSchema(payload = {}, { worldId = null, fallbackFields = [] } = {}) {
  const rawInputFields = Array.isArray(payload.inputFields) && payload.inputFields.length > 0
    ? payload.inputFields
    : fallbackFields;
  const inputFields = rawInputFields.map((field, index) => normalizeField(field, index, { required: false }));
  const inputFieldIds = normalizeStringList(
    Array.isArray(payload.inputFieldIds)
      ? payload.inputFieldIds
      : inputFields.map((field) => field.fieldId),
  );

  return {
    modelId: normalizeText(payload.modelId, worldId ? `${worldId}.search.v1` : 'world.search.v1'),
    worldId: normalizeText(payload.worldId, worldId || 'unknown-world'),
    mode: normalizeText(payload.mode, 'membership_profile_search'),
    previewRoute: normalizeText(payload.previewRoute, worldId ? `/v1/worlds/${worldId}/search` : '/v1/worlds/:worldId/search'),
    inputFieldIds,
    inputFields,
    resultFields: normalizeStringList(payload.resultFields),
    viewerRequirement: normalizeText(payload.viewerRequirement, 'active_membership'),
    onlineOnly: payload.onlineOnly !== false,
    defaultLimit: normalizeInteger(payload.defaultLimit, 10),
    summary: normalizeText(payload.summary, ''),
    hints: normalizeStringList(payload.hints),
    status: normalizeText(payload.status, 'phase1_world_search'),
  };
}

function normalizeWorldDetail(payload = {}) {
  if (Array.isArray(payload.requiredFields) || Array.isArray(payload.optionalFields)) {
    const requiredFields = Array.isArray(payload.requiredFields)
      ? payload.requiredFields.map((field, index) => normalizeField(field, index, { required: true }))
      : [];
    const optionalFields = Array.isArray(payload.optionalFields)
      ? payload.optionalFields.map((field, index) => normalizeField(field, index, { required: false }))
      : [];
    const normalizedWorldId = normalizeText(payload.worldId, 'unknown-world');

    return {
      status: normalizeText(payload.status, 'ready'),
      source: normalizeText(payload.source, 'product_shell'),
      worldId: normalizedWorldId,
      displayName: normalizeText(payload.displayName, normalizedWorldId),
      summary: normalizeText(payload.summary, ''),
      description: normalizeText(payload.description, normalizeText(payload.summary, '')),
      category: normalizeText(payload.category, 'general'),
      requiredFieldCount: normalizeInteger(payload.requiredFieldCount, requiredFields.length) || requiredFields.length,
      optionalFieldCount: normalizeInteger(payload.optionalFieldCount, optionalFields.length) || optionalFields.length,
      matchingMode: normalizeText(payload.matchingMode, 'manual_review'),
      conversationMode: normalizeText(payload.conversationMode, 'a2a'),
      interactionRules: normalizeText(payload.interactionRules, null),
      prohibitedRules: normalizeText(payload.prohibitedRules, null),
      eligibility: normalizeText(payload.eligibility, 'active'),
      broadcast: normalizeBroadcastConfig(payload.broadcast),
      requiredFields,
      optionalFields,
      hints: normalizeStringList(payload.hints),
      nextAction: normalizeText(payload.nextAction, 'call_join_world'),
      conversationOverview:
        payload.conversationOverview && typeof payload.conversationOverview === 'object'
          ? payload.conversationOverview
          : {},
      matchingOverview: payload.matchingOverview && typeof payload.matchingOverview === 'object' ? payload.matchingOverview : {},
      searchSchema: normalizeSearchSchema(payload.searchSchema || {}, {
        worldId: normalizedWorldId,
        fallbackFields: requiredFields,
      }),
    };
  }

  const world = payload.world && typeof payload.world === 'object' ? payload.world : {};
  const agentSummary = payload.agentSummary && typeof payload.agentSummary === 'object' ? payload.agentSummary : {};
  const joinSchema = payload.joinSchema && typeof payload.joinSchema === 'object' ? payload.joinSchema : {};
  const fieldGuide = payload.fieldGuide && typeof payload.fieldGuide === 'object' ? payload.fieldGuide : {};
  const conversationOverview = payload.conversationOverview && typeof payload.conversationOverview === 'object'
    ? payload.conversationOverview
    : {};
  const matchingOverview = payload.matchingOverview && typeof payload.matchingOverview === 'object'
    ? payload.matchingOverview
    : {};
  const searchOverview = payload.searchSchema && typeof payload.searchSchema === 'object'
    ? payload.searchSchema
    : {};

  const requiredInput = Array.isArray(fieldGuide.required) && fieldGuide.required.length > 0
    ? fieldGuide.required
    : (Array.isArray(joinSchema.requiredFields) ? joinSchema.requiredFields : []);
  const optionalInput = Array.isArray(fieldGuide.optional) && fieldGuide.optional.length > 0
    ? fieldGuide.optional
    : (Array.isArray(joinSchema.optionalFields) ? joinSchema.optionalFields : []);

  const requiredFields = requiredInput.map((field, index) => normalizeField(field, index, { required: true }));
  const optionalFields = optionalInput.map((field, index) => normalizeField(field, index, { required: false }));
  const worldId = normalizeText(payload.worldId || world.worldId || joinSchema.worldId, 'unknown-world');
  const displayName = normalizeText(payload.displayName || agentSummary.displayName || world.displayName, worldId);

  return {
    status: 'ready',
    source: 'product_shell',
    worldId,
    displayName,
    summary: normalizeText(payload.summary || agentSummary.summary || world.summary, ''),
    description: normalizeText(payload.description || world.description, normalizeText(payload.summary || agentSummary.summary || world.summary, '')),
    category: normalizeText(payload.category || agentSummary.category || world.category, 'general'),
    requiredFieldCount: normalizeInteger(joinSchema.requiredFieldCount, requiredFields.length) || requiredFields.length,
    optionalFieldCount: normalizeInteger(joinSchema.optionalFieldCount, optionalFields.length) || optionalFields.length,
    matchingMode: normalizeText(payload.matchingMode || agentSummary.matchingMode || matchingOverview.mode || world.matching?.mode, 'manual_review'),
    conversationMode: normalizeText(
      payload.conversationMode || agentSummary.conversationMode || conversationOverview.mode || world.conversationTemplate?.mode,
      'a2a',
    ),
    interactionRules: normalizeText(payload.interactionRules || world.interactionRules, null),
    prohibitedRules: normalizeText(payload.prohibitedRules || world.prohibitedRules, null),
    eligibility: normalizeText(payload.eligibility || world.eligibility, 'active'),
    broadcast: normalizeBroadcastConfig(payload.broadcast || world.broadcast),
    requiredFields,
    optionalFields,
    hints: normalizeStringList(payload.hints || joinSchema.hints),
    nextAction: normalizeText(payload.nextAction || joinSchema.nextAction, 'call_join_world'),
    conversationOverview,
    matchingOverview,
    searchSchema: normalizeSearchSchema(searchOverview, {
      worldId,
      fallbackFields: [...requiredFields, ...optionalFields],
    }),
  };
}

function formatConversationOverview(detail = {}) {
  const conversationOverview = detail.conversationOverview && typeof detail.conversationOverview === 'object'
    ? detail.conversationOverview
    : {};
  const mode = normalizeText(detail.conversationMode || conversationOverview.mode, null);
  const parts = [];

  if (mode) parts.push(`${mode} mode`);

  return parts.length > 0 ? parts.join(', ') : null;
}

export function buildWorldSessionStartupText(detail = {}) {
  const normalizedDetail = normalizeWorldDetail(detail);
  const worldId = normalizeText(normalizedDetail.worldId, null);
  if (!worldId) return null;

  const displayName = normalizeText(normalizedDetail.displayName, worldId);
  const summary = normalizeText(normalizedDetail.summary, null);
  const sessionSummary = formatConversationOverview(normalizedDetail);
  const conversationOverview = normalizedDetail.conversationOverview && typeof normalizedDetail.conversationOverview === 'object'
    ? normalizedDetail.conversationOverview
    : {};
  const openingText = normalizeText(conversationOverview.openingText, null);
  const convergenceText = normalizeText(conversationOverview.convergence?.text, null);
  const interactionRules = normalizeText(normalizedDetail.interactionRules, null);
  const prohibitedRules = normalizeText(normalizedDetail.prohibitedRules, null);

  const lines = [
    'Internal Claworld world context for this conversation.',
    'Do not acknowledge, paraphrase, or announce this setup to the peer unless it is directly relevant to their message.',
    `World: ${displayName} [${worldId}]`,
    summary ? `Summary: ${summary}` : null,
    sessionSummary ? `Session overview: ${sessionSummary}` : null,
    'Interruption handling: prefer reconnect/resume. Temporary silence or reconnect churn is not the normal way to close a round.',
    openingText ? `Opening focus: ${openingText}` : null,
    interactionRules ? `Interaction rules: ${interactionRules}` : null,
    prohibitedRules ? `Prohibited rules: ${prohibitedRules}` : null,
    convergenceText ? `Convergence rule: ${convergenceText}` : null,
    'Apply these world rules symmetrically when responding in this conversation.',
  ].filter(Boolean);

  return lines.join('\n');
}

function normalizeSelectionInput(selection) {
  if (selection && typeof selection === 'object') {
    const asWorldId = normalizeText(selection.worldId, null);
    const asDisplayName = normalizeText(selection.displayName, null);
    const asChoice = normalizeText(selection.selection || selection.choice || selection.value, null);
    const text = asWorldId || asDisplayName || asChoice || '';
    return {
      raw: selection,
      text,
      normalized: normalizeLookupText(text),
      index: /^\d+$/.test(String(text)) ? normalizeInteger(text, 0) : null,
    };
  }

  const text = normalizeText(selection, '');
  return {
    raw: selection,
    text,
    normalized: normalizeLookupText(text),
    index: /^\d+$/.test(String(text)) ? normalizeInteger(text, 0) : null,
  };
}

function buildSelectionRetryContract(status, selection, items = [], matches = []) {
  const choiceLabel = selection.text ? `"${selection.text}"` : 'that choice';
  const retryWorlds = (matches.length > 0 ? matches : items).map((world) => normalizeWorldSummary(world));
  const retrySummary = summarizeWorldChoices(retryWorlds);

  if (status === 'ambiguous') {
    return {
      status,
      selection: {
        input: selection.text || null,
        matchedBy: null,
        worldId: null,
        displayName: null,
      },
      candidateWorlds: retryWorlds,
      orchestration: {
        stage: 'post_setup_world_selection_retry',
        system: 'The world choice matched multiple worlds. Show the narrowed list and ask the user to pick one exact world ID or display name.',
        user: `The choice ${choiceLabel} is ambiguous. Matching worlds: ${joinAsNaturalLanguage(retrySummary)}. Ask the user to choose one exact world ID or display name.`,
        followUp: 'Once the user confirms one exact world, fetch its detail, explain the required fields, and use join_world when enough profile data is available.',
      },
    };
  }

  return {
    status: 'no_match',
    selection: {
      input: selection.text || null,
      matchedBy: null,
      worldId: null,
      displayName: null,
    },
    candidateWorlds: retryWorlds,
    orchestration: {
      stage: 'post_setup_world_selection_retry',
      system: 'The world choice did not match the available world directory. Re-list the worlds and ask the user to choose one by world ID or display name.',
      user: retrySummary.length > 0
        ? `I could not match ${choiceLabel} to an available world. Available worlds: ${joinAsNaturalLanguage(retrySummary)}. Ask the user to choose one by world ID or display name.`
        : 'No worlds are currently available. Tell the user setup is complete but world selection cannot continue yet.',
      followUp: 'Once the user chooses a valid world, confirm it, fetch the world detail, and explain the required fields before calling join_world.',
    },
  };
}

export function buildWorldSelectionPrompt(worldDirectory = {}) {
  const worldLines = Array.isArray(worldDirectory.items)
    ? worldDirectory.items.map((world, index) => (
      `${index + 1}. ${world.displayName} [${world.worldId}]`
      + ` (required fields: ${world.requiredFieldCount}; hotness: ${normalizeInteger(world.hotness, 0)})`
    ))
    : [];

  return {
    stage: 'post_setup_world_selection',
    recommendedWorldId: worldDirectory.recommendedWorldId || null,
    system:
      'Setup is complete. Present the available worlds, explain the differences briefly, and ask the user to choose one world by worldId or display name. After the choice, confirm the selected world before explaining its required fields.',
    user:
      worldLines.length > 0
        ? `Available worlds:\n${worldLines.join('\n')}\nAsk the user which world they want to join next.`
        : 'No worlds are currently available. Tell the user setup is complete but no worlds can be selected yet.',
    followUp:
      'After the user chooses a world, confirm the selection, fetch that world detail, explain the required fields, and then use join_world for that world.',
  };
}

export function resolveWorldSelection(worldDirectory = {}, selection = null) {
  const items = Array.isArray(worldDirectory.items)
    ? worldDirectory.items.map((world) => normalizeWorldSummary(world))
    : [];
  const normalizedSelection = normalizeSelectionInput(selection);

  if (items.length === 0) {
    return buildSelectionRetryContract('no_match', normalizedSelection, items);
  }

  let selectedWorld = null;
  let matchedBy = null;

  if (normalizedSelection.index && normalizedSelection.index >= 1 && normalizedSelection.index <= items.length) {
    selectedWorld = items[normalizedSelection.index - 1];
    matchedBy = 'index';
  }

  if (!selectedWorld && normalizedSelection.normalized) {
    selectedWorld = items.find((world) => normalizeLookupText(world.worldId) === normalizedSelection.normalized) || null;
    if (selectedWorld) matchedBy = 'worldId';
  }

  if (!selectedWorld && normalizedSelection.normalized) {
    selectedWorld = items.find((world) => normalizeLookupText(world.displayName) === normalizedSelection.normalized) || null;
    if (selectedWorld) matchedBy = 'displayName';
  }

  if (!selectedWorld && normalizedSelection.normalized.length >= 3) {
    const partialMatches = items.filter((world) => (
      normalizeLookupText(world.worldId).includes(normalizedSelection.normalized)
      || normalizeLookupText(world.displayName).includes(normalizedSelection.normalized)
    ));

    if (partialMatches.length === 1) {
      [selectedWorld] = partialMatches;
      matchedBy = 'partial';
    } else if (partialMatches.length > 1) {
      return buildSelectionRetryContract('ambiguous', normalizedSelection, items, partialMatches);
    }
  }

  if (!selectedWorld) {
    return buildSelectionRetryContract('no_match', normalizedSelection, items);
  }

  return {
    status: 'selected',
    selection: {
      input: normalizedSelection.text || null,
      matchedBy,
      worldId: selectedWorld.worldId,
      displayName: selectedWorld.displayName,
    },
    selectedWorld,
    candidateWorlds: items,
    orchestration: {
      stage: 'post_setup_world_selected',
      system: 'Confirm the resolved world choice before fetching detail and collecting participantContextText for join_world.',
      user: `I matched the user choice to ${selectedWorld.displayName} [${selectedWorld.worldId}]. Confirm that this is the world we will use next.`,
      confirmation: `Confirmed world: ${selectedWorld.displayName} [${selectedWorld.worldId}].`,
      followUp: 'Fetch the selected world detail, explain the participant context requirement, and use join_world once participantContextText is available.',
    },
  };
}

function buildFieldStepPrompt(field = {}, index = 0, total = 1) {
  const examples = Array.isArray(field.examples) && field.examples.length > 0
    ? ` Example: ${field.examples.map((example) => quoteExample(example)).join(' or ')}.`
    : '';
  const description = sentenceCase(
    field.description || `Provide ${field.label} so the world can evaluate the profile`,
    'Provide this field so the world can evaluate the profile.',
  );

  return `Step ${index + 1} of ${total}: ${field.label}. ${description}${examples}`;
}

export function buildRequiredFieldExplanation(worldDetail = {}) {
  const detail = normalizeWorldDetail(worldDetail);
  const field = detail.requiredFields[0];
  const summary = `To join ${detail.displayName}, I need one ${field.label} text.`;
  const steps = [
    {
      step: 1,
      fieldId: field.fieldId,
      label: field.label,
      prompt: buildFieldStepPrompt(field, 0, 1),
      description: field.description,
      examples: field.examples,
      constraints: field.constraints,
    },
  ];
  const nextInstruction = steps[0].prompt;

  return {
    status: 'ready',
    stage: 'post_setup_world_requirements',
    worldId: detail.worldId,
    displayName: detail.displayName,
    requiredFieldCount: 1,
    optionalFieldCount: 0,
    summary,
    steps,
    hints: detail.hints,
    nextAction: detail.nextAction,
    orchestration: {
      stage: 'post_setup_world_requirements',
      system: 'Confirm the selected world, explain the participant context requirement in plain language, and use join_world once that text is available.',
      confirmation: `Confirmed world: ${detail.displayName} [${detail.worldId}].`,
      user: [summary, nextInstruction].filter(Boolean).join('\n\n'),
      followUp: 'After the user provides participantContextText, call join_world.',
    },
  };
}

export function buildResolvedWorldJoinOrchestration({
  joinResult = null,
} = {}) {
  const joinOrchestration = joinResult?.orchestration && typeof joinResult.orchestration === 'object' && !Array.isArray(joinResult.orchestration)
    ? joinResult.orchestration
    : null;
  return joinOrchestration;
}
