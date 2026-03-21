import { ChatMessage } from '../core/llm/types';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import Store from 'electron-store'; // Only for migration

export interface Session {
  id: string;
  title: string;
  agentId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

let db: Database.Database | null = null;

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
    } catch (error) {
      console.error('Failed to migrate messages table:', error);
    }

    migrateFromElectronStore(db);
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
      const insertMessage = db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, name, tool_call_id, tool_calls, usage) VALUES (@id, @sessionId, @role, @content, @timestamp, @name, @toolCallId, @toolCalls, @usage)');

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
              usage: msg.usage ? JSON.stringify(msg.usage) : null
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

// --- Public API ---

export function getSessions(agentId?: string): Session[] {
  const db = getDb();
  let query = 'SELECT id, title, agent_id, created_at, updated_at FROM sessions';
  const params: unknown[] = [];
  
  if (agentId) {
    query += ' WHERE agent_id = ?';
    params.push(agentId);
  }
  
  query += ' ORDER BY updated_at DESC';
  
  const sessions = db.prepare(query).all(...params) as { id: string; title: string; agent_id: string; created_at: number; updated_at: number }[];
  
  return sessions.map(s => {
    const messages = db.prepare('SELECT role, content, timestamp, name, tool_call_id, tool_calls, usage FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(s.id) as { role: ChatMessage['role']; content: string; timestamp: number; name?: string; tool_call_id?: string; tool_calls?: string; usage?: string }[];
    return {
      id: s.id,
      title: s.title,
      agentId: s.agent_id,
      messages: messages.map(m => {
        const msg: ChatMessage = {
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        };
        if (m.name) msg.name = m.name;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.tool_calls) {
          try {
            msg.tool_calls = JSON.parse(m.tool_calls);
          } catch (e) {
            console.warn('[DB] Failed to parse tool_calls:', e);
          }
        }
        if (m.usage) {
          try {
            msg.usage = JSON.parse(m.usage);
          } catch (e) {
            console.warn('[DB] Failed to parse usage:', e);
          }
        }
        return msg;
      }),
      createdAt: s.created_at,
      updatedAt: s.updated_at
    };
  });
}

export function createSession(title: string = 'New Chat', agentId?: string): Session {
  const db = getDb();
  const newSession: Session = {
    id: uuidv4(),
    title,
    agentId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  db.prepare('INSERT INTO sessions (id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    newSession.id, newSession.title, newSession.agentId || null, newSession.createdAt, newSession.updatedAt
  );
  
  setActiveSessionId(newSession.id);
  return newSession;
}

export function getActiveSession(): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('active_session_id') as { value: string } | undefined;
  if (!row) return null;
  
  return getSessionById(row.value);
}

export function getSessionById(sessionId: string): Session | null {
  const db = getDb();
  const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as { id: string; title: string; agent_id: string; created_at: number; updated_at: number } | undefined;
  if (!sessionRow) return null;

  const messages = db.prepare('SELECT role, content, timestamp, name, tool_call_id, tool_calls, usage FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as { role: ChatMessage['role']; content: string; timestamp: number; name?: string; tool_call_id?: string; tool_calls?: string; usage?: string }[];

  return {
    id: sessionRow.id,
    title: sessionRow.title,
    createdAt: sessionRow.created_at,
    updatedAt: sessionRow.updated_at,
    messages: messages.map(m => {
      const msg: ChatMessage = {
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) {
        try {
          msg.tool_calls = JSON.parse(m.tool_calls);
        } catch (e) {
          // Ignore parse errors
        }
      }
      if (m.usage) {
        try {
          msg.usage = JSON.parse(m.usage);
        } catch (e) {
          // Ignore parse errors
        }
      }
      return msg;
    })
  };
}

export function setActiveSessionId(sessionId: string | null) {
  const db = getDb();
  if (sessionId) {
    db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run('active_session_id', sessionId);
  } else {
    db.prepare('DELETE FROM app_state WHERE key = ?').run('active_session_id');
  }
}

export function updateSessionMessages(sessionId: string, messages: ChatMessage[]) {
  const db = getDb();
  
  const transaction = db.transaction(() => {
    // 1. Update session timestamp
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);

    // 2. Sync messages (Full replace strategy for simplicity, or diffing?)
    // Full replace is safer for consistency but slower.
    // Given the previous implementation was full JSON replace, this is still better/same.
    // Optimization: Delete all and re-insert is the easiest way to handle edits/deletes in chat.
    
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    
    const insert = db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, name, tool_call_id, tool_calls, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const msg of messages) {
      insert.run(
        uuidv4(), 
        sessionId, 
        msg.role, 
        msg.content || '', 
        msg.timestamp || Date.now(),
        msg.name || null,
        msg.tool_call_id || null,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.usage ? JSON.stringify(msg.usage) : null
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
    // Cascade delete handles messages, but we need to check active session
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    
    const activeRow = db.prepare('SELECT value FROM app_state WHERE key = ?').get('active_session_id') as { value: string } | undefined;
    if (activeRow && activeRow.value === sessionId) {
      // Switch to another session or null
      const nextSession = db.prepare('SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1').get() as { id: string } | undefined;
      if (nextSession) {
        db.prepare('UPDATE app_state SET value = ? WHERE key = ?').run(nextSession.id, 'active_session_id');
      } else {
        db.prepare('DELETE FROM app_state WHERE key = ?').run('active_session_id');
      }
    }
  });
  
  transaction();
}

export function clearAllSessions() {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM sessions').run(); // Cascade deletes messages
    db.prepare('DELETE FROM app_state WHERE key = ?').run('active_session_id');
  });
  transaction();
}

export interface AgentStats {
  agentId: string;
  totalSessions: number;
  totalMessages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function getAgentStats(): AgentStats[] {
  const db = getDb();
  const sessions = db.prepare('SELECT id, agent_id FROM sessions').all() as {id: string, agent_id: string}[];
  const messages = db.prepare('SELECT session_id, role, usage FROM messages').all() as {session_id: string, role: string, usage: string | null}[];

  const statsMap = new Map<string, AgentStats>();

  for (const session of sessions) {
    const agentId = session.agent_id || 'mainAgent';
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
    const session = sessions.find(s => s.id === msg.session_id);
    if (session) {
      const agentId = session.agent_id || 'mainAgent';
      const stat = statsMap.get(agentId);
      if (stat) {
        stat.totalMessages += 1;
        if (msg.usage) {
          try {
            const usage = JSON.parse(msg.usage);
            stat.promptTokens += usage.prompt_tokens || 0;
            stat.completionTokens += usage.completion_tokens || 0;
            stat.totalTokens += usage.total_tokens || 0;
          } catch (e) {
            // ignore
          }
        }
      }
    }
  }

  return Array.from(statsMap.values());
}
