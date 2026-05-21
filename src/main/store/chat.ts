import { ChatMessage } from '../core/llm/types';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import { getAgents } from './config';
import { queryAuditLogs } from './audit';
import { buildRunTraceAggregations, normalizeRunTraceQuery, paginateRunSteps } from './chat_trace_utils';
import { initializeChatDatabase } from './chatDb';
import {
  isVisibleSessionMessage,
  mapMessageRowToChatMessage,
  serializeJson
} from './chatMessageUtils';
import { buildAgentStats, mapMonitoringRows } from './chatAnalyticsUtils';
import {
  deleteSessionAttachmentFiles,
  deleteWorkspaceAttachmentUploads,
  getAttachmentById,
  prepareChatAttachments
} from './attachments';
import {
  buildMonitoringWhereClause,
  buildRunQueryWhere,
  buildTokenMetricFacets,
  getSharedMessagePrefixLength,
  mapApprovalRowToRecord,
  mapContextSummaryRow,
  mapRunRowToSummary,
  mapRunStepRow,
  mapSessionRowToSummary,
  mapToolCallRecordRow,
  parseJsonValue
} from './chatStoreUtils';
import type {
  AgentStats,
  ApprovalRecord,
  ChatAttachment,
  MonitoringTokenQuery,
  MonitoringTokenQueryResult,
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

function getAgentWorkspaceById(agentId?: string | null) {
  const normalizedAgentId = normalizeAgentId(agentId);
  return getAgents().find((agent) => normalizeAgentId(agent.id) === normalizedAgentId)?.workspace || null;
}

function getAllAgentWorkspaces() {
  return [...new Set(getAgents()
    .map((agent) => agent.workspace)
    .filter((workspace): workspace is string => typeof workspace === 'string' && workspace.trim().length > 0))];
}

function cleanupSessionAttachments(workspace: string | null, sessionIds: string[]) {
  if (!workspace || sessionIds.length === 0) {
    return;
  }

  void Promise.all(sessionIds.map((sessionId) => deleteSessionAttachmentFiles(workspace, sessionId)))
    .catch((error) => {
      console.warn('[DB] Failed to cleanup session attachment files:', error);
    });
}

function cleanupWorkspaceAttachments(workspaces: string[]) {
  if (workspaces.length === 0) {
    return;
  }

  void Promise.all(workspaces.map((workspace) => deleteWorkspaceAttachmentUploads(workspace)))
    .catch((error) => {
      console.warn('[DB] Failed to cleanup workspace attachment files:', error);
    });
}


function insertMessageAttachments(
  database: Database.Database,
  sessionId: string,
  messageId: string,
  attachments: ChatAttachment[] | undefined
) {
  if (!attachments || attachments.length === 0) {
    return;
  }

  const insertAttachment = database.prepare(`
    INSERT OR REPLACE INTO message_attachments (
      id,
      session_id,
      message_id,
      name,
      mime_type,
      size,
      kind,
      original_path,
      stored_path,
      content_hash,
      preview_uri,
      extracted_text,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const attachment of attachments) {
    insertAttachment.run(
      attachment.id,
      sessionId,
      messageId,
      attachment.name,
      attachment.mimeType,
      attachment.size,
      attachment.kind,
      attachment.originalPath || null,
      attachment.storedPath,
      attachment.contentHash,
      attachment.previewUri || null,
      attachment.extractedText || null,
      attachment.createdAt
    );
  }
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
    initializeChatDatabase(db, {
      defaultAgentId: DEFAULT_AGENT_ID,
      getActiveSessionStateKey
    });
  }
  return db;
}

export function getSessionAttachmentById(attachmentId: string, sessionId?: string | null) {
  return getAttachmentById(getDb(), attachmentId, sessionId);
}

function extractLegacyAttachmentPaths(content: string) {
  const paths: string[] = [];
  const contextFileRegex = /^Context file:\s*(.+)$/gm;
  let contextMatch: RegExpExecArray | null;
  while ((contextMatch = contextFileRegex.exec(content)) !== null) {
    const candidate = contextMatch[1]?.trim();
    if (candidate) {
      paths.push(candidate.replace(/^file:\/\//, ''));
    }
  }

  const markdownImageRegex = /!\[[^\]]*\]\((kairopilot:\/\/[^)]+|file:\/\/[^)]+|\/[^)\s]+)\)/g;
  let imageMatch: RegExpExecArray | null;
  while ((imageMatch = markdownImageRegex.exec(content)) !== null) {
    const raw = imageMatch[1]?.trim();
    if (!raw) {
      continue;
    }
    if (raw.startsWith('kairopilot://')) {
      paths.push(decodeURIComponent(raw.slice('kairopilot://'.length)));
    } else if (raw.startsWith('file://')) {
      paths.push(decodeURIComponent(raw.slice('file://'.length)));
    } else {
      paths.push(raw);
    }
  }

  return [...new Set(paths)].filter((item) => path.isAbsolute(item) && fs.existsSync(item));
}

async function migrateLegacyMessageAttachments(params: {
  database: Database.Database;
  sessionId: string;
  messageId: string;
  workspace: string;
  content: string;
}) {
  const legacyPaths = extractLegacyAttachmentPaths(params.content);
  if (legacyPaths.length === 0) {
    return [];
  }

  const attachments = await prepareChatAttachments({
    sessionId: params.sessionId,
    workspace: params.workspace,
    files: legacyPaths.map((legacyPath) => ({ path: legacyPath }))
  });
  insertMessageAttachments(params.database, params.sessionId, params.messageId, attachments);
  params.database.prepare('UPDATE messages SET attachments = ? WHERE id = ?').run(JSON.stringify(attachments), params.messageId);
  return attachments;
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

  const messages = db.prepare('SELECT role, content, timestamp, name, tool_call_id, tool_calls, attachments, usage, model FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as { role: ChatMessage['role']; content: string; timestamp: number; name?: string; tool_call_id?: string; tool_calls?: string; attachments?: string; usage?: string; model?: string }[];

  return {
    ...mapSessionRowToSummary(sessionRow),
    messages: messages
      .filter((message) => isVisibleSessionMessage(message))
      .map(mapMessageRowToChatMessage)
  };
}

export async function migrateLegacyAttachmentsForSession(sessionId: string, workspace: string) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, content, attachments
    FROM messages
    WHERE session_id = ? AND role = 'user'
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{ id: string; content: string; attachments?: string | null }>;

  let migrated = 0;
  for (const row of rows) {
    if (row.attachments && row.attachments.trim() && row.attachments.trim() !== '[]') {
      continue;
    }
    const attachments = await migrateLegacyMessageAttachments({
      database: db,
      sessionId,
      messageId: row.id,
      workspace,
      content: row.content || ''
    });
    migrated += attachments.length;
  }
  return migrated;
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
  const visibleMessages = messages.filter((message) => isVisibleSessionMessage(message));
  
  const transaction = db.transaction(() => {
    const now = Date.now();
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

    const existingRows = db.prepare(
      'SELECT role, content, timestamp, name, tool_call_id, tool_calls, attachments, usage, model FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId) as Array<{
      role: ChatMessage['role'];
      content: string;
      timestamp: number;
      name?: string;
      tool_call_id?: string;
      tool_calls?: string;
      attachments?: string;
      usage?: string;
      model?: string;
    }>;
    const existingMessages = existingRows.map(mapMessageRowToChatMessage);
    const sharedPrefixLength = getSharedMessagePrefixLength(existingMessages, visibleMessages);
    const insert = db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, name, tool_call_id, tool_calls, attachments, usage, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    if (sharedPrefixLength === existingMessages.length && visibleMessages.length >= existingMessages.length) {
      for (const msg of visibleMessages.slice(sharedPrefixLength)) {
        const messageId = uuidv4();
        insert.run(
          messageId,
          sessionId,
          msg.role,
          msg.content || '',
          msg.timestamp || now,
          msg.name || null,
          msg.tool_call_id || null,
          msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
          msg.attachments ? JSON.stringify(msg.attachments) : null,
          msg.usage ? JSON.stringify(msg.usage) : null,
          msg.model || null
        );
        insertMessageAttachments(db, sessionId, messageId, msg.attachments);
      }
      return;
    }

    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM message_attachments WHERE session_id = ?').run(sessionId);

    for (const msg of visibleMessages) {
      const messageId = uuidv4();
      insert.run(
        messageId, 
        sessionId, 
        msg.role, 
        msg.content || '',
        msg.timestamp || now,
        msg.name || null,
        msg.tool_call_id || null,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.attachments ? JSON.stringify(msg.attachments) : null,
        msg.usage ? JSON.stringify(msg.usage) : null,
        msg.model || null
      );
      insertMessageAttachments(db, sessionId, messageId, msg.attachments);
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
  let attachmentWorkspace: string | null = null;
  const transaction = db.transaction(() => {
    const sessionRow = db.prepare('SELECT agent_id FROM sessions WHERE id = ?').get(sessionId) as { agent_id: string | null } | undefined;
    const sessionAgentId = normalizeAgentId(sessionRow?.agent_id);
    const stateKey = getActiveSessionStateKey(sessionAgentId);
    attachmentWorkspace = getAgentWorkspaceById(sessionAgentId);

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
  cleanupSessionAttachments(attachmentWorkspace, [sessionId]);
}

export function deleteSessionsByAgent(agentId: string) {
  const db = getDb();
  const normalizedAgentId = normalizeAgentId(agentId);
  const stateKey = getActiveSessionStateKey(normalizedAgentId);
  const sessionRows = db.prepare('SELECT id FROM sessions WHERE agent_id = ?').all(normalizedAgentId) as Array<{ id: string }>;
  const sessionIds = sessionRows.map((row) => row.id);
  const attachmentWorkspace = getAgentWorkspaceById(normalizedAgentId);

  const transaction = db.transaction(() => {
    const deleteMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    for (const sessionId of sessionIds) {
      deleteMessages.run(sessionId);
    }
    db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(normalizedAgentId);
    db.prepare('DELETE FROM app_state WHERE key = ?').run(stateKey);
  });

  transaction();
  cleanupSessionAttachments(attachmentWorkspace, sessionIds);
  return sessionIds;
}

export function clearAllSessions() {
  const db = getDb();
  const attachmentWorkspaces = getAllAgentWorkspaces();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM sessions').run(); // Cascade deletes messages
    db.prepare("DELETE FROM app_state WHERE key LIKE 'active_session_id:%'").run();
    db.prepare('DELETE FROM app_state WHERE key = ?').run('active_session_id');
  });
  transaction();
  cleanupWorkspaceAttachments(attachmentWorkspaces);
}

export function getAgentStats(): AgentStats[] {
  const db = getDb();
  const sessions = db.prepare('SELECT id, agent_id FROM sessions').all() as {id: string, agent_id: string}[];
  const messages = db.prepare('SELECT session_id, role, content, usage, tool_calls FROM messages').all() as {
    session_id: string,
    role: ChatMessage['role'],
    content: string,
    usage: string | null,
    tool_calls: string | null
  }[];
  const runs = db.prepare('SELECT id, agent_id, status FROM runs').all() as {id: string, agent_id: string, status: RunStatus}[];
  const approvals = db.prepare('SELECT run_id, status FROM approval_records').all() as {run_id: string, status: ApprovalRecord['status']}[];
  const toolCalls = db.prepare('SELECT run_id, status FROM tool_call_records').all() as {
    run_id: string,
    status: ToolCallRecord['status']
  }[];
  return buildAgentStats({
    defaultAgentId: DEFAULT_AGENT_ID,
    sessions,
    messages,
    runs,
    approvals,
    toolCalls
  });
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

function touchRunActivity(runId: string, updatedAt: number = Date.now()) {
  const current = getRunById(runId);
  if (!current) {
    return;
  }

  const database = getDb();
  database.prepare('UPDATE runs SET updated_at = ? WHERE id = ?').run(updatedAt, runId);
  database.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(updatedAt, current.sessionId);
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
  touchRunActivity(runId, now);
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
    SELECT run_id, result, error, status
    FROM tool_call_records
    WHERE id = ?
  `).get(recordId) as {
    run_id: string;
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

  if (current.run_id) {
    touchRunActivity(current.run_id);
  }
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
  touchRunActivity(args.runId, now);
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
  const runRow = database.prepare('SELECT run_id FROM approval_records WHERE id = ?').get(approvalId) as { run_id: string } | undefined;
  database.prepare(`
    UPDATE approval_records
    SET status = ?, updated_at = ?, resolved_at = ?
    WHERE id = ?
  `).run(approved ? 'approved' : 'denied', now, now, approvalId);
  if (runRow?.run_id) {
    touchRunActivity(runRow.run_id, now);
  }
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
        ORDER BY updated_at DESC, created_at DESC, rowid DESC
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
        ORDER BY updated_at DESC, created_at DESC, rowid DESC
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
  const now = Date.now();
  database.prepare(`
    INSERT INTO context_snapshots (id, run_id, step_id, snapshot, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), runId, stepId || null, serializeJson(snapshot) || '{}', now);
  touchRunActivity(runId, now);
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
  const now = Date.now();
  database.prepare(`
    INSERT INTO context_summaries (id, run_id, session_id, step_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    runId,
    run?.sessionId || null,
    stepId || null,
    serializeJson(summary) || '{}',
    now
  );
  touchRunActivity(runId, now);
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
      messages.tool_calls,
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
    tool_calls: string | null;
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
    tool_calls: string | null;
    model: string | null;
  }>;
  const agentModelMap = new Map(getAgents().map((agent) => [agent.id, agent.model || '']));
  const items = mapMonitoringRows(rows, (agentId) => agentModelMap.get(agentId));
  const aggregateItems = mapMonitoringRows(aggregateRows, (agentId) => agentModelMap.get(agentId));
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
