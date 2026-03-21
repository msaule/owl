/**
 * Schema Migrations — ensures the SQLite database stays in sync with
 * code changes across OWL versions.
 *
 * Each migration is a function that receives the database handle.
 * Migrations are idempotent and run in order.
 */

const MIGRATIONS = [
  {
    version: 1,
    description: 'Base schema (entities, relationships, events, patterns, situations, discoveries, preferences)',
    up(db) {
      // Base tables are created in WorldModel.initialize() — this is a no-op
      // but serves as the version anchor.
    }
  },
  {
    version: 2,
    description: 'Add discovery_chains table',
    up(db) {
      db.exec(`
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
  },
  {
    version: 3,
    description: 'Add confidence column to discoveries',
    up(db) {
      // Check if column already exists
      const columns = db.pragma('table_info(discoveries)');
      const hasConfidence = columns.some((col) => col.name === 'confidence');
      if (!hasConfidence) {
        db.exec(`ALTER TABLE discoveries ADD COLUMN confidence REAL DEFAULT 0.5;`);
      }
    }
  }
];

/**
 * Run all pending migrations on the database.
 * Tracks applied migrations in a `_migrations` table.
 */
export function runMigrations(db, logger) {
  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all().map((row) => row.version)
  );

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    return { applied: 0, current: MIGRATIONS.length };
  }

  const insertMigration = db.prepare(
    'INSERT INTO _migrations (version, description, applied_at) VALUES (?, ?, ?)'
  );

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      insertMigration.run(migration.version, migration.description, new Date().toISOString());
      logger?.info('Applied migration', { version: migration.version, description: migration.description });
    }
  });

  runAll();

  return { applied: pending.length, current: MIGRATIONS.length };
}

/**
 * Get the current schema version.
 */
export function getSchemaVersion(db) {
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM _migrations').get();
    return row?.version || 0;
  } catch {
    return 0;
  }
}

export { MIGRATIONS };
