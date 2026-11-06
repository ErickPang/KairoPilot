import type { MessagePageQuery, SessionListPage, SessionListQuery, SessionMessagePage, SessionSummary } from '../../shared/contracts';
import type { ChatMessage } from '../core/llm/types';
import { getDb } from './chat';
import { mapSessionRowToSummary, SESSION_TITLE_PREVIEW_SQL } from './chatStoreUtils';
import { mapMessageRowToChatMessage, isVisibleSessionMessage } from './chatMessageUtils';

const summarySelect = `SELECT sessions.*, ${SESSION_TITLE_PREVIEW_SQL} AS first_user_content, (SELECT status FROM runs WHERE session_id = sessions.id ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1) AS run_status FROM sessions`;
type SummaryRow = Parameters<typeof mapSessionRowToSummary>[0];

export function getOwnedSessionSummary(agentId: string | undefined, sessionId: string): SessionSummary | null {
  const row = getDb().prepare(`${summarySelect} WHERE sessions.id = ?${agentId ? ' AND sessions.agent_id = ?' : ''}`).get(...(agentId ? [sessionId, agentId] : [sessionId])) as SummaryRow | undefined;
  return row ? mapSessionRowToSummary(row) : null;
}

export function getActiveSessionSummary(agentId: string | undefined): SessionSummary | null {
  const selected = getDb().prepare('SELECT value FROM app_state WHERE key = ?').get(`active_session_id:${agentId || 'workbench'}`) as { value: string } | undefined;
  if (selected) {
    const summary = getOwnedSessionSummary(agentId, selected.value);
    if (summary) return summary;
  }
  const latest = getDb().prepare(`${summarySelect} ${agentId ? 'WHERE agent_id = ?' : ''} ORDER BY updated_at DESC, id DESC LIMIT 1`).get(...(agentId ? [agentId] : [])) as SummaryRow | undefined;
  return latest ? mapSessionRowToSummary(latest) : null;
}

export function querySessionPage(agentId: string | undefined, query: SessionListQuery): SessionListPage {
  const where = [agentId ? 'agent_id = ?' : '1=1']; const values: unknown[] = agentId ? [agentId] : [];
  if (query.projectId === null) where.push('project_id IS NULL');
  else if (query.projectId !== undefined) { where.push('project_id = ?'); values.push(query.projectId); }
  if (query.filter === 'archived') where.push('archived_at IS NOT NULL');
  else if (query.filter === 'open' || query.filter === 'unread') where.push('archived_at IS NULL');
  if (query.filter === 'unread') where.push('activity_version > read_version');
  if (query.search?.trim()) {
    where.push("COALESCE(" + SESSION_TITLE_PREVIEW_SQL + ", title) LIKE ? ESCAPE '\\'");
    values.push(`%${query.search.trim().replace(/[\\%_]/g, (value) => `\\${value}`)}%`);
  }
  const condition = where.join(' AND ');
  const total = (getDb().prepare(`SELECT COUNT(*) AS count FROM sessions WHERE ${condition}`).get(...values) as { count: number }).count;
  if (query.before) {
    where.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
    values.push(query.before.updatedAt, query.before.updatedAt, query.before.id);
  }
  const limit = Math.min(100, Math.max(1, query.limit || 50));
  const rows = getDb().prepare(`${summarySelect} WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...values, limit + 1) as SummaryRow[];
  const items = rows.slice(0, limit).map(mapSessionRowToSummary);
  const last = items[items.length - 1];
  return { items, total, ...(rows.length > limit && last ? { nextCursor: { updatedAt: last.updatedAt, id: last.id } } : {}), ...(query.includeSessionId || query.includeActiveSession ? { selectedSession: (query.includeSessionId ? getOwnedSessionSummary(agentId, query.includeSessionId) : getActiveSessionSummary(agentId)) || undefined } : {}) };
}

export function getSessionMessagePage(agentId: string | undefined, query: MessagePageQuery): SessionMessagePage<ChatMessage> {
  const session = getOwnedSessionSummary(agentId, query.sessionId);
  if (!session) throw new Error('Task does not belong to the active agent.');
  const generation = (getDb().prepare('SELECT message_generation FROM sessions WHERE id = ?').get(session.id) as { message_generation: number }).message_generation;
  if (query.before && query.before.generation !== generation) throw new Error('HISTORY_CHANGED: Reload the message history before continuing.');
  const total = (getDb().prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get(session.id) as { count: number }).count;
  const values: unknown[] = [session.id];
  let before = '';
  if (query.before) { before = ' AND (timestamp < ? OR (timestamp = ? AND rowid < ?))'; values.push(query.before.timestamp, query.before.timestamp, query.before.rowId); }
  const limit = Math.min(100, Math.max(1, query.limit || 100));
  const rows = getDb().prepare(`SELECT id, rowid AS rowId, role, content, timestamp, name, tool_call_id, tool_calls, attachments, context_refs, usage, model FROM messages WHERE session_id = ?${before} ORDER BY timestamp DESC, rowid DESC LIMIT ?`).all(...values, limit + 1) as Array<Parameters<typeof mapMessageRowToChatMessage>[0] & { id: string; rowId: number }>;
  const visible = rows.slice(0, limit); const oldest = visible[visible.length - 1];
  return { session, total, generation, messages: [...visible].reverse().filter(isVisibleSessionMessage).map(mapMessageRowToChatMessage), ...(rows.length > limit && oldest ? { nextCursor: { timestamp: oldest.timestamp, rowId: oldest.rowId, generation } } : {}) };
}
