import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import { buildContextSnapshot } from '../src/cli/context.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

test('context snapshot includes recent world model slices', () => {
  const dbPath = createTempDb('context');
  const worldModel = new WorldModel(dbPath);

  worldModel.addEntity({
    id: 'person_jane',
    type: 'person',
    name: 'Jane',
    sources: ['gmail']
  });

  worldModel.addEvent({
    id: 'event_1',
    source: 'gmail',
    type: 'email.received',
    timestamp: new Date().toISOString(),
    summary: 'Email from Jane',
    data: { subject: 'Hello' },
    entities: ['person_jane']
  });

  worldModel.addSituation({
    id: 'sit_1',
    description: 'Jane follow-up pending',
    urgency: 0.8,
    entities: ['person_jane'],
    related_events: ['event_1']
  });

  worldModel.addDiscovery({
    id: 'disc_1',
    timestamp: new Date().toISOString(),
    type: 'connection',
    urgency: 'important',
    title: 'Reply to Jane',
    body: 'Jane is waiting. Suggested action: reply today.',
    sources: ['gmail'],
    entities: ['person_jane']
  });

  const snapshot = buildContextSnapshot(worldModel, { days: 3 });

  assert.equal(snapshot.summary.entities, 1);
  assert.equal(snapshot.activeSituations.length, 1);
  assert.equal(snapshot.recentEvents.length, 1);
  assert.equal(snapshot.recentDiscoveries.length, 1);

  worldModel.close();
  fs.unlinkSync(dbPath);
});
