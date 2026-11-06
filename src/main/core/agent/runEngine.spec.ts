import {z} from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMProvider, LLMRequest } from '../llm/types';
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

  it.each([false, true])('continues after insufficient search results, respecting fallback approval (required=%s)', async requiresApproval => {
    const history: ChatMessage[] = [{ role: 'user', content: '/search 今日新闻' }];
    const chat = vi.fn()
      .mockResolvedValueOnce({ role: 'assistant', content: '先执行技能中的搜索。', tool_calls: [{ id: 'search', function: { name: 'web_search', arguments: '{}' } }] })
      .mockResolvedValueOnce({ role: 'assistant', content: '搜索没有取得有效结果，改为读取新闻频道。', tool_calls: [{ id: 'fetch', function: { name: 'fetch_webpage', arguments: '{}' } }] })
      .mockResolvedValueOnce({ role: 'assistant', content: '搜索未取得有效结果，以下内容来自新闻频道页面。' });
    const handleToolCall = vi.fn(async ({ call }: { call: { id: string; function: { name: string } } }) => {
      if (call.function.name === 'fetch_webpage' && requiresApproval) return { type: 'waiting_approval' as const, approvalId: 'fallback-approval' };
      history.push({ role: 'tool', tool_call_id: call.id, content: call.function.name === 'web_search' ? 'Error: no usable results' : 'Verified source content' });
      return { type: 'continue' as const };
    });
    const result = await executeRunEngine({
      llm: { chat } as unknown as LLMProvider, tools: [], runId: 'recover', userInput: '/search 今日新闻', options: { sessionId: 's' },
      buildModelContext: () => ({ messages: [...history], metadata: createEmptyMetadata('') }),
      handleToolCall, persistSnapshot: vi.fn(), emitUpdate: vi.fn(), pushHistory: message => { history.push(message); }, shouldBlockSensitiveDisclosure: () => false
    });
    expect(chat.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', content: 'Error: no usable results' })]));
    expect(handleToolCall).toHaveBeenCalledTimes(2);
    if (requiresApproval) {
      expect(result).toMatchObject({ status: 'waiting_approval', approvalId: 'fallback-approval' });
      expect(chat).toHaveBeenCalledTimes(2);
      expect(history).not.toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'fetch' }));
    } else {
      expect(result).toMatchObject({ status: 'completed', content: '搜索未取得有效结果，以下内容来自新闻频道页面。' });
      expect(chat).toHaveBeenCalledTimes(3);
    }
  });

  it.each([false, true])('静默模型请求可以取消，包括最终汇总（summary=%s）', async (summary) => {
    let cancelRequested = false;
    let calls = 0;
    const llm = {
      config: { provider: 'custom', model: 'synthetic' },
      getCapabilities: () => ({ stream: true }),
      stream: async (request: LLMRequest) => {
        calls += 1;
        if (summary && calls === 1) return;
        cancelRequested = true;
        await new Promise<void>((_resolve, reject) => request.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      }
    } as unknown as LLMProvider;
    const result = await executeRunEngine({
      llm, tools: [], runId: 'silent', userInput: 'synthetic',
      options: { sessionId: 'synthetic-session', maxIterations: 1 },
      buildModelContext: () => ({ messages: [{ role: 'user', content: 'synthetic' }], metadata: createEmptyMetadata('') }),
      handleToolCall: async () => ({ type: 'continue' }),
      persistSnapshot: vi.fn(), emitUpdate: vi.fn(), pushHistory: vi.fn(),
      shouldBlockSensitiveDisclosure: () => false,
      shouldInterrupt: () => cancelRequested ? { kind: 'cancel', reason: 'Synthetic cancellation' } : null
    });
    expect(result.status).toBe('cancelled');
    expect(calls).toBe(summary ? 2 : 1);
    expect(chatStoreMocks.updateRun).not.toHaveBeenCalledWith('silent', expect.objectContaining({ status: 'completed' }));
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
  it('planning rejects model tool calls before reaching any tool handler',async()=>{
    const handleToolCall=vi.fn();
    const llm={config:{provider:'custom',model:'fixture'},getCapabilities:()=>({stream:false}),chat:async()=>({role:'assistant',content:'',tool_calls:[{id:'blocked',function:{name:'write_file',arguments:'{}'}}]})} as unknown as LLMProvider;
    const result=await executeRunEngine({llm,tools:[],runId:'planning',userInput:'plan',options:{sessionId:'task',executionContext:{phase:'planning'} as never},buildModelContext:()=>({messages:[],metadata:createEmptyMetadata('')}),handleToolCall,persistSnapshot:vi.fn(),emitUpdate:vi.fn(),pushHistory:vi.fn(),shouldBlockSensitiveDisclosure:()=>false});
    expect(result.status).toBe('failed');expect(result.error).toContain('read-only investigation');expect(handleToolCall).not.toHaveBeenCalled();
  });

  it('uses newly discovered tools on the next inference and applies an output cap',async()=>{
    const requests:LLMRequest[]=[];let discovered=false;
    const tool={name:'discovered_probe',description:'probe',parameters:z.object({}),execute:async()=>null};
    const llm={config:{provider:'custom',model:'synthetic'},getCapabilities:()=>({stream:false,contextWindowTokens:8192}),complete:async(request:LLMRequest)=>{requests.push(request);return {message:requests.length===1?{role:'assistant',content:'',tool_calls:[{id:'c',function:{name:'search_tools',arguments:'{}'}}]}:{role:'assistant',content:'done'}};}} as unknown as LLMProvider;
    const result=await executeRunEngine({llm,tools:[],getTools:()=>discovered?[tool]:[],runId:'dynamic',userInput:'probe',options:{sessionId:'s'},buildModelContext:()=>({messages:[{role:'user',content:'probe'}],metadata:createEmptyMetadata('')}),handleToolCall:async()=>{discovered=true;return {type:'continue'};},persistSnapshot:vi.fn(),emitUpdate:vi.fn(),pushHistory:vi.fn(),shouldBlockSensitiveDisclosure:()=>false});
    expect(result.status).toBe('completed');expect(requests[0].tools).toEqual([]);expect(requests[1].tools?.[0].name).toBe('discovered_probe');expect(requests.every(request=>request.generationConfig?.maxOutputTokens===2048)).toBe(true);
  });

});
