import fs from 'node:fs';
import path from 'node:path';
import type { ContextReference, TaskDraft, TaskDraftInput } from '../../shared/contracts';
import { getSessionAttachmentById } from '../store/chat';
import * as store from '../store/taskOrganization';
import { permissionGuardForSession, requireOwnedSession } from './projectService';
import { assertTaskMutable } from './workbenchExecution';

function referenceAvailability(reference: ContextReference): ContextReference {
  const session = requireOwnedSession(reference.sessionId);
  let guard;
  try { guard = permissionGuardForSession(session); }
  catch { return { ...reference, availability: 'denied' }; }
  if (!guard.checkFileSystem(reference.path, 'read')) return { ...reference, availability: 'denied' };
  try {
    const canonical = fs.realpathSync(reference.path);
    const kind = fs.statSync(canonical).isDirectory() ? 'directory' : 'file';
    return { ...reference, availability: canonical === reference.path && kind === reference.kind ? 'available' : 'missing' };
  } catch { return { ...reference, availability: 'missing' }; }
}

export function createTaskReference(sessionId: string, target: string): ContextReference {
  const session = requireOwnedSession(sessionId);
  if (!path.isAbsolute(target)) throw new Error('An absolute reference path is required.');
  const guard = permissionGuardForSession(session);
  if (!guard.checkFileSystem(target, 'read')) throw new Error('Reference is outside this task’s read permissions.');
  const canonical = fs.realpathSync(target);
  if (!guard.checkFileSystem(canonical, 'read')) throw new Error('Reference target is outside this task’s read permissions.');
  const stat = fs.statSync(canonical);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('Only files and directories can be referenced.');
  return referenceAvailability(store.insertContextReference({ sessionId, agentId: session.agentId || '', projectId: session.projectId, path: canonical, name: path.basename(canonical), kind: stat.isDirectory() ? 'directory' : 'file' }));
}

export function resolveTaskReferences(sessionId: string, ids: string[], strict = false): ContextReference[] {
  requireOwnedSession(sessionId);
  const references = store.listContextReferences(sessionId);
  return [...new Set(ids)].map((id) => {
    const reference = references.find((item) => item.id === id);
    if (!reference) throw new Error('Reference does not belong to this task.');
    const resolved = referenceAvailability(reference);
    if (strict && resolved.availability !== 'available') throw new Error(`Reference unavailable: ${reference.name}. Remove it or restore its read access.`);
    return resolved;
  });
}

export function getTaskDraft(sessionId: string): TaskDraft {
  requireOwnedSession(sessionId);
  const { revision, data } = store.getStoredDraft(sessionId);
  const attachments = data.attachmentIds.flatMap((id) => {
    const attachment = getSessionAttachmentById(id, sessionId);
    return attachment && fs.existsSync(attachment.storedPath) ? [attachment] : [];
  });
  return { ...data, revision, references: resolveTaskReferences(sessionId, data.referenceIds), attachments, missingAttachmentIds: data.attachmentIds.filter((id) => !attachments.some((item) => item.id === id)) };
}

export function saveTaskDraft(sessionId: string, revision: number, data: TaskDraftInput): number {
  requireOwnedSession(sessionId);
  resolveTaskReferences(sessionId, data.referenceIds);
  if (data.attachmentIds.some((id) => !getSessionAttachmentById(id, sessionId))) throw new Error('Draft attachment does not belong to this task.');
  return store.saveStoredDraft(sessionId, revision, data);
}

export function archiveTask(sessionId: string, archived: boolean) {
  const session = requireOwnedSession(sessionId);
  assertTaskMutable(session.id);
  store.setSessionArchived(sessionId, archived);
}

export function readTask(sessionId: string, version: number) {
  requireOwnedSession(sessionId);
  store.markSessionRead(sessionId, version);
}
