/**
 * Discovery Chains — tracks how discoveries relate to each other over time.
 *
 * When OWL surfaces a new discovery, the chain system checks whether it shares
 * entities, sources, or thematic overlap with recent discoveries.  Related
 * discoveries are grouped into chains, which can eventually trigger
 * meta-discoveries ("I've been flagging a lot of customer churn signals
 * lately").
 *
 * A chain is a sequence of discoveries that form a narrative thread.
 */

import { jaccardSimilarity } from '../utils/text.js';
import { createId } from '../utils/id.js';
import { nowIso, daysAgo } from '../utils/time.js';

const CHAIN_SIMILARITY_THRESHOLD = 0.25;
const CHAIN_ENTITY_OVERLAP_THRESHOLD = 1;  // At least 1 shared entity
const CHAIN_MAX_AGE_DAYS = 30;
const META_DISCOVERY_MIN_CHAIN_LENGTH = 3;

/**
 * Find the best matching active chain for a new discovery.
 */
export function findMatchingChain(discovery, chains) {
  let bestChain = null;
  let bestScore = 0;

  for (const chain of chains) {
    const score = chainMatchScore(discovery, chain);
    if (score > bestScore) {
      bestScore = score;
      bestChain = chain;
    }
  }

  return bestScore >= 0.3 ? bestChain : null;
}

/**
 * Score how well a discovery fits into an existing chain.
 */
function chainMatchScore(discovery, chain) {
  const discoveryEntities = new Set(discovery.entities || []);
  const chainEntities = new Set(chain.entities || []);
  const chainSources = new Set(chain.sources || []);

  // Entity overlap score (0-1)
  let entityOverlap = 0;
  if (discoveryEntities.size > 0 && chainEntities.size > 0) {
    const intersection = [...discoveryEntities].filter((e) => chainEntities.has(e));
    entityOverlap = intersection.length / Math.min(discoveryEntities.size, chainEntities.size);
  }

  // Source overlap score (0-1)
  const discoverySources = new Set(discovery.sources || []);
  let sourceOverlap = 0;
  if (discoverySources.size > 0 && chainSources.size > 0) {
    const intersection = [...discoverySources].filter((s) => chainSources.has(s));
    sourceOverlap = intersection.length / Math.min(discoverySources.size, chainSources.size);
  }

  // Text similarity score
  const discoveryText = `${discovery.title} ${discovery.body}`;
  const chainText = chain.summary || '';
  const textSimilarity = jaccardSimilarity(discoveryText, chainText);

  // Type match bonus
  const typeBonus = (discovery.type === chain.dominant_type) ? 0.15 : 0;

  return entityOverlap * 0.45 + sourceOverlap * 0.15 + textSimilarity * 0.25 + typeBonus;
}

/**
 * Create a new chain from a discovery.
 */
export function createChain(discovery) {
  return {
    id: createId('chain'),
    discovery_ids: [discovery.id],
    entities: [...(discovery.entities || [])],
    sources: [...(discovery.sources || [])],
    dominant_type: discovery.type,
    summary: `${discovery.title}: ${discovery.body}`.slice(0, 300),
    length: 1,
    status: 'active',
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

/**
 * Add a discovery to an existing chain, updating chain metadata.
 */
export function extendChain(chain, discovery) {
  const discoveryIds = [...(chain.discovery_ids || []), discovery.id];
  const entities = Array.from(new Set([...(chain.entities || []), ...(discovery.entities || [])]));
  const sources = Array.from(new Set([...(chain.sources || []), ...(discovery.sources || [])]));

  // Recompute dominant type
  const typeCounts = {};
  // We don't have all discoveries, so use the existing dominant_type as a proxy
  typeCounts[chain.dominant_type] = (chain.length || 1);
  typeCounts[discovery.type] = (typeCounts[discovery.type] || 0) + 1;
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];

  return {
    ...chain,
    discovery_ids: discoveryIds,
    entities,
    sources,
    dominant_type: dominantType,
    summary: `${chain.summary}\n→ ${discovery.title}`.slice(0, 500),
    length: discoveryIds.length,
    updated_at: nowIso()
  };
}

/**
 * Check if a chain is long enough to trigger a meta-discovery.
 */
export function shouldGenerateMetaDiscovery(chain) {
  if (chain.length < META_DISCOVERY_MIN_CHAIN_LENGTH) {
    return false;
  }

  // Only generate meta-discovery every 3 additions
  return chain.length % 3 === 0;
}

/**
 * Build a meta-discovery prompt for a chain that has accumulated enough links.
 */
export function buildMetaDiscoveryPrompt(chain, recentDiscoveries) {
  const chainDiscoveries = recentDiscoveries
    .filter((d) => (chain.discovery_ids || []).includes(d.id))
    .map((d) => `- [${d.type}/${d.urgency}] ${d.title}: ${d.body}`)
    .join('\n');

  const systemPrompt = `You are OWL performing meta-analysis. You have noticed a CHAIN of ${chain.length} related discoveries about the same entities/topics over time. Analyze what this pattern of discoveries means at a higher level.

RULES:
1. This is a meta-observation — comment on the PATTERN of discoveries, not individual ones.
2. What does the accumulation of these signals mean?
3. Is the situation escalating, resolving, or evolving?
4. What should the user understand about this ongoing thread?
5. Be concise and actionable.`;

  const userPrompt = `Discovery chain (${chain.length} discoveries):
${chainDiscoveries}

Entities involved: ${(chain.entities || []).join(', ')}
Sources: ${(chain.sources || []).join(', ')}
Chain started: ${chain.created_at}

Analyze this chain. What meta-insight emerges from seeing these discoveries together?

Return a single JSON object:
{
  "type": "connection",
  "urgency": "important",
  "title": "Brief meta-insight headline",
  "body": "2-3 sentences explaining what the chain of discoveries reveals at a higher level. End with a suggested action.",
  "sources": ${JSON.stringify(chain.sources || [])},
  "entities": ${JSON.stringify(chain.entities || [])},
  "confidence": 0.8
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Process a new discovery through the chain system.
 * Returns { chain, isNew, metaDiscovery? }
 */
export function processDiscoveryChain(discovery, activeChains) {
  const match = findMatchingChain(discovery, activeChains);

  if (match) {
    const updated = extendChain(match, discovery);
    return {
      chain: updated,
      isNew: false,
      shouldMeta: shouldGenerateMetaDiscovery(updated)
    };
  }

  const newChain = createChain(discovery);
  return {
    chain: newChain,
    isNew: true,
    shouldMeta: false
  };
}
