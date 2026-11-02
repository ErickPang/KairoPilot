import type { ChatAttachment } from '../types';

/** Older histories include the generated model attachment preamble in user text. */
export function visibleUserText(content: string, attachments?: ChatAttachment[]): string {
  if (!attachments?.length || !content.startsWith('<attachments>\nWhen inspecting uploaded files, prefer the read_attachment tool')) return content;
  const boundary = '\n</attachments>\n\n';
  const end = content.indexOf(boundary);
  return end < 0 ? content : content.slice(end + boundary.length);
}
