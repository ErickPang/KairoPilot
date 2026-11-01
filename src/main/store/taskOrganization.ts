import { randomUUID } from 'node:crypto';
import type { ContextReference, TaskDraftInput } from '../../shared/contracts';
import { getDb } from './chat';

export function insertContextReference(reference: Omit<ContextReference, 'id' | 'createdAt'>): ContextReference {
  const existing = listContextReferences(reference.sessionId).find((item) => item.path === reference.path && item.kind === reference.kind);
  if (existing) return existing;
  const value = { ...reference, id: randomUUID(), createdAt: Date.now() };
  getDb().prepare('INSERT INTO context_references (id, session_id, data) VALUES (?, ?, ?)').run(value.id, value.sessionId, JSON.stringify(value));
  return value;
}

export function listContextReferences(sessionId: string): ContextReference[] {
  const rows = getDb().prepare('SELECT data FROM context_references WHERE session_id = ?').all(sessionId) as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data) as ContextReference);
}

export function getStoredDraft(sessionId: string): { revision: number; data: TaskDraftInput } {
  const row = getDb().prepare('SELECT revision, data FROM task_drafts WHERE session_id = ?').get(sessionId) as { revision: number; data: string } | undefined;
  return row ? { revision: row.revision, data: JSON.parse(row.data) as TaskDraftInput } : { revision: 0, data: { input: '', referenceIds: [], attachmentIds: [] } };
}

export function saveStoredDraft(sessionId: string, revision: number, data: TaskDraftInput): number {
  return getDb().transaction(() => {
    if (getStoredDraft(sessionId).revision !== revision) throw new Error('DRAFT_CONFLICT: The task draft changed. Reload it before saving again.');
    const next = revision + 1;
    getDb().prepare('INSERT INTO task_drafts (session_id, revision, data) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET revision = excluded.revision, data = excluded.data').run(sessionId, next, JSON.stringify(data));
    return next;
  })();
}

export function clearAcceptedDraft(sessionId: string, revision: number) {
  if (getStoredDraft(sessionId).revision !== revision) return;
  saveStoredDraft(sessionId, revision, { input: '', referenceIds: [], attachmentIds: [] });
}

export function setSessionArchived(sessionId: string, archived: boolean) {
  getDb().prepare('UPDATE sessions SET archived_at = ? WHERE id = ?').run(archived ? Date.now() : null, sessionId);
}

export function markSessionRead(sessionId: string, seenVersion: number) {
  getDb().prepare('UPDATE sessions SET read_version = MAX(read_version, MIN(?, activity_version)) WHERE id = ?').run(seenVersion, sessionId);
}
