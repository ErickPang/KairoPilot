import type { ChatAttachment, Message } from '../types';

/** Older histories include the generated model attachment preamble in user text. */
export function visibleUserText(content: string, attachments?: ChatAttachment[]): string {
  if (!attachments?.length || !content.startsWith('<attachments>\nWhen inspecting uploaded files, prefer the read_attachment tool')) return content;
  const boundary = '\n</attachments>\n\n';
  const end = content.indexOf(boundary);
  return end < 0 ? content : content.slice(end + boundary.length);
}

export interface MessageGroup { type: 'user' | 'final_answer' | 'process'; messages: Message[] }

/** Keep assistant commentary visible; only technical records are folded. */
export function buildMessageGroups(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const type = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'final_answer' : 'process';
    const previous = groups[groups.length - 1];
    if (type === 'process' && previous?.type === 'process') previous.messages.push(message);
    else groups.push({ type, messages: [message] });
  }
  return groups;
}
