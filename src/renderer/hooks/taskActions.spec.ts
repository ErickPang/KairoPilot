import { describe, expect, it, vi } from 'vitest';
import { archiveTaskWithFeedback } from './taskActions';
describe('archive feedback', () => {
  it('returns false without mutating the task when saving its draft fails', async () => {
    const actions = { saveDraft: vi.fn().mockRejectedValue(new Error('conflict')), archive: vi.fn(), refresh: vi.fn(), reportError: vi.fn() };
    expect(await archiveTaskWithFeedback(actions)).toBe(false);
    expect(actions.archive).not.toHaveBeenCalled(); expect(actions.refresh).not.toHaveBeenCalled(); expect(actions.reportError).toHaveBeenCalledOnce();
  });
  it('reports a rejected archive without announcing success or refreshing the list', async () => {
    const actions = { saveDraft: vi.fn(), archive: vi.fn().mockRejectedValue(new Error('busy')), refresh: vi.fn(), reportError: vi.fn() };
    expect(await archiveTaskWithFeedback(actions)).toBe(false); expect(actions.refresh).not.toHaveBeenCalled();
  });
  it('retains failure feedback when archive succeeded but refreshing the authoritative list failed', async () => {
    const actions = { saveDraft: vi.fn(), archive: vi.fn(), refresh: vi.fn().mockRejectedValue(new Error('refresh failed')), reportError: vi.fn() };
    expect(await archiveTaskWithFeedback(actions)).toBe(false);
    expect(actions.archive).toHaveBeenCalledOnce(); expect(actions.reportError).toHaveBeenCalledOnce();
  });
  it('announces success only after the authoritative list has refreshed', async () => {
    const order: string[] = [];
    expect(await archiveTaskWithFeedback({ saveDraft: async () => { order.push('save'); }, archive: async () => { order.push('archive'); }, refresh: async () => { order.push('refresh'); }, reportError: vi.fn() })).toBe(true);
    expect(order).toEqual(['save', 'archive', 'refresh']);
  });
});
