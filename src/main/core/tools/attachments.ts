import fs from 'fs-extra';
import { z } from 'zod';
import type { ToolDefinition } from '../llm/types';
import { getSessionAttachmentById } from '../../store/chat';
import { toolError, toolOk } from './result';

const MAX_ATTACHMENT_READ_CHARS = 64_000;

export function createReadAttachmentTool(getSessionId: () => string | undefined | null): ToolDefinition {
  return {
    name: 'read_attachment',
    description: 'Read an uploaded chat attachment by attachment id. This is scoped to the current chat session and does not require a filesystem path.',
    parameters: z.object({
      attachmentId: z.string().trim().min(1).describe('The id of the uploaded attachment to read.')
    }),
    execute: async (args: Record<string, unknown>) => {
      const attachmentId = typeof args.attachmentId === 'string' ? args.attachmentId.trim() : '';
      if (!attachmentId) {
        return toolError('attachmentId is required.');
      }

      const sessionId = getSessionId();
      const attachment = getSessionAttachmentById(attachmentId, sessionId || undefined);
      if (!attachment) {
        return toolError('Attachment not found in the current session.');
      }

      if (attachment.kind === 'image') {
        return toolOk({
          attachment,
          contentAvailable: false,
          note: 'This attachment is an image. Its visual content is provided to multimodal models directly; use storedPath only if a file path is explicitly needed.'
        });
      }

      if (attachment.kind !== 'text' && !attachment.extractedText) {
        return toolOk({
          attachment,
          contentAvailable: false,
          note: 'This attachment is not a text file, so read_attachment can only return metadata. Use a document-specific extractor or ask the user for conversion if textual contents are required.'
        });
      }

      try {
        const content = attachment.extractedText ?? await fs.readFile(attachment.storedPath, 'utf-8');
        return toolOk({
          attachment,
          content: content.length > MAX_ATTACHMENT_READ_CHARS
            ? `${content.slice(0, MAX_ATTACHMENT_READ_CHARS).trimEnd()}\n\n[Attachment read truncated: ${content.length} chars total]`
            : content
        });
      } catch (error) {
        return toolError(`Failed to read attachment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };
}
