import { describeConversationTool, conversationToolOutput } from '../../shared/conversationActivity';
import type { ChatAttachment, ContextReference, ConversationItem, ConversationPage, RuntimeUpdateEvent } from '../../shared/contracts';
import { getDb, getRunById } from './chat';
import { getOwnedSessionSummary } from './taskPages';

function put(runId: string, key: string, kind: ConversationItem['kind'], content: string, status: string, details?: unknown, metadata?: unknown) {
  const db = getDb();
  const id = `${runId}:${key}`;
  db.prepare(`INSERT INTO conversation_items(id,run_id,sequence,kind,content,status,details,metadata)
    VALUES(?,?,COALESCE((SELECT MAX(sequence)+1 FROM conversation_items WHERE run_id=?),0),?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,content=excluded.content,status=excluded.status,
    details=COALESCE(excluded.details,details),metadata=COALESCE(excluded.metadata,metadata)`)
    .run(id, runId, runId, kind, content, status, details === undefined ? null : JSON.stringify(details), metadata === undefined ? null : JSON.stringify(metadata));
}
export function setConversationUser(runId: string, content: string, attachments?: ChatAttachment[], references?: ContextReference[]) {
  put(runId, 'user', 'user', content, 'completed', undefined, { attachments, references });
}
export function recordConversationUpdate(update: RuntimeUpdateEvent) {
  const run = getRunById(update.runId);
  if (!run) return;
  const db = getDb();
  if (!db.prepare('SELECT id FROM conversation_items WHERE id=?').get(`${run.id}:user`)) setConversationUser(run.id, run.userInput);
  if (update.type === 'assistant-delta' || update.type === 'assistant-message') {
    if (!update.content.trim()) return;
    put(run.id, `message:${update.stepId}`, update.type === 'assistant-message' ? update.phase : 'draft', update.content, update.type === 'assistant-message' ? 'completed' : 'running');
  } else if (update.type === 'tool-call' || update.type === 'tool-result' || update.type === 'tool-error') {
    const key = `tool:${update.callId || update.stepId}`;
    const previous = db.prepare('SELECT details FROM conversation_items WHERE id=?').get(`${run.id}:${key}`) as { details: string | null } | undefined;
    const details = previous?.details ? JSON.parse(previous.details) : {};
    if (update.type === 'tool-call') details.input = update.args;
    if (update.type === 'tool-result') details.output = update.result;
    if (update.type === 'tool-error') details.error = update.error;
    put(run.id, key, 'tool', update.tool, update.type === 'tool-call' ? 'running' : update.type === 'tool-error' ? 'failed' : 'completed', details, update.type === 'tool-call' ? { activity: describeConversationTool(update.tool, update.args) } : undefined);
  } else if (update.type === 'assistant-response') {
    const draft = db.prepare("SELECT id FROM conversation_items WHERE run_id=? AND kind='draft' ORDER BY sequence DESC LIMIT 1").get(run.id) as { id: string } | undefined;
    if (draft) db.prepare("UPDATE conversation_items SET kind='final',content=?,status='completed' WHERE id=?").run(update.content, draft.id);
    else put(run.id, 'final', 'final', update.content, 'completed');
  } else if (update.type === 'run-failed' || update.type === 'run-cancelled' || update.type === 'run-paused') {
    db.prepare("UPDATE conversation_items SET status=? WHERE run_id=? AND status='running'").run(update.status, run.id);
  }
}
export function getConversationPage(sessionId: string, before?: number): ConversationPage {
  if (!getOwnedSessionSummary(undefined, sessionId)) throw new Error('Task not found.');
  const rows = getDb().prepare(`SELECT id,rowid AS cursor FROM runs WHERE session_id=? AND rowid<?
    AND EXISTS(SELECT 1 FROM conversation_items WHERE run_id=runs.id) ORDER BY rowid DESC LIMIT 21`).all(sessionId, before || Number.MAX_SAFE_INTEGER) as Array<{ id: string; cursor: number }>;
  return { rounds: rows.slice(0,20).reverse().map(row => ({ run: conversationRun(row.id), items: (getDb().prepare('SELECT id,run_id AS runId,sequence,kind,content,status,metadata FROM conversation_items WHERE run_id=? ORDER BY sequence').all(row.id) as Array<ConversationItem & { metadata?: string }>).map(item => { const { metadata, ...value } = item; return { ...value, ...(metadata ? JSON.parse(metadata) : {}) }; }) })), ...(rows.length > 20 ? { before: rows[19].cursor } : {}) };
}
export function getConversationDetails(sessionId: string, itemId: string): unknown {
  if (!getOwnedSessionSummary(undefined, sessionId)) throw new Error('Task not found.');
  const row = getDb().prepare('SELECT details FROM conversation_items JOIN runs ON runs.id=conversation_items.run_id WHERE conversation_items.id=? AND runs.session_id=?').get(itemId,sessionId) as { details: string | null } | undefined;
  if (!row) throw new Error('Activity not found in this task.');
  const details = row.details ? JSON.parse(row.details) : {};
  return { output: conversationToolOutput(details.output), error: typeof details.error === 'string' ? details.error : '' };
}

function conversationRun(id: string) {
  const { status, createdAt, startedAt, updatedAt, completedAt, error } = getRunById(id)!;
  return { id, status, createdAt, startedAt, updatedAt, completedAt, error };
}
