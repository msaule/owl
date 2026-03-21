import { getPreferenceSummary } from './preferences.js';

/**
 * Compute a score boost (or penalty) for a discovery type based on
 * accumulated user feedback.  Scores are stored as integers in the
 * preferences table (e.g. preference:type:connection = 5).
 *
 * Returns a multiplier centred on 1.0:
 *   positive feedback → multiplier > 1 (max 1.5)
 *   negative feedback → multiplier < 1 (min 0.5)
 *   no data          → 1.0 (neutral)
 */
export function getTypeBoost(worldModel, discoveryType) {
  const score = worldModel.getUserPreference(`preference:type:${discoveryType}`);
  if (score == null || score === 0) {
    return 1.0;
  }

  // Clamp the boost between 0.5 and 1.5
  return Math.max(0.5, Math.min(1.5, 1 + score * 0.1));
}

/**
 * Compute an aggregate source boost for a discovery that cites
 * multiple plugins.  Average the per-source preference scores.
 */
export function getSourceBoost(worldModel, sources = []) {
  if (!sources.length) {
    return 1.0;
  }

  let total = 0;
  for (const source of sources) {
    const score = worldModel.getUserPreference(`preference:source:${source}`) || 0;
    total += score;
  }

  const average = total / sources.length;
  return Math.max(0.5, Math.min(1.5, 1 + average * 0.1));
}

/**
 * Combined preference score for a single discovery candidate.
 * Used by the filter to re-rank candidates after the main filter chain.
 */
export function getPreferenceScore(worldModel, discovery) {
  const typeBoost = getTypeBoost(worldModel, discovery.type);
  const sourceBoost = getSourceBoost(worldModel, discovery.sources);
  // Weight type preferences more heavily than source preferences
  return typeBoost * 0.7 + sourceBoost * 0.3;
}

/**
 * Build a short natural-language hint for the discovery prompt so the
 * LLM also knows what the user tends to value.
 */
export function buildPreferenceHints(worldModel) {
  const types = ['connection', 'anomaly', 'risk', 'opportunity', 'anticipation', 'time_sensitive'];
  const scored = types
    .map((type) => ({
      type,
      score: worldModel.getUserPreference(`preference:type:${type}`) || 0
    }))
    .filter((item) => item.score !== 0)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  if (!scored.length) {
    return '';
  }

  const liked = scored.filter((item) => item.score > 0).map((item) => item.type);
  const disliked = scored.filter((item) => item.score < 0).map((item) => item.type);

  const parts = [];
  if (liked.length) {
    parts.push(`The user especially values: ${liked.join(', ')} discoveries.`);
  }
  if (disliked.length) {
    parts.push(`The user finds these less useful: ${disliked.join(', ')} discoveries.`);
  }

  return parts.join(' ');
}

export function buildImprovementSummary(worldModel) {
  return getPreferenceSummary(worldModel);
}
