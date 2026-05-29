import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStoreMocks = vi.hoisted(() => ({
  getAgentStats: vi.fn(),
  getTokenUsageDetails: vi.fn()
}));

vi.mock('../store/chat', () => chatStoreMocks);

import {
  getMonitoringAgentStats,
  getMonitoringTokenUsageDetails
} from './chatMonitoringService';

describe('chatMonitoringService', () => {
  beforeEach(() => {
    chatStoreMocks.getAgentStats.mockReset();
    chatStoreMocks.getTokenUsageDetails.mockReset();
  });

  it('delegates agent stats and token detail queries to the chat store', () => {
    chatStoreMocks.getAgentStats.mockReturnValue([{ agentId: 'agent-1' }]);
    chatStoreMocks.getTokenUsageDetails.mockReturnValue({ items: [] });

    expect(getMonitoringAgentStats()).toEqual([{ agentId: 'agent-1' }]);
    expect(getMonitoringTokenUsageDetails({ agentId: 'agent-1', page: 2 })).toEqual({ items: [] });

    expect(chatStoreMocks.getAgentStats).toHaveBeenCalledWith();
    expect(chatStoreMocks.getTokenUsageDetails).toHaveBeenCalledWith({ agentId: 'agent-1', page: 2 });
  });
});
