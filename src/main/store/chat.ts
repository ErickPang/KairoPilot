import { ChatMessage } from '../core/llm/types';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import Store from 'electron-store'; // Only for migration
import { getAgents } from './config';
import type {
  AgentStats,
  MonitoringTokenQuery,
  MonitoringTokenQueryResult,
  MonitoringTokenUsageItem,
  TokenMetricFacet
} from '../../shared/contracts';

export interface Session {
  id: string;
  title: string;
  agentId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}

let db: Database.Database | null = null;
const DEFAULT_AGENT_ID = 'mainAgent';

function normalizeAgentId(agentId?: string | null) {
  return agentId || DEFAULT_AGENT_ID;
}

function getActiveSessionStateKey(agentId?: string | null) {
  return `active_session_id:${normalizeAgentId(agentId)}`;
}

function ensureIndexes(database: Database.Database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_agent_updated_at
      ON sessions(agent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp
      ON messages(session_id, timestamp ASC);
  `);
}

// Initialize Database
function getDb(): Database.Database {
  if (!db) {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'kairopilot.db');
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // Enable Write-Ahead Logging for performance
    
    initTables(db);
    ensureIndexes(db);
    
    // Migration for agent_id column
    try {
      const columns = db.pragma('table_info(sessions)') as { name: string }[];
      const hasAgentId = columns.some(col => col.name === 'agent_id');
      if (!hasAgentId) {
        db.prepare('ALTER TABLE sessions ADD COLUMN agent_id TEXT').run();
      }
      // Migrate legacy sessions to mainAgent
      db.prepare("UPDATE sessions SET agent_id = 'mainAgent' WHERE agent_id IS NULL").run();
    } catch (error) {
      console.error('Failed to migrate sessions table:', error);
    }

    // Migration for tool calls and usage in messages table
    try {
      const msgColumns = db.pragma('table_info(messages)') as { name: string }[];
      const hasName = msgColumns.some(col => col.name === 'name');
      if (!hasName) {
        db.exec(`
          ALTER TABLE messages ADD COLUMN name TEXT;
          ALTER TABLE messages ADD COLUMN tool_call_id TEXT;
          ALTER TABLE messages ADD COLUMN tool_calls TEXT;
        `);
      }
      
      const hasUsage = msgColumns.some(col => col.name === 'usage');
      if (!hasUsage) {
        db.exec(`
          ALTER TABLE messages ADD COLUMN usage TEXT;
        `);
      }

      const hasModel = msgColumns.some(col => col.name === 'model');
      if (!hasModel) {
        db.exec(`
          ALTER TABLE messages ADD COLUMN model TEXT;
        `);
      }
    } catch (error) {
      console.error('Failed to migrate messages table:', error);
    }

    migrateFromElectronStore(db);
    migrateLegacyActiveSessionState(db);
  }
  return db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// One-time migration from old JSON store
function migrateFromElectronStore(db: Database.Database) {
  const migrationKey = 'migration_v1_completed';
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(migrationKey) as { value: string } | undefined;
  
  if (row) return; // Already migrated

  try {
    const oldStore = new Store({ name: 'chat-history' });
    const oldSessions = oldStore.get('sessions', []) as Session[];
    const activeSessionId = oldStore.get('activeSessionId') as string | null;

    if (oldSessions.length > 0) {
      const insertSession = db.prepare('INSERT INTO sessions (id, title, created_at, updated_at) VALUES (@id, @title, @createdAt, @updatedAt)');
      const insertMessage = db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, name, tool_call_id, tool_calls, usage, model) VALUES (@id, @sessionId, @role, @content, @timestamp, @name, @toolCallId, @toolCalls, @usage, @model)');

      const transaction = db.transaction(() => {
        for (const session of oldSessions) {
          insertSession.run({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt
          });

          for (const msg of session.messages) {
            insertMessage.run({
              id: uuidv4(),
              sessionId: session.id,
              role: msg.role,
              content: msg.content || '',
              timestamp: msg.timestamp || Date.now(),
              name: msg.name || null,
              toolCallId: msg.tool_call_id || null,
              toolCalls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
              usage: msg.usage ? JSON.stringify(msg.usage) : null,
              model: msg.model || null
            });
          }
        }

        if (activeSessionId) {
          db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run('active_session_id', activeSessionId);
        }
      });

      transaction();
      console.log(`[DB] Migrated ${oldSessions.length} sessions from JSON store.`);
    }

    // Mark migration as done
    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run(migrationKey, 'true');
    
    // Optional: clear old store to free space? 
    // oldStore.clear(); // Let's keep it as backup for now
  } catch (error) {
    console.error('[DB] Migration failed:', error);
  }
}

function migrateLegacyActiveSessionState(db: Database.Database) {
  try {
    const legacyRow = db.prepare('SELECT value FROM app_state WHERE key = ?').get('active_session_id') as { value: string } | undefined;
    if (!legacyRow?.value) {
      return;
    }

    const scopedKey = getActiveSessionStateKey(DEFAULT_AGENT_ID);
    const scopedRow = db.prepare('SELECT value FROM app_state WHERE key = ?').get(scopedKey) as { value: string } | undefined;
    if (!scopedRow) {
      db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(scopedKey, legacyRow.value);
    }
  } catch (error) {
    console.error('[DB] Failed to migrate legacy active session state:', error);
  }
}

// --- Public API ---

function mapMessageRowToChatMessage(message: {
  role: ChatMessage['role'];
  content: string;
  timestamp: number;
  name?: string;
  tool_call_id?: string;
  tool_calls?: string;
  usage?: string;
  model?: string;
}): ChatMessage {
  const chatMessage: ChatMessage = {
    role: message.role,
    content: message.content,
    timestamp: message.timestamp
  };

  if (message.name) {
    chatMessage.name = message.name;
  }

  if (message.tool_call_id) {
    chatMessage.tool_call_id = message.tool_call_id;
  }

  if (message.tool_calls) {
    try {
      chatMessage.tool_calls = JSON.parse(message.tool_calls);
    } catch (error) {
      console.warn('[DB] Failed to parse tool_calls:', error);
    }
  }

  if (message.usage) {
    try {
      chatMessage.usage = JSON.parse(message.usage);
    } catch (error) {
      console.warn('[DB] Failed to parse usage:', error);
    }
  }

  if (message.model) {
    chatMessage.model = message.model;
  }

  return chatMessage;
}

function parseUsage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const usage = JSON.parse(value) as Partial<ChatMessage['usage']>;
    return {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0
    };
  } catch {
    return null;
  }
}

function serializeComparableMessage(message: ChatMessage): string {
  return JSON.stringify({
    role: message.role,
    content: message.content || '',
    timestamp: message.timestamp || 0,
    name: message.name || null,
    tool_call_id: message.tool_call_id || null,
    tool_calls: message.tool_calls || null,
    usage: message.usage || null,
    model: message.model || null
  });
}

function getSharedMessagePrefixLength(existingMessages: ChatMessage[], nextMessages: ChatMessage[]) {
  const maxComparableLength = Math.min(existingMessages.length, nextMessages.length);
  let prefixLength = 0;

  while (prefixLength < maxComparableLength) {
    if (serializeComparableMessage(existingMessages[prefixLength]) !== serializeComparableMessage(nextMessages[prefixLength])) {
      break;
    }
    prefixLength += 1;
  }

  return prefixLength;
}

function mapSessionRowToSummary(session: {
  id: string;
  title: string;
  agent_id: string;
  created_at: number;
  updated_at: number;
}): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    agentId: session.agent_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at
  };
}

function getSessionAgentId(sessionId: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT agent_id FROM sessions WHERE id = ?').get(sessionId) as { agent_id: string | null } | undefined;
  return row?.agent_id || null;
}

function getLatestSessionSummary(agentId?: string): SessionSummary | null {
  const db = getDb();
  const normalizedAgentId = normalizeAgentId(agentId);
  const row = db.prepare(
    'SELECT id, title, agent_id, created_at, updated_at FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(normalizedAgentId) as {
    id: string;
    title: string;
    agent_id: string;
    created_at: number;
    updated_at: number;
  } | undefined;

  return row ? mapSessionRowToSummary(row) : null;
}

export function listSessions(agentId?: string): SessionSummary[] {
  const db = getDb();
  let query = 'SELECT id, title, agent_id, created_at, updated_at FROM sessions';
  const params: unknown[] = [];
  
  if (agentId) {
    query += ' WHERE agent_id = ?';
    params.push(agentId);
  }
  
  query += ' ORDER BY updated_at DESC';
  
  const sessions = db.prepare(query).all(...params) as {
    id: string;
    title: string;
    agent_id: string;
    created_at: number;
    updated_at: number;
  }[];

  return sessions.map(mapSessionRowToSummary);
}

export function getSessions(agentId?: string): Session[] {
  return listSessions(agentId)
    .map((session) => getSessionById(session.id))
    .filter((session): session is Session => session !== null);
}

export function createSession(title: string = 'New Chat', agentId?: string): Session {
  const db = getDb();
  const normalizedAgentId = normalizeAgentId(agentId);
  const newSession: Session = {
    id: uuidv4(),
    title,
    agentId: normalizedAgentId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  db.prepare('INSERT INTO sessions (id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    newSession.id, newSession.title, newSession.agentId || null, newSession.createdAt, newSession.updatedAt
  );
  
  setActiveSessionId(newSession.id, normalizedAgentId);
  return newSession;
}

export function getActiveSession(agentId?: string): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(getActiveSessionStateKey(agentId)) as { value: string } | undefined;
  if (!row) return null;
  
  return getSessionById(row.value);
}

export function ensureActiveSession(agentId?: string, title: string = 'New Chat'): Session {
  const normalizedAgentId = normalizeAgentId(agentId);
  const activeSession = getActiveSession(normalizedAgentId);
  if (activeSession?.agentId === normalizedAgentId) {
    return activeSession;
  }

  const latestSession = getLatestSessionSummary(normalizedAgentId);
  if (latestSession) {
    setActiveSessionId(latestSession.id, normalizedAgentId);
    const hydratedSession = getSessionById(latestSession.id);
    if (hydratedSession) {
      return hydratedSession;
    }
  }

  return createSession(title, normalizedAgentId);
}

export function getSessionById(sessionId: string): Session | null {
  const db = getDb();
  const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as { id: string; title: string; agent_id: string; created_at: number; updated_at: number } | undefined;
  if (!sessionRow) return null;

  const messages = db.prepare('SELECT role, content, timestamp, name, tool_call_id, tool_calls, usage, model FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as { role: ChatMessage['role']; content: string; timestamp: number; name?: string; tool_call_id?: string; tool_calls?: string; usage?: string; model?: string }[];

  return {
    ...mapSessionRowToSummary(sessionRow),
    messages: messages.map(mapMessageRowToChatMessage)
  };
}

export function setActiveSessionId(sessionId: string | null, agentId?: string) {
  const db = getDb();
  const resolvedAgentId = sessionId
    ? getSessionAgentId(sessionId) || agentId
    : agentId;
  const stateKey = getActiveSessionStateKey(resolvedAgentId);

  if (sessionId) {
    db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(stateKey, sessionId);
  } else {
    db.prepare('DELETE FROM app_state WHERE key = ?').run(stateKey);
  }
}

export function updateSessionMessages(sessionId: string, messages: ChatMessage[]) {
  const db = getDb();
  
  const transaction = db.transaction(() => {
    const now = Date.now();
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

    const existingRows = db.prepare(
      'SELECT role, content, timestamp, name, tool_call_id, tool_calls, usage, model FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId) as Array<{
      role: ChatMessage['role'];
      content: string;
      timestamp: number;
      name?: string;
      tool_call_id?: string;
      tool_calls?: string;
      usage?: string;
      model?: string;
    }>;
    const existingMessages = existingRows.map(mapMessageRowToChatMessage);
    const sharedPrefixLength = getSharedMessagePrefixLength(existingMessages, messages);
    const insert = db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, name, tool_call_id, tool_calls, usage, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    if (sharedPrefixLength === existingMessages.length && messages.length >= existingMessages.length) {
      for (const msg of messages.slice(sharedPrefixLength)) {
        insert.run(
          uuidv4(),
          sessionId,
          msg.role,
          msg.content || '',
          msg.timestamp || now,
          msg.name || null,
          msg.tool_call_id || null,
          msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
          msg.usage ? JSON.stringify(msg.usage) : null,
          msg.model || null
        );
      }
      return;
    }

    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

    for (const msg of messages) {
      insert.run(
        uuidv4(), 
        sessionId, 
        msg.role, 
        msg.content || '',
        msg.timestamp || now,
        msg.name || null,
        msg.tool_call_id || null,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.usage ? JSON.stringify(msg.usage) : null,
        msg.model || null
      );
    }
  });

  transaction();
}

export function updateSessionTitle(sessionId: string, title: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), sessionId);
}

export function deleteSession(sessionId: string) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const sessionRow = db.prepare('SELECT agent_id FROM sessions WHERE id = ?').get(sessionId) as { agent_id: string | null } | undefined;
    const sessionAgentId = normalizeAgentId(sessionRow?.agent_id);
    const stateKey = getActiveSessionStateKey(sessionAgentId);

    // Cascade delete handles messages, but we need to check active session
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    
    const activeRow = db.prepare('SELECT value FROM app_state WHERE key = ?').get(stateKey) as { value: string } | undefined;
    if (activeRow && activeRow.value === sessionId) {
      const nextSession = db.prepare('SELECT id FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1').get(sessionAgentId) as { id: string } | undefined;
      if (nextSession) {
        db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(stateKey, nextSession.id);
      } else {
        db.prepare('DELETE FROM app_state WHERE key = ?').run(stateKey);
      }
    }
  });
  
  transaction();
}

export function deleteSessionsByAgent(agentId: string) {
  const db = getDb();
  const normalizedAgentId = normalizeAgentId(agentId);
  const stateKey = getActiveSessionStateKey(normalizedAgentId);
  const sessionRows = db.prepare('SELECT id FROM sessions WHERE agent_id = ?').all(normalizedAgentId) as Array<{ id: string }>;
  const sessionIds = sessionRows.map((row) => row.id);

  const transaction = db.transaction(() => {
    const deleteMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    for (const sessionId of sessionIds) {
      deleteMessages.run(sessionId);
    }
    db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(normalizedAgentId);
    db.prepare('DELETE FROM app_state WHERE key = ?').run(stateKey);
  });

  transaction();
  return sessionIds;
}

export function clearAllSessions() {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM sessions').run(); // Cascade deletes messages
    db.prepare("DELETE FROM app_state WHERE key LIKE 'active_session_id:%'").run();
    db.prepare('DELETE FROM app_state WHERE key = ?').run('active_session_id');
  });
  transaction();
}

export function getAgentStats(): AgentStats[] {
  const db = getDb();
  const sessions = db.prepare('SELECT id, agent_id FROM sessions').all() as {id: string, agent_id: string}[];
  const messages = db.prepare('SELECT session_id, role, usage FROM messages').all() as {session_id: string, role: string, usage: string | null}[];
  const statsMap = new Map<string, AgentStats>();
  const sessionAgentMap = new Map(sessions.map(session => [session.id, session.agent_id || DEFAULT_AGENT_ID]));

  for (const session of sessions) {
    const agentId = session.agent_id || DEFAULT_AGENT_ID;
    if (!statsMap.has(agentId)) {
      statsMap.set(agentId, {
        agentId,
        totalSessions: 0,
        totalMessages: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      });
    }
    const stat = statsMap.get(agentId)!;
    stat.totalSessions += 1;
  }

  for (const msg of messages) {
    const agentId = sessionAgentMap.get(msg.session_id);
    if (!agentId) {
      continue;
    }

    const stat = statsMap.get(agentId);
    if (!stat) {
      continue;
    }

    stat.totalMessages += 1;
    const usage = parseUsage(msg.usage);
    if (usage) {
      stat.promptTokens += usage.promptTokens;
      stat.completionTokens += usage.completionTokens;
      stat.totalTokens += usage.totalTokens;
    }
  }

  return Array.from(statsMap.values());
}

function buildMonitoringWhereClause(query: MonitoringTokenQuery) {
  const clauses = ['messages.usage IS NOT NULL'];
  const params: Array<string | number> = [];
  const agentId = query.agentId?.trim();
  const model = query.model?.trim();
  const role = query.role?.trim();
  const sessionId = query.sessionId?.trim();
  const search = query.search?.trim().toLowerCase();
  const startTime = Number.isFinite(query.startTime) ? Number(query.startTime) : undefined;
  const endTime = Number.isFinite(query.endTime) ? Number(query.endTime) : undefined;

  if (agentId) {
    clauses.push('sessions.agent_id = ?');
    params.push(agentId);
  }

  if (model) {
    clauses.push('COALESCE(messages.model, \'\') = ?');
    params.push(model);
  }

  if (role && role !== 'all') {
    clauses.push('messages.role = ?');
    params.push(role);
  }

  if (sessionId) {
    clauses.push('messages.session_id = ?');
    params.push(sessionId);
  }

  if (typeof startTime === 'number') {
    clauses.push('messages.timestamp >= ?');
    params.push(startTime);
  }

  if (typeof endTime === 'number') {
    clauses.push('messages.timestamp <= ?');
    params.push(endTime);
  }

  if (search) {
    const keyword = `%${search}%`;
    clauses.push(`(
      LOWER(COALESCE(messages.content, '')) LIKE ?
      OR LOWER(COALESCE(messages.model, '')) LIKE ?
      OR LOWER(COALESCE(sessions.title, '')) LIKE ?
      OR LOWER(COALESCE(sessions.agent_id, '')) LIKE ?
    )`);
    params.push(keyword, keyword, keyword, keyword);
  }

  return {
    whereClause: `WHERE ${clauses.join(' AND ')}`,
    params,
    normalizedAgentId: agentId
  };
}

function buildTokenMetricFacets(
  items: MonitoringTokenUsageItem[],
  keySelector: (item: MonitoringTokenUsageItem) => string
): TokenMetricFacet[] {
  const facetMap = new Map<string, TokenMetricFacet>();

  for (const item of items) {
    const value = keySelector(item) || 'Unknown';
    const current = facetMap.get(value) ?? {
      value,
      count: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };
    current.count += 1;
    current.promptTokens += item.promptTokens;
    current.completionTokens += item.completionTokens;
    current.totalTokens += item.totalTokens;
    facetMap.set(value, current);
  }

  return Array.from(facetMap.values()).sort((left, right) => {
    if (right.totalTokens !== left.totalTokens) {
      return right.totalTokens - left.totalTokens;
    }
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.value.localeCompare(right.value);
  });
}

function mapMonitoringRows(rows: Array<{
  id: string;
  session_id: string;
  session_title: string;
  agent_id: string | null;
  role: ChatMessage['role'];
  content: string;
  timestamp: number;
  usage: string;
  model: string | null;
}>): MonitoringTokenUsageItem[] {
  const agentModelMap = new Map(
    getAgents().map((agent) => [agent.id, agent.model || ''])
  );

  return rows.flatMap((row) => {
    const usage = parseUsage(row.usage);
    if (!usage) {
      return [];
    }

    const agentId = row.agent_id || DEFAULT_AGENT_ID;
    const fallbackModel = agentModelMap.get(agentId) || '';
    return [{
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      agentId,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      model: row.model || fallbackModel || 'Unknown',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    }];
  });
}

export function getTokenUsageDetails(query: MonitoringTokenQuery = {}): MonitoringTokenQueryResult {
  const db = getDb();
  const page = Number.isFinite(query.page) && Number(query.page) > 0 ? Math.floor(Number(query.page)) : 1;
  const pageSize = Number.isFinite(query.pageSize) && Number(query.pageSize) > 0 ? Math.min(Math.floor(Number(query.pageSize)), 100) : 20;
  const { whereClause, params, normalizedAgentId } = buildMonitoringWhereClause(query);
  const totalRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM messages
    INNER JOIN sessions ON sessions.id = messages.session_id
    ${whereClause}
  `).get(...params) as { count: number };
  const total = totalRow?.count || 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const baseSelect = `
    SELECT
      messages.id,
      messages.session_id,
      sessions.title AS session_title,
      sessions.agent_id,
      messages.role,
      messages.content,
      messages.timestamp,
      messages.usage,
      messages.model
    FROM messages
    INNER JOIN sessions ON sessions.id = messages.session_id
    ${whereClause}
  `;
  const rows = db.prepare(`
    ${baseSelect}
    ORDER BY messages.timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<{
    id: string;
    session_id: string;
    session_title: string;
    agent_id: string | null;
    role: ChatMessage['role'];
    content: string;
    timestamp: number;
    usage: string;
    model: string | null;
  }>;
  const aggregateRows = db.prepare(`
    ${baseSelect}
    ORDER BY messages.timestamp DESC
  `).all(...params) as Array<{
    id: string;
    session_id: string;
    session_title: string;
    agent_id: string | null;
    role: ChatMessage['role'];
    content: string;
    timestamp: number;
    usage: string;
    model: string | null;
  }>;
  const items = mapMonitoringRows(rows);
  const aggregateItems = mapMonitoringRows(aggregateRows);
  const aggregations = aggregateItems.reduce((acc, item) => ({
    promptTokens: acc.promptTokens + item.promptTokens,
    completionTokens: acc.completionTokens + item.completionTokens,
    totalTokens: acc.totalTokens + item.totalTokens
  }), {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  });

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    aggregations: {
      agentId: normalizedAgentId || undefined,
      promptTokens: aggregations.promptTokens,
      completionTokens: aggregations.completionTokens,
      totalTokens: aggregations.totalTokens,
      totalRecords: aggregateItems.length,
      models: buildTokenMetricFacets(aggregateItems, (item) => item.model),
      roles: buildTokenMetricFacets(aggregateItems, (item) => item.role)
    }
  };
}
