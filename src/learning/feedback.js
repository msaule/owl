import { recordDiscoveryPreference } from './preferences.js';

const POSITIVE_PATTERNS = ['thanks', 'useful', 'good', 'great', 'helpful', 'amazing', 'nice', '👍'];
const NEGATIVE_PATTERNS = ['obvious', 'i knew', 'not useful', 'irrelevant', 'bad', 'wrong', '👎'];
const ACTION_PATTERNS = ['done', 'handled', 'i did', 'ordered', 'called', 'sent', 'fixed', 'deployed'];

/**
 * Mark any discoveries older than `hours` with no user reaction as neutral.
 * Also expires stale active situations.  Meant to be called on a schedule.
 */
export function runFeedbackExpiry(worldModel, { discoveryHours = 48, situationDays = 7 } = {}) {
  const expiredDiscoveries = worldModel.expireStaleDiscoveries(discoveryHours);
  const expiredSituations = worldModel.expireStaleSituations(situationDays);
  return { expiredDiscoveries, expiredSituations };
}

export function classifyFeedback(message) {
  const text = String(message || '').toLowerCase();
  if (ACTION_PATTERNS.some((pattern) => text.includes(pattern))) {
    return { reaction: 'positive', actedOn: true };
  }
  if (POSITIVE_PATTERNS.some((pattern) => text.includes(pattern))) {
    return { reaction: 'positive', actedOn: false };
  }
  if (NEGATIVE_PATTERNS.some((pattern) => text.includes(pattern))) {
    return { reaction: 'negative', actedOn: false };
  }
  return { reaction: 'neutral', actedOn: false };
}

export function recordFeedbackFromReply(worldModel, discoveryId, message) {
  const discovery = worldModel.getDiscovery(discoveryId);
  if (!discovery) {
    return null;
  }

  const result = classifyFeedback(message);
  worldModel.updateDiscoveryReaction(discoveryId, result.reaction, result.actedOn);

  if (result.reaction === 'positive') {
    recordDiscoveryPreference(worldModel, discovery, result.actedOn ? 2 : 1);
  } else if (result.reaction === 'negative') {
    recordDiscoveryPreference(worldModel, discovery, -1);
  }

  return { discovery, ...result };
}
