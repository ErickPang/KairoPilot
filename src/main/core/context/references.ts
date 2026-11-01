import fs from 'node:fs';
import type { ChatMessage } from '../llm/types';

/** References describe locations; file contents still require a permitted tool call. */
export function withReferenceContext(message: ChatMessage, canRead: (path: string) => boolean): ChatMessage {
  if (!message.references?.length) return message;
  const references = message.references.filter((reference) => {
    if (!canRead(reference.path)) return false;
    try {
      const stat = fs.statSync(reference.path);
      return fs.realpathSync(reference.path) === reference.path && (reference.kind === 'directory' ? stat.isDirectory() : stat.isFile());
    } catch { return false; }
  }).map(({ path, kind }) => ({ path, kind }));
  return { ...message, content: `${message.content}\n\nTask context references (paths only; read contents using permitted tools):\n${JSON.stringify(references)}` };
}
