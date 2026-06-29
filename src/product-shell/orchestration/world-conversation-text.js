const DEFAULT_TEMPLATE_REFS = {
  opening: 'world.conversation.opening',
  convergence: 'world.conversation.convergence',
  stateChanged: 'world.conversation.state_changed',
};

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeInteger(value, fallback = null) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.trunc(normalized);
}

function normalizePositiveInteger(value, fallback = null) {
  const normalized = normalizeInteger(value, fallback);
  if (normalized == null || normalized <= 0) return fallback;
  return normalized;
}

function normalizeTurnRule(rule = {}, index = 0) {
  return {
    id: rule.id || `turn_rule_${index + 1}`,
    trigger: rule.trigger || 'turn_threshold',
    atTurn: Number.isFinite(Number(rule.atTurn)) ? Math.max(0, Number(rule.atTurn)) : null,
    visibility: rule.visibility || 'both',
    role: rule.role || 'system',
    templateRef: rule.templateRef || `world.turn.rule.${index + 1}`,
    text: rule.text || null,
    once: rule.once !== false,
  };
}

function buildMessage({
  conversationId = null,
  trigger,
  role = 'system',
  visibility = 'both',
  templateRef = null,
  text = null,
  metadata = {},
}) {
  return {
    conversationId: normalizeText(conversationId, null),
    trigger,
    role,
    visibility,
    templateRef,
    text,
    metadata,
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

export function buildWorldConversationContextEvent(detail = {}) {
  const worldId = normalizeText(detail.worldId || detail.world?.worldId, null);
  if (!worldId) return null;
  const worldContextText = normalizeText(
    detail.world?.worldContextText,
    normalizeText(detail.worldContextText, null),
  );
  if (worldContextText) return worldContextText;

  const displayName = normalizeText(detail.displayName || detail.world?.displayName || detail.worldDisplayName, worldId);
  const summary = normalizeText(detail.summary || detail.world?.summary, null);
  const sessionSummary = formatConversationOverview(detail);
  const conversationOverview = detail.conversationOverview && typeof detail.conversationOverview === 'object'
    ? detail.conversationOverview
    : {};
  const openingText = normalizeText(conversationOverview.openingText, null);
  const convergenceText = normalizeText(conversationOverview.convergence?.text, null);
  const interactionRules = normalizeText(detail.interactionRules, null);
  const prohibitedRules = normalizeText(detail.prohibitedRules, null);

  const lines = [
    'Internal Claworld world context for this conversation.',
    'Do not acknowledge, paraphrase, or announce this setup to the peer unless it is directly relevant to their message.',
    `World: ${displayName} [${worldId}]`,
    summary ? `Summary: ${summary}` : null,
    sessionSummary ? `Conversation overview: ${sessionSummary}` : null,
    'Interruption handling: prefer reconnect/resume. Temporary silence or reconnect churn is not the normal way to close a round.',
    openingText ? `Opening focus: ${openingText}` : null,
    interactionRules ? `Interaction rules: ${interactionRules}` : null,
    prohibitedRules ? `Prohibited rules: ${prohibitedRules}` : null,
    convergenceText ? `Convergence rule: ${convergenceText}` : null,
    'Apply these world rules symmetrically when responding in this conversation.',
  ].filter(Boolean);

  return lines.join('\n');
}

export function createSystemMessageOrchestrator({ templateRefs = DEFAULT_TEMPLATE_REFS } = {}) {
  return {
    supportedTriggers: ['conversation_started', 'turn_threshold', 'convergence', 'state_changed'],
    describeRuleShape() {
      return {
        opening_system_message: 'optional text/template ref',
        turn_message_rules: [
          {
            id: 'turn_nudge_2',
            trigger: 'turn_threshold',
            atTurn: 2,
            visibility: 'both',
            role: 'system',
            templateRef: 'world.turn.nudge',
            once: true,
          },
        ],
        convergence_message: {
          whenRemainingTurnsLTE: 1,
          templateRef: templateRefs.convergence,
        },
        state_change_messages: {
          active_to_review: templateRefs.stateChanged,
        },
      };
    },
    planMessages({
      conversationId = null,
      trigger = 'conversation_started',
      turnIndex = 0,
      remainingTurns = null,
      worldRules = {},
      previousState = null,
      nextState = null,
      emittedRuleIds = [],
    } = {}) {
      const resolvedConversationId = normalizeText(conversationId, null);
      const messages = [];
      const emitted = new Set(emittedRuleIds);

      if (trigger === 'conversation_started' && worldRules.openingSystemMessage !== false) {
        messages.push(
          buildMessage({
            conversationId: resolvedConversationId,
            trigger,
            templateRef: worldRules.openingTemplateRef || templateRefs.opening,
            text: worldRules.openingText || null,
            metadata: { phase: 'opening' },
          }),
        );
      }

      const rules = Array.isArray(worldRules.turnMessageRules)
        ? worldRules.turnMessageRules.map((rule, index) => normalizeTurnRule(rule, index))
        : [];
      if (trigger === 'turn_threshold') {
        for (const rule of rules) {
          if (rule.trigger !== 'turn_threshold') continue;
          if (rule.atTurn == null || turnIndex < rule.atTurn) continue;
          if (rule.once && emitted.has(rule.id)) continue;
          messages.push(
            buildMessage({
              conversationId: resolvedConversationId,
              trigger,
              role: rule.role,
              visibility: rule.visibility,
              templateRef: rule.templateRef,
              text: rule.text,
              metadata: { ruleId: rule.id, atTurn: rule.atTurn },
            }),
          );
          emitted.add(rule.id);
        }
      }

      const convergenceThreshold = Number.isFinite(Number(worldRules.convergence?.whenRemainingTurnsLTE))
        ? Number(worldRules.convergence.whenRemainingTurnsLTE)
        : 1;
      if (
        trigger === 'convergence' &&
        remainingTurns != null &&
        Number(remainingTurns) <= convergenceThreshold
      ) {
        messages.push(
          buildMessage({
            conversationId: resolvedConversationId,
            trigger,
            templateRef: worldRules.convergence?.templateRef || templateRefs.convergence,
            text: worldRules.convergence?.text || null,
            metadata: { remainingTurns: Number(remainingTurns) },
          }),
        );
      }

      if (trigger === 'state_changed' && previousState !== nextState && nextState) {
        const stateKey = `${previousState || 'unknown'}_to_${nextState}`;
        messages.push(
          buildMessage({
            conversationId: resolvedConversationId,
            trigger,
            templateRef:
              worldRules.stateChangeMessages?.[stateKey]?.templateRef || templateRefs.stateChanged,
            text: worldRules.stateChangeMessages?.[stateKey]?.text || null,
            metadata: {
              previousState,
              nextState,
              stateKey,
            },
          }),
        );
      }

      return {
        conversationId: resolvedConversationId,
        turnIndex,
        trigger,
        emittedRuleIds: [...emitted],
        messages,
        status: messages.length > 0 ? 'planned' : 'noop',
      };
    },
  };
}
