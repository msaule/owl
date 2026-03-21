import { createId, slugify } from '../utils/id.js';
import { normalizeText } from '../utils/text.js';

export function buildEntityId(entity) {
  if (entity.id) {
    return entity.id;
  }

  const slug = slugify(entity.name || entity.attributes?.email || entity.type || 'entity');
  return slug ? `${entity.type || 'entity'}_${slug}` : createId(entity.type || 'entity');
}

export function canonicalizeEntity(entity, timestamp, source = undefined) {
  const id = buildEntityId(entity);
  const firstSeen = entity.first_seen || timestamp;
  const lastSeen = entity.last_seen || timestamp;
  const sources = Array.from(new Set([...(entity.sources || []), ...(source ? [source] : [])]));

  return {
    id,
    type: entity.type || 'custom',
    name: entity.name,
    attributes: entity.attributes || {},
    first_seen: firstSeen,
    last_seen: lastSeen,
    sources,
    importance: Number.isFinite(entity.importance) ? entity.importance : 0.5
  };
}

export function extractKnownAliases(entity) {
  const aliases = new Set();
  aliases.add(normalizeText(entity.name));

  for (const key of ['email', 'username', 'handle', 'domain']) {
    const value = entity.attributes?.[key];
    if (value) {
      aliases.add(normalizeText(value));
    }
  }

  for (const alias of entity.attributes?.aliases || []) {
    aliases.add(normalizeText(alias));
  }

  return Array.from(aliases).filter(Boolean);
}

export function scoreEntityMatch(candidate, existing) {
  const candidateName = normalizeText(candidate.name);
  const existingName = normalizeText(existing.name);
  let score = 0;

  if (!candidateName || !existingName) {
    return score;
  }

  if (candidateName === existingName) {
    score = 1;
  } else if (candidateName.includes(existingName) || existingName.includes(candidateName)) {
    score = Math.max(score, 0.7);
  }

  const candidateEmail = normalizeText(candidate.attributes?.email);
  const existingEmail = normalizeText(existing.attributes?.email);
  if (candidateEmail && existingEmail && candidateEmail === existingEmail) {
    score = Math.max(score, 1);
  }

  const candidateDomain = normalizeText(candidate.attributes?.domain || candidate.attributes?.email?.split('@')[1]);
  const existingDomain = normalizeText(existing.attributes?.domain || existing.attributes?.email?.split('@')[1]);
  if (candidateDomain && existingDomain && candidateDomain === existingDomain) {
    score = Math.max(score, 0.8);
  }

  const aliases = extractKnownAliases(existing);
  if (aliases.includes(candidateName)) {
    score = Math.max(score, 0.85);
  }

  return score;
}

export function mergeEntityData(base, incoming, timestamp) {
  const mergedSources = Array.from(new Set([...(base.sources || []), ...(incoming.sources || [])]));
  const mergedAliases = Array.from(
    new Set([...(base.attributes?.aliases || []), ...(incoming.attributes?.aliases || [])].filter(Boolean))
  );

  return {
    ...base,
    ...incoming,
    id: base.id,
    type: incoming.type || base.type,
    name: incoming.name || base.name,
    first_seen: base.first_seen,
    last_seen: incoming.last_seen || timestamp || base.last_seen,
    importance: Math.max(base.importance ?? 0.5, incoming.importance ?? 0.5),
    sources: mergedSources,
    attributes: {
      ...(base.attributes || {}),
      ...(incoming.attributes || {}),
      aliases: mergedAliases
    }
  };
}
