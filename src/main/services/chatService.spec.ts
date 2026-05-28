import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStoreMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionsByAgent: vi.fn(),
  getActiveSession: vi.fn(),
  getSessionById: vi.fn(),
  listSessions: vi.fn(),
  setActiveSessionId: vi.fn(),
  updateSessionTitle: vi.fn()
}));

const configStoreMocks = vi.hoisted(() => ({
  getActiveAgentId: vi.fn()
}));

vi.mock('../store/chat', () => chatStoreMocks);
vi.mock('../store/config', () => configStoreMocks);

import {
  ACTIVE_AGENT_SESSION_ERROR,
  clearActiveAgentSessions,
  createActiveAgentSession,
  deleteActiveAgentSession,
  listActiveAgentSessions,
  setActiveAgentSession,
  updateActiveAgentSessionTitle
} from './chatService';

describe('chatService', () => {
  beforeEach(() => {
    for (const mock of [
      ...Object.values(chatStoreMocks),
      ...Object.values(configStoreMocks)
    ]) {
      mock.mockReset();
    }

    configStoreMocks.getActiveAgentId.mockReturnValue('agent-1');
  });

  it('scopes session list and creation to the active agent', () => {
    chatStoreMocks.listSessions.mockReturnValue([]);
    chatStoreMocks.createSession.mockReturnValue({ id: 'session-1' });

    expect(listActiveAgentSessions()).toEqual([]);
    expect(createActiveAgentSession('New Chat')).toEqual({ id: 'session-1' });

    expect(chatStoreMocks.listSessions).toHaveBeenCalledWith('agent-1');
    expect(chatStoreMocks.createSession).toHaveBeenCalledWith('New Chat', 'agent-1');
  });

  it('rejects active session updates outside the active agent', () => {
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-2',
      title: 'Other',
      agentId: 'agent-2',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });

    expect(() => updateActiveAgentSessionTitle('session-2', 'Renamed')).toThrow(ACTIVE_AGENT_SESSION_ERROR);
    expect(chatStoreMocks.updateSessionTitle).not.toHaveBeenCalled();
  });

  it('sets and deletes sessions only after active agent ownership passes', () => {
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-1',
      title: 'Owned',
      agentId: 'agent-1',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });

    setActiveAgentSession('session-1');
    deleteActiveAgentSession('session-1');
    clearActiveAgentSessions();

    expect(chatStoreMocks.setActiveSessionId).toHaveBeenCalledWith('session-1', 'agent-1');
    expect(chatStoreMocks.deleteSession).toHaveBeenCalledWith('session-1');
    expect(chatStoreMocks.deleteSessionsByAgent).toHaveBeenCalledWith('agent-1');
  });
});
