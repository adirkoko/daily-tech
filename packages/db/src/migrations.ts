import type Database from "better-sqlite3";

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "create_daily_brief_metadata",
    sql: `
      CREATE TABLE daily_briefs (
        date TEXT PRIMARY KEY NOT NULL,
        summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
        significant_items INTEGER NOT NULL CHECK (significant_items >= 0),
        worth_watching_items INTEGER NOT NULL CHECK (worth_watching_items >= 0),
        day_intensity TEXT NOT NULL CHECK (
          day_intensity IN ('minimal', 'low', 'medium', 'high', 'extreme')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('draft', 'ready', 'published', 'failed')
        ),
        source_count INTEGER NOT NULL CHECK (source_count >= 0),
        created_at TEXT NOT NULL,
        published_at TEXT,
        updated_at TEXT
      ) STRICT;

      CREATE TABLE daily_brief_companies (
        day_date TEXT NOT NULL REFERENCES daily_briefs(date) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        company TEXT NOT NULL CHECK (length(trim(company)) > 0),
        PRIMARY KEY (day_date, company),
        UNIQUE (day_date, position)
      ) STRICT;

      CREATE TABLE daily_brief_topics (
        day_date TEXT NOT NULL REFERENCES daily_briefs(date) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        topic TEXT NOT NULL CHECK (length(trim(topic)) > 0),
        PRIMARY KEY (day_date, topic),
        UNIQUE (day_date, position)
      ) STRICT;

      CREATE TABLE daily_brief_developments (
        day_date TEXT NOT NULL REFERENCES daily_briefs(date) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        digest TEXT NOT NULL CHECK (length(trim(digest)) > 0),
        PRIMARY KEY (day_date, position)
      ) STRICT;

      CREATE INDEX daily_briefs_status_date_idx
        ON daily_briefs (status, date DESC);
      CREATE INDEX daily_brief_companies_company_idx
        ON daily_brief_companies (company, day_date DESC);
      CREATE INDEX daily_brief_topics_topic_idx
        ON daily_brief_topics (topic, day_date DESC);
    `,
  },
  {
    version: 2,
    name: "create_operations_and_feedback",
    sql: `
      CREATE TABLE operational_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        brief_date TEXT,
        event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
        level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
        message TEXT,
        details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX operational_logs_run_idx
        ON operational_logs (run_id, occurred_at DESC);
      CREATE INDEX operational_logs_date_idx
        ON operational_logs (brief_date, occurred_at DESC);
      CREATE INDEX operational_logs_level_idx
        ON operational_logs (level, occurred_at DESC);

      CREATE TABLE feedback_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        submitter_name TEXT,
        category TEXT NOT NULL CHECK (
          category IN ('general', 'correction', 'suggestion', 'system')
        ),
        body TEXT NOT NULL CHECK (length(trim(body)) > 0),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE INDEX feedback_tickets_inbox_idx
        ON feedback_tickets (status, category, created_at DESC);

      CREATE TABLE rate_limit_counters (
        scope TEXT NOT NULL CHECK (scope IN ('admin_login', 'feedback')),
        key_hash TEXT NOT NULL CHECK (length(trim(key_hash)) > 0),
        window_started_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key_hash, window_started_at)
      ) STRICT;

      CREATE INDEX rate_limit_counters_window_idx
        ON rate_limit_counters (scope, window_started_at);
    `,
  },
  {
    version: 3,
    name: "create_publication_jobs",
    sql: `
      CREATE TABLE publication_jobs (
        day_date TEXT PRIMARY KEY NOT NULL
          REFERENCES daily_briefs(date) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('triggering', 'triggered', 'failed')),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK (
          (state = 'triggering' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
          OR (state != 'triggering' AND lease_owner IS NULL AND lease_expires_at IS NULL)
        )
      ) STRICT;

      CREATE INDEX publication_jobs_state_idx
        ON publication_jobs (state, updated_at DESC);
    `,
  },
  {
    version: 4,
    name: "create_admin_sessions",
    sql: `
      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
        csrf_token_hash TEXT NOT NULL CHECK (length(csrf_token_hash) = 64),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX admin_sessions_expiry_idx
        ON admin_sessions (expires_at);
    `,
  },
  {
    version: 5,
    name: "create_scheduled_jobs",
    sql: `
      CREATE TABLE scheduled_jobs (
        job_name TEXT NOT NULL CHECK (job_name IN ('generate', 'publish')),
        target_date TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
        lease_owner TEXT,
        lease_expires_at TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (job_name, target_date),
        CHECK (
          (state = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
          OR (state != 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
        )
      ) STRICT;

      CREATE INDEX scheduled_jobs_state_idx
        ON scheduled_jobs (state, updated_at DESC);
    `,
  },
];

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string }>;
  const knownMigrations = new Map(
    migrations.map((migration) => [migration.version, migration.name]),
  );
  for (const row of appliedRows) {
    const expectedName = knownMigrations.get(row.version);
    if (expectedName === undefined) {
      throw new Error(
        `Database schema version ${row.version} is newer than this application supports.`,
      );
    }
    if (row.name !== expectedName) {
      throw new Error(
        `Migration ${row.version} was applied as ${row.name}, expected ${expectedName}.`,
      );
    }
  }
  const applied = new Map(
    appliedRows.map((row) => [Number(row.version), String(row.name)]),
  );

  for (const migration of migrations) {
    const appliedName = applied.get(migration.version);
    if (appliedName !== undefined) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function getSchemaVersion(database: Database.Database): number {
  const row = database
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number } | undefined;
  return Number(row?.version ?? 0);
}
