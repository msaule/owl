import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import {
  findMatchingChain,
  createChain,
  extendChain,
  shouldGenerateMetaDiscovery,
  processDiscoveryChain,
  buildMetaDiscoveryPrompt
} from '../src/discovery/chains.js';
import {
  computeHealthMetrics,
  detectHealthAnomalies,
  formatHealthReport
} from '../src/discovery/health.js';
import { buildEmbed } from '../src/channels/discord.js';
import { buildBlocks } from '../src/channels/slack.js';
import { buildAtomFeed, buildAtomEntry, escapeXml } from '../src/channels/rss.js';
import { groupDiscoveries } from '../src/channels/email-digest.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

function makeDiscovery(overrides = {}) {
  return {
    id: `disc-${Math.random().toString(36).slice(2, 8)}`,
    type: 'connection',
    urgency: 'important',
    title: 'Test Discovery',
    body: 'This is a test discovery body.',
    sources: ['gmail'],
    entities: ['entity-alice'],
    confidence: 0.85,
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

// =============================================
// Discovery Chains
// =============================================

test('createChain creates a new chain from a discovery', () => {
  const discovery = makeDiscovery();
  const chain = createChain(discovery);
  assert.equal(chain.length, 1);
  assert.deepEqual(chain.discovery_ids, [discovery.id]);
  assert.deepEqual(chain.entities, ['entity-alice']);
  assert.equal(chain.status, 'active');
  assert.ok(chain.id.startsWith('chain_'));
});

test('extendChain adds a discovery to an existing chain', () => {
  const d1 = makeDiscovery({ entities: ['entity-alice'] });
  const chain = createChain(d1);
  const d2 = makeDiscovery({ entities: ['entity-alice', 'entity-bob'] });
  const extended = extendChain(chain, d2);
  assert.equal(extended.length, 2);
  assert.ok(extended.entities.includes('entity-alice'));
  assert.ok(extended.entities.includes('entity-bob'));
  assert.deepEqual(extended.discovery_ids, [d1.id, d2.id]);
});

test('findMatchingChain returns null when no chains match', () => {
  const d = makeDiscovery({ entities: ['entity-xyz'], sources: ['shopify'], title: 'Unrelated order spike', body: 'Revenue jumped overnight.' });
  const chain = createChain(makeDiscovery({ entities: ['entity-completely-different'], sources: ['github'], title: 'PR merge pattern', body: 'Multiple PRs merged in sequence.' }));
  const match = findMatchingChain(d, [chain]);
  assert.equal(match, null);
});

test('findMatchingChain finds chain with shared entities', () => {
  const d = makeDiscovery({ entities: ['entity-alice', 'entity-bob'] });
  const existingChain = createChain(makeDiscovery({ entities: ['entity-alice'] }));
  const match = findMatchingChain(d, [existingChain]);
  assert.ok(match);
  assert.equal(match.id, existingChain.id);
});

test('shouldGenerateMetaDiscovery triggers at length 3, 6, 9...', () => {
  assert.equal(shouldGenerateMetaDiscovery({ length: 1 }), false);
  assert.equal(shouldGenerateMetaDiscovery({ length: 2 }), false);
  assert.equal(shouldGenerateMetaDiscovery({ length: 3 }), true);
  assert.equal(shouldGenerateMetaDiscovery({ length: 4 }), false);
  assert.equal(shouldGenerateMetaDiscovery({ length: 6 }), true);
});

test('processDiscoveryChain creates new chain when no match', () => {
  const d = makeDiscovery({ entities: ['entity-new'] });
  const result = processDiscoveryChain(d, []);
  assert.equal(result.isNew, true);
  assert.equal(result.chain.length, 1);
  assert.equal(result.shouldMeta, false);
});

test('processDiscoveryChain extends existing chain on match', () => {
  const d1 = makeDiscovery({ entities: ['entity-alice'] });
  const chain = createChain(d1);
  const d2 = makeDiscovery({ entities: ['entity-alice'] });
  const result = processDiscoveryChain(d2, [chain]);
  assert.equal(result.isNew, false);
  assert.equal(result.chain.length, 2);
});

test('buildMetaDiscoveryPrompt produces valid prompts', () => {
  const chain = createChain(makeDiscovery());
  chain.length = 3;
  chain.entities = ['entity-alice', 'entity-bob'];
  chain.sources = ['gmail', 'calendar'];
  const discoveries = [makeDiscovery({ id: chain.discovery_ids[0] })];
  const { systemPrompt, userPrompt } = buildMetaDiscoveryPrompt(chain, discoveries);
  assert.ok(systemPrompt.includes('meta-analysis'));
  assert.ok(userPrompt.includes('entity-alice'));
  assert.ok(userPrompt.includes('gmail'));
});

// =============================================
// World Model — Chain CRUD
// =============================================

test('WorldModel chain CRUD operations', () => {
  const dbPath = createTempDb('chain-crud');
  const wm = new WorldModel(dbPath);
  try {
    const chain = createChain(makeDiscovery());
    const saved = wm.addChain(chain);
    assert.ok(saved);
    assert.equal(saved.id, chain.id);
    assert.equal(saved.length, 1);

    // Get chain
    const fetched = wm.getChain(chain.id);
    assert.ok(fetched);
    assert.deepEqual(fetched.discovery_ids, chain.discovery_ids);

    // Get active chains
    const active = wm.getActiveChains();
    assert.equal(active.length, 1);

    // Update chain
    const extended = extendChain(chain, makeDiscovery({ entities: ['entity-bob'] }));
    wm.updateChain(extended);
    const updated = wm.getChain(chain.id);
    assert.equal(updated.length, 2);
    assert.ok(updated.entities.includes('entity-bob'));
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

// =============================================
// Health Diagnostics
// =============================================

test('computeHealthMetrics returns structured metrics', () => {
  const dbPath = createTempDb('health-metrics');
  const wm = new WorldModel(dbPath);
  try {
    // Add some test data
    wm.addEvent({ source: 'gmail', type: 'email.received', summary: 'Test event', timestamp: new Date().toISOString() });
    wm.addDiscovery(makeDiscovery());

    const metrics = computeHealthMetrics(wm);
    assert.ok(metrics.timestamp);
    assert.ok(metrics.totals);
    assert.equal(metrics.totals.events, 1);
    assert.equal(metrics.totals.discoveries, 1);
    assert.ok(metrics.daily);
    assert.ok(metrics.weekly);
    assert.ok(metrics.active);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('detectHealthAnomalies returns empty for healthy state', () => {
  const metrics = {
    daily: { discoveries: 2, events: 10 },
    weekly: { discoveries: 14, avgDiscoveriesPerDay: 2, positiveRate: 60, feedbackRate: 40, actionRate: 20 },
    totals: { events: 100 }
  };
  const anomalies = detectHealthAnomalies(metrics);
  assert.equal(anomalies.length, 0);
});

test('detectHealthAnomalies flags no-discoveries with events', () => {
  const metrics = {
    daily: { discoveries: 0, events: 50 },
    weekly: { discoveries: 3, avgDiscoveriesPerDay: 0.4, positiveRate: 50, feedbackRate: 30, actionRate: 10 },
    totals: { events: 200 }
  };
  const anomalies = detectHealthAnomalies(metrics);
  assert.ok(anomalies.some((a) => a.type === 'no_discoveries'));
});

test('detectHealthAnomalies flags low quality', () => {
  const metrics = {
    daily: { discoveries: 2, events: 10 },
    weekly: { discoveries: 10, avgDiscoveriesPerDay: 1.4, positiveRate: 10, feedbackRate: 80, actionRate: 5 },
    totals: { events: 100 }
  };
  const anomalies = detectHealthAnomalies(metrics);
  assert.ok(anomalies.some((a) => a.type === 'low_quality'));
});

test('formatHealthReport produces readable output', () => {
  const metrics = {
    timestamp: new Date().toISOString(),
    totals: { entities: 10, relationships: 5, events: 100, patterns: 3, situations: 2, discoveries: 15 },
    daily: { discoveries: 2, events: 10 },
    weekly: {
      discoveries: 14, avgDiscoveriesPerDay: 2, feedbackRate: 40, positiveRate: 60,
      actionRate: 20, entityGrowth: 5, typeDistribution: { connection: 4, risk: 2 },
      urgencyDistribution: { important: 3, interesting: 4 }
    },
    active: { situations: 2, patterns: 3, highConfidencePatterns: 1 }
  };
  const report = formatHealthReport(metrics, []);
  assert.ok(report.includes('OWL Health Report'));
  assert.ok(report.includes('Entities: 10'));
  assert.ok(report.includes('Feedback rate: 40%'));
});

// =============================================
// Discord Rich Embeds
// =============================================

test('buildEmbed creates structured embed object', () => {
  const discovery = makeDiscovery({ urgency: 'urgent', type: 'risk' });
  const embed = buildEmbed(discovery);
  assert.ok(embed.title.includes('Test Discovery'));
  assert.equal(embed.color, 0xff3b30); // red for urgent
  assert.ok(embed.fields.length > 0);
  assert.ok(embed.footer.text.includes('OWL'));
});

test('buildEmbed handles missing fields gracefully', () => {
  const discovery = makeDiscovery({ sources: [], entities: [], confidence: null });
  const embed = buildEmbed(discovery);
  assert.ok(embed.title);
  assert.ok(embed.description);
});

// =============================================
// Slack Block Kit
// =============================================

test('buildBlocks creates structured block array', () => {
  const discovery = makeDiscovery({ urgency: 'important', type: 'opportunity' });
  const blocks = buildBlocks(discovery);
  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.length >= 3);
  assert.equal(blocks[0].type, 'header');
  assert.ok(blocks.some((b) => b.type === 'section'));
  assert.ok(blocks.some((b) => b.type === 'divider'));
});

// =============================================
// RSS/Atom Feed
// =============================================

test('escapeXml escapes special characters', () => {
  assert.equal(escapeXml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(escapeXml("O'Reilly & Sons"), "O&apos;Reilly &amp; Sons");
});

test('buildAtomEntry creates valid entry XML', () => {
  const discovery = makeDiscovery();
  const entry = buildAtomEntry(discovery);
  assert.ok(entry.includes('<entry>'));
  assert.ok(entry.includes('</entry>'));
  assert.ok(entry.includes('Test Discovery'));
  assert.ok(entry.includes('urn:owl:discovery:'));
});

test('buildAtomFeed creates complete Atom XML', () => {
  const discoveries = [makeDiscovery(), makeDiscovery({ title: 'Another Discovery' })];
  const feed = buildAtomFeed(discoveries, 'Test Feed');
  assert.ok(feed.includes('<?xml version="1.0"'));
  assert.ok(feed.includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
  assert.ok(feed.includes('Test Feed'));
  assert.ok(feed.includes('Test Discovery'));
  assert.ok(feed.includes('Another Discovery'));
  assert.ok(feed.includes('</feed>'));
});

test('buildAtomFeed handles empty discoveries', () => {
  const feed = buildAtomFeed([]);
  assert.ok(feed.includes('<feed'));
  assert.ok(feed.includes('</feed>'));
});

// =============================================
// Email Digest Grouping
// =============================================

test('groupDiscoveries returns single group for few items', () => {
  const discoveries = [makeDiscovery(), makeDiscovery()];
  const groups = groupDiscoveries(discoveries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].discoveries.length, 2);
});

test('groupDiscoveries clusters by shared entities', () => {
  const d1 = makeDiscovery({ entities: ['entity-alice'] });
  const d2 = makeDiscovery({ entities: ['entity-alice', 'entity-bob'] });
  const d3 = makeDiscovery({ entities: ['entity-charlie'] });
  const d4 = makeDiscovery({ entities: ['entity-charlie'] });
  const groups = groupDiscoveries([d1, d2, d3, d4]);
  // Should have at least 2 groups (alice/bob cluster and charlie cluster)
  assert.ok(groups.length >= 2);
});

test('groupDiscoveries handles empty array', () => {
  const groups = groupDiscoveries([]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].discoveries.length, 0);
});
