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
import { buildAdjacencyList, getHubs, findClusters, findBridgeEntities, findPath } from '../core/graph.js';
import { computeHealthMetrics, detectHealthAnomalies } from '../discovery/health.js';
import { computeOwlScore } from '../cli/banner.js';
import { daysAgo } from '../utils/time.js';

const SERVER_INFO = { name: 'owl', version: '1.0.0' };

const CAPABILITIES = {
  tools: {},
  resources: {},
  prompts: {}
};

const TOOLS = [
  {
    name: 'owl_status',
    description: 'Get OWL daemon status including world model stats (entities, events, discoveries, patterns, situations), OWL Score (0-100 world awareness metric with breakdown), active data source plugins, and delivery channels.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'owl_ask',
    description: 'Ask OWL a natural language question about the user\'s world. OWL watches email, calendar, GitHub, Slack, Shopify, and files. It knows about people, companies, projects, patterns, and ongoing situations. Use this for open-ended questions like "what\'s happening with Acme Corp?" or "any risks I should know about?"',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural language question about the user\'s world' },
        days: { type: 'number', description: 'How many days of history to consider (default: 14)' }
      },
      required: ['question']
    }
  },
  {
    name: 'owl_entities',
    description: 'Search or list entities (people, companies, projects, topics, locations) in OWL\'s world model. Each entity has a type, attributes, source list, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search filter — matches entity name (fuzzy)' },
        type: { type: 'string', enum: ['person', 'company', 'project', 'topic', 'location'], description: 'Filter by entity type' },
        days: { type: 'number', description: 'Only entities active in last N days (default: 7)' },
        limit: { type: 'number', description: 'Max results (default: 25)' }
      },
      required: []
    }
  },
  {
    name: 'owl_entity_detail',
    description: 'Get comprehensive detail about a specific entity: attributes, all relationships with other entities, and recent events involving this entity. Use this to deeply explore one node in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name to look up (fuzzy matched)' }
      },
      required: ['name']
    }
  },
  {
    name: 'owl_discoveries',
    description: 'Get discoveries — insights, patterns, anomalies, and cross-source connections OWL has found. Each discovery has a type (insight/pattern/anomaly/connection), urgency (urgent/important/interesting), confidence score, and source attribution.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look back N days (default: 7)' },
        type: { type: 'string', enum: ['insight', 'pattern', 'anomaly', 'connection'], description: 'Filter by discovery type' },
        urgency: { type: 'string', enum: ['urgent', 'important', 'interesting'], description: 'Filter by urgency' },
        limit: { type: 'number', description: 'Max results (default: 20)' }
      },
      required: []
    }
  },
  {
    name: 'owl_events',
    description: 'Get raw events from data sources: emails sent/received, calendar meetings, GitHub commits/PRs/issues, Slack messages, Shopify orders, file changes. Each event has a source, type, timestamp, summary, and linked entities.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look back N days (default: 3)' },
        source: { type: 'string', enum: ['gmail', 'calendar', 'github', 'slack', 'shopify', 'files'], description: 'Filter by data source' },
        limit: { type: 'number', description: 'Max results (default: 50)' }
      },
      required: []
    }
  },
  {
    name: 'owl_relationships',
    description: 'Get relationships between entities in the knowledge graph. Relationships have types (works_at, manages, partner_of, etc.), strength (0-1), and evidence links.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Get relationships for this entity (fuzzy matched)' },
        path_from: { type: 'string', description: 'Find shortest path FROM this entity...' },
        path_to: { type: 'string', description: '...TO this entity (requires path_from)' }
      },
      required: []
    }
  },
  {
    name: 'owl_graph',
    description: 'Get knowledge graph insights: hub entities (most connected), community clusters (groups of related entities), bridge entities (connecting different groups), or a full summary.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['hubs', 'clusters', 'bridges', 'summary'], description: 'Type of graph analysis (default: summary)' },
        top_n: { type: 'number', description: 'How many results to return (default: 10)' }
      },
      required: []
    }
  },
  {
    name: 'owl_situations',
    description: 'Get active situations — ongoing multi-event developments OWL is tracking. Situations have urgency levels, linked entities, and descriptions. They auto-expire after 7 days of inactivity.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'owl_patterns',
    description: 'Get detected patterns — recurring behaviors and trends across data sources. Each pattern has a description, occurrence count, confidence, and predicted next occurrence.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default: 30)' }
      },
      required: []
    }
  },
  {
    name: 'owl_feedback',
    description: 'Record user feedback on a discovery. This trains OWL\'s learning system — positive feedback boosts similar discoveries, negative dampens them. The confidence calibration system uses this to self-correct over time.',
    inputSchema: {
      type: 'object',
      properties: {
        discovery_id: { type: 'string', description: 'ID of the discovery to react to' },
        reaction: { type: 'string', enum: ['positive', 'negative', 'neutral'], description: 'User reaction' },
        acted_on: { type: 'boolean', description: 'Whether the user acted on this discovery (default: false)' }
      },
      required: ['discovery_id', 'reaction']
    }
  }
];

const PROMPTS = [
  {
    name: 'morning_briefing',
    description: 'Generate a morning briefing — a summary of what happened overnight and what to watch today',
    arguments: [
      { name: 'days', description: 'How many days back to include (default: 1)', required: false }
    ]
  },
  {
    name: 'risk_assessment',
    description: 'Analyze potential risks across all data sources — overdue items, anomalous activity, dependency bottlenecks',
    arguments: []
  },
  {
    name: 'relationship_map',
    description: 'Describe the relationship network around a specific entity — who they connect to, strength of connections, clusters',
    arguments: [
      { name: 'entity', description: 'Name of the entity to map', required: true }
    ]
  },
  {
    name: 'weekly_summary',
    description: 'Comprehensive summary of the past week — key events, new discoveries, changing situations, emerging patterns',
    arguments: []
  }
];

const RESOURCES = [
  {
    uri: 'owl://world-model/snapshot',
    name: 'OWL World Model Snapshot',
    description: 'Complete 14-day snapshot: all entities, events, discoveries, situations, patterns, and graph structure',
    mimeType: 'application/json'
  },
  {
    uri: 'owl://health/report',
    name: 'OWL Health Report',
    description: 'System health metrics, pipeline performance, anomaly detection on OWL itself',
    mimeType: 'application/json'
  },
  {
    uri: 'owl://score',
    name: 'OWL Score',
    description: 'World-awareness score (0-100) with detailed breakdown across 6 dimensions',
    mimeType: 'application/json'
  }
];

// ─── Helpers ───

function getConfig() {
  try { return loadConfig(); } catch { return loadConfig(undefined); }
}

function withWorldModel(fn) {
  const config = getConfig();
  const wm = new WorldModel(config.paths.dbPath);
  try { return fn(wm, config); } finally { wm.close(); }
}

// ─── Tool handlers ───

function handleOwlStatus() {
  return withWorldModel((wm, config) => {
    const stats = wm.getStats();
    const score = computeOwlScore(wm, config);
    const recentDiscovery = wm.getRecentDiscoveries(daysAgo(7), 1)[0];
    return {
      stats,
      owlScore: score.total,
      scoreBreakdown: score.breakdown,
      scoreLabel: score.total >= 80 ? 'Excellent' : score.total >= 60 ? 'Good' : score.total >= 40 ? 'Growing' : score.total >= 20 ? 'Waking Up' : 'Sleeping',
      activeSources: Object.entries(config.plugins || {}).filter(([, v]) => v?.enabled).map(([k]) => k),
      activeChannels: Object.entries(config.channels || {}).filter(([, v]) => v?.enabled).map(([k]) => k),
      lastDiscovery: recentDiscovery ? { title: recentDiscovery.title, date: recentDiscovery.timestamp } : null
    };
  });
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
    const patterns = wm.getPatterns(20);

    const context = [
      `Entities tracked: ${entities.map((e) => `${e.name} [${e.type}]`).join(', ')}`,
      `Active situations: ${situations.map((s) => `[${s.urgency}] ${s.description}`).join('; ')}`,
      `Recent discoveries: ${discoveries.map((d) => `[${d.type}/${d.urgency}] ${d.title}: ${d.body?.split('\n')[0] || ''}`).join('; ')}`,
      `Patterns: ${patterns.map((p) => p.description).join('; ')}`,
      `Recent events (last ${days}d): ${events.slice(0, 80).map((e) => `[${e.timestamp?.slice(0, 10)} ${e.source}] ${e.summary}`).join('; ')}`
    ].join('\n\n');

    const systemPrompt = `You are OWL, an AI that watches the user's data sources (email, calendar, GitHub, Slack, Shopify, files) and knows their world deeply. Answer based only on the data provided. Be specific — name people, companies, dates. If you see non-obvious connections, mention them. Be concise but thorough.`;
    const response = await llm.chat(systemPrompt, `World model:\n${context}\n\nQuestion: ${args.question}`, { temperature: 0.4, maxTokens: 1500 });
    return response;
  } finally { wm.close(); }
}

function handleOwlEntities(args) {
  return withWorldModel((wm) => {
    let results;
    if (args.query) {
      results = wm.findEntities(args.query, args.limit || 25);
    } else {
      results = wm.getChangedEntities(daysAgo(args.days || 7), args.limit || 25);
    }
    if (args.type) results = results.filter((e) => e.type === args.type);
    return results;
  });
}

function handleOwlEntityDetail(args) {
  return withWorldModel((wm) => {
    const matches = wm.findEntities(args.name, 1);
    if (matches.length === 0) return { error: `No entity found matching "${args.name}"` };
    const entity = matches[0];
    const relationships = wm.getRelationships(entity.id).map((r) => {
      const otherId = r.from_entity === entity.id ? r.to_entity : r.from_entity;
      const other = wm.getEntity(otherId);
      return { type: r.type, direction: r.from_entity === entity.id ? 'outgoing' : 'incoming', target: other ? other.name : otherId, targetType: other?.type, strength: r.strength };
    });
    const events = wm.getRecentEvents(daysAgo(14), 500).filter((e) => (e.entities || []).includes(entity.id)).slice(0, 20);
    const discoveries = wm.getRecentDiscoveries(daysAgo(30), 200).filter((d) => (d.entities || []).includes(entity.id)).slice(0, 10);
    return { entity, relationships, recentEvents: events, relatedDiscoveries: discoveries };
  });
}

function handleOwlDiscoveries(args) {
  return withWorldModel((wm) => {
    let results = wm.getRecentDiscoveries(daysAgo(args.days || 7), args.limit || 20);
    if (args.type) results = results.filter((d) => d.type === args.type);
    if (args.urgency) results = results.filter((d) => d.urgency === args.urgency);
    return results;
  });
}

function handleOwlEvents(args) {
  return withWorldModel((wm) => {
    let events = wm.getRecentEvents(daysAgo(args.days || 3), args.limit || 50);
    if (args.source) events = events.filter((e) => e.source === args.source);
    return events;
  });
}

function handleOwlRelationships(args) {
  return withWorldModel((wm) => {
    // Path finding
    if (args.path_from && args.path_to) {
      const fromMatches = wm.findEntities(args.path_from, 1);
      const toMatches = wm.findEntities(args.path_to, 1);
      if (fromMatches.length === 0) return { error: `Entity not found: "${args.path_from}"` };
      if (toMatches.length === 0) return { error: `Entity not found: "${args.path_to}"` };
      const graph = buildAdjacencyList(wm);
      const path = findPath(graph, fromMatches[0].id, toMatches[0].id);
      if (!path) return { path: null, message: 'No path found between these entities' };
      const pathNames = path.map((id) => { const e = wm.getEntity(id); return { id, name: e ? e.name : id, type: e?.type }; });
      return { path: pathNames, hops: path.length - 1 };
    }

    // Single entity relationships
    if (args.entity) {
      const matches = wm.findEntities(args.entity, 1);
      if (matches.length === 0) return { error: `Entity not found: "${args.entity}"` };
      const entity = matches[0];
      const rels = wm.getRelationships(entity.id);
      return {
        entity: { id: entity.id, name: entity.name, type: entity.type },
        relationships: rels.map((r) => {
          const otherId = r.from_entity === entity.id ? r.to_entity : r.from_entity;
          const other = wm.getEntity(otherId);
          return { type: r.type, direction: r.from_entity === entity.id ? 'outgoing' : 'incoming', target: other ? other.name : otherId, targetType: other?.type, strength: r.strength };
        })
      };
    }

    return { error: 'Provide entity name or path_from + path_to' };
  });
}

function handleOwlGraph(args) {
  return withWorldModel((wm) => {
    const graph = buildAdjacencyList(wm);
    if (graph.size === 0) return { nodes: 0, edges: 0, message: 'No graph data yet' };
    const totalEdges = Math.round([...graph.values()].reduce((s, e) => s + e.length, 0) / 2);
    const type = args.type || 'summary';
    const topN = args.top_n || 10;
    const resolveName = (id) => { const e = wm.getEntity(id); return e ? e.name : id; };

    if (type === 'hubs') {
      return { nodes: graph.size, edges: totalEdges, hubs: getHubs(graph, topN).map((h) => ({ name: resolveName(h.entityId), degree: h.degree, avgStrength: h.avgStrength })) };
    }
    if (type === 'clusters') {
      const clusters = findClusters(graph);
      const result = [];
      for (const [, members] of clusters) {
        result.push([...members].map(resolveName));
      }
      return { nodes: graph.size, edges: totalEdges, clusterCount: clusters.size, clusters: result };
    }
    if (type === 'bridges') {
      const clusters = findClusters(graph);
      const bridges = findBridgeEntities(graph, clusters);
      return { nodes: graph.size, edges: totalEdges, bridges: bridges.slice(0, topN).map((b) => ({ name: resolveName(b.entityId), clusterCount: b.clusterCount })) };
    }

    // Summary
    const hubs = getHubs(graph, 5).map((h) => ({ name: resolveName(h.entityId), connections: h.degree }));
    const clusters = findClusters(graph);
    return { nodes: graph.size, edges: totalEdges, clusterCount: clusters.size, topHubs: hubs };
  });
}

function handleOwlSituations() {
  return withWorldModel((wm) => wm.getActiveSituations(50));
}

function handleOwlPatterns(args) {
  return withWorldModel((wm) => wm.getPatterns(args.limit || 30));
}

function handleOwlFeedback(args) {
  return withWorldModel((wm) => {
    const discovery = wm.getDiscovery(args.discovery_id);
    if (!discovery) return { error: `Discovery not found: ${args.discovery_id}` };
    wm.updateDiscoveryReaction(args.discovery_id, args.reaction, args.acted_on || false);
    return { success: true, discovery_id: args.discovery_id, reaction: args.reaction };
  });
}

// ─── Prompt handlers ───

function handlePrompt(name, args) {
  return withWorldModel((wm, config) => {
    switch (name) {
      case 'morning_briefing': {
        const days = Number(args?.days) || 1;
        const since = daysAgo(days);
        const events = wm.getRecentEvents(since, 100);
        const discoveries = wm.getRecentDiscoveries(since, 20);
        const situations = wm.getActiveSituations(20);
        const upcoming = wm.getUpcomingEvents(1, 20);
        return {
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `Generate a concise morning briefing based on OWL's world model data.\n\nOvernight events (${events.length}):\n${events.map((e) => `- [${e.source}] ${e.summary}`).join('\n')}\n\nActive discoveries:\n${discoveries.map((d) => `- [${d.urgency}] ${d.title}`).join('\n')}\n\nOngoing situations:\n${situations.map((s) => `- [${s.urgency}] ${s.description}`).join('\n')}\n\nToday's schedule:\n${upcoming.map((e) => `- ${e.summary} (${e.timestamp})`).join('\n')}\n\nFormat as a brief executive summary with action items.`
            }
          }]
        };
      }
      case 'risk_assessment': {
        const events = wm.getRecentEvents(daysAgo(7), 200);
        const discoveries = wm.getRecentDiscoveries(daysAgo(7), 50).filter((d) => d.urgency === 'urgent' || d.type === 'anomaly');
        const situations = wm.getActiveSituations(50);
        const graph = buildAdjacencyList(wm);
        const bridges = graph.size > 0 ? findBridgeEntities(graph, findClusters(graph)).slice(0, 5) : [];
        const bridgeNames = bridges.map((b) => { const e = wm.getEntity(b.entityId); return e ? e.name : b.entityId; });
        return {
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze potential risks across the user's world based on OWL's data.\n\nUrgent/anomaly discoveries:\n${discoveries.map((d) => `- [${d.type}] ${d.title}: ${d.body?.split('\n')[0]}`).join('\n')}\n\nActive situations:\n${situations.map((s) => `- [${s.urgency}] ${s.description}`).join('\n')}\n\nSingle-point-of-failure entities (bridges): ${bridgeNames.join(', ')}\n\nRecent event volume by source:\n${[...new Set(events.map((e) => e.source))].map((src) => `- ${src}: ${events.filter((e) => e.source === src).length} events`).join('\n')}\n\nIdentify risks, bottlenecks, and things that need attention. Rank by severity.`
            }
          }]
        };
      }
      case 'relationship_map': {
        const entityName = args?.entity;
        if (!entityName) return { messages: [{ role: 'user', content: { type: 'text', text: 'Please provide an entity name to map.' } }] };
        const matches = wm.findEntities(entityName, 1);
        if (matches.length === 0) return { messages: [{ role: 'user', content: { type: 'text', text: `Entity "${entityName}" not found.` } }] };
        const entity = matches[0];
        const rels = wm.getRelationships(entity.id);
        const relDetails = rels.map((r) => {
          const otherId = r.from_entity === entity.id ? r.to_entity : r.from_entity;
          const other = wm.getEntity(otherId);
          return `- ${r.from_entity === entity.id ? '->' : '<-'} ${r.type} ${other ? other.name : otherId} [${other?.type}] (strength: ${r.strength})`;
        });
        const events = wm.getRecentEvents(daysAgo(14), 500).filter((e) => (e.entities || []).includes(entity.id)).slice(0, 15);
        return {
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `Describe the relationship network around ${entity.name} [${entity.type}].\n\nAttributes: ${JSON.stringify(entity.attributes)}\nSources: ${(entity.sources || []).join(', ')}\n\nDirect relationships:\n${relDetails.join('\n')}\n\nRecent events involving ${entity.name}:\n${events.map((e) => `- [${e.source}] ${e.summary}`).join('\n')}\n\nDescribe who this entity connects to, the nature and strength of those connections, and any interesting patterns.`
            }
          }]
        };
      }
      case 'weekly_summary': {
        const events = wm.getRecentEvents(daysAgo(7), 300);
        const discoveries = wm.getRecentDiscoveries(daysAgo(7), 50);
        const situations = wm.getActiveSituations(30);
        const stats = wm.getStats();
        return {
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `Generate a comprehensive weekly summary based on OWL's world model.\n\nWorld model: ${stats.entities} entities, ${stats.events} events, ${stats.discoveries} discoveries\n\nThis week's discoveries (${discoveries.length}):\n${discoveries.map((d) => `- [${d.type}/${d.urgency}] ${d.title}`).join('\n')}\n\nActive situations:\n${situations.map((s) => `- [${s.urgency}] ${s.description}`).join('\n')}\n\nEvent summary by source:\n${[...new Set(events.map((e) => e.source))].map((src) => `- ${src}: ${events.filter((e) => e.source === src).length} events`).join('\n')}\n\nHighlight key developments, emerging patterns, and what to watch next week.`
            }
          }]
        };
      }
      default:
        return null;
    }
  });
}

// ─── Resource handlers ───

function handleResource(uri) {
  return withWorldModel((wm, config) => {
    if (uri === 'owl://world-model/snapshot') {
      const since = daysAgo(14);
      const graph = buildAdjacencyList(wm);
      const hubs = graph.size > 0 ? getHubs(graph, 10).map((h) => { const e = wm.getEntity(h.entityId); return { name: e?.name, degree: h.degree }; }) : [];
      return {
        exportedAt: new Date().toISOString(),
        stats: wm.getStats(),
        entities: wm.getChangedEntities(since, 200),
        events: wm.getRecentEvents(since, 200),
        discoveries: wm.getRecentDiscoveries(since, 100),
        situations: wm.getActiveSituations(50),
        patterns: wm.getPatterns(100),
        graphHubs: hubs
      };
    }
    if (uri === 'owl://health/report') {
      const metrics = computeHealthMetrics(wm);
      const anomalies = detectHealthAnomalies(metrics);
      return { metrics, anomalies };
    }
    if (uri === 'owl://score') {
      return computeOwlScore(wm, config);
    }
    return null;
  });
}

// ─── MCP Protocol (stdio JSON-RPC) ───

async function handleRequest(request) {
  const { method, params } = request;

  switch (method) {
    case 'initialize':
      return { protocolVersion: '2024-11-05', serverInfo: SERVER_INFO, capabilities: CAPABILITIES };

    case 'notifications/initialized':
      return undefined;

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
          case 'owl_entity_detail': result = handleOwlEntityDetail(args); break;
          case 'owl_discoveries': result = handleOwlDiscoveries(args); break;
          case 'owl_events': result = handleOwlEvents(args); break;
          case 'owl_relationships': result = handleOwlRelationships(args); break;
          case 'owl_graph': result = handleOwlGraph(args); break;
          case 'owl_situations': result = handleOwlSituations(); break;
          case 'owl_patterns': result = handleOwlPatterns(args); break;
          case 'owl_feedback': result = handleOwlFeedback(args); break;
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
        }
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }

    case 'prompts/list':
      return { prompts: PROMPTS };

    case 'prompts/get': {
      const result = handlePrompt(params?.name, params?.arguments || {});
      if (!result) throw { code: -32602, message: `Unknown prompt: ${params?.name}` };
      return result;
    }

    case 'resources/list':
      return { resources: RESOURCES };

    case 'resources/read': {
      const uri = params?.uri;
      const data = handleResource(uri);
      if (data === null) return { contents: [{ uri, text: `Unknown resource: ${uri}` }] };
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
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
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try { processMessage(JSON.parse(line)); } catch { /* ignore malformed */ }
  }
});

async function processMessage(message) {
  try {
    const result = await handleRequest(message);
    if (result === undefined && !message.id) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: result || {} }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      error: error.code ? error : { code: -32603, message: error.message || 'Internal error' }
    }) + '\n');
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
