/**
 * Health self-diagnostics — OWL monitors its own performance and can surface
 * discoveries about its own behavior.
 *
 * Tracks: discovery rates, plugin error rates, LLM costs, entity growth,
 * feedback ratios, and pipeline throughput.
 */

import { daysAgo, nowIso } from '../utils/time.js';

/**
 * Compute health metrics from the world model and logs.
 */
export function computeHealthMetrics(worldModel, options = {}) {
  const stats = worldModel.getStats();
  const oneDayAgo = daysAgo(1);
  const sevenDaysAgo = daysAgo(7);

  // Discovery metrics
  const recentDiscoveries = worldModel.getRecentDiscoveries(oneDayAgo, 100);
  const weekDiscoveries = worldModel.getRecentDiscoveries(sevenDaysAgo, 500);

  const discoveriesToday = recentDiscoveries.length;
  const discoveriesThisWeek = weekDiscoveries.length;
  const avgDiscoveriesPerDay = discoveriesThisWeek / 7;

  // Feedback metrics
  const withReaction = weekDiscoveries.filter((d) => d.user_reaction && d.user_reaction !== 'neutral');
  const positiveReactions = withReaction.filter((d) => d.user_reaction === 'positive');
  const negativeReactions = withReaction.filter((d) => d.user_reaction === 'negative');
  const actedOn = weekDiscoveries.filter((d) => d.acted_on);

  const feedbackRate = weekDiscoveries.length > 0
    ? withReaction.length / weekDiscoveries.length
    : 0;

  const positiveRate = withReaction.length > 0
    ? positiveReactions.length / withReaction.length
    : 0;

  const actionRate = weekDiscoveries.length > 0
    ? actedOn.length / weekDiscoveries.length
    : 0;

  // Entity growth
  const recentEntities = worldModel.getChangedEntities(sevenDaysAgo, 500);
  const entityGrowthRate = recentEntities.length;

  // Event throughput
  const recentEvents = worldModel.getRecentEvents(oneDayAgo, 1000);
  const eventsTodayCount = recentEvents.length;

  // Active situations
  const activeSituations = worldModel.getActiveSituations(100);

  // Pattern health
  const patterns = worldModel.getPatterns(100);
  const highConfidencePatterns = patterns.filter((p) => p.confidence >= 0.7);

  // Discovery type distribution
  const typeDistribution = {};
  for (const d of weekDiscoveries) {
    typeDistribution[d.type] = (typeDistribution[d.type] || 0) + 1;
  }

  // Urgency distribution
  const urgencyDistribution = {};
  for (const d of weekDiscoveries) {
    urgencyDistribution[d.urgency] = (urgencyDistribution[d.urgency] || 0) + 1;
  }

  return {
    timestamp: nowIso(),
    totals: stats,
    daily: {
      discoveries: discoveriesToday,
      events: eventsTodayCount
    },
    weekly: {
      discoveries: discoveriesThisWeek,
      avgDiscoveriesPerDay: Math.round(avgDiscoveriesPerDay * 10) / 10,
      feedbackRate: Math.round(feedbackRate * 100),
      positiveRate: Math.round(positiveRate * 100),
      actionRate: Math.round(actionRate * 100),
      entityGrowth: entityGrowthRate,
      typeDistribution,
      urgencyDistribution
    },
    active: {
      situations: activeSituations.length,
      patterns: patterns.length,
      highConfidencePatterns: highConfidencePatterns.length
    }
  };
}

/**
 * Detect health anomalies that might be worth surfacing to the user.
 */
export function detectHealthAnomalies(metrics) {
  const anomalies = [];

  // No discoveries in 24h despite having events
  if (metrics.daily.discoveries === 0 && metrics.daily.events > 10) {
    anomalies.push({
      type: 'no_discoveries',
      severity: 'warning',
      message: `OWL processed ${metrics.daily.events} events today but generated no discoveries. The LLM may be too conservative or the quality filter too strict.`
    });
  }

  // Very low positive rate
  if (metrics.weekly.discoveries >= 5 && metrics.weekly.positiveRate < 20) {
    anomalies.push({
      type: 'low_quality',
      severity: 'warning',
      message: `Only ${metrics.weekly.positiveRate}% of discoveries this week got positive reactions. OWL may need tuning — consider adjusting the importance threshold or LLM model.`
    });
  }

  // Very high discovery rate (possible hallucination flood)
  if (metrics.weekly.avgDiscoveriesPerDay > 8) {
    anomalies.push({
      type: 'high_volume',
      severity: 'info',
      message: `OWL is averaging ${metrics.weekly.avgDiscoveriesPerDay} discoveries/day — above the recommended 3-5. Consider raising minConfidence or lowering maxDiscoveriesPerDay.`
    });
  }

  // No events at all (plugins might be broken)
  if (metrics.daily.events === 0 && metrics.totals.events > 0) {
    anomalies.push({
      type: 'no_events',
      severity: 'error',
      message: 'No events ingested in the past 24 hours. One or more plugins may have stopped working.'
    });
  }

  // Zero feedback (user not engaging)
  if (metrics.weekly.discoveries >= 10 && metrics.weekly.feedbackRate === 0) {
    anomalies.push({
      type: 'no_feedback',
      severity: 'info',
      message: 'No user feedback received this week. OWL learns from your reactions — consider replying to discoveries so OWL can improve.'
    });
  }

  return anomalies;
}

/**
 * Format health metrics for CLI display.
 */
export function formatHealthReport(metrics, anomalies = []) {
  const lines = [
    'OWL Health Report',
    '─'.repeat(40),
    '',
    `Entities: ${metrics.totals.entities}  |  Relationships: ${metrics.totals.relationships}`,
    `Events: ${metrics.totals.events}  |  Patterns: ${metrics.totals.patterns}`,
    `Discoveries: ${metrics.totals.discoveries}  |  Situations: ${metrics.totals.situations}`,
    '',
    `Today: ${metrics.daily.discoveries} discoveries from ${metrics.daily.events} events`,
    `This week: ${metrics.weekly.discoveries} discoveries (avg ${metrics.weekly.avgDiscoveriesPerDay}/day)`,
    '',
    `Feedback rate: ${metrics.weekly.feedbackRate}%  |  Positive: ${metrics.weekly.positiveRate}%  |  Acted on: ${metrics.weekly.actionRate}%`,
    `Active situations: ${metrics.active.situations}  |  Patterns: ${metrics.active.patterns} (${metrics.active.highConfidencePatterns} high-confidence)`,
    `Entity growth (7d): +${metrics.weekly.entityGrowth}`
  ];

  if (Object.keys(metrics.weekly.typeDistribution).length > 0) {
    const types = Object.entries(metrics.weekly.typeDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}`)
      .join('  ');
    lines.push(`Discovery types: ${types}`);
  }

  if (anomalies.length > 0) {
    lines.push('', 'Alerts:');
    for (const a of anomalies) {
      const icon = a.severity === 'error' ? '[!]' : a.severity === 'warning' ? '[~]' : '[i]';
      lines.push(`  ${icon} ${a.message}`);
    }
  }

  return lines.join('\n');
}
