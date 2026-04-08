import { ChatMessage } from '../core/llm/types';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import Store from 'electron-store'; // Only for migration
import { getAgents } from './config';
import { queryAuditLogs } from './audit';
import { buildRunTraceAggregations, normalizeRunTraceQuery, paginateRunSteps } from './chat_trace_utils';
import type {
  AgentStats,
  ApprovalRecord,
  MonitoringTokenQuery,
  MonitoringTokenQueryResult,
  MonitoringTokenUsageItem,
  QueryFacet,
  RunContextSummary,
  RunQuery,
  RunQueryResult,
  RunStatus,
  RunStep,
  RunStepStatus,
  RunStepType,
  RunTrace,
  RunTraceAggregations,
  RunTraceQuery,
  RunSummary,
  TokenMetricFacet,
  ToolCallRecord
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
const MAX_RUN_QUERY_PAGE_SIZE = 100;

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
    CREATE INDEX IF NOT EXISTS idx_runs_session_updated_at
      ON runs(session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_steps_run_step_index
      ON run_steps(run_id, step_index ASC);
    CREATE INDEX IF NOT EXISTS idx_tool_call_records_run_step
      ON tool_call_records(run_id, step_id);
    CREATE INDEX IF NOT EXISTS idx_approval_records_run_status
      ON approval_records(run_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approval_records_session_status
      ON approval_records(session_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_snapshots_run_created_at
      ON context_snapshots(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_summaries_run_created_at
      ON context_summaries(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_summaries_session_created_at
      ON context_summaries(session_id, created_at DESC);
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
    db.pragma('foreign_keys = ON');
    
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

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      user_input TEXT NOT NULL,
      status TEXT NOT NULL,
      final_response TEXT,
      error TEXT,
      waiting_approval_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      input TEXT,
      output TEXT,
      error TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_call_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      tool_name TEXT NOT NULL,
      args TEXT,
      result TEXT,
      error TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      args TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS context_summaries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT,
      step_id TEXT,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL
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

function serializeJson(value: unknown) {
  if (typeof value === 'undefined') {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function parseJsonValue<T>(value: string | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
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

function mapRunRowToSummary(run: {
  id: string;
  session_id: string;
  agent_id: string;
  goal: string;
  user_input: string;
  status: RunStatus;
  final_response: string | null;
  error: string | null;
  waiting_approval_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}): RunSummary {
  return {
    id: run.id,
    sessionId: run.session_id,
    agentId: run.agent_id,
    goal: run.goal,
    userInput: run.user_input,
    status: run.status,
    finalResponse: run.final_response || undefined,
    error: run.error || undefined,
    waitingApprovalId: run.waiting_approval_id || undefined,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    startedAt: run.started_at || undefined,
    completedAt: run.completed_at || undefined
  };
}

function mapRunStepRow(step: {
  id: string;
  run_id: string;
  step_index: number;
  type: RunStepType;
  status: RunStepStatus;
  title: string;
  input: string | null;
  output: string | null;
  error: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}): RunStep {
  return {
    id: step.id,
    runId: step.run_id,
    stepIndex: step.step_index,
    type: step.type,
    status: step.status,
    title: step.title,
    input: parseJsonValue(step.input),
    output: parseJsonValue(step.output),
    error: step.error || undefined,
    metadata: parseJsonValue<Record<string, unknown>>(step.metadata),
    createdAt: step.created_at,
    updatedAt: step.updated_at
  };
}

function mapApprovalRowToRecord(row: {
  id: string;
  run_id: string;
  step_id: string | null;
  session_id: string | null;
  tool_name: string;
  args: string;
  status: 'pending' | 'approved' | 'denied';
  metadata: string | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}): ApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id || undefined,
    sessionId: row.session_id || undefined,
    toolName: row.tool_name,
    args: parseJsonValue<Record<string, unknown>>(row.args) || {},
    status: row.status,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || undefined
  };
}

function mapToolCallRecordRow(row: {
  id: string;
  run_id: string;
  step_id: string | null;
  tool_name: string;
  args: string | null;
  result: string | null;
  error: string | null;
  status: 'running' | 'waiting_approval' | 'success' | 'failed' | 'cancelled';
  created_at: number;
  updated_at: number;
}): ToolCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id || undefined,
    toolName: row.tool_name,
    args: parseJsonValue(row.args),
    result: parseJsonValue(row.result),
    error: row.error || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapContextSummaryRow(row: {
  id: string;
  run_id: string;
  session_id: string | null;
  step_id: string | null;
  summary: string;
  created_at: number;
}): RunContextSummary | null {
  const parsedSummary = parseJsonValue<Omit<RunContextSummary, 'id' | 'runId' | 'sessionId' | 'stepId' | 'createdAt'>>(row.summary);
  if (!parsedSummary) {
    return null;
  }

  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id || undefined,
    stepId: row.step_id || undefined,
    activeTaskSummary: parsedSummary.activeTaskSummary || '',
    activeSkillsSummary: parsedSummary.activeSkillsSummary || '',
    availableSkillsSummary: parsedSummary.availableSkillsSummary || '',
    availableToolsSummary: parsedSummary.availableToolsSummary || '',
    compactedHistorySummary: parsedSummary.compactedHistorySummary || '',
    unresolvedApprovals: parsedSummary.unresolvedApprovals || '',
    selectedToolResults: parsedSummary.selectedToolResults || '',
    workspaceRetrieval: parsedSummary.workspaceRetrieval || '',
    memoryDigest: parsedSummary.memoryDigest || '',
    layers: Array.isArray(parsedSummary.layers)
      ? parsedSummary.layers.map((layer) => ({
          id: String(layer.id || ''),
          title: String(layer.title || ''),
          kind: layer.kind === 'system' || layer.kind === 'support' || layer.kind === 'history' ? layer.kind : 'support',
          messageCount: Number.isFinite(layer.messageCount) ? layer.messageCount : 0,
          charCount: Number.isFinite(layer.charCount) ? layer.charCount : 0,
          summary: String(layer.summary || '')
        }))
      : [],
    recentMessageCount: Number.isFinite(parsedSummary.recentMessageCount) ? parsedSummary.recentMessageCount : 0,
    omittedMessageCount: Number.isFinite(parsedSummary.omittedMessageCount) ? parsedSummary.omittedMessageCount : 0,
    budget: {
      maxContextChars: parsedSummary.budget?.maxContextChars || 0,
      systemPromptChars: parsedSummary.budget?.systemPromptChars || 0,
      supportChars: parsedSummary.budget?.supportChars || 0,
      recentHistoryChars: parsedSummary.budget?.recentHistoryChars || 0,
      totalChars: parsedSummary.budget?.totalChars || 0
    },
    createdAt: row.created_at
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
  const runs = db.prepare('SELECT agent_id, status FROM runs').all() as {agent_id: string, status: RunStatus}[];
  const approvals = db.prepare('SELECT run_id, status FROM approval_records').all() as {run_id: string, status: ApprovalRecord['status']}[];
  const toolCalls = db.prepare('SELECT run_id, status FROM tool_call_records').all() as {
    run_id: string,
    status: ToolCallRecord['status']
  }[];
  const statsMap = new Map<string, AgentStats>();
  const sessionAgentMap = new Map(sessions.map(session => [session.id, session.agent_id || DEFAULT_AGENT_ID]));
  const runAgentMap = new Map<string, string>();

  const ensureAgentStats = (agentId: string) => {
    const normalizedAgentId = agentId || DEFAULT_AGENT_ID;
    if (!statsMap.has(normalizedAgentId)) {
      statsMap.set(normalizedAgentId, {
        agentId: normalizedAgentId,
        totalSessions: 0,
        totalMessages: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        waitingApprovalRuns: 0,
        approvalRequests: 0,
        approvalApproved: 0,
        toolCalls: 0,
        successfulToolCalls: 0
      });
    }
    return statsMap.get(normalizedAgentId)!;
  };

  for (const session of sessions) {
    const agentId = session.agent_id || DEFAULT_AGENT_ID;
    const stat = ensureAgentStats(agentId);
    stat.totalSessions += 1;
  }

  for (const msg of messages) {
    const agentId = sessionAgentMap.get(msg.session_id);
    if (!agentId) {
      continue;
    }

    const stat = ensureAgentStats(agentId);
    stat.totalMessages += 1;
    const usage = parseUsage(msg.usage);
    if (usage) {
      stat.promptTokens += usage.promptTokens;
      stat.completionTokens += usage.completionTokens;
      stat.totalTokens += usage.totalTokens;
    }
  }

  for (const run of runs) {
    const agentId = run.agent_id || DEFAULT_AGENT_ID;
    const stat = ensureAgentStats(agentId);
    stat.totalRuns += 1;
    if (run.status === 'completed') {
      stat.completedRuns += 1;
    } else if (run.status === 'failed') {
      stat.failedRuns += 1;
    } else if (run.status === 'cancelled') {
      stat.cancelledRuns += 1;
    } else if (run.status === 'waiting_approval') {
      stat.waitingApprovalRuns += 1;
    }
  }

  const runRows = db.prepare('SELECT id, agent_id FROM runs').all() as { id: string; agent_id: string }[];
  for (const run of runRows) {
    runAgentMap.set(run.id, run.agent_id || DEFAULT_AGENT_ID);
  }

  for (const approval of approvals) {
    const agentId = runAgentMap.get(approval.run_id);
    if (!agentId) {
      continue;
    }
    const stat = ensureAgentStats(agentId);
    stat.approvalRequests += 1;
    if (approval.status === 'approved') {
      stat.approvalApproved += 1;
    }
  }

  for (const toolCall of toolCalls) {
    const agentId = runAgentMap.get(toolCall.run_id);
    if (!agentId) {
      continue;
    }
    const stat = ensureAgentStats(agentId);
    stat.toolCalls += 1;
    if (toolCall.status === 'success') {
      stat.successfulToolCalls += 1;
    }
  }

  return Array.from(statsMap.values());
}

function getNextRunStepIndex(database: Database.Database, runId: string) {
  const row = database.prepare(
    'SELECT COALESCE(MAX(step_index), -1) AS max_step_index FROM run_steps WHERE run_id = ?'
  ).get(runId) as { max_step_index: number };
  return (row?.max_step_index ?? -1) + 1;
}

export function createRun(sessionId: string, agentId: string, userInput: string, goal?: string): RunSummary {
  const database = getDb();
  const now = Date.now();
  const id = uuidv4();
  database.prepare(`
    INSERT INTO runs (
      id, session_id, agent_id, goal, user_input, status, created_at, updated_at, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, normalizeAgentId(agentId), goal || userInput, userInput, 'running', now, now, now);
  database.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
  return getRunById(id)!;
}

export function getRunById(runId: string): RunSummary | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT
      id,
      session_id,
      agent_id,
      goal,
      user_input,
      status,
      final_response,
      error,
      waiting_approval_id,
      created_at,
      updated_at,
      started_at,
      completed_at
    FROM runs
    WHERE id = ?
  `).get(runId) as {
    id: string;
    session_id: string;
    agent_id: string;
    goal: string;
    user_input: string;
    status: RunStatus;
    final_response: string | null;
    error: string | null;
    waiting_approval_id: string | null;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    completed_at: number | null;
  } | undefined;

  return row ? mapRunRowToSummary(row) : null;
}

export function getLatestRun(sessionId: string): RunSummary | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT
      id,
      session_id,
      agent_id,
      goal,
      user_input,
      status,
      final_response,
      error,
      waiting_approval_id,
      created_at,
      updated_at,
      started_at,
      completed_at
    FROM runs
    WHERE session_id = ?
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).get(sessionId) as {
    id: string;
    session_id: string;
    agent_id: string;
    goal: string;
    user_input: string;
    status: RunStatus;
    final_response: string | null;
    error: string | null;
    waiting_approval_id: string | null;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    completed_at: number | null;
  } | undefined;

  return row ? mapRunRowToSummary(row) : null;
}

function buildRunQueryWhere(query: RunQuery) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const search = query.search?.trim().toLowerCase();
  const status = query.status ?? 'all';
  const sessionId = query.sessionId?.trim();
  const agentId = query.agentId?.trim();

  if (status !== 'all') {
    clauses.push('status = ?');
    params.push(status);
  }

  if (sessionId) {
    clauses.push('session_id = ?');
    params.push(sessionId);
  }

  if (agentId) {
    clauses.push('agent_id = ?');
    params.push(agentId);
  }

  if (search) {
    const keyword = `%${search}%`;
    clauses.push(`(
      LOWER(id) LIKE ?
      OR LOWER(goal) LIKE ?
      OR LOWER(user_input) LIKE ?
      OR LOWER(COALESCE(final_response, '')) LIKE ?
      OR LOWER(COALESCE(error, '')) LIKE ?
      OR LOWER(session_id) LIKE ?
    )`);
    params.push(keyword, keyword, keyword, keyword, keyword, keyword);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

export function queryRuns(query: RunQuery = {}): RunQueryResult {
  const database = getDb();
  const page = Number.isFinite(query.page) && Number(query.page) > 0 ? Math.floor(Number(query.page)) : 1;
  const pageSize = Number.isFinite(query.page) && Number(query.pageSize) > 0
    ? Math.min(Math.floor(Number(query.pageSize)), MAX_RUN_QUERY_PAGE_SIZE)
    : 20;
  const { whereClause, params } = buildRunQueryWhere(query);
  const totalRow = database.prepare(`
    SELECT COUNT(*) as count
    FROM runs
    ${whereClause}
  `).get(...params) as { count: number };
  const total = totalRow?.count ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const runRows = database.prepare(`
    SELECT
      id,
      session_id,
      agent_id,
      goal,
      user_input,
      status,
      final_response,
      error,
      waiting_approval_id,
      created_at,
      updated_at,
      started_at,
      completed_at
    FROM runs
    ${whereClause}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<{
    id: string;
    session_id: string;
    agent_id: string;
    goal: string;
    user_input: string;
    status: RunStatus;
    final_response: string | null;
    error: string | null;
    waiting_approval_id: string | null;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    completed_at: number | null;
  }>;
  const items = runRows.map(mapRunRowToSummary);
  const aggregateStats = database.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running_runs,
      SUM(CASE WHEN status = 'waiting_approval' THEN 1 ELSE 0 END) as waiting_approval_runs,
      SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused_runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_runs,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_runs
    FROM runs
    ${whereClause}
  `).get(...params) as {
    total_runs: number | null;
    running_runs: number | null;
    waiting_approval_runs: number | null;
    paused_runs: number | null;
    completed_runs: number | null;
    failed_runs: number | null;
    cancelled_runs: number | null;
  };
  const statusRows = database.prepare(`
    SELECT status as value, COUNT(*) as count
    FROM runs
    ${whereClause}
    GROUP BY status
    ORDER BY count DESC, value ASC
  `).all(...params) as QueryFacet[];

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    aggregations: {
      totalRuns: aggregateStats?.total_runs ?? 0,
      runningRuns: aggregateStats?.running_runs ?? 0,
      waitingApprovalRuns: aggregateStats?.waiting_approval_runs ?? 0,
      pausedRuns: aggregateStats?.paused_runs ?? 0,
      completedRuns: aggregateStats?.completed_runs ?? 0,
      failedRuns: aggregateStats?.failed_runs ?? 0,
      cancelledRuns: aggregateStats?.cancelled_runs ?? 0,
      statuses: statusRows
    }
  };
}

export function updateRun(
  runId: string,
  patch: Partial<{
    status: RunStatus;
    finalResponse: string | null;
    error: string | null;
    waitingApprovalId: string | null;
    startedAt: number | null;
    completedAt: number | null;
  }>
) {
  const database = getDb();
  const current = getRunById(runId);
  if (!current) {
    return null;
  }

  const nextStatus = patch.status ?? current.status;
  const nextFinalResponse = patch.finalResponse === undefined ? current.finalResponse || null : patch.finalResponse;
  const nextError = patch.error === undefined ? current.error || null : patch.error;
  const nextWaitingApprovalId = patch.waitingApprovalId === undefined ? current.waitingApprovalId || null : patch.waitingApprovalId;
  const nextStartedAt = patch.startedAt === undefined ? current.startedAt || null : patch.startedAt;
  const nextCompletedAt = patch.completedAt === undefined ? current.completedAt || null : patch.completedAt;
  const updatedAt = Date.now();

  database.prepare(`
    UPDATE runs
    SET
      status = ?,
      final_response = ?,
      error = ?,
      waiting_approval_id = ?,
      started_at = ?,
      completed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    nextStatus,
    nextFinalResponse,
    nextError,
    nextWaitingApprovalId,
    nextStartedAt,
    nextCompletedAt,
    updatedAt,
    runId
  );

  database.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(updatedAt, current.sessionId);
  return getRunById(runId);
}

export function createRunStep(
  runId: string,
  type: RunStepType,
  title: string,
  options: {
    status?: RunStepStatus;
    input?: unknown;
    output?: unknown;
    error?: string;
    metadata?: Record<string, unknown>;
  } = {}
): RunStep {
  const database = getDb();
  const now = Date.now();
  const id = uuidv4();
  const stepIndex = getNextRunStepIndex(database, runId);
  database.prepare(`
    INSERT INTO run_steps (
      id, run_id, step_index, type, status, title, input, output, error, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    runId,
    stepIndex,
    type,
    options.status || 'pending',
    title,
    serializeJson(options.input),
    serializeJson(options.output),
    options.error || null,
    serializeJson(options.metadata),
    now,
    now
  );
  updateRun(runId, {});
  return getRunSteps(runId).find((step) => step.id === id)!;
}

export function updateRunStep(
  stepId: string,
  patch: Partial<{
    status: RunStepStatus;
    title: string;
    input: unknown;
    output: unknown;
    error: string | null;
    metadata: Record<string, unknown> | null;
  }>
) {
  const database = getDb();
  const current = database.prepare(`
    SELECT
      id,
      run_id,
      step_index,
      type,
      status,
      title,
      input,
      output,
      error,
      metadata,
      created_at,
      updated_at
    FROM run_steps
    WHERE id = ?
  `).get(stepId) as {
    id: string;
    run_id: string;
    step_index: number;
    type: RunStepType;
    status: RunStepStatus;
    title: string;
    input: string | null;
    output: string | null;
    error: string | null;
    metadata: string | null;
    created_at: number;
    updated_at: number;
  } | undefined;

  if (!current) {
    return null;
  }

  database.prepare(`
    UPDATE run_steps
    SET
      status = ?,
      title = ?,
      input = ?,
      output = ?,
      error = ?,
      metadata = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? current.status,
    patch.title ?? current.title,
    patch.input === undefined ? current.input : serializeJson(patch.input),
    patch.output === undefined ? current.output : serializeJson(patch.output),
    patch.error === undefined ? current.error : patch.error,
    patch.metadata === undefined ? current.metadata : serializeJson(patch.metadata),
    Date.now(),
    stepId
  );

  updateRun(current.run_id, {});
  return getRunSteps(current.run_id).find((step) => step.id === stepId) || null;
}

export function getRunSteps(runId: string): RunStep[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT
      id,
      run_id,
      step_index,
      type,
      status,
      title,
      input,
      output,
      error,
      metadata,
      created_at,
      updated_at
    FROM run_steps
    WHERE run_id = ?
    ORDER BY step_index ASC
  `).all(runId) as Array<{
    id: string;
    run_id: string;
    step_index: number;
    type: RunStepType;
    status: RunStepStatus;
    title: string;
    input: string | null;
    output: string | null;
    error: string | null;
    metadata: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map(mapRunStepRow);
}

export function getLatestRunSteps(sessionId: string): RunStep[] {
  const latestRun = getLatestRun(sessionId);
  if (!latestRun) {
    return [];
  }
  return getRunSteps(latestRun.id);
}

export function createToolCallRecord(runId: string, stepId: string | null, toolName: string, args: unknown) {
  const database = getDb();
  const now = Date.now();
  const id = uuidv4();
  database.prepare(`
    INSERT INTO tool_call_records (
      id, run_id, step_id, tool_name, args, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, runId, stepId, toolName, serializeJson(args), 'running', now, now);
  return id;
}

export function updateToolCallRecord(
  recordId: string,
  patch: Partial<{
    result: unknown;
    error: string | null;
    status: 'running' | 'waiting_approval' | 'success' | 'failed' | 'cancelled';
  }>
) {
  const database = getDb();
  const current = database.prepare(`
    SELECT result, error, status
    FROM tool_call_records
    WHERE id = ?
  `).get(recordId) as {
    result: string | null;
    error: string | null;
    status: string;
  } | undefined;

  if (!current) {
    return;
  }

  database.prepare(`
    UPDATE tool_call_records
    SET result = ?, error = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.result === undefined ? current.result : serializeJson(patch.result),
    patch.error === undefined ? current.error : patch.error,
    patch.status ?? current.status,
    Date.now(),
    recordId
  );
}

export function getToolCallRecords(runId: string): ToolCallRecord[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT
      id,
      run_id,
      step_id,
      tool_name,
      args,
      result,
      error,
      status,
      created_at,
      updated_at
    FROM tool_call_records
    WHERE run_id = ?
    ORDER BY created_at ASC, updated_at ASC
  `).all(runId) as Array<{
    id: string;
    run_id: string;
    step_id: string | null;
    tool_name: string;
    args: string | null;
    result: string | null;
    error: string | null;
    status: 'running' | 'waiting_approval' | 'success' | 'failed' | 'cancelled';
    created_at: number;
    updated_at: number;
  }>;

  return rows.map(mapToolCallRecordRow);
}

export function createApprovalRecord(args: {
  runId: string;
  stepId?: string;
  sessionId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): ApprovalRecord {
  const database = getDb();
  const now = Date.now();
  const id = uuidv4();
  database.prepare(`
    INSERT INTO approval_records (
      id, run_id, step_id, session_id, tool_name, args, status, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    args.runId,
    args.stepId || null,
    args.sessionId || null,
    args.toolName,
    serializeJson(args.toolArgs) || '{}',
    'pending',
    serializeJson(args.metadata),
    now,
    now
  );
  return getApprovalRecord(id)!;
}

export function getApprovalRecord(approvalId: string): ApprovalRecord | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT
      id,
      run_id,
      step_id,
      session_id,
      tool_name,
      args,
      status,
      metadata,
      created_at,
      updated_at,
      resolved_at
    FROM approval_records
    WHERE id = ?
  `).get(approvalId) as {
    id: string;
    run_id: string;
    step_id: string | null;
    session_id: string | null;
    tool_name: string;
    args: string;
    status: 'pending' | 'approved' | 'denied';
    metadata: string | null;
    created_at: number;
    updated_at: number;
    resolved_at: number | null;
  } | undefined;

  return row ? mapApprovalRowToRecord(row) : null;
}

export function resolveApprovalRecord(approvalId: string, approved: boolean) {
  const database = getDb();
  const now = Date.now();
  database.prepare(`
    UPDATE approval_records
    SET status = ?, updated_at = ?, resolved_at = ?
    WHERE id = ?
  `).run(approved ? 'approved' : 'denied', now, now, approvalId);
  return getApprovalRecord(approvalId);
}

export function getPendingApproval(sessionId?: string): ApprovalRecord | null {
  const database = getDb();
  const row = sessionId
    ? database.prepare(`
        SELECT
          id,
          run_id,
          step_id,
          session_id,
          tool_name,
          args,
          status,
          metadata,
          created_at,
          updated_at,
          resolved_at
        FROM approval_records
        WHERE session_id = ? AND status = 'pending'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `).get(sessionId)
    : database.prepare(`
        SELECT
          id,
          run_id,
          step_id,
          session_id,
          tool_name,
          args,
          status,
          metadata,
          created_at,
          updated_at,
          resolved_at
        FROM approval_records
        WHERE status = 'pending'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `).get();

  return row
    ? mapApprovalRowToRecord(row as {
        id: string;
        run_id: string;
        step_id: string | null;
        session_id: string | null;
        tool_name: string;
        args: string;
        status: 'pending' | 'approved' | 'denied';
        metadata: string | null;
        created_at: number;
        updated_at: number;
        resolved_at: number | null;
      })
    : null;
}

export function getApprovalRecords(runId: string): ApprovalRecord[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT
      id,
      run_id,
      step_id,
      session_id,
      tool_name,
      args,
      status,
      metadata,
      created_at,
      updated_at,
      resolved_at
    FROM approval_records
    WHERE run_id = ?
    ORDER BY created_at ASC, updated_at ASC
  `).all(runId) as Array<{
    id: string;
    run_id: string;
    step_id: string | null;
    session_id: string | null;
    tool_name: string;
    args: string;
    status: 'pending' | 'approved' | 'denied';
    metadata: string | null;
    created_at: number;
    updated_at: number;
    resolved_at: number | null;
  }>;

  return rows.map(mapApprovalRowToRecord);
}

export function getRunTrace(query: RunTraceQuery | string): RunTrace | null {
  const normalizedQuery = normalizeRunTraceQuery(query);
  const { runId, page, pageSize, includeToolCalls, includeApprovalRecords, includeAuditLogs, includeContextSummary } = normalizedQuery;
  const run = getRunById(runId);
  if (!run) {
    return null;
  }

  const allSteps = getRunSteps(runId);
  const pagination = paginateRunSteps(allSteps, page, pageSize);
  const toolCalls = includeToolCalls ? getToolCallRecords(runId) : [];
  const approvals = includeApprovalRecords ? getApprovalRecords(runId) : [];
  const auditLogs = includeAuditLogs
    ? queryAuditLogs({ runId, page: 1, pageSize: 1000 }).items.sort((left, right) => left.timestamp - right.timestamp)
    : [];
  const aggregations: RunTraceAggregations = buildRunTraceAggregations(allSteps, toolCalls, approvals, auditLogs);

  return {
    run,
    steps: pagination.steps,
    total: pagination.total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
    aggregations,
    toolCalls,
    approvals,
    auditLogs,
    latestContextSummary: includeContextSummary ? getLatestRunContextSummary(runId) : null
  };
}

export function saveContextSnapshot(runId: string, snapshot: unknown, stepId?: string) {
  const database = getDb();
  database.prepare(`
    INSERT INTO context_snapshots (id, run_id, step_id, snapshot, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), runId, stepId || null, serializeJson(snapshot) || '{}', Date.now());
}

export function getLatestContextSnapshot<T>(runId: string): T | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT snapshot
    FROM context_snapshots
    WHERE run_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(runId) as { snapshot: string } | undefined;

  return row ? parseJsonValue<T>(row.snapshot) || null : null;
}

export function getLatestContextSnapshotByStep<T>(runId: string, stepId: string): T | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT snapshot
    FROM context_snapshots
    WHERE run_id = ? AND step_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(runId, stepId) as { snapshot: string } | undefined;

  return row ? parseJsonValue<T>(row.snapshot) || null : null;
}

export function saveRunContextSummary(
  runId: string,
  summary: Omit<RunContextSummary, 'id' | 'runId' | 'sessionId' | 'stepId' | 'createdAt'>,
  stepId?: string
) {
  const database = getDb();
  const run = getRunById(runId);
  database.prepare(`
    INSERT INTO context_summaries (id, run_id, session_id, step_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    runId,
    run?.sessionId || null,
    stepId || null,
    serializeJson(summary) || '{}',
    Date.now()
  );
}

export function getLatestRunContextSummary(runId: string): RunContextSummary | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT id, run_id, session_id, step_id, summary, created_at
    FROM context_summaries
    WHERE run_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(runId) as {
    id: string;
    run_id: string;
    session_id: string | null;
    step_id: string | null;
    summary: string;
    created_at: number;
  } | undefined;

  return row ? mapContextSummaryRow(row) : null;
}

export function getLatestSessionContextSummary(sessionId: string): RunContextSummary | null {
  const database = getDb();
  const row = database.prepare(`
    SELECT id, run_id, session_id, step_id, summary, created_at
    FROM context_summaries
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as {
    id: string;
    run_id: string;
    session_id: string | null;
    step_id: string | null;
    summary: string;
    created_at: number;
  } | undefined;

  return row ? mapContextSummaryRow(row) : null;
}

export function getRecentSessionContextSummaries(sessionId: string, limit = 3, excludeRunId?: string): RunContextSummary[] {
  const database = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 10));
  const rows = excludeRunId
    ? database.prepare(`
        SELECT id, run_id, session_id, step_id, summary, created_at
        FROM context_summaries
        WHERE session_id = ? AND run_id != ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(sessionId, excludeRunId, safeLimit)
    : database.prepare(`
        SELECT id, run_id, session_id, step_id, summary, created_at
        FROM context_summaries
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(sessionId, safeLimit);

  return (rows as Array<{
    id: string;
    run_id: string;
    session_id: string | null;
    step_id: string | null;
    summary: string;
    created_at: number;
  }>)
    .map((row) => mapContextSummaryRow(row))
    .filter((summary): summary is RunContextSummary => Boolean(summary));
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
