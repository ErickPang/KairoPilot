import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getRunById: vi.fn(), listArtifacts: vi.fn(() => []), listVerifications: vi.fn() }));
vi.mock('../store/chat', () => ({ getRunById: state.getRunById }));
vi.mock('../store/workbench', () => ({ listArtifacts: state.listArtifacts, listVerifications: state.listVerifications }));
vi.mock('./projectService', () => ({ requireOwnedSession: () => ({ id: 'owned-session', agentId: 'owned-agent' }) }));
import { getTaskResults } from './taskResultsService';

it('does not expose a verification whose run belongs to another task', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-result-owner-')));
  try {
    state.getRunById.mockReturnValue({ id: 'other-run', sessionId: 'other-session', agentId: 'other-agent', executionContext: { agentId: 'other-agent', executionRoot: root } });
    state.listVerifications.mockReturnValue([{ id: 'record', runId: 'other-run', sessionId: 'owned-session', command: 'OTHER_PRIVATE', stdout: 'OTHER_PRIVATE', stderr: 'OTHER_PRIVATE', cwd: root, status: 'passed' }]);
    const results = await getTaskResults('owned-session');
    expect(results.verifications[0]).toMatchObject({ outputAvailable: false, stdout: '', stderr: '', command: '' });
    expect(JSON.stringify(results)).not.toContain('OTHER_PRIVATE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
