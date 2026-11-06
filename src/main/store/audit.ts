import { app } from 'electron';
import Database from 'better-sqlite3';

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { AuditLogEntry, AuditLogQuery, AuditLogQueryResult, QueryFacet } from '../../shared/contracts';

const MAX_AUDIT_LOGS = 1000;

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
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        result TEXT,
        error TEXT,
        session_id TEXT,
        run_id TEXT,
        step_id TEXT,
        policy_tags TEXT
      );


      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp_desc
        ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id
        ON audit_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_run_id
        ON audit_logs(run_id);
    `);

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
      run_id,
      step_id,
      policy_tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newLog.id,
    newLog.timestamp,
    newLog.tool,
    serializeValue(newLog.args ?? {}) ?? '{}',
    serializeValue(newLog.result),
    newLog.error ?? null,
    newLog.sessionId ?? null,
    newLog.runId ?? null,
    newLog.stepId ?? null,
    serializeValue(newLog.policyTags)
  );
  trimAuditLogs(database);
}

export function getAuditLogs(limit = 100): AuditLogEntry[] {
  return queryAuditLogs({ page: 1, pageSize: limit }).items;
}

function mapAuditRows(rows: Array<{
  id: string;
  timestamp: number;
  tool: string;
  args: string;
  result: string | null;
  error: string | null;
  session_id: string | null;
  run_id: string | null;
  step_id: string | null;
  policy_tags: string | null;
}>): AuditLogEntry[] {
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    tool: row.tool,
    args: parseValue<Record<string, unknown>>(row.args) ?? {},
    result: parseValue<unknown>(row.result),
    error: row.error ?? undefined,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    stepId: row.step_id ?? undefined,
    policyTags: parseValue<string[]>(row.policy_tags) ?? undefined
  }));
}

function buildAuditQueryWhere(query: AuditLogQuery) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const search = query.search?.trim().toLowerCase();
  const status = query.status ?? 'all';
  const tool = query.tool?.trim();
  const tag = query.tag?.trim();
  const sessionId = query.sessionId?.trim();
  const runId = query.runId?.trim();
  const stepId = query.stepId?.trim();
  const startTime = Number.isFinite(query.startTime) ? Number(query.startTime) : undefined;
  const endTime = Number.isFinite(query.endTime) ? Number(query.endTime) : undefined;

  if (status === 'success') {
    clauses.push('(error IS NULL OR error = \'\')');
  } else if (status === 'error') {
    clauses.push('(error IS NOT NULL AND error <> \'\')');
  }

  if (tool) {
    clauses.push('tool = ?');
    params.push(tool);
  }

  if (tag) {
    clauses.push('policy_tags LIKE ?');
    params.push(`%"${tag.split('"').join('""')}"%`);
  }

  if (sessionId) {
    clauses.push('session_id = ?');
    params.push(sessionId);
  }

  if (runId) {
    clauses.push('run_id = ?');
    params.push(runId);
  }

  if (stepId) {
    clauses.push('step_id = ?');
    params.push(stepId);
  }

  if (typeof startTime === 'number') {
    clauses.push('timestamp >= ?');
    params.push(startTime);
  }

  if (typeof endTime === 'number') {
    clauses.push('timestamp <= ?');
    params.push(endTime);
  }

  if (search) {
    const keyword = `%${search}%`;
    clauses.push(`(
      LOWER(tool) LIKE ?
      OR LOWER(args) LIKE ?
      OR LOWER(COALESCE(error, '')) LIKE ?
      OR LOWER(COALESCE(result, '')) LIKE ?
      OR LOWER(COALESCE(policy_tags, '')) LIKE ?
      OR LOWER(COALESCE(session_id, '')) LIKE ?
    )`);
    params.push(keyword, keyword, keyword, keyword, keyword, keyword);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

function aggregateTags(entries: AuditLogEntry[]): QueryFacet[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.policyTags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.value.localeCompare(right.value);
    });
}

export function queryAuditLogs(query: AuditLogQuery = {}): AuditLogQueryResult {
  const database = getDb();
  const page = Number.isFinite(query.page) && Number(query.page) > 0 ? Math.floor(Number(query.page)) : 1;
  const pageSize = Number.isFinite(query.pageSize) && Number(query.pageSize) > 0
    ? Math.min(Math.floor(Number(query.pageSize)), MAX_AUDIT_LOGS)
    : 20;
  const { whereClause, params } = buildAuditQueryWhere(query);
  const totalRow = database.prepare(`
    SELECT COUNT(*) as count
    FROM audit_logs
    ${whereClause}
  `).get(...params) as { count: number };
  const total = totalRow?.count ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const itemRows = database.prepare(`
    SELECT id, timestamp, tool, args, result, error, session_id, policy_tags
    , run_id, step_id
    FROM audit_logs
    ${whereClause}
    ORDER BY timestamp DESC, rowid DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<{
    id: string;
    timestamp: number;
    tool: string;
    args: string;
    result: string | null;
    error: string | null;
    session_id: string | null;
    run_id: string | null;
    step_id: string | null;
    policy_tags: string | null;
  }>;
  const items = mapAuditRows(itemRows);
  const aggregateStats = database.prepare(`
    SELECT
      SUM(CASE WHEN error IS NULL OR error = '' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN error IS NOT NULL AND error <> '' THEN 1 ELSE 0 END) as error_count
    FROM audit_logs
    ${whereClause}
  `).get(...params) as { success_count: number | null; error_count: number | null };
  const toolRows = database.prepare(`
    SELECT tool as value, COUNT(*) as count
    FROM audit_logs
    ${whereClause}
    GROUP BY tool
    ORDER BY count DESC, value ASC
  `).all(...params) as QueryFacet[];
  const tagRows = database.prepare(`
    SELECT id, timestamp, tool, args, result, error, session_id, run_id, step_id, policy_tags
    FROM audit_logs
    ${whereClause}
  `).all(...params) as Array<{
    id: string;
    timestamp: number;
    tool: string;
    args: string;
    result: string | null;
    error: string | null;
    session_id: string | null;
    run_id: string | null;
    step_id: string | null;
    policy_tags: string | null;
  }>;
  const aggregateEntries = mapAuditRows(tagRows);

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    aggregations: {
      successCount: aggregateStats?.success_count ?? 0,
      errorCount: aggregateStats?.error_count ?? 0,
      tools: toolRows,
      tags: aggregateTags(aggregateEntries)
    }
  };
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
