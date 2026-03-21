/**
 * Weekly Debrief — generates a high-level summary of OWL's observations
 * over the past week. Think of it as OWL's "weekly newsletter" to the user.
 *
 * Runs once per week (Sunday evening by default) and produces a single
 * meta-discovery that summarizes: top discoveries, new entities, pattern
 * changes, and an overall outlook.
 */

import { daysAgo, nowIso } from '../utils/time.js';
import { truncate } from '../utils/text.js';
import { computeHealthMetrics } from './health.js';

/**
 * Compile the raw data for a weekly debrief.
 */
export function compileDebriefData(worldModel) {
  const since = daysAgo(7);

  const discoveries = worldModel.getRecentDiscoveries(since, 100);
  const events = worldModel.getRecentEvents(since, 500);
  const entities = worldModel.getChangedEntities(since, 100);
  const situations = worldModel.getActiveSituations(20);
  const patterns = worldModel.getPatterns(20);
  const metrics = computeHealthMetrics(worldModel);

  // Top discoveries by urgency and user reaction
  const topDiscoveries = discoveries
    .filter((d) => d.user_reaction === 'positive' || d.urgency === 'urgent')
    .slice(0, 5);

  // Most active sources
  const sourceCounts = {};
  for (const event of events) {
    sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // New entities this week
  const newEntities = entities
    .filter((e) => new Date(e.first_seen) >= new Date(since))
    .slice(0, 10);

  // Evolving patterns
  const activePatterns = patterns
    .filter((p) => p.confidence >= 0.6)
    .slice(0, 5);

  return {
    period: { from: since, to: nowIso() },
    discoveries: {
      total: discoveries.length,
      top: topDiscoveries,
      typeBreakdown: metrics.weekly.typeDistribution,
      urgencyBreakdown: metrics.weekly.urgencyDistribution
    },
    events: {
      total: events.length,
      topSources
    },
    entities: {
      newCount: newEntities.length,
      newEntities: newEntities.map((e) => ({ name: e.name, type: e.type })),
      totalActive: entities.length
    },
    situations: {
      active: situations.length,
      list: situations.slice(0, 5).map((s) => ({
        description: truncate(s.description, 120),
        urgency: s.urgency
      }))
    },
    patterns: {
      active: activePatterns.length,
      list: activePatterns.map((p) => ({
        description: truncate(p.description, 120),
        frequency: p.frequency,
        confidence: p.confidence
      }))
    },
    health: {
      feedbackRate: metrics.weekly.feedbackRate,
      positiveRate: metrics.weekly.positiveRate,
      actionRate: metrics.weekly.actionRate
    }
  };
}

/**
 * Build the LLM prompt for generating the weekly debrief.
 */
export function buildDebriefPrompt(debriefData, userName = 'the user') {
  const systemPrompt = `You are OWL writing a weekly debrief for ${userName}. This is a summary of everything noteworthy from the past 7 days across all data sources.

STYLE:
- Write like a trusted advisor giving a 2-minute briefing
- Lead with the most important insight
- Group related observations
- End with a forward-looking statement about what to watch next week
- Be conversational but concise
- Reference specific entities, patterns, and discoveries by name`;

  const sections = [];

  sections.push(`Week overview: ${debriefData.discoveries.total} discoveries generated from ${debriefData.events.total} events.`);

  if (debriefData.discoveries.top.length > 0) {
    sections.push('Top discoveries this week:\n' + debriefData.discoveries.top.map(
      (d) => `- [${d.urgency}] ${d.title}: ${truncate(d.body, 100)}`
    ).join('\n'));
  }

  if (debriefData.events.topSources.length > 0) {
    sections.push('Most active sources: ' + debriefData.events.topSources.map(
      ([source, count]) => `${source} (${count} events)`
    ).join(', '));
  }

  if (debriefData.entities.newCount > 0) {
    sections.push(`${debriefData.entities.newCount} new entities appeared: ` +
      debriefData.entities.newEntities.map((e) => `${e.name} [${e.type}]`).join(', '));
  }

  if (debriefData.situations.active > 0) {
    sections.push('Active situations:\n' + debriefData.situations.list.map(
      (s) => `- [urgency ${s.urgency}] ${s.description}`
    ).join('\n'));
  }

  if (debriefData.patterns.active > 0) {
    sections.push('Active patterns:\n' + debriefData.patterns.list.map(
      (p) => `- ${p.description} (${p.frequency}, confidence ${p.confidence})`
    ).join('\n'));
  }

  sections.push(`Feedback: ${debriefData.health.feedbackRate}% response rate, ${debriefData.health.positiveRate}% positive, ${debriefData.health.actionRate}% acted on.`);

  const userPrompt = `${sections.join('\n\n')}

Write a weekly debrief in 4-8 sentences. Structure as a brief narrative, not bullet points.

Return a JSON object:
{
  "type": "connection",
  "urgency": "interesting",
  "title": "Weekly Debrief: [key theme]",
  "body": "The debrief narrative. End with what to watch next week.",
  "sources": ["owl"],
  "entities": [],
  "confidence": 0.9
}`;

  return { systemPrompt, userPrompt };
}
