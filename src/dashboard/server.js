import http from 'node:http';
import fs from 'node:fs';
import { loadConfig } from '../config/index.js';
import { WorldModel } from '../core/world-model.js';
import { buildAdjacencyList, getHubs, findClusters } from '../core/graph.js';
import { computeHealthMetrics, detectHealthAnomalies } from '../discovery/health.js';
import { computeOwlScore } from '../cli/banner.js';
import { daysAgo } from '../utils/time.js';
import { getDashboardHtml } from './html.js';

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function getWorldModel(config) {
  return new WorldModel(config.paths.dbPath);
}

function apiStats(config) {
  const wm = getWorldModel(config);
  try {
    const stats = wm.getStats();
    const score = computeOwlScore(wm, config);
    return { stats, score };
  } finally { wm.close(); }
}

function apiEntities(config, days = 14) {
  const wm = getWorldModel(config);
  try {
    return wm.getChangedEntities(daysAgo(days), 200);
  } finally { wm.close(); }
}

function apiDiscoveries(config, days = 7) {
  const wm = getWorldModel(config);
  try {
    return wm.getRecentDiscoveries(daysAgo(days), 100);
  } finally { wm.close(); }
}

function apiEvents(config, days = 3) {
  const wm = getWorldModel(config);
  try {
    return wm.getRecentEvents(daysAgo(days), 200);
  } finally { wm.close(); }
}

function apiGraph(config) {
  const wm = getWorldModel(config);
  try {
    const graph = buildAdjacencyList(wm);
    const nodes = [];
    const edges = [];
    const seen = new Set();

    for (const [entityId, neighbors] of graph) {
      const entity = wm.getEntity(entityId);
      nodes.push({
        id: entityId,
        name: entity ? entity.name : entityId,
        type: entity ? entity.type : 'unknown',
        importance: entity?.importance || 0.5
      });

      for (const neighbor of neighbors) {
        const edgeKey = [entityId, neighbor.entityId].sort().join('::');
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          edges.push({
            source: entityId,
            target: neighbor.entityId,
            type: neighbor.type,
            strength: neighbor.strength
          });
        }
      }
    }

    const hubs = getHubs(graph, 10).map((h) => {
      const e = wm.getEntity(h.entityId);
      return { id: h.entityId, name: e ? e.name : h.entityId, degree: h.degree };
    });

    return { nodes, edges, hubs };
  } finally { wm.close(); }
}

function apiHealth(config) {
  const wm = getWorldModel(config);
  try {
    const metrics = computeHealthMetrics(wm);
    const anomalies = detectHealthAnomalies(metrics);
    return { metrics, anomalies };
  } finally { wm.close(); }
}

function apiSituations(config) {
  const wm = getWorldModel(config);
  try {
    return wm.getActiveSituations(50);
  } finally { wm.close(); }
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  for (const pair of url.slice(idx + 1).split('&')) {
    const [k, v] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return params;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export function startDashboard(options = {}) {
  const config = loadConfig(options.config);
  const port = options.port || 3000;

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const query = parseQuery(req.url);

    // CORS preflight for save-config
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    try {
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHtml());
        return;
      }

      // Save config endpoint (used by setup wizard)
      if (url === '/api/save-config' && req.method === 'POST') {
        const body = await readBody(req);
        const newConfig = JSON.parse(body);
        const configPath = config.paths.configPath;
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
        return jsonResponse(res, { ok: true });
      }

      if (url === '/api/stats') return jsonResponse(res, apiStats(config));
      if (url === '/api/entities') return jsonResponse(res, apiEntities(config, Number(query.days) || 14));
      if (url === '/api/discoveries') return jsonResponse(res, apiDiscoveries(config, Number(query.days) || 7));
      if (url === '/api/events') return jsonResponse(res, apiEvents(config, Number(query.days) || 3));
      if (url === '/api/graph') return jsonResponse(res, apiGraph(config));
      if (url === '/api/health') return jsonResponse(res, apiHealth(config));
      if (url === '/api/situations') return jsonResponse(res, apiSituations(config));

      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      jsonResponse(res, { error: error.message }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`OWL Dashboard → http://localhost:${port}`);
  });

  return server;
}
