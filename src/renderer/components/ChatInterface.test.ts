import { describe, expect, it } from 'vitest';
import type { RunStep } from '../types';
import { resolvePreferredTraceSelection } from './chat_trace_utils';

function createRunStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    stepIndex: 0,
    type: 'plan',
    status: 'completed',
    title: 'Step',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

describe('resolvePreferredTraceSelection', () => {
  it('保留当前仍存在于分页结果中的选中步骤', () => {
    const steps = [
      createRunStep({ id: 'step-1', stepIndex: 0 }),
      createRunStep({ id: 'step-2', stepIndex: 1, status: 'waiting_approval' })
    ];

    expect(resolvePreferredTraceSelection(steps, 'step-1')).toEqual({
      stepId: 'step-1',
      reason: 'preserve'
    });
  });

  it('优先聚焦等待确认步骤，再回退到失败步骤', () => {
    const steps = [
      createRunStep({ id: 'step-1', stepIndex: 0, status: 'failed' }),
      createRunStep({ id: 'step-2', stepIndex: 1, status: 'waiting_approval' }),
      createRunStep({ id: 'step-3', stepIndex: 2, status: 'running' })
    ];

    expect(resolvePreferredTraceSelection(steps)).toEqual({
      stepId: 'step-2',
      reason: 'waiting_approval'
    });
  });

  it('在没有异常步骤时回退到最新步骤', () => {
    const steps = [
      createRunStep({ id: 'step-1', stepIndex: 0, status: 'completed' }),
      createRunStep({ id: 'step-2', stepIndex: 1, status: 'completed' })
    ];

    expect(resolvePreferredTraceSelection(steps)).toEqual({
      stepId: 'step-2',
      reason: 'latest'
    });
  });
});
