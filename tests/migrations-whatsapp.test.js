import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations, getSchemaVersion, MIGRATIONS } from '../src/core/migrations.js';
import { WorldModel } from '../src/core/world-model.js';
import { WhatsAppChannel } from '../src/channels/whatsapp.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

// =============================================
// Schema Migrations
// =============================================

test('runMigrations creates tracking table and applies all migrations', () => {
  const dbPath = createTempDb('migrations-all');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    // Create base tables manually (simulating a fresh WorldModel)
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, type TEXT, name TEXT, attributes TEXT, first_seen TEXT, last_seen TEXT, sources TEXT, importance REAL);
      CREATE TABLE IF NOT EXISTS discoveries (id TEXT PRIMARY KEY, timestamp TEXT, type TEXT, urgency TEXT, title TEXT, body TEXT, sources TEXT, entities TEXT, user_reaction TEXT, acted_on INTEGER);
    `);

    const result = runMigrations(db);
    assert.ok(result.applied > 0);
    assert.equal(result.current, MIGRATIONS.length);

    // Check tracking table exists
    const version = getSchemaVersion(db);
    assert.equal(version, MIGRATIONS.length);

    // Check discovery_chains table was created
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_chains'").get();
    assert.ok(tables);

    // Check confidence column was added
    const columns = db.pragma('table_info(discoveries)');
    assert.ok(columns.some((col) => col.name === 'confidence'));
  } finally {
    db.close();
    fs.unlinkSync(dbPath);
  }
});

test('runMigrations is idempotent — running twice applies nothing on second run', () => {
  const dbPath = createTempDb('migrations-idempotent');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, type TEXT, name TEXT, attributes TEXT, first_seen TEXT, last_seen TEXT, sources TEXT, importance REAL);
      CREATE TABLE IF NOT EXISTS discoveries (id TEXT PRIMARY KEY, timestamp TEXT, type TEXT, urgency TEXT, title TEXT, body TEXT, sources TEXT, entities TEXT, user_reaction TEXT, acted_on INTEGER);
    `);

    const first = runMigrations(db);
    assert.ok(first.applied > 0);

    const second = runMigrations(db);
    assert.equal(second.applied, 0);
    assert.equal(second.current, MIGRATIONS.length);
  } finally {
    db.close();
    fs.unlinkSync(dbPath);
  }
});

test('getSchemaVersion returns 0 for fresh database', () => {
  const dbPath = createTempDb('migrations-fresh');
  const db = new Database(dbPath);
  try {
    assert.equal(getSchemaVersion(db), 0);
  } finally {
    db.close();
    fs.unlinkSync(dbPath);
  }
});

test('WorldModel constructor runs migrations automatically', () => {
  const dbPath = createTempDb('migrations-auto');
  const wm = new WorldModel(dbPath);
  try {
    const version = getSchemaVersion(wm.db);
    assert.equal(version, MIGRATIONS.length);

    // Verify chains table exists
    const chains = wm.getActiveChains();
    assert.ok(Array.isArray(chains));
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

// =============================================
// WhatsApp Channel
// =============================================

test('WhatsAppChannel skips when config is incomplete', async () => {
  const logs = [];
  const channel = new WhatsAppChannel({}, { logger: { warn: (msg) => logs.push(msg) } });
  await channel.send([{ title: 'Test', body: 'Body' }]);
  assert.ok(logs.some((l) => l.includes('skipped')));
});

test('WhatsAppChannel posts to Meta Cloud API', async () => {
  let sentUrl = null;
  let sentBody = null;
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    sentUrl = url;
    sentBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({}) };
  };

  try {
    const channel = new WhatsAppChannel({
      phoneNumberId: '123456',
      accessToken: 'test-token',
      recipientPhone: '19876543210'
    });

    await channel.send([{
      title: 'Test Discovery',
      body: 'Test body',
      urgency: 'important',
      sources: ['gmail']
    }]);

    assert.ok(sentUrl.includes('123456'));
    assert.ok(sentUrl.includes('graph.facebook.com'));
    assert.equal(sentBody.messaging_product, 'whatsapp');
    assert.equal(sentBody.to, '19876543210');
    assert.equal(sentBody.type, 'text');
    assert.ok(sentBody.text.body.includes('Test Discovery'));
  } finally {
    global.fetch = originalFetch;
  }
});
