import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';

function createTempDb(name) {
  const dbPath = path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
  return dbPath;
}

test('world model stores and hydrates JSON fields correctly', () => {
  const dbPath = createTempDb('world-model');
  const worldModel = new WorldModel(dbPath);

  worldModel.addEntity({
    id: 'person_john-smith',
    type: 'person',
    name: 'John Smith',
    attributes: { email: 'john@acme.com' },
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    sources: ['gmail'],
    importance: 0.8
  });

  worldModel.addEvent({
    id: 'event_1',
    source: 'gmail',
    type: 'email.received',
    timestamp: new Date().toISOString(),
    summary: 'Email from John Smith',
    data: { subject: 'Hello', snippet: 'Testing' },
    importance: 0.7,
    entities: ['person_john-smith']
  });

  worldModel.addDiscovery({
    id: 'disc_1',
    timestamp: new Date().toISOString(),
    type: 'connection',
    urgency: 'important',
    title: 'John surfaced',
    body: 'Something worth noticing. Suggested action: reply.',
    sources: ['gmail'],
    entities: ['person_john-smith']
  });

  const entity = worldModel.getEntity('person_john-smith');
  const event = worldModel.getEvent('event_1');
  const discovery = worldModel.getDiscovery('disc_1');

  assert.equal(entity.attributes.email, 'john@acme.com');
  assert.deepEqual(entity.sources, ['gmail']);
  assert.equal(event.data.subject, 'Hello');
  assert.deepEqual(event.entities, ['person_john-smith']);
  assert.deepEqual(discovery.sources, ['gmail']);

  worldModel.close();
  fs.unlinkSync(dbPath);
});

test('forgetEntity removes direct and derived memory for that entity', () => {
  const dbPath = createTempDb('world-model-forget-entity');
  const worldModel = new WorldModel(dbPath);

  worldModel.addEntity({
    id: 'person_john-smith',
    type: 'person',
    name: 'John Smith',
    attributes: { email: 'john@acme.com', aliases: ['John S.'] },
    sources: ['gmail']
  });

  worldModel.addEntity({
    id: 'company_other',
    type: 'company',
    name: 'Other Co',
    sources: ['calendar']
  });

  worldModel.addEvent({
    id: 'event_john',
    source: 'gmail',
    type: 'email.received',
    summary: 'Email from John Smith about pricing',
    data: { snippet: 'John Smith needs a response' },
    entities: ['person_john-smith']
  });

  worldModel.addEvent({
    id: 'event_other',
    source: 'calendar',
    type: 'calendar.event.created',
    summary: 'Meeting with Other Co',
    data: { title: 'Check-in' },
    entities: ['company_other']
  });

  worldModel.addDiscovery({
    id: 'disc_john',
    type: 'risk',
    urgency: 'important',
    title: 'John Smith is waiting',
    body: 'John Smith asked for pricing. Suggested action: reply today.',
    sources: ['gmail'],
    entities: ['person_john-smith']
  });

  worldModel.addPattern({
    id: 'pattern_john',
    description: 'John Smith emails every Tuesday',
    entities: ['person_john-smith']
  });

  worldModel.addSituation({
    id: 'sit_john',
    description: 'Follow up with John Smith',
    entities: ['person_john-smith'],
    related_events: ['event_john']
  });

  worldModel.setUserPreference('note:john', { label: 'John Smith' });

  assert.equal(worldModel.forgetEntity('person_john-smith'), true);
  assert.equal(worldModel.getEntity('person_john-smith'), null);
  assert.equal(worldModel.getEvent('event_john'), null);
  assert.equal(worldModel.getDiscovery('disc_john'), null);
  assert.equal(worldModel.getPatterns().find((item) => item.id === 'pattern_john'), undefined);
  assert.equal(worldModel.getActiveSituations().find((item) => item.id === 'sit_john'), undefined);
  assert.equal(worldModel.getUserPreference('note:john'), null);
  assert.ok(worldModel.getEvent('event_other'));

  worldModel.close();
  fs.unlinkSync(dbPath);
});

test('forgetSource removes source rows and scrubs remaining references', () => {
  const dbPath = createTempDb('world-model-forget-source');
  const worldModel = new WorldModel(dbPath);

  worldModel.addEntity({
    id: 'person_john-smith',
    type: 'person',
    name: 'John Smith',
    attributes: { email: 'john@acme.com' },
    sources: ['gmail', 'calendar']
  });

  worldModel.addEvent({
    id: 'event_gmail',
    source: 'gmail',
    type: 'email.received',
    summary: 'Email from John Smith',
    data: { snippet: 'Pricing follow-up' },
    entities: ['person_john-smith']
  });

  worldModel.addEvent({
    id: 'event_calendar',
    source: 'calendar',
    type: 'calendar.event.created',
    summary: 'Meeting with John Smith',
    data: { title: 'Review' },
    entities: ['person_john-smith']
  });

  worldModel.addDiscovery({
    id: 'disc_gmail',
    type: 'risk',
    urgency: 'important',
    title: 'Reply to John',
    body: 'A Gmail thread needs attention. Suggested action: reply today.',
    sources: ['gmail', 'calendar'],
    entities: ['person_john-smith']
  });

  worldModel.addDiscovery({
    id: 'disc_calendar',
    type: 'anticipation',
    urgency: 'interesting',
    title: 'Upcoming review',
    body: 'Calendar review is tomorrow. Suggested action: prepare notes.',
    sources: ['calendar'],
    entities: ['person_john-smith']
  });

  worldModel.addSituation({
    id: 'sit_mixed',
    description: 'John Smith follow-up',
    entities: ['person_john-smith'],
    related_events: ['event_gmail', 'event_calendar']
  });

  worldModel.setUserPreference('channel:gmail:lastUpdateId', 123);

  worldModel.forgetSource('gmail');

  assert.equal(worldModel.getEvent('event_gmail'), null);
  assert.deepEqual(worldModel.getEvent('event_calendar')?.entities, []);
  assert.equal(worldModel.getEntity('person_john-smith'), null);
  assert.equal(worldModel.getDiscovery('disc_gmail'), null);
  assert.deepEqual(worldModel.getDiscovery('disc_calendar')?.entities, []);
  assert.deepEqual(worldModel.getActiveSituations()[0]?.entities, []);
  assert.deepEqual(worldModel.getActiveSituations()[0]?.related_events, ['event_calendar']);
  assert.equal(worldModel.getUserPreference('channel:gmail:lastUpdateId'), null);

  worldModel.close();
  fs.unlinkSync(dbPath);
});
