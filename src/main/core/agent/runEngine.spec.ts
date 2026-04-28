import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMProvider } from '../llm/types';
import { executeRunEngine } from './runEngine';

vi.mock('../../store/chat', () => ({
  createRunStep: vi.fn((_: string, __: string, ___: string) => ({ id: 'step-1' })),
  updateRun: vi.fn(),
  updateRunStep: vi.fn()
}));

function createEmptyMetadata(availableSkillsSummary: string) {
  return {
    activeTaskSummary: '',
    activeSkillsSummary: '',
    availableSkillsSummary,
    availableToolsSummary: '',
    compactedHistorySummary: '',
    unresolvedApprovals: '',
    selectedToolResults: '',
    workspaceRetrieval: '',
    memoryDigest: '',
    layers: [],
    recentMessageCount: 0,
    omittedMessageCount: 0,
    budget: {
      maxContextChars: 0,
      systemPromptChars: 0,
      supportChars: 0,
      recentHistoryChars: 0,
      totalChars: 0
    }
  };
}

describe('executeRunEngine', () => {
  it('首次模型调用使用首份构建的运行时上下文，而不是被预构建消费后的下一份', async () => {
    const llm = {
      chat: vi.fn(async (messages: ChatMessage[]) => ({
        role: 'assistant' as const,
        content: `reply for ${messages[0]?.content ?? ''}`,
        timestamp: Date.now()
      }))
    } as Partial<LLMProvider> as LLMProvider & {
      chat: ReturnType<typeof vi.fn>;
    };

    const buildModelContext = vi
      .fn()
      .mockImplementationOnce(() => ({
        messages: [{ role: 'system', content: 'available_skills ctx-1' }],
        metadata: createEmptyMetadata('available_skills ctx-1')
      }))
      .mockImplementationOnce(() => ({
        messages: [{ role: 'system', content: 'available_skills ctx-2' }],
        metadata: createEmptyMetadata('available_skills ctx-2')
      }));

    const result = await executeRunEngine({
      llm,
      tools: [],
      runId: 'run-1',
      userInput: '有哪些可用技能？',
      options: {
        sessionId: 'session-1',
        maxIterations: 1
      },
      buildModelContext,
      handleToolCall: async () => ({ type: 'continue' }),
      persistSnapshot: vi.fn(),
      emitUpdate: vi.fn(),
      pushHistory: vi.fn(),
      shouldBlockSensitiveDisclosure: () => false
    });

    expect(result.status).toBe('completed');
    expect(buildModelContext).toHaveBeenCalledTimes(1);
    expect(llm.chat.mock.calls[0]?.[0][0]).toEqual(expect.objectContaining({
      content: 'available_skills ctx-1'
    }));
    expect(llm.chat.mock.calls[0]?.[1]).toEqual([]);
  });
});
