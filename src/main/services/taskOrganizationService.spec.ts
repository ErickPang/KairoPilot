import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDefaultAgentPermissions } from '../../shared/contracts';

const mocks = vi.hoisted(() => ({ agent: vi.fn(), owned: vi.fn(), insert: vi.fn(), list: vi.fn(), attachment: vi.fn(), draft: vi.fn(), save: vi.fn(), mutable: vi.fn(), archive: vi.fn(), read: vi.fn() }));
vi.mock('./projectService', async () => {
  const { createAgentPermissionGuard } = await import('../core/security/executionContext');
  return { requireOwnedSession: mocks.owned, permissionGuardForSession: (session: { executionRoot: string }) => createAgentPermissionGuard(mocks.agent(), session.executionRoot) };
});
vi.mock('./workbenchExecution', () => ({ assertTaskMutable: mocks.mutable }));
vi.mock('../store/chat', () => ({ getSessionAttachmentById: mocks.attachment }));
vi.mock('../store/taskOrganization', () => ({ insertContextReference: mocks.insert, listContextReferences: mocks.list, getStoredDraft: mocks.draft, saveStoredDraft: mocks.save, setSessionArchived: mocks.archive, markSessionRead: mocks.read }));

import { archiveTask, createTaskReference, getTaskDraft, readTask, resolveTaskReferences, saveTaskDraft } from './taskOrganizationService';
import { withReferenceContext } from '../core/context/references';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-p2-reference-'));
const project = path.join(root, 'project');
const outside = path.join(root, 'outside');
fs.mkdirSync(project); fs.mkdirSync(outside);
const file = path.join(project, 'context.txt'); fs.writeFileSync(file, 'CONTENTS_MUST_NOT_UPLOAD');
const reference = { id: 'reference', agentId: 'agent', sessionId: 'task', projectId: 'project', path: file, name: 'context.txt', kind: 'file' as const, createdAt: 1 };
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.owned.mockReturnValue({ id: 'task', agentId: 'agent', projectId: 'project', executionRoot: project });
  mocks.agent.mockReturnValue({ id: 'agent', workspace: root, permissions: { ...createDefaultAgentPermissions(), executionProfile: 'read_only_workspace', fileSystem: { read: true, write: false, allowedPaths: [root] } } });
  mocks.insert.mockImplementation((value) => ({ ...value, id: 'reference', createdAt: 1 }));
  mocks.list.mockReturnValue([reference]);
  mocks.draft.mockReturnValue({ revision: 4, data: { input: 'draft', referenceIds: [reference.id], attachmentIds: [] } });
});

describe('task references and draft ownership', () => {
  it('canonicalizes task references without reading or uploading their contents', () => {
    const created = createTaskReference('task', file);
    expect(created.path).toBe(fs.realpathSync(file));
    const message = withReferenceContext({ role: 'user', content: 'inspect', references: [created] }, () => true);
    expect(message.content).toContain('context.txt');
    expect(message.content).not.toContain('CONTENTS_MUST_NOT_UPLOAD');
  });
  it('narrows references to the bound project even when the agent can read its parent', () => {
    expect(() => createTaskReference('task', outside)).toThrow('read permissions');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('rejects symlinks escaping the project and references belonging to another task', () => {
    const link = path.join(project, 'escape');
    if (!fs.existsSync(link)) fs.symlinkSync(outside, link);
    expect(() => createTaskReference('task', link)).toThrow('read permissions');
    expect(() => resolveTaskReferences('task', ['foreign'], true)).toThrow('does not belong');
  });
  it('marks missing paths unavailable, rejects sending them and omits model context', () => {
    const missing = { ...reference, path: path.join(project, 'missing') };
    mocks.list.mockReturnValue([missing]);
    expect(getTaskDraft('task').references[0].availability).toBe('missing');
    expect(() => resolveTaskReferences('task', [reference.id], true)).toThrow('unavailable');
    expect(withReferenceContext({ role: 'user', content: 'inspect', references: [missing] }, () => true).content).not.toContain(missing.path);
  });
  it('rechecks revoked read access and excludes previously stored paths from model context', () => {
    const agent = mocks.agent(); agent.permissions.fileSystem.read = false; mocks.agent.mockReturnValue(agent);
    expect(getTaskDraft('task').references[0].availability).toBe('denied');
    expect(() => resolveTaskReferences('task', [reference.id], true)).toThrow('unavailable');
    expect(withReferenceContext({ role: 'user', content: 'inspect', references: [reference] }, () => false).content).not.toContain(file);
  });
  it('rejects foreign attachment ids before saving a draft', () => {
    expect(() => saveTaskDraft('task', 4, { input: 'draft', referenceIds: [], attachmentIds: ['foreign'] })).toThrow('does not belong');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('blocks all reads and mutations when task ownership fails', () => {
    mocks.owned.mockImplementation(() => { throw new Error('wrong owner'); });
    expect(() => getTaskDraft('foreign')).toThrow('wrong owner');
    expect(() => createTaskReference('foreign', file)).toThrow('wrong owner');
    expect(() => archiveTask('foreign', true)).toThrow('wrong owner');
    expect(() => readTask('foreign', 2)).toThrow('wrong owner');
  });
  it('prevents archiving an executing agent without rewriting run state', () => {
    mocks.mutable.mockImplementation(() => { throw new Error('busy'); });
    expect(() => archiveTask('task', true)).toThrow('busy');
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
