import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../types';
import { visibleUserText } from './chatMessagePresentation';

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
