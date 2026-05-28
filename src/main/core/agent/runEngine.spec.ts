import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMProvider } from '../llm/types';
import { executeRunEngine } from './runEngine';

const chatStoreMocks = vi.hoisted(() => ({
  createRunStep: vi.fn(() => ({ id: 'step-1' })),
  updateRun: vi.fn(),
  updateRunStep: vi.fn()
}));

vi.mock('../../store/chat', () => ({
  createRunStep: chatStoreMocks.createRunStep,
  updateRun: chatStoreMocks.updateRun,
  updateRunStep: chatStoreMocks.updateRunStep
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
  beforeEach(() => {
    chatStoreMocks.createRunStep.mockReset();
    chatStoreMocks.updateRun.mockReset();
    chatStoreMocks.updateRunStep.mockReset();
    chatStoreMocks.createRunStep.mockReturnValue({ id: 'step-1' });
  });

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

  it('模型调用返回后若已取消，不写入模型响应或完成状态', async () => {
    chatStoreMocks.createRunStep
      .mockReturnValueOnce({ id: 'model-step' })
      .mockReturnValueOnce({ id: 'cancel-step' });
    const pushHistory = vi.fn();
    const persistSnapshot = vi.fn();
    const emitUpdate = vi.fn();
    const shouldInterrupt = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        kind: 'cancel',
        reason: 'Run cancelled by user.'
      });
    const llm = {
      chat: vi.fn(async () => ({
        role: 'assistant' as const,
        content: 'late response',
        timestamp: Date.now()
      }))
    } as Partial<LLMProvider> as LLMProvider & {
      chat: ReturnType<typeof vi.fn>;
    };

    const result = await executeRunEngine({
      llm,
      tools: [],
      runId: 'run-cancel',
      userInput: 'cancel me',
      options: {
        sessionId: 'session-1',
        maxIterations: 1
      },
      buildModelContext: () => ({
        messages: [{ role: 'user', content: 'cancel me' }],
        metadata: createEmptyMetadata('')
      }),
      handleToolCall: async () => ({ type: 'continue' }),
      persistSnapshot,
      emitUpdate,
      pushHistory,
      shouldBlockSensitiveDisclosure: () => false,
      shouldInterrupt
    });

    expect(result).toEqual({
      status: 'cancelled',
      runId: 'run-cancel',
      error: 'Run cancelled by user.'
    });
    expect(pushHistory).not.toHaveBeenCalled();
    expect(chatStoreMocks.updateRunStep).toHaveBeenCalledWith('model-step', expect.objectContaining({
      status: 'cancelled',
      output: expect.objectContaining({
        discardedModelOutput: true
      })
    }));
    expect(chatStoreMocks.updateRun).toHaveBeenCalledWith('run-cancel', expect.objectContaining({
      status: 'cancelled'
    }));
    expect(chatStoreMocks.updateRun).not.toHaveBeenCalledWith('run-cancel', expect.objectContaining({
      status: 'completed'
    }));
    expect(emitUpdate).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'assistant-response'
    }));
  });

  it('支持使用provider流式事件增量更新助手消息', async () => {
    const emitUpdate = vi.fn((listener, update) => listener?.(update));
    const onUpdate = vi.fn();
    const pushHistory = vi.fn();
    const llm = {
      config: { provider: 'openai', model: 'gpt-stream-test' },
      getCapabilities: vi.fn(() => ({
        chat: true,
        stream: true,
        toolCalling: true,
        modelListing: false,
        structuredOutput: false,
        multimodalInput: false,
        protocol: 'openai-compatible' as const
      })),
      chat: vi.fn(),
      stream: vi.fn(async (_request, onEvent) => {
        onEvent({
          type: 'assistant_delta',
          delta: 'hel',
          provider: 'openai',
          model: 'gpt-stream-test'
        });
        onEvent({
          type: 'assistant_delta',
          delta: 'lo',
          provider: 'openai',
          model: 'gpt-stream-test'
        });
        onEvent({
          type: 'completed',
          provider: 'openai',
          model: 'gpt-stream-test'
        });
      })
    } as Partial<LLMProvider> as LLMProvider & {
      chat: ReturnType<typeof vi.fn>;
      stream: ReturnType<typeof vi.fn>;
    };

    const result = await executeRunEngine({
      llm,
      tools: [],
      runId: 'run-stream',
      userInput: 'stream please',
      onUpdate,
      options: {
        sessionId: 'session-1',
        maxIterations: 1
      },
      buildModelContext: () => ({
        messages: [{ role: 'user', content: 'stream please' }],
        metadata: createEmptyMetadata('')
      }),
      handleToolCall: async () => ({ type: 'continue' }),
      persistSnapshot: vi.fn(),
      emitUpdate,
      pushHistory,
      shouldBlockSensitiveDisclosure: () => false
    });

    expect(result).toEqual({
      status: 'completed',
      runId: 'run-stream',
      content: 'hello'
    });
    expect(llm.chat).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'assistant-delta',
      content: 'hel'
    }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'assistant-delta',
      content: 'hello'
    }));
    expect(pushHistory).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: 'hello',
      model: 'gpt-stream-test'
    }));
  });
});
