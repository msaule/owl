import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { canonicalizeEntity, mergeEntityData } from './entity.js';
import { canonicalizeRelationship, strengthenRelationship } from './relationship.js';
import { jaccardSimilarity } from '../utils/text.js';
import { createId } from '../utils/id.js';
import { daysAgo, nowIso, startOfTodayIso } from '../utils/time.js';
import { runMigrations } from './migrations.js';

function encodeJson(value) {
  return JSON.stringify(value ?? {});
}

function decodeJson(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeNeedles(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => value.length >= 3)
    )
  );
}

function collectStringValues(value, bucket = new Set()) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      bucket.add(trimmed);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, bucket);
    }
    return bucket;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStringValues(item, bucket);
    }
  }

  return bucket;
}

function buildEntityForgetNeedles(entity) {
  const bucket = new Set([entity.id, entity.name]);
  collectStringValues(entity.attributes, bucket);
  return normalizeNeedles(Array.from(bucket));
}

function containsNeedle(value, needles) {
  if (!value || needles.length === 0) {
    return false;
  }

  const haystack = String(typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function overlaps(values, expected) {
  if (!Array.isArray(values) || expected.size === 0) {
    return false;
  }

  return values.some((value) => expected.has(value));
}

function filterExcluded(values, excluded) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value) => !excluded.has(value));
}

function hydrateEntity(row) {
  return row
    ? {
        ...row,
        attributes: decodeJson(row.attributes, {}),
        sources: decodeJson(row.sources, [])
      }
    : null;
}

function hydrateRelationship(row) {
  return row
    ? {
        ...row,
        evidence: decodeJson(row.evidence, [])
      }
    : null;
}

function hydrateEvent(row) {
  return row
    ? {
        ...row,
        data: decodeJson(row.data, {}),
        entities: decodeJson(row.entities, []),
        processed: Boolean(row.processed)
      }
    : null;
}

function hydratePattern(row) {
  return row
    ? {
        ...row,
        entities: decodeJson(row.entities, [])
      }
    : null;
}

function hydrateSituation(row) {
  return row
    ? {
        ...row,
        entities: decodeJson(row.entities, []),
        related_events: decodeJson(row.related_events, [])
      }
    : null;
}

function hydrateDiscovery(row) {
  return row
    ? {
        ...row,
        sources: decodeJson(row.sources, []),
        entities: decodeJson(row.entities, []),
        acted_on: Boolean(row.acted_on)
      }
    : null;
}

export class WorldModel {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.logger = options.logger;

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
    runMigrations(this.db, options.logger);
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT DEFAULT '{}',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        sources TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_entity TEXT NOT NULL REFERENCES entities(id),
        to_entity TEXT NOT NULL REFERENCES entities(id),
        type TEXT NOT NULL,
        strength REAL DEFAULT 0.5,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        evidence TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        summary TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        importance REAL DEFAULT 0.5,
        entities TEXT DEFAULT '[]',
        processed INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        entities TEXT DEFAULT '[]',
        frequency TEXT,
        confidence REAL DEFAULT 0.5,
        last_occurrence TEXT,
        next_expected TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS situations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        urgency REAL DEFAULT 0.5,
        entities TEXT DEFAULT '[]',
        related_events TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discoveries (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        urgency TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        sources TEXT DEFAULT '[]',
        entities TEXT DEFAULT '[]',
        user_reaction TEXT,
        acted_on INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discovery_chains (
        id TEXT PRIMARY KEY,
        discovery_ids TEXT DEFAULT '[]',
        entities TEXT DEFAULT '[]',
        sources TEXT DEFAULT '[]',
        dominant_type TEXT,
        summary TEXT DEFAULT '',
        length INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  addEntity(entity) {
    const timestamp = entity.first_seen || nowIso();
    const record = canonicalizeEntity(entity, timestamp);

    this.db
      .prepare(
        `INSERT INTO entities (id, type, name, attributes, first_seen, last_seen, sources, importance)
         VALUES (@id, @type, @name, @attributes, @first_seen, @last_seen, @sources, @importance)`
      )
      .run({
        ...record,
        attributes: encodeJson(record.attributes),
        sources: encodeJson(record.sources)
      });

    return this.getEntity(record.id);
  }

  upsertEntity(entity) {
    const existing = entity.id ? this.getEntity(entity.id) : null;
    if (!existing) {
      return this.addEntity(entity);
    }

    return this.updateEntity(existing.id, entity);
  }

  getEntity(id) {
    return hydrateEntity(this.db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id));
  }

  findEntities(query, limit = 25) {
    const text = `%${String(query || '').trim()}%`;
    return this.db
      .prepare(
        `SELECT * FROM entities
         WHERE id LIKE ? OR name LIKE ? OR attributes LIKE ?
         ORDER BY importance DESC, last_seen DESC
         LIMIT ?`
      )
      .all(text, text, text, limit)
      .map(hydrateEntity);
  }

  updateEntity(id, changes) {
    const existing = this.getEntity(id);
    if (!existing) {
      return null;
    }

    const merged = mergeEntityData(existing, canonicalizeEntity({ ...existing, ...changes }, nowIso()), nowIso());
    this.db
      .prepare(
        `UPDATE entities
         SET type = @type,
             name = @name,
             attributes = @attributes,
             last_seen = @last_seen,
             sources = @sources,
             importance = @importance
         WHERE id = @id`
      )
      .run({
        ...merged,
        attributes: encodeJson(merged.attributes),
        sources: encodeJson(merged.sources)
      });

    return this.getEntity(id);
  }

  getChangedEntities(since = daysAgo(3), limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM entities
         WHERE last_seen >= ?
         ORDER BY last_seen DESC, importance DESC
         LIMIT ?`
      )
      .all(since, limit)
      .map(hydrateEntity);
  }

  addRelationship(relationship) {
    const incoming = canonicalizeRelationship(relationship, relationship.first_seen || nowIso());
    const existing = this.db
      .prepare(
        `SELECT * FROM relationships
         WHERE from_entity = ? AND to_entity = ? AND type = ?
         LIMIT 1`
      )
      .get(incoming.from_entity, incoming.to_entity, incoming.type);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO relationships (id, from_entity, to_entity, type, strength, first_seen, last_seen, evidence)
           VALUES (@id, @from_entity, @to_entity, @type, @strength, @first_seen, @last_seen, @evidence)`
        )
        .run({
          ...incoming,
          evidence: encodeJson(incoming.evidence)
        });

      return hydrateRelationship(this.db.prepare(`SELECT * FROM relationships WHERE id = ?`).get(incoming.id));
    }

    const merged = strengthenRelationship(hydrateRelationship(existing), incoming, nowIso());
    this.db
      .prepare(
        `UPDATE relationships
         SET strength = @strength,
             last_seen = @last_seen,
             evidence = @evidence
         WHERE id = @id`
      )
      .run({
        ...merged,
        evidence: encodeJson(merged.evidence)
      });

    return hydrateRelationship(this.db.prepare(`SELECT * FROM relationships WHERE id = ?`).get(existing.id));
  }

  getRelationships(entityId) {
    return this.db
      .prepare(
        `SELECT * FROM relationships
         WHERE from_entity = ? OR to_entity = ?
         ORDER BY strength DESC, last_seen DESC`
      )
      .all(entityId, entityId)
      .map(hydrateRelationship);
  }

  addEvent(event) {
    const record = {
      id: event.id || createId('event'),
      source: event.source,
      type: event.type,
      timestamp: event.timestamp || nowIso(),
      summary: event.summary,
      data: event.data || {},
      importance: Number.isFinite(event.importance) ? event.importance : 0.5,
      entities: event.entities || [],
      processed: event.processed ? 1 : 0
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO events (id, source, type, timestamp, summary, data, importance, entities, processed)
         VALUES (@id, @source, @type, @timestamp, @summary, @data, @importance, @entities, @processed)`
      )
      .run({
        ...record,
        data: encodeJson(record.data),
        entities: encodeJson(record.entities)
      });

    return this.getEvent(record.id);
  }

  getEvent(id) {
    return hydrateEvent(this.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id));
  }

  getRecentEvents(since = daysAgo(1), limit = 100) {
    return this.db
      .prepare(
        `SELECT * FROM events
         WHERE timestamp >= ?
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(since, limit)
      .map(hydrateEvent);
  }

  getUpcomingEvents(days = 7, limit = 100) {
    const end = new Date(Date.now() + days * 86_400_000).toISOString();
    return this.db
      .prepare(
        `SELECT * FROM events
         WHERE timestamp BETWEEN ? AND ?
         ORDER BY timestamp ASC
         LIMIT ?`
      )
      .all(nowIso(), end, limit)
      .map(hydrateEvent);
  }

  getUnprocessedEvents(limit = 200) {
    return this.db
      .prepare(
        `SELECT * FROM events
         WHERE processed = 0
         ORDER BY timestamp ASC
         LIMIT ?`
      )
      .all(limit)
      .map(hydrateEvent);
  }

  markEventsProcessed(eventIds = null) {
    if (!eventIds || eventIds.length === 0) {
      this.db.prepare(`UPDATE events SET processed = 1 WHERE processed = 0`).run();
      return;
    }

    const update = this.db.prepare(`UPDATE events SET processed = 1 WHERE id = ?`);
    const transaction = this.db.transaction((ids) => {
      for (const id of ids) {
        update.run(id);
      }
    });

    transaction(eventIds);
  }

  addPattern(pattern) {
    const record = {
      id: pattern.id || createId('pattern'),
      description: pattern.description,
      entities: pattern.entities || [],
      frequency: pattern.frequency || null,
      confidence: Number.isFinite(pattern.confidence) ? pattern.confidence : 0.5,
      last_occurrence: pattern.last_occurrence || null,
      next_expected: pattern.next_expected || null,
      created_at: pattern.created_at || nowIso()
    };

    const existing = this.db.prepare(`SELECT * FROM patterns WHERE description = ? LIMIT 1`).get(record.description);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO patterns (id, description, entities, frequency, confidence, last_occurrence, next_expected, created_at)
           VALUES (@id, @description, @entities, @frequency, @confidence, @last_occurrence, @next_expected, @created_at)`
        )
        .run({
          ...record,
          entities: encodeJson(record.entities)
        });

      return this.getPatterns().find((item) => item.id === record.id);
    }

    this.db
      .prepare(
        `UPDATE patterns
         SET entities = @entities,
             frequency = @frequency,
             confidence = @confidence,
             last_occurrence = @last_occurrence,
             next_expected = @next_expected
         WHERE id = @id`
      )
      .run({
        id: existing.id,
        entities: encodeJson(record.entities),
        frequency: record.frequency,
        confidence: record.confidence,
        last_occurrence: record.last_occurrence,
        next_expected: record.next_expected
      });

    return hydratePattern(this.db.prepare(`SELECT * FROM patterns WHERE id = ?`).get(existing.id));
  }

  getPatterns(limit = 100) {
    return this.db
      .prepare(
        `SELECT * FROM patterns
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`
      )
      .all(limit)
      .map(hydratePattern);
  }

  addSituation(situation) {
    const record = {
      id: situation.id || createId('sit'),
      description: situation.description,
      urgency: Number.isFinite(situation.urgency) ? situation.urgency : 0.5,
      entities: situation.entities || [],
      related_events: situation.related_events || [],
      status: situation.status || 'active',
      created_at: situation.created_at || nowIso(),
      updated_at: situation.updated_at || nowIso()
    };

    const existing = this.db
      .prepare(`SELECT * FROM situations WHERE description = ? AND status = 'active' LIMIT 1`)
      .get(record.description);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO situations (id, description, urgency, entities, related_events, status, created_at, updated_at)
           VALUES (@id, @description, @urgency, @entities, @related_events, @status, @created_at, @updated_at)`
        )
        .run({
          ...record,
          entities: encodeJson(record.entities),
          related_events: encodeJson(record.related_events)
        });

      return hydrateSituation(this.db.prepare(`SELECT * FROM situations WHERE id = ?`).get(record.id));
    }

    this.db
      .prepare(
        `UPDATE situations
         SET urgency = @urgency,
             entities = @entities,
             related_events = @related_events,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run({
        id: existing.id,
        urgency: Math.max(existing.urgency || 0.5, record.urgency),
        entities: encodeJson(Array.from(new Set([...decodeJson(existing.entities, []), ...record.entities]))),
        related_events: encodeJson(
          Array.from(new Set([...decodeJson(existing.related_events, []), ...record.related_events]))
        ),
        updated_at: record.updated_at
      });

    return hydrateSituation(this.db.prepare(`SELECT * FROM situations WHERE id = ?`).get(existing.id));
  }

  getActiveSituations(limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM situations
         WHERE status = 'active'
         ORDER BY urgency DESC, updated_at DESC
         LIMIT ?`
      )
      .all(limit)
      .map(hydrateSituation);
  }

  addDiscovery(discovery) {
    const record = {
      id: discovery.id || createId('disc'),
      timestamp: discovery.timestamp || nowIso(),
      type: discovery.type,
      urgency: discovery.urgency,
      title: discovery.title,
      body: discovery.body,
      confidence: Number.isFinite(discovery.confidence) ? discovery.confidence : 0.5,
      sources: discovery.sources || [],
      entities: discovery.entities || [],
      user_reaction: discovery.user_reaction || null,
      acted_on: discovery.acted_on ? 1 : 0
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO discoveries (id, timestamp, type, urgency, title, body, confidence, sources, entities, user_reaction, acted_on)
         VALUES (@id, @timestamp, @type, @urgency, @title, @body, @confidence, @sources, @entities, @user_reaction, @acted_on)`
      )
      .run({
        ...record,
        sources: encodeJson(record.sources),
        entities: encodeJson(record.entities)
      });

    return this.getDiscovery(record.id);
  }

  getDiscovery(id) {
    return hydrateDiscovery(this.db.prepare(`SELECT * FROM discoveries WHERE id = ?`).get(id));
  }

  getRecentDiscoveries(since = daysAgo(3), limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM discoveries
         WHERE timestamp >= ?
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(since, limit)
      .map(hydrateDiscovery);
  }

  countDiscoveriesSince(since = startOfTodayIso()) {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM discoveries WHERE timestamp >= ?`).get(since)?.count || 0;
  }

  hasDiscoveredSimilar(description, days = 7, threshold = 0.6) {
    const recent = this.getRecentDiscoveries(daysAgo(days), 100);
    return recent.some((item) => jaccardSimilarity(description, `${item.title} ${item.body}`) >= threshold);
  }

  updateDiscoveryReaction(id, reaction, actedOn = false) {
    this.db
      .prepare(`UPDATE discoveries SET user_reaction = ?, acted_on = ? WHERE id = ?`)
      .run(reaction, actedOn ? 1 : 0, id);

    return this.getDiscovery(id);
  }

  /**
   * Mark discoveries older than `hours` (default 48) with no user reaction as
   * 'neutral'.  This closes the feedback loop: silence = low interest.
   * Returns the number of discoveries expired.
   */
  expireStaleDiscoveries(hours = 48) {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE discoveries
         SET user_reaction = 'neutral'
         WHERE user_reaction IS NULL
           AND timestamp < ?`
      )
      .run(cutoff);

    return result.changes;
  }

  /**
   * Expire active situations that haven't been updated for `days` (default 7)
   * by marking them as 'expired'.
   */
  expireStaleSituations(days = 7) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE situations
         SET status = 'expired'
         WHERE status = 'active'
           AND updated_at < ?`
      )
      .run(cutoff);

    return result.changes;
  }

  // --- Discovery Chains ---

  addChain(chain) {
    const record = {
      id: chain.id || createId('chain'),
      discovery_ids: chain.discovery_ids || [],
      entities: chain.entities || [],
      sources: chain.sources || [],
      dominant_type: chain.dominant_type || null,
      summary: chain.summary || '',
      length: chain.length || 0,
      status: chain.status || 'active',
      created_at: chain.created_at || nowIso(),
      updated_at: chain.updated_at || nowIso()
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO discovery_chains (id, discovery_ids, entities, sources, dominant_type, summary, length, status, created_at, updated_at)
         VALUES (@id, @discovery_ids, @entities, @sources, @dominant_type, @summary, @length, @status, @created_at, @updated_at)`
      )
      .run({
        ...record,
        discovery_ids: encodeJson(record.discovery_ids),
        entities: encodeJson(record.entities),
        sources: encodeJson(record.sources)
      });

    return this.getChain(record.id);
  }

  getChain(id) {
    const row = this.db.prepare(`SELECT * FROM discovery_chains WHERE id = ?`).get(id);
    return row ? this.#hydrateChain(row) : null;
  }

  getActiveChains(limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM discovery_chains
         WHERE status = 'active'
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit)
      .map((row) => this.#hydrateChain(row));
  }

  updateChain(chain) {
    this.db
      .prepare(
        `UPDATE discovery_chains
         SET discovery_ids = @discovery_ids,
             entities = @entities,
             sources = @sources,
             dominant_type = @dominant_type,
             summary = @summary,
             length = @length,
             status = @status,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run({
        ...chain,
        discovery_ids: encodeJson(chain.discovery_ids || []),
        entities: encodeJson(chain.entities || []),
        sources: encodeJson(chain.sources || [])
      });

    return this.getChain(chain.id);
  }

  #hydrateChain(row) {
    return {
      ...row,
      discovery_ids: decodeJson(row.discovery_ids, []),
      entities: decodeJson(row.entities, []),
      sources: decodeJson(row.sources, [])
    };
  }

  getUserPreference(key) {
    const row = this.db.prepare(`SELECT * FROM preferences WHERE key = ?`).get(key);
    return row ? decodeJson(row.value, row.value) : null;
  }

  setUserPreference(key, value) {
    this.db
      .prepare(
        `INSERT INTO preferences (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, encodeJson(value), nowIso());
  }

  getStats() {
    const counts = {};
    for (const table of ['entities', 'relationships', 'events', 'patterns', 'situations', 'discoveries']) {
      counts[table] = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    }

    return counts;
  }

  forgetEntity(identifier) {
    const entity = this.getEntity(identifier) || this.findEntities(identifier, 1)[0];
    if (!entity) {
      return false;
    }

    const entityNeedles = buildEntityForgetNeedles(entity);

    const transaction = this.db.transaction(() => {
      const deleteEvent = this.db.prepare(`DELETE FROM events WHERE id = ?`);
      const deleteDiscovery = this.db.prepare(`DELETE FROM discoveries WHERE id = ?`);
      const deletePattern = this.db.prepare(`DELETE FROM patterns WHERE id = ?`);
      const deleteSituation = this.db.prepare(`DELETE FROM situations WHERE id = ?`);
      const deletePreference = this.db.prepare(`DELETE FROM preferences WHERE key = ?`);
      const deleteRelationship = this.db.prepare(`DELETE FROM relationships WHERE id = ?`);

      for (const event of this.db.prepare(`SELECT * FROM events`).all().map(hydrateEvent)) {
        if (event.entities.includes(entity.id) || containsNeedle([event.summary, event.data], entityNeedles)) {
          deleteEvent.run(event.id);
        }
      }

      for (const discovery of this.db.prepare(`SELECT * FROM discoveries`).all().map(hydrateDiscovery)) {
        if (
          discovery.entities.includes(entity.id) ||
          containsNeedle([discovery.title, discovery.body, discovery.sources], entityNeedles)
        ) {
          deleteDiscovery.run(discovery.id);
        }
      }

      for (const pattern of this.db.prepare(`SELECT * FROM patterns`).all().map(hydratePattern)) {
        if (pattern.entities.includes(entity.id) || containsNeedle(pattern.description, entityNeedles)) {
          deletePattern.run(pattern.id);
        }
      }

      for (const situation of this.db.prepare(`SELECT * FROM situations`).all().map(hydrateSituation)) {
        if (
          situation.entities.includes(entity.id) ||
          containsNeedle([situation.description, situation.related_events], entityNeedles)
        ) {
          deleteSituation.run(situation.id);
        }
      }

      for (const relationship of this.db.prepare(`SELECT * FROM relationships`).all().map(hydrateRelationship)) {
        if (
          relationship.from_entity === entity.id ||
          relationship.to_entity === entity.id ||
          containsNeedle(relationship.evidence, entityNeedles)
        ) {
          deleteRelationship.run(relationship.id);
        }
      }

      for (const preference of this.db.prepare(`SELECT key, value FROM preferences`).all()) {
        if (containsNeedle([preference.key, preference.value], entityNeedles)) {
          deletePreference.run(preference.key);
        }
      }

      this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(entity.id);
    });

    transaction();
    return true;
  }

  forgetSource(source) {
    const sourceEvents = this.db.prepare(`SELECT * FROM events WHERE source = ?`).all(source).map(hydrateEvent);
    const sourceEventIds = new Set(sourceEvents.map((event) => event.id));
    const impactedEntityIds = new Set(sourceEvents.flatMap((event) => event.entities));
    const entitiesWithSource = this.db
      .prepare(`SELECT * FROM entities`)
      .all()
      .map(hydrateEntity)
      .filter((entity) => entity.sources.includes(source));

    for (const entity of entitiesWithSource) {
      impactedEntityIds.add(entity.id);
    }

    const impactedEntities = Array.from(impactedEntityIds)
      .map((id) => this.getEntity(id))
      .filter(Boolean);
    const sourceNeedles = normalizeNeedles([
      source,
      ...impactedEntities.flatMap((entity) => buildEntityForgetNeedles(entity))
    ]);

    const transaction = this.db.transaction(() => {
      const updateEventEntities = this.db.prepare(`UPDATE events SET entities = ? WHERE id = ?`);
      const updateDiscoveryEntities = this.db.prepare(`UPDATE discoveries SET entities = ? WHERE id = ?`);
      const updatePatternEntities = this.db.prepare(`UPDATE patterns SET entities = ? WHERE id = ?`);
      const updateSituation = this.db.prepare(
        `UPDATE situations SET entities = ?, related_events = ?, updated_at = ? WHERE id = ?`
      );
      const deleteDiscovery = this.db.prepare(`DELETE FROM discoveries WHERE id = ?`);
      const deleteSituation = this.db.prepare(`DELETE FROM situations WHERE id = ?`);
      const deleteRelationship = this.db.prepare(`DELETE FROM relationships WHERE id = ?`);
      const deletePreference = this.db.prepare(`DELETE FROM preferences WHERE key = ?`);

      this.db.prepare(`DELETE FROM events WHERE source = ?`).run(source);

      for (const event of this.db.prepare(`SELECT * FROM events`).all().map(hydrateEvent)) {
        if (!overlaps(event.entities, impactedEntityIds)) {
          continue;
        }

        updateEventEntities.run(encodeJson(filterExcluded(event.entities, impactedEntityIds)), event.id);
      }

      for (const discovery of this.db.prepare(`SELECT * FROM discoveries`).all().map(hydrateDiscovery)) {
        if (discovery.sources.includes(source) || containsNeedle([discovery.title, discovery.body], [source])) {
          deleteDiscovery.run(discovery.id);
          continue;
        }

        if (overlaps(discovery.entities, impactedEntityIds)) {
          updateDiscoveryEntities.run(encodeJson(filterExcluded(discovery.entities, impactedEntityIds)), discovery.id);
        }
      }

      for (const pattern of this.db.prepare(`SELECT * FROM patterns`).all().map(hydratePattern)) {
        if (!overlaps(pattern.entities, impactedEntityIds)) {
          continue;
        }

        updatePatternEntities.run(encodeJson(filterExcluded(pattern.entities, impactedEntityIds)), pattern.id);
      }

      for (const situation of this.db.prepare(`SELECT * FROM situations`).all().map(hydrateSituation)) {
        const filteredEntities = filterExcluded(situation.entities, impactedEntityIds);
        const filteredEvents = filterExcluded(situation.related_events, sourceEventIds);

        if (
          overlaps(situation.related_events, sourceEventIds) &&
          filteredEntities.length === 0 &&
          filteredEvents.length === 0
        ) {
          deleteSituation.run(situation.id);
          continue;
        }

        if (filteredEntities.length !== situation.entities.length || filteredEvents.length !== situation.related_events.length) {
          updateSituation.run(
            encodeJson(filteredEntities),
            encodeJson(filteredEvents),
            nowIso(),
            situation.id
          );
        }
      }

      for (const relationship of this.db.prepare(`SELECT * FROM relationships`).all().map(hydrateRelationship)) {
        if (
          impactedEntityIds.has(relationship.from_entity) ||
          impactedEntityIds.has(relationship.to_entity) ||
          containsNeedle(relationship.evidence, sourceNeedles)
        ) {
          deleteRelationship.run(relationship.id);
        }
      }

      for (const preference of this.db.prepare(`SELECT key, value FROM preferences`).all()) {
        if (
          containsNeedle([preference.key, preference.value], [source]) ||
          containsNeedle([preference.key, preference.value], sourceNeedles)
        ) {
          deletePreference.run(preference.key);
        }
      }

      for (const entityId of impactedEntityIds) {
        this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(entityId);
      }
    });

    transaction();
  }

  reset() {
    this.db.exec(`
      DELETE FROM relationships;
      DELETE FROM entities;
      DELETE FROM events;
      DELETE FROM patterns;
      DELETE FROM situations;
      DELETE FROM discoveries;
      DELETE FROM preferences;
    `);
  }

  close() {
    this.db.close();
  }
}
