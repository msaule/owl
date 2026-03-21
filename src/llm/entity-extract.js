import { resolveEntities } from '../core/event-processor.js';
import { truncate } from '../utils/text.js';

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }

    return JSON.parse(match[0]);
  }
}

export async function extractEntitiesWithLlm(llm, events) {
  const systemPrompt = [
    'You extract entities from event summaries.',
    'Return JSON only.',
    'For each event, extract people, companies, products, and projects.',
    'Never invent details. Use only evidence in the event payload.'
  ].join(' ');

  const userPrompt = JSON.stringify(
    events.map((event) => ({
      eventId: event.id,
      source: event.source,
      type: event.type,
      summary: event.summary,
      data: event.data
    })),
    null,
    2
  );

  const response = await llm.chat(systemPrompt, userPrompt, {
    temperature: 0.1,
    maxTokens: 1600,
    responseFormat: 'json'
  });

  const parsed = safeParseJson(response);
  return Array.isArray(parsed) ? parsed : parsed.events || [];
}

export class EntityExtractionQueue {
  constructor({ worldModel, llm, logger, batchSize = 20 }) {
    this.worldModel = worldModel;
    this.llm = llm;
    this.logger = logger;
    this.batchSize = batchSize;
    this.queue = [];
  }

  enqueue(event) {
    if (!this.queue.find((item) => item.id === event.id)) {
      this.queue.push(event);
    }
  }

  pendingCount() {
    return this.queue.length;
  }

  async flush() {
    if (!this.llm || this.queue.length === 0) {
      return [];
    }

    const batch = this.queue.splice(0, this.batchSize);
    const results = await extractEntitiesWithLlm(this.llm, batch);
    const updatedEvents = [];

    for (const result of results) {
      const existingEvent = this.worldModel.getEvent(result.eventId);
      if (!existingEvent) {
        continue;
      }

      const extracted = (result.entities || []).map((entity) => ({
        type: entity.type || 'custom',
        name: entity.name,
        attributes: entity.attributes || entity.details || {},
        importance: entity.importance || existingEvent.importance || 0.5
      }));

      const resolved = resolveEntities(extracted, this.worldModel, { source: existingEvent.source });
      for (const entity of resolved) {
        this.worldModel.upsertEntity(entity);
      }

      const entityIds = Array.from(new Set([...(existingEvent.entities || []), ...resolved.map((entity) => entity.id)]));
      this.worldModel.addEvent({
        ...existingEvent,
        summary: truncate(existingEvent.summary, 240),
        entities: entityIds,
        processed: false
      });

      updatedEvents.push({ eventId: existingEvent.id, entityIds });
    }

    this.logger?.info('Flushed entity extraction queue', {
      requested: batch.length,
      updated: updatedEvents.length
    });

    return updatedEvents;
  }
}
