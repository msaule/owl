import { truncate } from '../utils/text.js';

/**
 * Build relevant context from the world model for a follow-up conversation.
 * Includes related events, entity relationships, and active situations.
 */
function buildRelevantContext(worldModel, discovery) {
  const sections = [];

  // Related events (last 7 days, filtered to shared entities/sources)
  const relatedEvents = worldModel
    .getRecentEvents(new Date(Date.now() - 7 * 86_400_000).toISOString(), 80)
    .filter(
      (event) =>
        event.entities?.some((entityId) => discovery.entities.includes(entityId)) ||
        discovery.sources.includes(event.source)
    )
    .slice(0, 15)
    .map((event) => `- [${event.timestamp}] ${event.source}/${event.type}: ${truncate(event.summary, 160)}`)
    .join('\n');

  if (relatedEvents) {
    sections.push(`Recent related events:\n${relatedEvents}`);
  }

  // Entity details
  const entityDetails = discovery.entities
    .map((id) => worldModel.getEntity(id))
    .filter(Boolean)
    .slice(0, 8)
    .map((entity) => {
      const attrs = Object.entries(entity.attributes || {})
        .filter(([, v]) => v && typeof v === 'string')
        .slice(0, 3)
        .map(([k, v]) => `${k}=${truncate(String(v), 40)}`)
        .join(', ');
      return `- ${entity.name} [${entity.type}] ${attrs ? `(${attrs})` : ''}`;
    })
    .join('\n');

  if (entityDetails) {
    sections.push(`Entities mentioned:\n${entityDetails}`);
  }

  // Entity relationships
  const relationships = [];
  for (const entityId of discovery.entities.slice(0, 5)) {
    const rels = worldModel.getRelationships(entityId);
    for (const rel of rels.slice(0, 3)) {
      relationships.push(`- ${rel.from_entity} → ${rel.type} → ${rel.to_entity} (strength: ${rel.strength})`);
    }
  }
  if (relationships.length > 0) {
    sections.push(`Relationships:\n${[...new Set(relationships)].slice(0, 8).join('\n')}`);
  }

  // Active situations involving these entities
  const situations = worldModel.getActiveSituations(20)
    .filter((sit) => sit.entities.some((e) => discovery.entities.includes(e)))
    .slice(0, 3)
    .map((sit) => `- [${sit.urgency}] ${sit.description}`)
    .join('\n');

  if (situations) {
    sections.push(`Active situations:\n${situations}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : '- No directly related recent context found.';
}

/**
 * Respond to a user's follow-up question about a specific discovery.
 * Uses the full world model context, not just the discovery itself.
 */
export async function respondToFollowUp({ message, discovery, worldModel, llm, conversationHistory = [] }) {
  const systemPrompt = `You are OWL continuing a conversation about a discovery you previously sent.
Answer with concrete context from the user's world model. If evidence is weak, say so.
Be concise, helpful, and action-oriented.
If the user is giving feedback (like "thanks", "not useful", etc.), acknowledge it briefly.
If the user asks a follow-up question, draw on the context below to give a specific answer.`;

  const contextBlock = buildRelevantContext(worldModel, discovery);

  const historyBlock = conversationHistory.length > 0
    ? `\nPrevious messages in this thread:\n${conversationHistory.map((m) => `${m.role}: ${truncate(m.text, 200)}`).join('\n')}\n`
    : '';

  const userPrompt = `Original discovery:
Title: ${discovery.title}
Body: ${discovery.body}
Urgency: ${discovery.urgency}
Type: ${discovery.type}
Sources: ${(discovery.sources || []).join(', ')}
Entities: ${(discovery.entities || []).join(', ')}

${contextBlock}
${historyBlock}
User follow-up:
${message}

Reply in 2-5 sentences. Be specific and reference actual data from the context when possible.`;

  return llm.chat(systemPrompt, userPrompt, {
    temperature: 0.2,
    maxTokens: 500
  });
}
