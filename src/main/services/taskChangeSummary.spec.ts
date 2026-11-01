import { describe, expect, it } from 'vitest';
import type { TaskArtifact } from '../../shared/contracts';
import { summarizeTaskChanges } from './taskChangeSummary';

const entry = (id: string, overrides: Partial<TaskArtifact> = {}): TaskArtifact => ({ id, runId: 'run', sessionId: 'session', toolCallId: id, path: '/project/file.txt', operation: 'modified', createdAt: 1, beforeHash: 'one', afterHash: 'two', diffAvailable: true, ...overrides });
describe('task change summaries', () => {
  it('combines operations in store order, including equal timestamps and multiple runs', () => {
    const changes = summarizeTaskChanges([entry('last', { runId: 'second', beforeHash: 'two', afterHash: 'three' }), entry('first')]);
    expect(changes).toEqual([{ path: '/project/file.txt', artifactIds: ['first', 'last'], runIds: ['run', 'second'], operation: 'modified', hasDiscontinuity: false, diffAvailable: true, availability: 'available' }]);
  });
  it('marks a gap instead of attributing external edits entirely to the task', () => {
    expect(summarizeTaskChanges([entry('last', { beforeHash: 'external' }), entry('first')])[0].hasDiscontinuity).toBe(true);
    expect(summarizeTaskChanges([entry('last', { beforeHash: undefined }), entry('first')])[0].hasDiscontinuity).toBe(true);
  });
  it('distinguishes created-then-deleted files and known absent boundaries', () => {
    expect(summarizeTaskChanges([entry('deleted', { operation: 'deleted', beforeHash: 'two', afterHash: undefined }), entry('created', { operation: 'created', beforeHash: undefined })])[0]).toMatchObject({ operation: 'no_remaining_file', hasDiscontinuity: false });
    expect(summarizeTaskChanges([entry('recreated', { operation: 'created', beforeHash: undefined }), entry('deleted', { operation: 'deleted', afterHash: undefined })])[0]).toMatchObject({ operation: 'modified', hasDiscontinuity: false });
  });
  it('keeps paths separate and denies aggregate snapshots if any operation is denied', () => {
    const changes = summarizeTaskChanges([entry('third', { path: '/project/other.txt' }), entry('second', { beforeHash: 'two', availability: 'denied' }), entry('first')]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ availability: 'denied', diffAvailable: false });
  });
  it('does not invent continuity for a write with an unknown initial state', () => {
    expect(summarizeTaskChanges([entry('unknown', { operation: 'written', beforeHash: undefined, diffAvailable: false })])[0]).toMatchObject({ hasDiscontinuity: true, diffAvailable: false });
  });
});
