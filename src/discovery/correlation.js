/**
 * Cross-Source Correlation — detects temporal correlations between events
 * from different sources.
 *
 * For example: "Every time a Shopify order spikes, there's a Gmail thread
 * about inventory 2 hours later" or "Calendar meetings with Acme Corp are
 * always followed by GitHub PR activity."
 *
 * Uses a sliding window approach to find event pairs that co-occur
 * significantly more often than chance.
 */

import { daysAgo } from '../utils/time.js';

/**
 * Find temporal correlations between events from different sources.
 *
 * @param {object} worldModel
 * @param {object} options
 * @param {number} options.lookbackDays - How far back to look (default 14)
 * @param {number} options.windowMinutes - Co-occurrence window in minutes (default 120)
 * @param {number} options.minOccurrences - Minimum co-occurrences to report (default 3)
 * @returns {Array<object>} Correlation objects sorted by strength
 */
export function findCorrelations(worldModel, options = {}) {
  const {
    lookbackDays = 14,
    windowMinutes = 120,
    minOccurrences = 3
  } = options;

  const since = daysAgo(lookbackDays);
  const events = worldModel.getRecentEvents(since, 5000);

  // Sort events by timestamp
  const sorted = [...events].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Build co-occurrence counts: "sourceA:typeA → sourceB:typeB"
  const pairCounts = {};
  const sourceTotalCounts = {};
  const windowMs = windowMinutes * 60_000;

  for (let i = 0; i < sorted.length; i++) {
    const eventA = sorted[i];
    const keyA = `${eventA.source}:${eventA.type}`;
    sourceTotalCounts[keyA] = (sourceTotalCounts[keyA] || 0) + 1;

    // Look forward within the window
    for (let j = i + 1; j < sorted.length; j++) {
      const eventB = sorted[j];
      const timeDiff = new Date(eventB.timestamp).getTime() - new Date(eventA.timestamp).getTime();

      if (timeDiff > windowMs) break;
      if (eventA.source === eventB.source) continue; // Only cross-source

      const keyB = `${eventB.source}:${eventB.type}`;
      const pairKey = `${keyA} → ${keyB}`;

      if (!pairCounts[pairKey]) {
        pairCounts[pairKey] = {
          from: keyA,
          to: keyB,
          count: 0,
          avgDelayMs: 0,
          delays: [],
          sharedEntities: {}
        };
      }

      pairCounts[pairKey].count += 1;
      pairCounts[pairKey].delays.push(timeDiff);

      // Track shared entities
      const entitiesA = new Set(eventA.entities || []);
      for (const entityId of (eventB.entities || [])) {
        if (entitiesA.has(entityId)) {
          pairCounts[pairKey].sharedEntities[entityId] =
            (pairCounts[pairKey].sharedEntities[entityId] || 0) + 1;
        }
      }
    }
  }

  // Filter and score correlations
  const correlations = [];

  for (const [pairKey, pair] of Object.entries(pairCounts)) {
    if (pair.count < minOccurrences) continue;

    const totalA = sourceTotalCounts[pair.from] || 1;
    const totalB = sourceTotalCounts[pair.to] || 1;

    // Lift score: how much more likely is B given A vs baseline?
    const expectedRate = totalB / sorted.length;
    const observedRate = pair.count / totalA;
    const lift = expectedRate > 0 ? observedRate / expectedRate : 0;

    if (lift < 1.5) continue; // Only report meaningful correlations

    // Average delay
    const avgDelay = pair.delays.reduce((a, b) => a + b, 0) / pair.delays.length;
    const avgDelayMinutes = Math.round(avgDelay / 60_000);

    // Shared entities
    const topSharedEntities = Object.entries(pair.sharedEntities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([entityId]) => entityId);

    correlations.push({
      from: pair.from,
      to: pair.to,
      occurrences: pair.count,
      lift: Math.round(lift * 100) / 100,
      avgDelayMinutes,
      sharedEntities: topSharedEntities,
      description: `${pair.from.split(':')[0]} "${pair.from.split(':').slice(1).join(':')}" events are followed by ${pair.to.split(':')[0]} "${pair.to.split(':').slice(1).join(':')}" events ${avgDelayMinutes}min later (${pair.count}x, ${Math.round(lift)}x above baseline)${topSharedEntities.length > 0 ? `, often involving ${topSharedEntities.join(', ')}` : ''}`
    });
  }

  return correlations.sort((a, b) => b.lift - a.lift);
}

/**
 * Format correlations into context that can be injected into discovery prompts.
 */
export function formatCorrelationsForPrompt(correlations) {
  if (correlations.length === 0) return '';

  const lines = correlations.slice(0, 5).map((c) =>
    `- ${c.description}`
  );

  return `## Cross-Source Correlations\n${lines.join('\n')}`;
}
