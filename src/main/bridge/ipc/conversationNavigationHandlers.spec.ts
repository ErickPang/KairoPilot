import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KAIRO_INVOKE as C } from '../../../shared/ipc';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, input: unknown) => unknown>(),
  getConversationPage: vi.fn(), getConversationNavigation: vi.fn(), getConversationDetails: vi.fn()
}));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (_event: unknown, input: unknown) => unknown) => mocks.handlers.set(channel, handler) } }));
vi.mock('../../store/conversation', () => mocks);
vi.mock('../../store/taskPages', () => ({ getActiveSessionSummary: vi.fn(), getSessionMessagePage: vi.fn(), querySessionPage: vi.fn() }));
vi.mock('../../services/taskSettingsService', () => ({ updateTaskSettings: vi.fn() }));
vi.mock('../../services/taskOrganizationService', () => ({ archiveTask: vi.fn(), createTaskReference: vi.fn(), getTaskDraft: vi.fn(), readTask: vi.fn(), saveTaskDraft: vi.fn() }));
import { registerTaskOrganizationHandlers } from './taskOrganizationHandlers';
const invoke = (channel: string, input: unknown) => mocks.handlers.get(channel)!(null, input);
beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); registerTaskOrganizationHandlers(); });
describe('conversation navigation IPC', () => {
  it('forwards only validated session-scoped directory and target queries', () => {
    invoke(C.chatConversationNavigation, { sessionId: 'task', before: 100 });
    expect(mocks.getConversationNavigation).toHaveBeenCalledWith('task', 100);
    invoke(C.chatConversation, { sessionId: 'task', aroundRunId: 'round' });
    expect(mocks.getConversationPage).toHaveBeenCalledWith('task', undefined, 'round');
  });
  it('rejects conflicting selectors, invalid cursors and extra fields before reading data', () => {
    for (const value of [{ sessionId: '' }, { sessionId: 'task', before: 0 }, { sessionId: 'task', before: 1.5 }, { sessionId: 'task', extra: true }]) {
      expect(() => invoke(C.chatConversationNavigation, value)).toThrow();
    }
    expect(() => invoke(C.chatConversation, { sessionId: 'task', before: 1, aroundRunId: 'round' })).toThrow();
    expect(() => invoke(C.chatConversation, { sessionId: 'task', aroundRunId: '' })).toThrow();
    expect(mocks.getConversationNavigation).not.toHaveBeenCalled();
    expect(mocks.getConversationPage).not.toHaveBeenCalled();
  });
});
