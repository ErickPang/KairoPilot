import type Database from 'better-sqlite3';
import type { ChatMessage } from '../core/llm/types';
import { v4 as uuidv4 } from 'uuid';
import Store from 'electron-store';

interface LegacySession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
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

function initTables(database: Database.Database) {
  database.exec(`
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
      name TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      usage TEXT,
      model TEXT,
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

function ensureMessageColumn(database: Database.Database, columnName: string, definition: string) {
  const columns = database.pragma('table_info(messages)') as { name: string }[];
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE messages ADD COLUMN ${definition};`);
}

function migrateFromElectronStore(database: Database.Database, defaultAgentId: string) {
  const migrationKey = 'migration_v1_completed';
  const row = database.prepare('SELECT value FROM app_state WHERE key = ?').get(migrationKey) as { value: string } | undefined;

  if (row) {
    return;
  }

  try {
    const oldStore = new Store({ name: 'chat-history' });
    const oldSessions = oldStore.get('sessions', []) as LegacySession[];
    const activeSessionId = oldStore.get('activeSessionId') as string | null;

    if (oldSessions.length > 0) {
      const insertSession = database.prepare(
        'INSERT INTO sessions (id, title, agent_id, created_at, updated_at) VALUES (@id, @title, @agentId, @createdAt, @updatedAt)'
      );
      const insertMessage = database.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, name, tool_call_id, tool_calls, usage, model) VALUES (@id, @sessionId, @role, @content, @timestamp, @name, @toolCallId, @toolCalls, @usage, @model)');

      const transaction = database.transaction(() => {
        for (const session of oldSessions) {
          insertSession.run({
            id: session.id,
            title: session.title,
            agentId: defaultAgentId,
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
          database.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run('active_session_id', activeSessionId);
        }
      });

      transaction();
      console.log(`[DB] Migrated ${oldSessions.length} sessions from JSON store.`);
    }

    database.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run(migrationKey, 'true');
  } catch (error) {
    console.error('[DB] Migration failed:', error);
  }
}

function migrateLegacyActiveSessionState(
  database: Database.Database,
  defaultAgentId: string,
  getActiveSessionStateKey: (agentId?: string | null) => string
) {
  try {
    const legacyRow = database.prepare('SELECT value FROM app_state WHERE key = ?').get('active_session_id') as { value: string } | undefined;
    if (!legacyRow?.value) {
      return;
    }

    const scopedKey = getActiveSessionStateKey(defaultAgentId);
    const scopedRow = database.prepare('SELECT value FROM app_state WHERE key = ?').get(scopedKey) as { value: string } | undefined;
    if (!scopedRow) {
      database.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(scopedKey, legacyRow.value);
    }
  } catch (error) {
    console.error('[DB] Failed to migrate legacy active session state:', error);
  }
}

export function initializeChatDatabase(
  database: Database.Database,
  options: {
    defaultAgentId: string;
    getActiveSessionStateKey: (agentId?: string | null) => string;
  }
) {
  initTables(database);
  ensureIndexes(database);

  try {
    const columns = database.pragma('table_info(sessions)') as { name: string }[];
    const hasAgentId = columns.some(col => col.name === 'agent_id');
    if (!hasAgentId) {
      database.prepare('ALTER TABLE sessions ADD COLUMN agent_id TEXT').run();
    }
    database.prepare("UPDATE sessions SET agent_id = 'mainAgent' WHERE agent_id IS NULL").run();
  } catch (error) {
    console.error('Failed to migrate sessions table:', error);
  }

  try {
    ensureMessageColumn(database, 'name', 'name TEXT');
    ensureMessageColumn(database, 'tool_call_id', 'tool_call_id TEXT');
    ensureMessageColumn(database, 'tool_calls', 'tool_calls TEXT');
    ensureMessageColumn(database, 'usage', 'usage TEXT');
    ensureMessageColumn(database, 'model', 'model TEXT');
  } catch (error) {
    console.error('Failed to migrate messages table:', error);
  }

  migrateFromElectronStore(database, options.defaultAgentId);
  database.prepare('UPDATE sessions SET agent_id = ? WHERE agent_id IS NULL').run(options.defaultAgentId);
  migrateLegacyActiveSessionState(database, options.defaultAgentId, options.getActiveSessionStateKey);
}
