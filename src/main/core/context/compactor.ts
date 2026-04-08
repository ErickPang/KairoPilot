import { ChatMessage } from '../llm/types';

export interface MessageSelectionResult {
  selectedMessages: ChatMessage[];
  omittedMessages: ChatMessage[];
  selectedChars: number;
}

export function estimateMessageChars(message: ChatMessage) {
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message.tool_calls) ? JSON.stringify(message.tool_calls) : '';
  return content.length + toolCalls.length + (message.name?.length || 0) + 48;
}

export function selectRecentMessages(
  history: ChatMessage[],
  maxChars: number,
  maxUserTurns: number
): MessageSelectionResult {
  if (history.length === 0 || maxChars <= 0) {
    return {
      selectedMessages: [],
      omittedMessages: history.slice(),
      selectedChars: 0
    };
  }

  const selectedMessages: ChatMessage[] = [];
  let selectedChars = 0;
  let userTurns = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const messageChars = estimateMessageChars(message);
    const nextUserTurns = userTurns + (message.role === 'user' ? 1 : 0);
    const wouldExceedBudget = selectedChars + messageChars > maxChars;
    const hasMinimumWindow = userTurns >= Math.max(1, maxUserTurns);

    if (selectedMessages.length > 0 && wouldExceedBudget && hasMinimumWindow) {
      break;
    }

    selectedMessages.unshift(message);
    selectedChars += messageChars;
    userTurns = nextUserTurns;

    if (userTurns >= maxUserTurns && selectedChars >= Math.floor(maxChars * 0.7)) {
      break;
    }
  }

  const omittedCount = Math.max(0, history.length - selectedMessages.length);

  return {
    selectedMessages,
    omittedMessages: history.slice(0, omittedCount),
    selectedChars
  };
}

function compactText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatMessageLine(message: ChatMessage, maxChars: number) {
  if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const toolNames = message.tool_calls
      .map((toolCall) => {
        const functionValue = typeof toolCall === 'object' && toolCall
          ? (toolCall as { function?: { name?: unknown } }).function
          : undefined;
        return typeof functionValue?.name === 'string' ? functionValue.name : 'unknown_tool';
      })
      .join(', ');
    return `assistant 调用工具: ${toolNames}`;
  }

  if (message.role === 'tool') {
    return `tool ${message.name || 'unknown'}: ${compactText(message.content || '', maxChars)}`;
  }

  return `${message.role}: ${compactText(message.content || '', maxChars)}`;
}

export function buildCompactedHistorySummary(messages: ChatMessage[], maxChars: number) {
  if (messages.length === 0 || maxChars <= 0) {
    return '';
  }

  const lines: string[] = [];
  let remainingChars = maxChars;

  for (let index = Math.max(0, messages.length - 12); index < messages.length; index += 1) {
    const line = `- ${formatMessageLine(messages[index], 220)}`;
    if (line.length > remainingChars) {
      break;
    }
    lines.push(line);
    remainingChars -= line.length + 1;
  }

  if (lines.length === 0) {
    return '';
  }

  if (messages.length > 12 && remainingChars > 32) {
    lines.unshift(`- 更早历史已压缩，共省略 ${messages.length - 12} 条消息`);
  }

  return lines.join('\n');
}

export function buildSelectedToolResults(messages: ChatMessage[], maxChars: number) {
  if (messages.length === 0 || maxChars <= 0) {
    return '';
  }

  const toolMessages = messages.filter((message) => message.role === 'tool');
  if (toolMessages.length === 0) {
    return '';
  }

  const lines: string[] = [];
  let remainingChars = maxChars;

  for (let index = toolMessages.length - 1; index >= 0; index -= 1) {
    const message = toolMessages[index];
    const line = `- ${message.name || 'tool'}: ${compactText(message.content || '', 320)}`;
    if (line.length > remainingChars) {
      break;
    }
    lines.unshift(line);
    remainingChars -= line.length + 1;
    if (lines.length >= 4) {
      break;
    }
  }

  return lines.join('\n');
}
