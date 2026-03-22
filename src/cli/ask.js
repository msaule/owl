import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import { loadConfig } from '../config/index.js';
import { WorldModel } from '../core/world-model.js';
import { LLMConnection } from '../llm/connection.js';
import { daysAgo } from '../utils/time.js';
import { buildAdjacencyList, getHubs, findClusters, findBridgeEntities } from '../core/graph.js';

// ─── Entity-aware context: if the question mentions known entities, pull deep context ───

function detectMentionedEntities(question, worldModel, limit = 5) {
  const words = question.toLowerCase().split(/\s+/);
  const allEntities = worldModel.getChangedEntities(daysAgo(90), 500);
  const matches = [];

  for (const entity of allEntities) {
    const name = (entity.name || '').toLowerCase();
    // Check if any 2+ char word from entity name appears in question
    const entityWords = name.split(/\s+/).filter((w) => w.length > 2);
    const overlap = entityWords.filter((w) => words.some((qw) => qw.includes(w) || w.includes(qw)));
    if (overlap.length > 0 && overlap.length >= entityWords.length * 0.5) {
      matches.push(entity);
    }
  }

  return matches.slice(0, limit);
}

function buildEntityDeepContext(worldModel, entities) {
  const sections = [];

  for (const entity of entities) {
    const lines = [`### ${entity.name} [${entity.type}]`];
    const attrs = entity.attributes || {};
    if (Object.keys(attrs).length > 0) {
      lines.push(`Attributes: ${Object.entries(attrs).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    lines.push(`Sources: ${(entity.sources || []).join(', ')} | First seen: ${entity.first_seen?.slice(0, 10)} | Last seen: ${entity.last_seen?.slice(0, 10)}`);

    // Relationships
    const rels = worldModel.getRelationships(entity.id);
    if (rels.length > 0) {
      lines.push('Relationships:');
      for (const r of rels.slice(0, 8)) {
        const otherId = r.from_entity === entity.id ? r.to_entity : r.from_entity;
        const other = worldModel.getEntity(otherId);
        const dir = r.from_entity === entity.id ? '->' : '<-';
        lines.push(`  ${dir} ${r.type} ${other ? other.name : otherId} (strength: ${r.strength})`);
      }
    }

    // Recent events involving this entity
    const events = worldModel.getRecentEvents(daysAgo(14), 500)
      .filter((e) => (e.entities || []).includes(entity.id))
      .slice(0, 10);
    if (events.length > 0) {
      lines.push('Recent activity:');
      for (const ev of events) {
        lines.push(`  [${ev.timestamp?.slice(0, 10)}] ${ev.source}/${ev.type}: ${ev.summary}`);
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

// ─── Full world snapshot ───

function buildWorldSnapshot(worldModel, days = 14) {
  const since = daysAgo(days);
  const entities = worldModel.getChangedEntities(since, 100);
  const events = worldModel.getRecentEvents(since, 200);
  const discoveries = worldModel.getRecentDiscoveries(since, 50);
  const situations = worldModel.getActiveSituations(50);
  const patterns = worldModel.getPatterns(50);
  const stats = worldModel.getStats();

  const sections = [];

  sections.push(`## World Model Stats\nEntities: ${stats.entities} | Events: ${stats.events} | Discoveries: ${stats.discoveries} | Patterns: ${stats.patterns} | Active Situations: ${stats.situations}`);

  if (situations.length > 0) {
    const sitLines = situations.map((s) => `- [${s.urgency}] ${s.description} (entities: ${(s.entities || []).join(', ')})`);
    sections.push(`## Active Situations\n${sitLines.join('\n')}`);
  }

  if (discoveries.length > 0) {
    const discLines = discoveries.slice(0, 20).map((d) =>
      `- [${d.type}/${d.urgency}] ${d.title}\n  ${d.body?.split('\n')[0] || ''}\n  Sources: ${(d.sources || []).join(', ')} | Confidence: ${Math.round((d.confidence || 0) * 100)}% | ${d.timestamp?.slice(0, 10)}`
    );
    sections.push(`## Recent Discoveries\n${discLines.join('\n')}`);
  }

  if (entities.length > 0) {
    const entityLines = entities.map((e) => {
      const attrs = e.attributes || {};
      const attrStr = Object.entries(attrs).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ');
      return `- ${e.name} [${e.type}]${attrStr ? ` (${attrStr})` : ''} — sources: ${(e.sources || []).join(', ')} — last seen: ${e.last_seen?.slice(0, 10)}`;
    });
    sections.push(`## Entities (${entities.length} recently active)\n${entityLines.join('\n')}`);
  }

  if (patterns.length > 0) {
    const patLines = patterns.slice(0, 15).map((p) => `- ${p.description} (seen ${p.occurrence_count}x, confidence: ${Math.round((p.confidence || 0) * 100)}%)`);
    sections.push(`## Patterns\n${patLines.join('\n')}`);
  }

  if (events.length > 0) {
    const eventLines = events.slice(0, 80).map((e) => `- [${e.timestamp?.slice(0, 10)} ${e.timestamp?.slice(11, 16)}] ${e.source}/${e.type}: ${e.summary}`);
    sections.push(`## Recent Events (${events.length} in last ${days}d)\n${eventLines.join('\n')}`);
  }

  // Graph insights
  const graph = buildAdjacencyList(worldModel);
  if (graph.size > 0) {
    const hubs = getHubs(graph, 5);
    if (hubs.length > 0) {
      const hubLines = hubs.map((h) => {
        const e = worldModel.getEntity(h.entityId);
        return `- ${e ? e.name : h.entityId} (${h.degree} connections, avg strength: ${h.avgStrength.toFixed(2)})`;
      });
      sections.push(`## Most Connected Entities (Hubs)\n${hubLines.join('\n')}`);
    }

    const clusters = findClusters(graph);
    if (clusters.size > 1) {
      const clusterLines = [];
      let i = 1;
      for (const [, members] of clusters) {
        if (members.size < 2) continue;
        const names = [...members].slice(0, 6).map((id) => { const e = worldModel.getEntity(id); return e ? e.name : id; });
        clusterLines.push(`- Cluster ${i}: ${names.join(', ')}${members.size > 6 ? ` (+${members.size - 6} more)` : ''}`);
        i++;
      }
      if (clusterLines.length > 0) sections.push(`## Entity Clusters\n${clusterLines.join('\n')}`);
    }

    const bridges = findBridgeEntities(graph, clusters);
    if (bridges.length > 0) {
      const bridgeLines = bridges.slice(0, 5).map((b) => {
        const e = worldModel.getEntity(b.entityId);
        return `- ${e ? e.name : b.entityId} (bridges ${b.clusterCount} groups)`;
      });
      sections.push(`## Bridge Entities (connecting different groups)\n${bridgeLines.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

// ─── System prompt ───

const SYSTEM_PROMPT = `You are OWL, an AI that has been continuously watching the user's data sources (email, calendar, GitHub, Slack, Shopify, files) and building a world model — a knowledge graph of entities, relationships, events, patterns, and situations.

You have deep knowledge of the user's world — the people they interact with, the companies involved, ongoing projects, patterns, anomalies, and active situations.

When the user asks a question:
1. Answer based ONLY on the world model data provided. Never fabricate data.
2. Be specific — name people, companies, dates, events, and metrics.
3. If you see connections the user might not have noticed, proactively mention them.
4. If data is insufficient, say so honestly and suggest what data sources might help.
5. Structure longer answers with bullet points or sections.
6. Be concise but thorough — like a chief of staff briefing their executive.

After answering, suggest 2-3 follow-up questions the user might want to ask, prefixed with ">>". These should be non-obvious, insightful questions that dig deeper based on what you see in the data.

Format follow-up suggestions like:
>> What is the relationship between [entity A] and [entity B]?
>> Are there any risks with [situation]?
>> How has [entity] activity changed over the past month?`;

// ─── Rich output formatting ───

function formatResponse(response) {
  const lines = response.split('\n');
  const formatted = [];
  let inSuggestions = false;

  for (const line of lines) {
    if (line.trim().startsWith('>>')) {
      if (!inSuggestions) {
        inSuggestions = true;
        formatted.push('');
        formatted.push(chalk.dim('  ── Follow-up questions ──'));
      }
      formatted.push(chalk.hex('#FFB347')(`  ${line.trim().slice(2).trim()}`));
    } else {
      // Bold markdown headers
      const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headerMatch) {
        formatted.push(chalk.bold(`  ${headerMatch[2]}`));
      } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        formatted.push(chalk.white(`  ${line}`));
      } else if (line.trim().startsWith('**') && line.trim().endsWith('**')) {
        formatted.push(chalk.bold(`  ${line.trim().replace(/\*\*/g, '')}`));
      } else {
        formatted.push(`  ${line}`);
      }
    }
  }

  return formatted;
}

// ─── Interactive conversation loop ───

async function conversationLoop(worldModel, llm, config, days) {
  const history = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => new Promise((resolve) => {
    rl.question(chalk.hex('#FFB347')('\n  You > '), (answer) => resolve(answer));
  });

  console.log(chalk.dim('  Type your questions. Press Ctrl+C or type "exit" to quit.\n'));

  while (true) {
    const input = await prompt();
    if (!input || input.trim().toLowerCase() === 'exit' || input.trim().toLowerCase() === 'quit') {
      console.log(chalk.dim('\n  OWL is always watching. Goodbye.\n'));
      break;
    }

    const question = input.trim();
    history.push({ role: 'user', content: question });

    const spinner = ora({ text: 'Thinking...', color: 'yellow' }).start();

    try {
      // Build context with entity-awareness
      const snapshot = buildWorldSnapshot(worldModel, days);
      const mentioned = detectMentionedEntities(question, worldModel);
      let entityContext = '';
      if (mentioned.length > 0) {
        entityContext = `\n\n## Deep Context for Mentioned Entities\n${buildEntityDeepContext(worldModel, mentioned)}`;
      }

      // Build conversation history for LLM
      const historyStr = history.slice(-8).map((m) => `${m.role === 'user' ? 'User' : 'OWL'}: ${m.content}`).join('\n\n');

      const userPrompt = `## User's World Model (last ${days} days)\n\n${snapshot}${entityContext}\n\n---\n\n## Conversation\n${historyStr}`;

      const response = await llm.chat(SYSTEM_PROMPT, userPrompt, {
        temperature: 0.4,
        maxTokens: 2000
      });

      spinner.stop();
      console.log('');
      console.log(chalk.hex('#FFB347').bold('  OWL'));

      const formatted = formatResponse(response);
      for (const line of formatted) {
        console.log(line);
      }

      history.push({ role: 'assistant', content: response });
    } catch (error) {
      spinner.fail(`Failed: ${error.message}`);
    }
  }

  rl.close();
}

// ─── Main entry ───

export async function runAsk(question, options = {}) {
  const config = loadConfig(options.config);
  const worldModel = new WorldModel(config.paths.dbPath);
  const llm = new LLMConnection(config.llm, { costLogPath: config.paths.costLogPath });

  const days = options.days || 14;

  // Interactive mode: owl ask --chat
  if (options.chat || !question) {
    try {
      await conversationLoop(worldModel, llm, config, days);
    } finally {
      worldModel.close();
    }
    return;
  }

  // Single-shot mode
  const spinner = ora({ text: 'Thinking...', color: 'yellow' }).start();

  try {
    const snapshot = buildWorldSnapshot(worldModel, days);

    if (snapshot.includes('Entities: 0') && snapshot.includes('Events: 0')) {
      spinner.stop();
      console.log(chalk.yellow('\n  OWL has no data yet. Run `owl start` to begin watching your world.\n'));
      worldModel.close();
      return;
    }

    // Detect mentioned entities and pull deep context
    const mentioned = detectMentionedEntities(question, worldModel);
    let entityContext = '';
    if (mentioned.length > 0) {
      entityContext = `\n\n## Deep Context for Mentioned Entities\n${buildEntityDeepContext(worldModel, mentioned)}`;
    }

    const userPrompt = `## User's World Model (last ${days} days)\n\n${snapshot}${entityContext}\n\n---\n\nUser's question: ${question}`;

    const response = await llm.chat(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.4,
      maxTokens: 2000
    });

    spinner.stop();
    console.log('');
    console.log(chalk.hex('#FFB347').bold('  OWL'));

    const formatted = formatResponse(response);
    for (const line of formatted) {
      console.log(line);
    }
    console.log('');
  } catch (error) {
    spinner.fail(`Failed: ${error.message}`);
  } finally {
    worldModel.close();
  }
}
