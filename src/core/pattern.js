import { createId } from '../utils/id.js';
import { addDays, nowIso } from '../utils/time.js';

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeConfidence(intervals) {
  if (intervals.length < 2) {
    return 0.4;
  }

  const avg = average(intervals);
  const variance = average(intervals.map((value) => (value - avg) ** 2));
  const normalizedVariance = avg === 0 ? 1 : Math.min(1, variance / (avg ** 2));
  return Number(Math.max(0.45, Math.min(0.95, 1 - normalizedVariance)).toFixed(2));
}

function describeFrequency(meanMs) {
  const hours = meanMs / 3_600_000;
  if (hours < 24) {
    return 'daily';
  }
  if (hours < 24 * 10) {
    return 'weekly';
  }
  if (hours < 24 * 45) {
    return 'monthly';
  }
  return 'irregular';
}

export function detectPatterns(events) {
  const groups = new Map();

  for (const event of events) {
    const entities = event.entities?.length ? event.entities : ['global'];

    for (const entityId of entities) {
      const key = `${event.type}:${entityId}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(event);
    }
  }

  const patterns = [];

  for (const [key, group] of groups.entries()) {
    const sorted = [...group].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
    if (sorted.length < 3) {
      continue;
    }

    const intervals = [];
    for (let index = 1; index < sorted.length; index += 1) {
      intervals.push(new Date(sorted[index].timestamp).getTime() - new Date(sorted[index - 1].timestamp).getTime());
    }

    const mean = average(intervals);
    if (!mean) {
      continue;
    }

    const [type, entityId] = key.split(':');
    const lastOccurrence = sorted.at(-1).timestamp;

    patterns.push({
      id: createId('pattern'),
      description: `${type} tends to recur for ${entityId} every ${describeFrequency(mean)}`,
      entities: entityId === 'global' ? [] : [entityId],
      frequency: describeFrequency(mean),
      confidence: computeConfidence(intervals),
      last_occurrence: lastOccurrence,
      next_expected: addDays(lastOccurrence, Math.round(mean / 86_400_000) || 1),
      created_at: nowIso()
    });
  }

  return patterns;
}

export function updatePatternsForEvent(worldModel, event, options = {}) {
  const windowDays = options.windowDays || 45;
  const recentEvents = worldModel.getRecentEvents(
    new Date(Date.now() - windowDays * 86_400_000).toISOString(),
    500
  );

  const relatedEvents = recentEvents.filter((candidate) => {
    if (candidate.type !== event.type) {
      return false;
    }

    if (!event.entities?.length || !candidate.entities?.length) {
      return true;
    }

    return candidate.entities.some((entityId) => event.entities.includes(entityId));
  });

  for (const pattern of detectPatterns(relatedEvents)) {
    worldModel.addPattern(pattern);
  }
}
