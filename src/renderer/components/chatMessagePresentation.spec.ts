import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../types';
import { visibleUserText, buildMessageGroups } from './chatMessagePresentation';

const attachments = [{ id: 'uploaded' }] as ChatAttachment[];
describe('visible attachment message text', () => {
  it('shows the user message and leaves generated upload instructions to the attachment chips', () => {
    expect(visibleUserText('<attachments>\nWhen inspecting uploaded files, prefer the read_attachment tool\nINTERNAL_METADATA\n</attachments>\n\n请检查附件', attachments)).toBe('请检查附件');
  });
  it('preserves user authored markup and messages without prepared attachments', () => {
    expect(visibleUserText('<attachments>example</attachments>\n\n保留', attachments)).toBe('<attachments>example</attachments>\n\n保留');
    expect(visibleUserText('<attachments>\nWhen inspecting uploaded files, prefer the read_attachment tool\n</attachments>\n\n原文')).toContain('<attachments>');
  });
  it('keeps malformed historical text visible', () => {
    const content = '<attachments>\nWhen inspecting uploaded files, prefer the read_attachment tool\n原文';
    expect(visibleUserText(content, attachments)).toBe(content);
  });
});


describe('message grouping', () => {
  it('keeps intermediate replies visible in order while folding technical records', () => {
    const messages: import('../types').Message[] = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'working' }, { role: 'tool', content: 'result' }, { role: 'assistant', content: 'answer' }, { role: 'system', content: 'metadata' }, { role: 'user', content: 'next' }, { role: 'thinking', content: 'pending' }];
    const groups = buildMessageGroups(messages);
    expect(groups.map((group) => [group.type, group.messages.map((message) => message.content)])).toEqual([['user', ['first']], ['final_answer', ['working']], ['process', ['result']], ['final_answer', ['answer']], ['process', ['metadata']], ['user', ['next']], ['process', ['pending']]]);
    expect(groups.flatMap((group) => group.messages)).toEqual(messages);
  });
  it('handles a large immutable history with system messages between assistant responses', () => {
    const messages: import('../types').Message[] = Array.from({ length: 10000 }, (_, index) => ({ role: index % 100 === 0 ? 'assistant' : 'system', content: String(index) }));
    const original = JSON.stringify(messages);
    expect(buildMessageGroups(messages).filter((group) => group.type === 'final_answer')).toHaveLength(100);
    expect(JSON.stringify(messages)).toBe(original);
  });
});
