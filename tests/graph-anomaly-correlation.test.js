import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import { buildAdjacencyList, findPath, findClusters, findBridgeEntities, getHubs } from '../src/core/graph.js';
import { computeBaselines, detectAnomalies, anomaliesToEvents } from '../src/core/anomaly.js';
import { findCorrelations, formatCorrelationsForPrompt } from '../src/discovery/correlation.js';
import { compileDebriefData, buildDebriefPrompt } from '../src/discovery/debrief.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

// =============================================
// Entity Graph
// =============================================

test('buildAdjacencyList creates bidirectional graph from relationships', () => {
  const dbPath = createTempDb('graph-adj');
  const wm = new WorldModel(dbPath);
  try {
    wm.addEntity({ id: 'alice', type: 'person', name: 'Alice' });
    wm.addEntity({ id: 'bob', type: 'person', name: 'Bob' });
    wm.addEntity({ id: 'acme', type: 'company', name: 'Acme Corp' });

    wm.addRelationship({ from_entity: 'alice', to_entity: 'bob', type: 'knows', strength: 0.8 });
    wm.addRelationship({ from_entity: 'bob', to_entity: 'acme', type: 'works-at', strength: 0.9 });

    const graph = buildAdjacencyList(wm);
    assert.ok(graph.has('alice'));
    assert.ok(graph.has('bob'));
    assert.ok(graph.has('acme'));

    // Bidirectional
    assert.ok(graph.get('alice').some((e) => e.target === 'bob'));
    assert.ok(graph.get('bob').some((e) => e.target === 'alice'));
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('findPath discovers shortest path between entities', () => {
  const graph = new Map();
  graph.set('a', [{ target: 'b', type: 'knows', strength: 0.8 }]);
  graph.set('b', [
    { target: 'a', type: 'knows', strength: 0.8 },
    { target: 'c', type: 'works-at', strength: 0.9 }
  ]);
  graph.set('c', [{ target: 'b', type: 'works-at', strength: 0.9 }]);

  const pathResult = findPath(graph, 'a', 'c');
  assert.ok(pathResult);
  assert.equal(pathResult.length, 3); // a → b → c
  assert.equal(pathResult[0].entity, 'a');
  assert.equal(pathResult[2].entity, 'c');
});

test('findPath returns null when no path exists', () => {
  const graph = new Map();
  graph.set('a', []);
  graph.set('b', []);
  const result = findPath(graph, 'a', 'b');
  assert.equal(result, null);
});

test('findPath returns empty array for same start and end', () => {
  const graph = new Map();
  graph.set('a', []);
  assert.deepEqual(findPath(graph, 'a', 'a'), []);
});

test('findClusters groups connected entities', () => {
  const graph = new Map();
  // Cluster 1: a-b-c
  graph.set('a', [{ target: 'b', strength: 0.8 }, { target: 'c', strength: 0.7 }]);
  graph.set('b', [{ target: 'a', strength: 0.8 }, { target: 'c', strength: 0.9 }]);
  graph.set('c', [{ target: 'a', strength: 0.7 }, { target: 'b', strength: 0.9 }]);
  // Cluster 2: d-e
  graph.set('d', [{ target: 'e', strength: 0.6 }]);
  graph.set('e', [{ target: 'd', strength: 0.6 }]);
  // Isolated: f
  graph.set('f', []);

  const clusters = findClusters(graph);
  assert.ok(clusters.size >= 2);

  // Check that a, b, c are in the same cluster
  let clusterOfA = null;
  for (const [label, members] of clusters) {
    if (members.has('a')) clusterOfA = label;
  }
  assert.ok(clusterOfA != null);
  const cluster1 = clusters.get(clusterOfA);
  assert.ok(cluster1.has('b'));
  assert.ok(cluster1.has('c'));
});

test('getHubs returns most connected entities', () => {
  const graph = new Map();
  graph.set('hub', [
    { target: 'a', strength: 0.5 },
    { target: 'b', strength: 0.6 },
    { target: 'c', strength: 0.7 }
  ]);
  graph.set('a', [{ target: 'hub', strength: 0.5 }]);
  graph.set('b', [{ target: 'hub', strength: 0.6 }]);
  graph.set('c', [{ target: 'hub', strength: 0.7 }]);

  const hubs = getHubs(graph, 2);
  assert.equal(hubs[0].entityId, 'hub');
  assert.equal(hubs[0].degree, 3);
});

// =============================================
// Anomaly Detection
// =============================================

test('computeBaselines builds statistical profiles from events', () => {
  const dbPath = createTempDb('anomaly-baselines');
  const wm = new WorldModel(dbPath);
  try {
    // Add events on the same day-of-week for 4 consecutive weeks to ensure
    // each bucket gets >= 3 data points.
    for (let weekOffset = 0; weekOffset < 4; weekOffset++) {
      const ts = new Date(Date.now() - weekOffset * 7 * 86_400_000);
      // Set to 10:00 AM to land in the same 4h bucket
      ts.setHours(10, 0, 0, 0);
      for (let i = 0; i < 5; i++) {
        wm.addEvent({
          source: 'gmail',
          type: 'email.received',
          summary: `Email week${weekOffset} ${i}`,
          timestamp: new Date(ts.getTime() + i * 60_000).toISOString()
        });
      }
    }

    const baselines = computeBaselines(wm, 30);
    assert.ok(baselines.size > 0);

    // Check that at least one gmail baseline exists
    const gmailKeys = [...baselines.keys()].filter((k) => k.startsWith('gmail:'));
    assert.ok(gmailKeys.length > 0);

    const firstBaseline = baselines.get(gmailKeys[0]);
    assert.ok(firstBaseline.mean > 0);
    assert.ok(firstBaseline.count >= 3);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('anomaliesToEvents converts anomaly objects to event objects', () => {
  const anomalies = [
    {
      type: 'volume_spike',
      source: 'gmail',
      severity: 'high',
      currentCount: 20,
      expectedMean: 5,
      zScore: 3.5,
      message: 'Gmail has 20 events — normally ~5'
    }
  ];

  const events = anomaliesToEvents(anomalies);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'owl-internal');
  assert.equal(events[0].type, 'anomaly.volume_spike');
  assert.equal(events[0].importance, 0.85);
});

// =============================================
// Cross-Source Correlation
// =============================================

test('findCorrelations detects co-occurring events from different sources', () => {
  const dbPath = createTempDb('correlation');
  const wm = new WorldModel(dbPath);
  try {
    // Create a pattern: gmail event followed by calendar event 30min later, repeated 5 times
    for (let i = 0; i < 5; i++) {
      const base = Date.now() - (10 - i) * 86_400_000;
      wm.addEvent({
        source: 'gmail',
        type: 'email.received',
        summary: `Important email ${i}`,
        timestamp: new Date(base).toISOString(),
        entities: ['entity-acme']
      });
      wm.addEvent({
        source: 'calendar',
        type: 'calendar.event.approaching',
        summary: `Meeting ${i}`,
        timestamp: new Date(base + 30 * 60_000).toISOString(),
        entities: ['entity-acme']
      });
    }

    const correlations = findCorrelations(wm, { lookbackDays: 14, windowMinutes: 120, minOccurrences: 3 });
    // Should find the gmail → calendar correlation
    assert.ok(correlations.length > 0);
    const first = correlations[0];
    assert.ok(first.from.includes('gmail'));
    assert.ok(first.to.includes('calendar'));
    assert.ok(first.occurrences >= 3);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('formatCorrelationsForPrompt returns empty string for no correlations', () => {
  assert.equal(formatCorrelationsForPrompt([]), '');
});

test('formatCorrelationsForPrompt formats correlations as markdown', () => {
  const correlations = [{
    from: 'gmail:email.received',
    to: 'calendar:event',
    occurrences: 5,
    lift: 3.2,
    avgDelayMinutes: 30,
    sharedEntities: ['acme'],
    description: 'Gmail followed by Calendar 30min later'
  }];
  const result = formatCorrelationsForPrompt(correlations);
  assert.ok(result.includes('Cross-Source Correlations'));
  assert.ok(result.includes('Gmail followed by Calendar'));
});

// =============================================
// Weekly Debrief
// =============================================

test('compileDebriefData produces structured weekly summary', () => {
  const dbPath = createTempDb('debrief');
  const wm = new WorldModel(dbPath);
  try {
    wm.addEvent({ source: 'gmail', type: 'email.received', summary: 'Test', timestamp: new Date().toISOString() });
    wm.addDiscovery({
      type: 'connection',
      urgency: 'important',
      title: 'Test Discovery',
      body: 'Body',
      sources: ['gmail'],
      entities: [],
      timestamp: new Date().toISOString()
    });

    const data = compileDebriefData(wm);
    assert.ok(data.period);
    assert.ok(data.discoveries);
    assert.equal(data.discoveries.total, 1);
    assert.ok(data.events);
    assert.equal(data.events.total, 1);
    assert.ok(data.health);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('buildDebriefPrompt produces valid LLM prompts', () => {
  const data = {
    period: { from: '2026-03-14', to: '2026-03-21' },
    discoveries: { total: 5, top: [], typeBreakdown: {}, urgencyBreakdown: {} },
    events: { total: 100, topSources: [['gmail', 60], ['calendar', 40]] },
    entities: { newCount: 3, newEntities: [{ name: 'Alice', type: 'person' }], totalActive: 20 },
    situations: { active: 1, list: [{ description: 'Server down', urgency: 0.9 }] },
    patterns: { active: 2, list: [] },
    health: { feedbackRate: 40, positiveRate: 60, actionRate: 20 }
  };

  const { systemPrompt, userPrompt } = buildDebriefPrompt(data, 'TestUser');
  assert.ok(systemPrompt.includes('TestUser'));
  assert.ok(systemPrompt.includes('weekly debrief'));
  assert.ok(userPrompt.includes('gmail'));
  assert.ok(userPrompt.includes('Alice'));
});
