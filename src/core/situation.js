import { createId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';

const URGENT_KEYWORDS = ['urgent', 'delay', 'blocked', 'failed', 'cancelled', 'overdue', 'refund', 'escalation'];

export function inferSituationsFromEvent(event) {
  const text = `${event.summary || ''} ${JSON.stringify(event.data || {})}`.toLowerCase();
  const situations = [];

  if (URGENT_KEYWORDS.some((keyword) => text.includes(keyword))) {
    situations.push({
      id: createId('sit'),
      description: `Possible issue emerging from ${event.type}: ${event.summary}`,
      urgency: Math.max(event.importance || 0.5, 0.72),
      entities: event.entities || [],
      related_events: [event.id],
      status: 'active',
      created_at: nowIso(),
      updated_at: nowIso()
    });
  }

  if (event.type === 'calendar.event.approaching') {
    situations.push({
      id: createId('sit'),
      description: `Upcoming meeting requires preparation: ${event.summary}`,
      urgency: Math.max(event.importance || 0.5, 0.6),
      entities: event.entities || [],
      related_events: [event.id],
      status: 'active',
      created_at: nowIso(),
      updated_at: nowIso()
    });
  }

  return situations;
}

export function updateSituationsFromEvent(worldModel, event) {
  for (const situation of inferSituationsFromEvent(event)) {
    worldModel.addSituation(situation);
  }
}
