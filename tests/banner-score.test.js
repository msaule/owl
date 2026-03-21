import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { WorldModel } from '../src/core/world-model.js';
import { computeOwlScore, formatOwlScore } from '../src/cli/banner.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

test('computeOwlScore returns 0-100 with breakdown', () => {
  const dbPath = createTempDb('score-basic');
  const wm = new WorldModel(dbPath);

  try {
    const score = computeOwlScore(wm, {});
    assert.ok(score.total >= 0 && score.total <= 100);
    assert.ok(score.breakdown);
    assert.ok('freshness' in score.breakdown);
    assert.ok('coverage' in score.breakdown);
    assert.ok('discoveryRate' in score.breakdown);
    assert.ok('feedbackLoop' in score.breakdown);
    assert.ok('sourceDiversity' in score.breakdown);
    assert.ok('health' in score.breakdown);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('computeOwlScore increases with more data', () => {
  const dbPath = createTempDb('score-growth');
  const wm = new WorldModel(dbPath);

  try {
    const emptyScore = computeOwlScore(wm, {});

    // Add some entities and events
    for (let i = 0; i < 10; i++) {
      wm.upsertEntity({
        id: `entity-${i}`,
        type: 'person',
        name: `Person ${i}`,
        attributes: {},
        sources: ['test'],
        importance: 0.5
      });
    }

    for (let i = 0; i < 15; i++) {
      wm.addEvent({
        id: `event-${i}`,
        source: 'test',
        type: 'test',
        timestamp: new Date().toISOString(),
        summary: `Test event ${i}`,
        entities: [`entity-${i % 10}`],
        raw: {}
      });
    }

    const populatedScore = computeOwlScore(wm, {
      plugins: { test: { enabled: true }, gmail: { enabled: true }, slack: { enabled: true } },
      entityTarget: 10
    });

    assert.ok(populatedScore.total > emptyScore.total, 'Score should increase with data');
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('formatOwlScore returns formatted string', () => {
  const score = {
    total: 72,
    breakdown: {
      freshness: 20,
      coverage: 15,
      discoveryRate: 12,
      feedbackLoop: 10,
      sourceDiversity: 8,
      health: 7
    }
  };

  const output = formatOwlScore(score);
  assert.ok(output.includes('72'));
  assert.ok(output.includes('OWL Score'));
});

test('computeOwlScore caps at 100', () => {
  const dbPath = createTempDb('score-cap');
  const wm = new WorldModel(dbPath);

  try {
    // Flood with data
    for (let i = 0; i < 100; i++) {
      wm.upsertEntity({
        id: `e-${i}`, type: 'person', name: `Person ${i}`,
        attributes: {}, sources: ['test'], importance: 1
      });
      wm.addEvent({
        id: `ev-${i}`, source: 'test', type: 'test',
        timestamp: new Date().toISOString(),
        summary: `Event ${i}`, entities: [`e-${i}`], raw: {}
      });
    }

    for (let i = 0; i < 20; i++) {
      wm.addDiscovery({
        id: `d-${i}`, timestamp: new Date().toISOString(),
        type: 'insight', urgency: 'interesting',
        title: `Discovery ${i}`, body: 'Test body',
        sources: ['test'], entities: [], confidence: 0.8
      });
    }

    const score = computeOwlScore(wm, {
      plugins: { a: { enabled: true }, b: { enabled: true }, c: { enabled: true }, d: { enabled: true } },
      entityTarget: 10, maxDiscoveriesPerDay: 1
    });

    assert.ok(score.total <= 100, `Score should not exceed 100, got ${score.total}`);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});
