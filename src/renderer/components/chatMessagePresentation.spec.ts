import { describe, expect, it } from 'vitest';
import { visibleSessionTitle } from './chatMessagePresentation';

describe('session title presentation', () => {
  it('localizes the storage placeholder without changing authored titles', () => {
    expect(visibleSessionTitle('New Chat', '新建任务')).toBe('新建任务');
    expect(visibleSessionTitle('New Chat', 'New task')).toBe('New task');
    expect(visibleSessionTitle('   ', '新建任务')).toBe('新建任务');
    expect(visibleSessionTitle(undefined, '新建任务')).toBe('新建任务');
    expect(visibleSessionTitle('New Chat notes', '新建任务')).toBe('New Chat notes');
    expect(visibleSessionTitle('我的任务', '新建任务')).toBe('我的任务');
  });
});
