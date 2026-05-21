import type { ChatMessage } from '../core/llm/types';

export function mapMessageRowToChatMessage(message: {
  role: ChatMessage['role'];
  content: string;
  timestamp: number;
  name?: string;
  tool_call_id?: string;
  tool_calls?: string;
  attachments?: string;
  usage?: string;
  model?: string;
}): ChatMessage {
  const chatMessage: ChatMessage = {
    role: message.role,
    content: message.content,
    timestamp: message.timestamp
  };

  if (message.name) {
    chatMessage.name = message.name;
  }

  if (message.tool_call_id) {
    chatMessage.tool_call_id = message.tool_call_id;
  }

  if (message.tool_calls) {
    try {
      chatMessage.tool_calls = JSON.parse(message.tool_calls);
    } catch (error) {
      console.warn('[DB] Failed to parse tool_calls:', error);
    }
  }

  if (message.attachments) {
    try {
      const parsed = JSON.parse(message.attachments);
      if (Array.isArray(parsed)) {
        chatMessage.attachments = parsed;
      }
    } catch (error) {
      console.warn('[DB] Failed to parse attachments:', error);
    }
  }

  if (message.usage) {
    try {
      chatMessage.usage = JSON.parse(message.usage);
    } catch (error) {
      console.warn('[DB] Failed to parse usage:', error);
    }
  }

  if (message.model) {
    chatMessage.model = message.model;
  }

  return chatMessage;
}

export function parseUsage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const usage = JSON.parse(value) as Partial<ChatMessage['usage']>;
    return {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0
    };
  } catch {
    return null;
  }
}

export function serializeJson(value: unknown) {
  if (typeof value === 'undefined') {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function hasSerializedToolCalls(toolCalls: string | null | undefined) {
  if (!toolCalls) {
    return false;
  }

  try {
    const parsed = JSON.parse(toolCalls);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return toolCalls.trim().length > 0 && toolCalls.trim() !== '[]';
  }
}

export function isVisibleSessionMessage(message: {
  role: ChatMessage['role'];
  content: string;
  tool_calls?: string | Record<string, unknown>[] | null;
}): boolean {
  const content = message.content.trim();
  if (!content) {
    return false;
  }

  if (message.role === 'user') {
    return true;
  }

  if (message.role !== 'assistant') {
    return false;
  }

  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls.length === 0;
  }

  return !hasSerializedToolCalls(message.tool_calls);
}
