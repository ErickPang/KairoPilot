import { describe, expect, it } from 'vitest';
import { RuntimeRunControl } from './runtimeRunControl';

describe('RuntimeRunControl', () => {
  it('默认无中断信号', () => {
    const control = new RuntimeRunControl();

    expect(control.consume('run-1')).toBeNull();
  });

  it('取消信号优先于暂停信号消费', () => {
    const control = new RuntimeRunControl();
    control.start('run-1');
    control.requestPause('run-1');
    control.requestCancel('run-1');

    expect(control.consume('run-1')).toEqual({
      kind: 'cancel',
      reason: 'Run cancelled by user.'
    });
    expect(control.consume('run-1')?.kind).toBe('cancel');
    control.reconcile('run-1', 'cancelled');
    expect(control.consume('run-1')).toBeNull();
  });

  it('完成后清理控制状态，暂停后保留但重置请求位', () => {
    const control = new RuntimeRunControl();
    control.start('run-1');
    control.requestPause('run-1');
    control.reconcile('run-1', 'paused');

    expect(control.consume('run-1')).toBeNull();

    control.requestCancel('run-1');
    control.reconcile('run-1', 'completed');

    expect(control.consume('run-1')).toBeNull();
  });
});
