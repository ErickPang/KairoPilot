import { describe, expect, it } from 'vitest';
import { conversationToolOutput, describeConversationTool } from './conversationActivity';

describe('conversation tool activities', () => {
  it('keeps each search target and command tied to its actual call', () => {
    expect(describeConversationTool('glob', { path: '/project/agent/', pattern: '**/*.ts' })).toEqual({ action: 'files', target: 'agent', icon: 'search' });
    expect(describeConversationTool('list_directory', { path: 'C:\\project\\components' }).target).toBe('components');
    expect(describeConversationTool('grep', { path: '/project/agent', pattern: 'runtime' }).target).toBe('runtime · agent');
    expect(describeConversationTool('execute_command', { command: 'npm', args: ['run', 'lint'] })).toEqual({ action: 'command', target: 'npm run lint', icon: 'terminal' });
  });
  it('extracts actual output without displaying the tool envelope or input', () => {
    expect(conversationToolOutput({ __toolResult: true, ok: true, data: { content: 'File body' }, meta: { internal: true } })).toBe('File body');
    expect(conversationToolOutput({ stdout: 'passed', stderr: 'one warning', exitCode: 0 })).toBe('passed\none warning');
    expect(conversationToolOutput({ files: ['agent/a.ts', 'agent/b.ts'] })).toBe('agent/a.ts\nagent/b.ts');
    expect(conversationToolOutput({ success: true, internal: 'opaque' })).toBe('');
  });
});
