import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config/index.js';
import { WorldModel } from '../core/world-model.js';
import { LLMConnection } from '../llm/connection.js';
import { daysAgo } from '../utils/time.js';
import { buildAdjacencyList, getHubs } from '../core/graph.js';

function buildWorldSnapshot(worldModel, days = 7) {
  const since = daysAgo(days);
  const entities = worldModel.getChangedEntities(since, 100);
  const events = worldModel.getRecentEvents(since, 200);
  const discoveries = worldModel.getRecentDiscoveries(since, 50);
  const situations = worldModel.getActiveSituations(50);
  const patterns = worldModel.getPatterns(50);
  const stats = worldModel.getStats();

  const sections = [];

  sections.push(`## World Model Stats\nEntities: ${stats.entities} | Events: ${stats.events} | Discoveries: ${stats.discoveries} | Patterns: ${stats.patterns} | Active Situations: ${stats.situations}`);

  if (entities.length > 0) {
    const entityLines = entities.map((e) => {
      const attrs = e.attributes || {};
      const attrStr = Object.entries(attrs).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ');
      return `- ${e.name} [${e.type}]${attrStr ? ` (${attrStr})` : ''} — sources: ${(e.sources || []).join(', ')}`;
    });
    sections.push(`## Entities (${entities.length} recently active)\n${entityLines.join('\n')}`);
  }

  if (situations.length > 0) {
    const sitLines = situations.map((s) => `- [${s.urgency}] ${s.description}`);
    sections.push(`## Active Situations\n${sitLines.join('\n')}`);
  }

  if (discoveries.length > 0) {
    const discLines = discoveries.slice(0, 20).map((d) => `- [${d.type}/${d.urgency}] ${d.title} (${d.timestamp?.slice(0, 10)})`);
    sections.push(`## Recent Discoveries\n${discLines.join('\n')}`);
  }

  if (patterns.length > 0) {
    const patLines = patterns.slice(0, 15).map((p) => `- ${p.description} (seen ${p.occurrence_count}x)`);
    sections.push(`## Patterns\n${patLines.join('\n')}`);
  }

  if (events.length > 0) {
    const eventLines = events.slice(0, 60).map((e) => `- [${e.source}/${e.type}] ${e.summary} (${e.timestamp?.slice(0, 10)})`);
    sections.push(`## Recent Events (${events.length} in last ${days}d)\n${eventLines.join('\n')}`);
  }

  // Graph insights
  const graph = buildAdjacencyList(worldModel);
  if (graph.size > 0) {
    const hubs = getHubs(graph, 5);
    if (hubs.length > 0) {
      const hubLines = hubs.map((h) => {
        const e = worldModel.getEntity(h.entityId);
        return `- ${e ? e.name : h.entityId} (${h.degree} connections)`;
      });
      sections.push(`## Most Connected Entities\n${hubLines.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

const SYSTEM_PROMPT = `You are OWL, an AI that has been continuously watching the user's data sources (email, calendar, GitHub, Slack, Shopify, files) and building a world model.

You have deep knowledge of the user's world — the people they interact with, the companies involved, ongoing projects, patterns, anomalies, and active situations.

When the user asks a question:
- Answer based on the world model data provided below
- Be specific — name people, companies, dates, and events
- If you see connections the user might not, mention them
- If you don't have enough data to answer, say so honestly
- Be concise but thorough
- Use a warm, direct tone — you're an advisor who knows their world

Do NOT make up data. Only reference entities, events, and discoveries from the context provided.`;

export async function runAsk(question, options = {}) {
  const config = loadConfig(options.config);
  const worldModel = new WorldModel(config.paths.dbPath);
  const llm = new LLMConnection(config.llm, { costLogPath: config.paths.costLogPath });

  const days = options.days || 14;
  const spinner = ora({ text: 'Thinking...', color: 'yellow' }).start();

  try {
    const snapshot = buildWorldSnapshot(worldModel, days);

    if (snapshot.includes('Entities: 0') && snapshot.includes('Events: 0')) {
      spinner.stop();
      console.log(chalk.yellow('\nOWL has no data yet. Run `owl start` to begin watching your world.\n'));
      worldModel.close();
      return;
    }

    const userPrompt = `## User's World Model (last ${days} days)\n\n${snapshot}\n\n---\n\nUser's question: ${question}`;

    const response = await llm.chat(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.4,
      maxTokens: 1500
    });

    spinner.stop();
    console.log('');
    console.log(chalk.hex('#FFB347').bold('  OWL'));
    console.log('');

    // Format response with indent
    const lines = response.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log('');
  } catch (error) {
    spinner.fail(`Failed: ${error.message}`);
  } finally {
    worldModel.close();
  }
}
