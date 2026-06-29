function normalizeSignal(signal = {}, index = 0, source = 'unknown') {
  const score = Number.isFinite(Number(signal.score)) ? Number(signal.score) : 0;
  const risk = Number.isFinite(Number(signal.risk)) ? Number(signal.risk) : 0;
  return {
    id: signal.id || `${source}_${index + 1}`,
    type: signal.type || 'note',
    source,
    score,
    risk,
    summary: signal.summary || signal.text || signal.type || `${source} signal ${index + 1}`,
    weight: Number.isFinite(Number(signal.weight)) ? Number(signal.weight) : 1,
    metadata: signal.metadata || {},
  };
}

function computeWeightedAverage(signals) {
  if (signals.length === 0) return null;
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (totalWeight <= 0) return null;
  const totalScore = signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0);
  return Number((totalScore / totalWeight).toFixed(3));
}

function collectRisks(signals) {
  return signals
    .filter((signal) => signal.risk > 0)
    .sort((a, b) => b.risk - a.risk)
    .map((signal) => signal.summary);
}

function buildSummary({ matchScore, riskCount, intentCount, conversationCount, agentCount }) {
  const scoreText = matchScore == null ? 'insufficient evidence' : `match score ${matchScore}`;
  return `Canonical result built from ${intentCount} intent, ${conversationCount} conversation, ${agentCount} agent signals; ${scoreText}; ${riskCount} risk signal(s).`;
}

function pickRecommendation({ matchScore, normalizedSignals, risks }) {
  const readySignals = normalizedSignals.filter(
    (signal) => signal.type === 'next_step_ready'
      || signal.type === 'human_handoff_ready'
      || signal.type === 'conversation_complete',
  ).length;
  const hardBlock = normalizedSignals.some(
    (signal) => signal.type === 'block' || signal.metadata?.hardBlock === true || signal.risk >= 0.85,
  );
  if (hardBlock) return 'pass';
  if (readySignals >= 2 && (matchScore == null || matchScore >= 0.45) && risks.length <= 1) {
    return 'continue';
  }
  if (matchScore != null && matchScore >= 0.65 && risks.length === 0) {
    return 'continue';
  }
  if (matchScore != null && matchScore < 0.25) {
    return 'pass';
  }
  return 'review';
}

export function createCanonicalResultBuilder() {
  return {
    schema: {
      match_score: 'number',
      summary: 'string',
      risks: 'string[]',
      recommendation: 'continue|pass|review',
      evidence: 'ConversationMessage[]',
    },
    build({
      conversationId = null,
      intentSignals = [],
      conversationSignals = [],
      agentSignals = [],
    } = {}) {
      const resolvedConversationId = conversationId || null;
      const normalizedIntentSignals = intentSignals.map((signal, index) =>
        normalizeSignal(signal, index, 'intent'),
      );
      const normalizedConversationSignals = conversationSignals.map((signal, index) =>
        normalizeSignal(signal, index, 'conversation'),
      );
      const normalizedAgentSignals = agentSignals.map((signal, index) =>
        normalizeSignal(signal, index, 'agent'),
      );
      const normalizedSignals = [
        ...normalizedIntentSignals,
        ...normalizedConversationSignals,
        ...normalizedAgentSignals,
      ];

      const matchScore = computeWeightedAverage(normalizedSignals);
      const risks = collectRisks(normalizedSignals);
      const recommendation = pickRecommendation({ matchScore, normalizedSignals, risks });
      const evidence = normalizedSignals
        .sort((a, b) => Math.abs(b.score) + b.risk - (Math.abs(a.score) + a.risk))
        .slice(0, 5)
        .map((signal) => ({
          id: signal.id,
          type: signal.type,
          source: signal.source,
          summary: signal.summary,
          score: signal.score,
          risk: signal.risk,
        }));

      return {
        conversationId: resolvedConversationId,
        match_score: matchScore,
        summary: buildSummary({
          matchScore,
          riskCount: risks.length,
          intentCount: normalizedIntentSignals.length,
          conversationCount: normalizedConversationSignals.length,
          agentCount: normalizedAgentSignals.length,
        }),
        risks,
        recommendation,
        evidence,
        inputs: {
          intentSignalsCount: normalizedIntentSignals.length,
          conversationSignalsCount: normalizedConversationSignals.length,
          agentSignalsCount: normalizedAgentSignals.length,
        },
        status: 'built',
      };
    },
  };
}
