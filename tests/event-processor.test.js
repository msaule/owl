import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import { processEvent } from '../src/core/event-processor.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

test('event processor resolves partial identities into one entity when domain matches', async () => {
  const dbPath = createTempDb('event-processor');
  const worldModel = new WorldModel(dbPath);

  await processEvent(
    {
      source: 'gmail',
      type: 'email.received',
      timestamp: new Date().toISOString(),
      summary: 'Email from John Smith at Acme',
      data: {
        from: 'John Smith <john@acme.com>',
        subject: 'Pricing',
        snippet: 'Can we review pricing tomorrow?'
      },
      importance: 0.8
    },
    worldModel,
    null,
    {}
  );

  await processEvent(
    {
      source: 'calendar',
      type: 'calendar.event.created',
      timestamp: new Date().toISOString(),
      summary: 'Meeting with John S. from Acme',
      data: {
        attendees: ['John S <john@acme.com>'],
        title: 'Pricing review'
      },
      importance: 0.7
    },
    worldModel,
    null,
    {}
  );

  const johnMatches = worldModel.findEntities('john@acme.com', 10).filter((entity) => entity.type === 'person');
  assert.equal(johnMatches.length, 1);

  const relationships = worldModel.getRelationships(johnMatches[0].id);
  assert.ok(relationships.length >= 1);

  worldModel.close();
  fs.unlinkSync(dbPath);
});
