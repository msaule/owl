#!/usr/bin/env node
/**
 * OWL MCP Server — Model Context Protocol interface
 *
 * Exposes OWL's world model to Claude Desktop, Cursor, Windsurf,
 * and any MCP-compatible client via stdio JSON-RPC.
 *
 * Usage:
 *   node src/mcp/server.js
 *
 * Add to Claude Desktop config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "owl": {
 *         "command": "node",
 *         "args": ["/path/to/owl/src/mcp/server.js"]
 *       }
 *     }
 *   }
 */

import { loadConfig } from '../config/index.js';
import { WorldModel } from '../core/world-model.js';
import { LLMConnection } from '../llm/connection.js';
import { buildAdjacencyList, getHubs, findClusters } from '../core/graph.js';
import { computeHealthMetrics, detectHealthAnomalies } from '../discovery/health.js';
import { computeOwlScore } from '../cli/banner.js';
import { daysAgo } from '../utils/time.js';

const SERVER_INFO = {
  name: 'owl',
  version: '1.0.0'
};

const CAPABILITIES = {
  tools: {},
  resources: {}
};

const TOOLS = [
  {
    name: 'owl_status',
    description: 'Get OWL daemon status, world model stats, and OWL Score',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'owl_ask',
    description: 'Ask OWL a natural language question about the user\'s world — their email, calendar, GitHub, Slack, Shopify, and files. OWL knows about the people, companies, projects, and patterns in the user\'s life.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask about the user\'s world' },
        days: { type: 'number', description: 'How many days back to look (default: 14)', default: 14 }
      },
      required: ['question']
    }
  },
  {
    name: 'owl_entities',
    description: 'List entities (people, companies, projects, topics) tracked in OWL\'s world model',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search filter for entity name' },
        days: { type: 'number', description: 'Only show entities active in last N days', default: 7 },
        limit: { type: 'number', description: 'Max results', default: 25 }
      },
      required: []
    }
  },
  {
    name: 'owl_discoveries',
    description: 'Get recent discoveries — insights, patterns, anomalies, and connections OWL found across the user\'s data sources',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look back N days', default: 7 },
        limit: { type: 'number', description: 'Max results', default: 20 }
      },
      required: []
    }
  },
  {
    name: 'owl_events',
    description: 'Get recent events from the user\'s data sources (emails, meetings, commits, messages, orders, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look back N days', default: 3 },
        source: { type: 'string', description: 'Filter by source (gmail, calendar, github, slack, shopify, files)' },
        limit: { type: 'number', description: 'Max results', default: 50 }
      },
      required: []
    }
  },
  {
    name: 'owl_entity_detail',
    description: 'Get detailed information about a specific entity including relationships, recent activity, and connections',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name to look up' }
      },
      required: ['name']
    }
  },
  {
    name: 'owl_graph',
    description: 'Get knowledge graph insights — most connected entities (hubs), entity clusters, and relationship patterns',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['hubs', 'clusters', 'summary'], description: 'Type of graph insight', default: 'summary' }
      },
      required: []
    }
  },
  {
    name: 'owl_situations',
    description: 'Get active situations — ongoing developments OWL is tracking across the user\'s world',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

const RESOURCES = [
  {
    uri: 'owl://world-model/snapshot',
    name: 'OWL World Model Snapshot',
    description: 'Complete snapshot of the user\'s world model — entities, events, discoveries, situations, and patterns',
    mimeType: 'application/json'
  },
  {
    uri: 'owl://health/report',
    name: 'OWL Health Report',
    description: 'System health metrics and anomaly detection for OWL itself',
    mimeType: 'application/json'
  }
];

// ─── Tool handlers ───

function getConfig() {
  try {
    return loadConfig();
  } catch {
    return loadConfig(undefined);
  }
}

function handleOwlStatus() {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const stats = wm.getStats();
    const score = computeOwlScore(wm, config);
    return {
      stats,
      owlScore: score.total,
      scoreBreakdown: score.breakdown,
      activeSources: Object.entries(config.plugins || {}).filter(([, v]) => v?.enabled).map(([k]) => k),
      activeChannels: Object.entries(config.channels || {}).filter(([, v]) => v?.enabled).map(([k]) => k)
    };
  } finally {
    wm.close();
  }
}

async function handleOwlAsk(args) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  const llm = new LLMConnection(config.llm, { costLogPath: config.paths.costLogPath });

  try {
    const days = args.days || 14;
    const since = daysAgo(days);
    const entities = wm.getChangedEntities(since, 80);
    const events = wm.getRecentEvents(since, 150);
    const discoveries = wm.getRecentDiscoveries(since, 30);
    const situations = wm.getActiveSituations(30);

    const context = [
      `Entities: ${entities.map((e) => `${e.name} [${e.type}]`).join(', ')}`,
      `Recent events: ${events.slice(0, 60).map((e) => `[${e.source}] ${e.summary}`).join('; ')}`,
      `Discoveries: ${discoveries.map((d) => `[${d.type}] ${d.title}`).join('; ')}`,
      `Active situations: ${situations.map((s) => s.description).join('; ')}`
    ].join('\n\n');

    const systemPrompt = `You are OWL, an AI that watches the user's data sources and knows their world. Answer based only on the data provided. Be specific — name people, dates, events. Be concise.`;
    const userPrompt = `World model context:\n${context}\n\nQuestion: ${args.question}`;

    const response = await llm.chat(systemPrompt, userPrompt, { temperature: 0.4, maxTokens: 1500 });
    return response;
  } finally {
    wm.close();
  }
}

function handleOwlEntities(args) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    if (args.query) {
      return wm.findEntities(args.query, args.limit || 25);
    }
    const since = daysAgo(args.days || 7);
    return wm.getChangedEntities(since, args.limit || 25);
  } finally {
    wm.close();
  }
}

function handleOwlDiscoveries(args) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const since = daysAgo(args.days || 7);
    return wm.getRecentDiscoveries(since, args.limit || 20);
  } finally {
    wm.close();
  }
}

function handleOwlEvents(args) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const since = daysAgo(args.days || 3);
    let events = wm.getRecentEvents(since, args.limit || 50);
    if (args.source) {
      events = events.filter((e) => e.source === args.source);
    }
    return events;
  } finally {
    wm.close();
  }
}

function handleOwlEntityDetail(args) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const matches = wm.findEntities(args.name, 1);
    if (matches.length === 0) return { error: `No entity found matching "${args.name}"` };

    const entity = matches[0];
    const relationships = wm.getRelationships(entity.id);
    const since = daysAgo(14);
    const events = wm.getRecentEvents(since, 500)
      .filter((e) => (e.entities || []).includes(entity.id))
      .slice(0, 20);

    const relDetails = relationships.map((r) => {
      const otherId = r.from_entity === entity.id ? r.to_entity : r.from_entity;
      const other = wm.getEntity(otherId);
      return {
        type: r.type,
        direction: r.from_entity === entity.id ? 'outgoing' : 'incoming',
        target: other ? other.name : otherId,
        strength: r.strength
      };
    });

    return { entity, relationships: relDetails, recentEvents: events };
  } finally {
    wm.close();
  }
}

function handleOwlGraph(args) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const graph = buildAdjacencyList(wm);
    if (graph.size === 0) return { nodes: 0, edges: 0, message: 'No graph data yet' };

    const type = args.type || 'summary';
    const totalEdges = Math.round([...graph.values()].reduce((s, e) => s + e.length, 0) / 2);

    if (type === 'hubs') {
      const hubs = getHubs(graph, 10).map((h) => {
        const e = wm.getEntity(h.entityId);
        return { name: e ? e.name : h.entityId, degree: h.degree, avgStrength: h.avgStrength };
      });
      return { nodes: graph.size, edges: totalEdges, hubs };
    }

    if (type === 'clusters') {
      const clusters = findClusters(graph);
      const result = [];
      for (const [, members] of clusters) {
        const names = [...members].map((id) => { const e = wm.getEntity(id); return e ? e.name : id; });
        result.push(names);
      }
      return { nodes: graph.size, edges: totalEdges, clusters: result };
    }

    // summary
    const hubs = getHubs(graph, 5).map((h) => {
      const e = wm.getEntity(h.entityId);
      return { name: e ? e.name : h.entityId, connections: h.degree };
    });
    return { nodes: graph.size, edges: totalEdges, topHubs: hubs };
  } finally {
    wm.close();
  }
}

function handleOwlSituations() {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    return wm.getActiveSituations(50);
  } finally {
    wm.close();
  }
}

// ─── Resource handlers ───

function handleWorldModelSnapshot() {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const since = daysAgo(14);
    return {
      stats: wm.getStats(),
      entities: wm.getChangedEntities(since, 200),
      events: wm.getRecentEvents(since, 200),
      discoveries: wm.getRecentDiscoveries(since, 100),
      situations: wm.getActiveSituations(50),
      patterns: wm.getPatterns(100)
    };
  } finally {
    wm.close();
  }
}

function handleHealthReport() {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try {
    const metrics = computeHealthMetrics(wm);
    const anomalies = detectHealthAnomalies(metrics);
    return { metrics, anomalies };
  } finally {
    wm.close();
  }
}

// ─── MCP Protocol (stdio JSON-RPC) ───

async function handleRequest(request) {
  const { method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES
      };

    case 'notifications/initialized':
      return undefined; // no response for notifications

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        let result;
        switch (toolName) {
          case 'owl_status': result = handleOwlStatus(); break;
          case 'owl_ask': result = await handleOwlAsk(args); break;
          case 'owl_entities': result = handleOwlEntities(args); break;
          case 'owl_discoveries': result = handleOwlDiscoveries(args); break;
          case 'owl_events': result = handleOwlEvents(args); break;
          case 'owl_entity_detail': result = handleOwlEntityDetail(args); break;
          case 'owl_graph': result = handleOwlGraph(args); break;
          case 'owl_situations': result = handleOwlSituations(); break;
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
        }

        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }

    case 'resources/list':
      return { resources: RESOURCES };

    case 'resources/read': {
      const uri = params?.uri;
      try {
        let data;
        if (uri === 'owl://world-model/snapshot') data = handleWorldModelSnapshot();
        else if (uri === 'owl://health/report') data = handleHealthReport();
        else return { contents: [{ uri, text: `Unknown resource: ${uri}` }] };

        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { contents: [{ uri, text: `Error: ${error.message}` }] };
      }
    }

    case 'ping':
      return {};

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

// ─── stdio transport ───

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // Process complete JSON-RPC messages (newline-delimited)
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);

    if (!line) continue;

    try {
      const message = JSON.parse(line);
      processMessage(message);
    } catch {
      // Ignore malformed lines
    }
  }
});

async function processMessage(message) {
  try {
    const result = await handleRequest(message);

    // Notifications don't get responses
    if (result === undefined && !message.id) return;

    const response = { jsonrpc: '2.0', id: message.id };
    if (result !== undefined) {
      response.result = result;
    } else {
      response.result = {};
    }

    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    const response = {
      jsonrpc: '2.0',
      id: message.id,
      error: error.code ? error : { code: -32603, message: error.message || 'Internal error' }
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}

// Handle clean shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
