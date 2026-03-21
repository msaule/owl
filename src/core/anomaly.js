/**
 * Anomaly Scoring — detects statistical anomalies in event patterns.
 *
 * Builds baselines from historical event rates and flags significant
 * deviations. For example: "Gmail volume is 3x normal for a Saturday"
 * or "No Shopify orders in 24 hours (normally get ~5/day)".
 */

import { daysAgo, nowIso } from '../utils/time.js';

/**
 * Compute hourly event rate baselines by source and day-of-week.
 * Returns a Map<sourceKey, { mean, stddev, count }> where sourceKey
 * is "source:dayOfWeek:hourBucket".
 */
export function computeBaselines(worldModel, lookbackDays = 30) {
  const since = daysAgo(lookbackDays);
  const events = worldModel.getRecentEvents(since, 10000);

  // Bucket events by source + day + 4-hour block
  const buckets = {};

  for (const event of events) {
    const date = new Date(event.timestamp);
    const dayOfWeek = date.getDay(); // 0-6
    const hourBucket = Math.floor(date.getHours() / 4); // 0-5 (4h blocks)
    const key = `${event.source}:${dayOfWeek}:${hourBucket}`;

    // Count events per calendar day in this bucket
    const dateKey = `${key}:${date.toISOString().slice(0, 10)}`;
    if (!buckets[key]) buckets[key] = {};
    buckets[key][dateKey] = (buckets[key][dateKey] || 0) + 1;
  }

  // Compute mean and stddev for each bucket
  const baselines = new Map();

  for (const [key, dateCounts] of Object.entries(buckets)) {
    const values = Object.values(dateCounts);
    const count = values.length;
    if (count < 3) continue; // Need at least 3 data points

    const mean = values.reduce((a, b) => a + b, 0) / count;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count;
    const stddev = Math.sqrt(variance);

    baselines.set(key, { mean, stddev, count });
  }

  return baselines;
}

/**
 * Detect anomalies in the current period's events against baselines.
 * Returns an array of anomaly objects.
 */
export function detectAnomalies(worldModel, baselines, lookbackHours = 4) {
  const since = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();
  const events = worldModel.getRecentEvents(since, 1000);
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hourBucket = Math.floor(now.getHours() / 4);

  // Count events by source in current period
  const currentCounts = {};
  for (const event of events) {
    currentCounts[event.source] = (currentCounts[event.source] || 0) + 1;
  }

  const anomalies = [];

  // Check for volume spikes
  for (const [source, count] of Object.entries(currentCounts)) {
    const key = `${source}:${dayOfWeek}:${hourBucket}`;
    const baseline = baselines.get(key);
    if (!baseline || baseline.stddev === 0) continue;

    const zScore = (count - baseline.mean) / baseline.stddev;

    if (zScore > 2.0) {
      anomalies.push({
        type: 'volume_spike',
        source,
        severity: zScore > 3.0 ? 'high' : 'medium',
        currentCount: count,
        expectedMean: Math.round(baseline.mean * 10) / 10,
        zScore: Math.round(zScore * 100) / 100,
        message: `${source} has ${count} events in the last ${lookbackHours}h — normally ~${Math.round(baseline.mean)} at this time. ${Math.round(zScore)}x standard deviation above normal.`
      });
    }
  }

  // Check for missing sources (silence anomalies)
  const allSources = new Set();
  for (const key of baselines.keys()) {
    const parts = key.split(':');
    if (Number(parts[1]) === dayOfWeek && Number(parts[2]) === hourBucket) {
      allSources.add(parts[0]);
    }
  }

  for (const source of allSources) {
    if (currentCounts[source]) continue; // Source has events

    const key = `${source}:${dayOfWeek}:${hourBucket}`;
    const baseline = baselines.get(key);
    if (!baseline || baseline.mean < 2) continue; // Only flag if we normally expect events

    anomalies.push({
      type: 'silence',
      source,
      severity: baseline.mean > 5 ? 'high' : 'medium',
      currentCount: 0,
      expectedMean: Math.round(baseline.mean * 10) / 10,
      zScore: baseline.stddev > 0 ? Math.round((-baseline.mean / baseline.stddev) * 100) / 100 : -99,
      message: `No events from ${source} in the last ${lookbackHours}h — normally ~${Math.round(baseline.mean)} at this time.`
    });
  }

  return anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

/**
 * Format anomalies into event objects that can be ingested by the discovery engine.
 */
export function anomaliesToEvents(anomalies) {
  return anomalies.map((anomaly) => ({
    id: `anomaly-${anomaly.source}-${Date.now()}`,
    source: 'owl-internal',
    type: `anomaly.${anomaly.type}`,
    timestamp: nowIso(),
    summary: anomaly.message,
    data: {
      source: anomaly.source,
      zScore: anomaly.zScore,
      currentCount: anomaly.currentCount,
      expectedMean: anomaly.expectedMean
    },
    importance: anomaly.severity === 'high' ? 0.85 : 0.65
  }));
}
