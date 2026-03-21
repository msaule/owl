import { createId } from '../utils/id.js';

export function canonicalizeRelationship(relationship, timestamp) {
  return {
    id: relationship.id || createId('rel'),
    from_entity: relationship.from_entity,
    to_entity: relationship.to_entity,
    type: relationship.type || 'related_to',
    strength: Number.isFinite(relationship.strength) ? relationship.strength : 0.5,
    first_seen: relationship.first_seen || timestamp,
    last_seen: relationship.last_seen || timestamp,
    evidence: relationship.evidence || []
  };
}

export function strengthenRelationship(existing, incoming, timestamp) {
  const evidence = Array.from(new Set([...(existing.evidence || []), ...(incoming.evidence || [])])).slice(-20);

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    strength: Math.min(1, Math.max(existing.strength || 0.3, incoming.strength || 0.3) + 0.08),
    first_seen: existing.first_seen,
    last_seen: incoming.last_seen || timestamp || existing.last_seen,
    evidence
  };
}
