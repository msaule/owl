import { canonicalizeEntity, scoreEntityMatch } from './entity.js';
import { updatePatternsForEvent } from './pattern.js';
import { updateSituationsFromEvent } from './situation.js';
import { createId } from '../utils/id.js';
import { inferDomainCompany, normalizeText, truncate } from '../utils/text.js';
import { nowIso } from '../utils/time.js';

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HANDLE_REGEX = /(^|\s)@([a-z0-9_.-]{2,})/gi;
const URL_REGEX = /\bhttps?:\/\/[^\s/$.?#].[^\s]*/gi;
const CAPITALIZED_PHRASE_REGEX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-zA-Z.&-]+)+)\b/g;

function parseAddressName(address) {
  const match = String(address || '').match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) {
    return {
      name: String(address || '').split('@')[0] || String(address || ''),
      email: String(address || '').includes('@') ? String(address || '') : undefined
    };
  }

  return {
    name: match[1].replace(/^"|"$/g, '').trim(),
    email: match[2].trim()
  };
}

function uniqueEntities(entities) {
  const seen = new Set();
  const output = [];

  for (const entity of entities) {
    const email = normalizeText(entity.attributes?.email || '');
    const domain = normalizeText(entity.attributes?.domain || '');
    const key = email
      ? `${entity.type}:email:${email}`
      : domain
        ? `${entity.type}:domain:${domain}`
        : `${entity.type}:name:${normalizeText(entity.name)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(entity);
  }

  return output;
}

export function extractEntitiesSimple(event) {
  const text = [
    event.summary,
    event.data?.subject,
    event.data?.snippet,
    event.data?.title,
    event.data?.description,
    event.data?.location,
    Array.isArray(event.data?.attendees) ? event.data.attendees.join(', ') : '',
    Array.isArray(event.data?.from) ? event.data.from.join(', ') : event.data?.from,
    Array.isArray(event.data?.to) ? event.data.to.join(', ') : event.data?.to,
    Array.isArray(event.data?.cc) ? event.data.cc.join(', ') : event.data?.cc
  ]
    .filter(Boolean)
    .join('\n');

  const entities = [];

  for (const email of text.match(EMAIL_REGEX) || []) {
    const [username, domain] = email.split('@');
    entities.push({
      type: 'person',
      name: username.replace(/[._-]+/g, ' '),
      attributes: { email, domain, aliases: [username] },
      importance: 0.55
    });
    entities.push({
      type: 'company',
      name: inferDomainCompany(domain),
      attributes: { domain },
      importance: 0.5
    });
  }

  for (const field of ['from', 'to', 'cc']) {
    const raw = event.data?.[field];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of values) {
      const parsed = parseAddressName(item);
      if (parsed.name) {
        entities.push({
          type: 'person',
          name: parsed.name,
          attributes: {
            email: parsed.email,
            domain: parsed.email?.split('@')[1]
          },
          importance: 0.6
        });
      }
    }
  }

  for (const match of text.matchAll(HANDLE_REGEX)) {
    entities.push({
      type: 'person',
      name: match[2],
      attributes: { username: match[2], aliases: [match[2]] },
      importance: 0.45
    });
  }

  for (const url of text.match(URL_REGEX) || []) {
    try {
      const domain = new URL(url).hostname.replace(/^www\./, '');
      entities.push({
        type: 'company',
        name: inferDomainCompany(domain),
        attributes: { domain, url },
        importance: 0.45
      });
    } catch {
      // Ignore malformed URLs.
    }
  }

  for (const match of text.matchAll(CAPITALIZED_PHRASE_REGEX)) {
    const phrase = match[1].trim();
    entities.push({
      type: 'custom',
      name: phrase,
      attributes: { aliases: [phrase] },
      importance: 0.35
    });
  }

  return uniqueEntities(entities).filter((entity) => entity.name);
}

export function resolveEntities(extractedEntities, worldModel, options = {}) {
  const threshold = options.threshold || 0.75;
  const resolved = [];

  for (const entity of extractedEntities) {
    const candidate = canonicalizeEntity(entity, nowIso(), options.source);
    const searchTerms = Array.from(new Set([candidate.name, candidate.attributes?.email, candidate.attributes?.domain].filter(Boolean)));

    let best = null;
    let bestScore = 0;

    for (const term of searchTerms) {
      const matches = worldModel.findEntities(term, 10);
      for (const match of matches) {
        const score = scoreEntityMatch(candidate, match);
        if (score > bestScore) {
          best = match;
          bestScore = score;
        }
      }
    }

    if (best && bestScore >= threshold) {
      resolved.push({
        ...best,
        name: best.name || candidate.name,
        type: best.type || candidate.type,
        attributes: {
          ...(best.attributes || {}),
          ...(candidate.attributes || {}),
          aliases: Array.from(
            new Set([...(best.attributes?.aliases || []), ...(candidate.attributes?.aliases || []), candidate.name])
          )
        },
        sources: Array.from(new Set([...(best.sources || []), ...(candidate.sources || []), options.source].filter(Boolean))),
        importance: Math.max(best.importance || 0.5, candidate.importance || 0.5),
        last_seen: nowIso()
      });
      continue;
    }

    resolved.push(candidate);
  }

  return uniqueEntities(resolved);
}

function inferRelationshipType(leftEntity, rightEntity, event) {
  if (event.type.startsWith('email.')) {
    return 'communicates_with';
  }

  if (event.type.startsWith('calendar.')) {
    return 'meets_with';
  }

  if (leftEntity.type === 'person' && rightEntity.type === 'company') {
    return 'associated_with';
  }

  return 'related_to';
}

export function updateRelationships(entities, event, worldModel) {
  for (let left = 0; left < entities.length; left += 1) {
    for (let right = left + 1; right < entities.length; right += 1) {
      const leftEntity = entities[left];
      const rightEntity = entities[right];
      if (!leftEntity?.id || !rightEntity?.id || leftEntity.id === rightEntity.id) {
        continue;
      }

      worldModel.addRelationship({
        from_entity: leftEntity.id,
        to_entity: rightEntity.id,
        type: inferRelationshipType(leftEntity, rightEntity, event),
        strength: Math.max(0.45, event.importance || 0.5),
        last_seen: event.timestamp,
        evidence: [truncate(event.summary, 140)]
      });
    }
  }
}

function normalizeEvent(event) {
  return {
    id: event.id || createId('event'),
    source: event.source,
    type: event.type,
    timestamp: event.timestamp || nowIso(),
    summary: truncate(event.summary || `${event.type} from ${event.source}`, 240),
    data: event.data || {},
    importance: Number.isFinite(event.importance) ? event.importance : 0.5,
    entities: event.entities || [],
    processed: Boolean(event.processed)
  };
}

export function shouldUseLlmExtraction(event, simpleEntities) {
  const textLength = JSON.stringify(event.data || {}).length + String(event.summary || '').length;
  return simpleEntities.length < 2 && textLength > 280;
}

export async function processEvent(rawEvent, worldModel, llmConnection, options = {}) {
  const event = normalizeEvent(rawEvent);
  const simpleEntities = extractEntitiesSimple(event);
  const resolvedEntities = resolveEntities(simpleEntities, worldModel, { source: event.source });

  for (const entity of resolvedEntities) {
    worldModel.upsertEntity(entity);
  }

  const persistedEntities = resolvedEntities
    .map((entity) => worldModel.getEntity(entity.id) || entity)
    .filter(Boolean);

  event.entities = persistedEntities.map((entity) => entity.id);
  worldModel.addEvent(event);
  updateRelationships(persistedEntities, event, worldModel);
  updatePatternsForEvent(worldModel, event);
  updateSituationsFromEvent(worldModel, event);

  if (llmConnection && options.entityQueue && shouldUseLlmExtraction(event, simpleEntities)) {
    options.entityQueue.enqueue(event);
  }

  options.logger?.debug('Processed event', {
    eventId: event.id,
    source: event.source,
    type: event.type,
    entityCount: event.entities.length
  });

  return event;
}
