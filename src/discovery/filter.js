import { jaccardSimilarity } from '../utils/text.js';
import { startOfTodayIso } from '../utils/time.js';
import { getPreferenceScore } from '../learning/improvement.js';
import { computeCalibration, calibrateConfidence } from '../learning/calibration.js';

const URGENCY_SCORES = {
  urgent: 3,
  important: 2,
  interesting: 1
};

const VALID_TYPES = new Set(['connection', 'anomaly', 'risk', 'opportunity', 'anticipation', 'time_sensitive']);
const VALID_URGENCIES = new Set(['urgent', 'important', 'interesting']);

function safeJsonParse(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : parsed.discoveries || [];
  } catch {
    const match = value.match(/\[[\s\S]*\]/);
    return match ? safeJsonParse(match[0]) : [];
  }
}

export function parseDiscoveries(response) {
  return safeJsonParse(response);
}

export function isValidDiscovery(discovery) {
  return Boolean(
    discovery &&
      VALID_TYPES.has(discovery.type) &&
      VALID_URGENCIES.has(discovery.urgency) &&
      typeof discovery.title === 'string' &&
      typeof discovery.body === 'string' &&
      Array.isArray(discovery.sources) &&
      Array.isArray(discovery.entities) &&
      Number.isFinite(Number(discovery.confidence))
  );
}

export function urgencyScore(discovery) {
  return URGENCY_SCORES[discovery.urgency] || 0;
}

export function meetsImportanceThreshold(discovery, config = {}) {
  const threshold = config.importanceThreshold || 'medium';
  if (threshold === 'low') {
    return true;
  }
  if (threshold === 'high') {
    return discovery.urgency === 'urgent';
  }
  return discovery.urgency === 'urgent' || discovery.urgency === 'important';
}

function isNovelWithinBatch(discovery, accepted) {
  return !accepted.some(
    (existing) => jaccardSimilarity(`${discovery.title} ${discovery.body}`, `${existing.title} ${existing.body}`) > 0.65
  );
}

export function filterDiscoveries(discoveries, worldModel, config = {}) {
  const dailyRemaining = Math.max(0, (config.maxDiscoveriesPerDay || 5) - worldModel.countDiscoveriesSince(startOfTodayIso()));
  if (dailyRemaining === 0) {
    return [];
  }

  const accepted = [];
  const minConfidence = config.minConfidence || 0.6;
  const maxPerRun = Math.min(config.maxDiscoveriesPerRun || 3, dailyRemaining);

  // Compute confidence calibration from historical feedback
  let calibration = {};
  try {
    calibration = computeCalibration(worldModel);
  } catch {
    // Non-fatal — use uncalibrated confidence
  }

  const ordered = parseDiscoveries(discoveries)
    .filter(isValidDiscovery)
    .map((item) => ({
      ...item,
      confidence: calibrateConfidence(Number(item.confidence), calibration)
    }))
    .filter((item) => item.confidence >= minConfidence)
    .filter((item) => meetsImportanceThreshold(item, config))
    .filter((item) => !worldModel.hasDiscoveredSimilar(`${item.title} ${item.body}`, 7, 0.6))
    .map((item) => ({
      ...item,
      _prefScore: getPreferenceScore(worldModel, item)
    }))
    .sort((left, right) => {
      // Primary: urgency.  Secondary: preference-weighted confidence.
      const urgencyDiff = urgencyScore(right) - urgencyScore(left);
      if (urgencyDiff !== 0) {
        return urgencyDiff;
      }
      return (Number(right.confidence) * right._prefScore) - (Number(left.confidence) * left._prefScore);
    });

  for (const item of ordered) {
    if (accepted.length >= maxPerRun) {
      break;
    }

    if (!isNovelWithinBatch(item, accepted)) {
      continue;
    }

    accepted.push({
      ...item,
      confidence: Number(item.confidence)
    });
  }

  return accepted;
}
