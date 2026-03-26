import { app } from 'electron';
import Database from 'better-sqlite3';
import Store from 'electron-store';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  sessionId?: string;
  policyTags?: string[];
}

const MAX_AUDIT_LOGS = 1000;
const AUDIT_MIGRATION_KEY = 'migration_v1_completed';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'kairopilot.db');
    const dir = path.dirname(dbPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        result TEXT,
        error TEXT,
        session_id TEXT,
        policy_tags TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp_desc
        ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id
        ON audit_logs(session_id);
    `);

    migrateFromElectronStore(db);
  }

  return db;
}

function serializeValue(value: unknown) {
  if (typeof value === 'undefined') {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function parseValue<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function trimAuditLogs(database: Database.Database) {
  database.prepare(`
    DELETE FROM audit_logs
    WHERE rowid IN (
      SELECT rowid
      FROM audit_logs
      ORDER BY timestamp DESC, rowid DESC
      LIMIT -1 OFFSET ?
    )
  `).run(MAX_AUDIT_LOGS);
}

function migrateFromElectronStore(database: Database.Database) {
  const migrationRow = database.prepare(
    'SELECT value FROM audit_state WHERE key = ?'
  ).get(AUDIT_MIGRATION_KEY) as { value: string } | undefined;

  if (migrationRow?.value === 'true') {
    return;
  }

  try {
    const oldStore = new Store<{ logs: AuditLogEntry[] }>({
      name: 'audit-logs',
      defaults: {
        logs: []
      }
    });
    const legacyLogs = oldStore.get('logs', []) as AuditLogEntry[];

    if (legacyLogs.length > 0) {
      const insertLog = database.prepare(`
        INSERT OR REPLACE INTO audit_logs (
          id,
          timestamp,
          tool,
          args,
          result,
          error,
          session_id,
          policy_tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const transaction = database.transaction(() => {
        for (const log of legacyLogs) {
          insertLog.run(
            log.id,
            log.timestamp,
            log.tool,
            serializeValue(log.args ?? {}) ?? '{}',
            serializeValue(log.result),
            log.error ?? null,
            log.sessionId ?? null,
            serializeValue(log.policyTags)
          );
        }

        trimAuditLogs(database);
        database.prepare('INSERT OR REPLACE INTO audit_state (key, value) VALUES (?, ?)').run(AUDIT_MIGRATION_KEY, 'true');
      });

      transaction();
    } else {
      database.prepare('INSERT OR REPLACE INTO audit_state (key, value) VALUES (?, ?)').run(AUDIT_MIGRATION_KEY, 'true');
    }
  } catch (error) {
    console.error('[Audit DB] Migration failed:', error);
  }
}

export function addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
  const newLog: AuditLogEntry = {
    id: uuidv4(),
    timestamp: Date.now(),
    ...entry
  };

  const database = getDb();
  database.prepare(`
    INSERT INTO audit_logs (
      id,
      timestamp,
      tool,
      args,
      result,
      error,
      session_id,
      policy_tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newLog.id,
    newLog.timestamp,
    newLog.tool,
    serializeValue(newLog.args ?? {}) ?? '{}',
    serializeValue(newLog.result),
    newLog.error ?? null,
    newLog.sessionId ?? null,
    serializeValue(newLog.policyTags)
  );
  trimAuditLogs(database);
}

export function getAuditLogs(limit = 100): AuditLogEntry[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(limit, MAX_AUDIT_LOGS)) : 100;
  const rows = getDb().prepare(`
    SELECT id, timestamp, tool, args, result, error, session_id, policy_tags
    FROM audit_logs
    ORDER BY timestamp DESC, rowid DESC
    LIMIT ?
  `).all(safeLimit) as Array<{
    id: string;
    timestamp: number;
    tool: string;
    args: string;
    result: string | null;
    error: string | null;
    session_id: string | null;
    policy_tags: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    tool: row.tool,
    args: parseValue<Record<string, unknown>>(row.args) ?? {},
    result: parseValue<unknown>(row.result),
    error: row.error ?? undefined,
    sessionId: row.session_id ?? undefined,
    policyTags: parseValue<string[]>(row.policy_tags) ?? undefined
  }));
}

export function deleteAuditLogsBySessionIds(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return 0;
  }

  const placeholders = sessionIds.map(() => '?').join(', ');
  const database = getDb();
  const before = database.prepare(
    `SELECT COUNT(*) as count FROM audit_logs WHERE session_id IN (${placeholders})`
  ).get(...sessionIds) as { count: number };

  database.prepare(
    `DELETE FROM audit_logs WHERE session_id IN (${placeholders})`
  ).run(...sessionIds);

  return before.count;
}
