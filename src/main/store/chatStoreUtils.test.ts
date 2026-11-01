import { describe, expect, it } from 'vitest';
import {
  buildMonitoringWhereClause,
  buildRunQueryWhere,
  buildTokenMetricFacets,
  getSharedMessagePrefixLength,
  getSessionTitle,
  mapSessionRowToSummary,
  mapContextSummaryRow
} from './chatStoreUtils';

describe('chatStoreUtils', () => {
  it('uses the first user content for default titles and collapses whitespace', () => {
    expect(getSessionTitle('New Chat', '  整理新闻\n\t生成选题  ')).toBe('整理新闻 生成选题');
    expect(getSessionTitle('', '问题')).toBe('问题');
    expect(getSessionTitle('New Chat', '')).toBe('New Chat');
    expect(getSessionTitle('自定义名称', '别的问题')).toBe('自定义名称');
  });

  it('limits titles without splitting Unicode code points', () => {
    expect(getSessionTitle('New Chat', '😀'.repeat(81))).toBe('😀'.repeat(80) + '…');
    expect(getSessionTitle('New Chat', '文'.repeat(80))).toBe('文'.repeat(80));
  });

  it('shows first-message names for existing defaults while preserving custom names', () => {
    const row = {id:'task', title:'New Chat', agent_id:'workbench', created_at:1, updated_at:1, first_user_content:'分析自媒体选题'};
    expect(mapSessionRowToSummary(row).title).toBe('分析自媒体选题');
    expect(mapSessionRowToSummary({...row, title:'我的项目讨论'}).title).toBe('我的项目讨论');
  });

  it('计算消息共享前缀时会比较关键字段差异', () => {
    const existing = [
      { role: 'user' as const, content: 'hello', timestamp: 1 },
      { role: 'assistant' as const, content: 'done', timestamp: 2, model: 'gpt-4o-mini' }
    ];
    const next = [
      { role: 'user' as const, content: 'hello', timestamp: 1 },
      { role: 'assistant' as const, content: 'changed', timestamp: 2, model: 'gpt-4o-mini' }
    ];

    expect(getSharedMessagePrefixLength(existing, next)).toBe(1);
  });

  it('映射 context summary 时会补默认值并规范 layer kind', () => {
    const summary = mapContextSummaryRow({
      id: 'summary-1',
      run_id: 'run-1',
      session_id: 'session-1',
      step_id: null,
      summary: JSON.stringify({
        activeTaskSummary: 'task',
        layers: [
          { id: 'l1', title: 'Layer 1', kind: 'history', messageCount: 3, charCount: 9, summary: 'ok' },
          { id: 'l2', title: 'Layer 2', kind: 'other', messageCount: Number.NaN, charCount: 0, summary: '' }
        ],
        budget: {
          maxContextChars: 100
        }
      }),
      created_at: 123
    });

    expect(summary).toEqual({
      id: 'summary-1',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: undefined,
      activeTaskSummary: 'task',
      activeSkillsSummary: '',
      availableSkillsSummary: '',
      availableToolsSummary: '',
      compactedHistorySummary: '',
      unresolvedApprovals: '',
      selectedToolResults: '',
      workspaceRetrieval: '',
      memoryDigest: '',
      layers: [
        { id: 'l1', title: 'Layer 1', kind: 'history', messageCount: 3, charCount: 9, summary: 'ok' },
        { id: 'l2', title: 'Layer 2', kind: 'support', messageCount: 0, charCount: 0, summary: '' }
      ],
      recentMessageCount: 0,
      omittedMessageCount: 0,
      budget: {
        maxContextChars: 100,
        systemPromptChars: 0,
        supportChars: 0,
        recentHistoryChars: 0,
        totalChars: 0
      },
      createdAt: 123
    });
  });

  it('构建 run 查询条件时会组合状态、会话、Agent 和搜索词', () => {
    const result = buildRunQueryWhere({
      status: 'failed',
      sessionId: 'session-1',
      agentId: 'agent-1',
      search: 'Timeout'
    });

    expect(result.whereClause).toContain('status = ?');
    expect(result.whereClause).toContain('session_id = ?');
    expect(result.whereClause).toContain('agent_id = ?');
    expect(result.whereClause).toContain('LOWER(goal) LIKE ?');
    expect(result.params).toEqual([
      'failed',
      'session-1',
      'agent-1',
      '%timeout%',
      '%timeout%',
      '%timeout%',
      '%timeout%',
      '%timeout%',
      '%timeout%'
    ]);
  });

  it('构建 token 查询条件时默认带可见消息过滤，并附加筛选项', () => {
    const result = buildMonitoringWhereClause({
      agentId: 'agent-1',
      role: 'assistant',
      sessionId: 'session-1',
      model: 'gpt-4o-mini',
      search: 'summary',
      startTime: 100,
      endTime: 200
    });

    expect(result.whereClause).toContain('messages.usage IS NOT NULL');
    expect(result.whereClause).toContain("messages.tool_calls = '[]'");
    expect(result.whereClause).toContain('sessions.agent_id = ?');
    expect(result.params).toEqual([
      'agent-1',
      'gpt-4o-mini',
      'assistant',
      'session-1',
      100,
      200,
      '%summary%',
      '%summary%',
      '%summary%',
      '%summary%'
    ]);
    expect(result.normalizedAgentId).toBe('agent-1');
  });

  it('token facets 会按总 token、数量、名称排序', () => {
    const facets = buildTokenMetricFacets([
      { model: 'beta', promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      { model: 'alpha', promptTokens: 3, completionTokens: 3, totalTokens: 6 },
      { model: 'beta', promptTokens: 1, completionTokens: 1, totalTokens: 2 }
    ], (item) => item.model);

    expect(facets).toEqual([
      {
        value: 'beta',
        count: 2,
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7
      },
      {
        value: 'alpha',
        count: 1,
        promptTokens: 3,
        completionTokens: 3,
        totalTokens: 6
      }
    ]);
  });
});
