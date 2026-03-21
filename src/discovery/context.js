import { daysAgo, hoursAgo } from '../utils/time.js';
import { truncate } from '../utils/text.js';
import { findCorrelations, formatCorrelationsForPrompt } from './correlation.js';

const TOKEN_BUDGETS = {
  quick: 4000,
  deep: 8000,
  daily: 12000
};

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function formatSection(title, lines) {
  if (!lines.length) {
    return '';
  }

  return `## ${title}\n${lines.join('\n')}`;
}

function formatEvent(event, detail = 'full') {
  const base = `- [${event.timestamp}] ${event.source}/${event.type}: ${truncate(event.summary, detail === 'full' ? 180 : 90)}`;
  if (detail !== 'full') {
    return base;
  }

  const extras = [];
  if (event.entities?.length) {
    extras.push(`entities=${event.entities.join(', ')}`);
  }
  if (event.importance != null) {
    extras.push(`importance=${event.importance}`);
  }
  if (event.data?.snippet) {
    extras.push(`snippet=${truncate(event.data.snippet, 120)}`);
  }
  if (event.data?.subject) {
    extras.push(`subject=${truncate(event.data.subject, 80)}`);
  }

  return extras.length ? `${base} (${extras.join('; ')})` : base;
}

function formatEntity(entity) {
  const attrs = Object.entries(entity.attributes || {})
    .filter(([key, value]) => value && !Array.isArray(value))
    .slice(0, 4)
    .map(([key, value]) => `${key}=${truncate(String(value), 40)}`)
    .join(', ');

  return `- ${entity.name} [${entity.type}] last_seen=${entity.last_seen}${attrs ? ` (${attrs})` : ''}`;
}

function formatPattern(pattern) {
  return `- ${pattern.description} | confidence=${pattern.confidence} | next_expected=${pattern.next_expected || 'unknown'}`;
}

function formatSituation(situation) {
  return `- urgency=${situation.urgency}: ${situation.description}`;
}

function formatDiscovery(discovery) {
  return `- [${discovery.timestamp}] ${discovery.urgency.toUpperCase()} ${discovery.title}: ${truncate(discovery.body, 160)}`;
}

function defaultSince(scanType) {
  if (scanType === 'quick') {
    return hoursAgo(24);
  }
  if (scanType === 'deep') {
    return hoursAgo(72);
  }
  return daysAgo(14);
}

export function compileContext(worldModel, scanType = 'quick', options = {}) {
  const since = options.lastRunTime || defaultSince(scanType);
  const sections = [];

  const situations = worldModel.getActiveSituations().map(formatSituation);
  if (situations.length) {
    sections.push(formatSection('Active Situations', situations));
  }

  const recentEvents = worldModel
    .getRecentEvents(since, scanType === 'quick' ? 80 : scanType === 'deep' ? 180 : 260)
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

  const changedEntities = worldModel.getChangedEntities(since, 40).map(formatEntity);
  if (changedEntities.length) {
    sections.push(formatSection('Entity Updates', changedEntities));
  }

  const patterns = worldModel
    .getPatterns(40)
    .filter((pattern) => !pattern.next_expected || new Date(pattern.next_expected).getTime() <= Date.now() + 14 * 86_400_000)
    .map(formatPattern);
  if (patterns.length) {
    sections.push(formatSection('Patterns', patterns));
  }

  const upcoming = worldModel.getUpcomingEvents(7, 60).map((event) => formatEvent(event, 'compact'));
  if (upcoming.length) {
    sections.push(formatSection('Upcoming', upcoming));
  }

  const recentDiscoveries = worldModel.getRecentDiscoveries(daysAgo(3), 30).map(formatDiscovery);
  if (recentDiscoveries.length) {
    sections.push(formatSection('Already Told User (do NOT repeat)', recentDiscoveries));
  }

  // Cross-source correlations (only for deep and daily scans)
  if (scanType !== 'quick') {
    try {
      const correlations = findCorrelations(worldModel, { lookbackDays: scanType === 'daily' ? 14 : 7 });
      const correlationSection = formatCorrelationsForPrompt(correlations);
      if (correlationSection) {
        sections.push(correlationSection);
      }
    } catch {
      // Non-fatal — skip correlations if computation fails
    }
  }

  let eventLines = recentEvents.map((event) => formatEvent(event, 'full'));
  sections.splice(Math.min(1, sections.length), 0, formatSection('Recent Events', eventLines));
  let context = sections.filter(Boolean).join('\n\n');
  const tokenBudget = TOKEN_BUDGETS[scanType] || TOKEN_BUDGETS.quick;

  if (estimateTokens(context) > tokenBudget) {
    eventLines = recentEvents.slice(Math.max(0, recentEvents.length - 80)).map((event) => formatEvent(event, 'compact'));
    sections.splice(Math.min(1, sections.length - 1), 1, formatSection('Recent Events', eventLines));
    context = sections.filter(Boolean).join('\n\n');
  }

  if (estimateTokens(context) > tokenBudget) {
    const compactSections = sections.filter((section) => !section.startsWith('## Entity Updates'));
    context = compactSections.join('\n\n');
  }

  return context;
}
