import type {ChatMessage} from '../llm/types';

function compactContent(value: string, maxLen: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

function formatCompactedMessageLine(msg: ChatMessage, maxLen: number): string {
  if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const names = msg.tool_calls
      .map((tc) => {
        const fn = (tc as { function?: { name?: string } }).function;
        return fn?.name || 'unknown';
      })
      .join(', ');
    return `assistant 调用工具: ${names}`;
  }
  if (msg.role === 'tool') {
    return `工具结果 [${msg.name || 'unknown'}]: ${compactContent(msg.content || '', maxLen)}`;
  }
  return `${msg.role}: ${compactContent(msg.content || '', maxLen)}`;
}

export function buildCompactedHistorySummary(messages: ChatMessage[], maxChars: number) {
  if (messages.length === 0 || maxChars <= 0) return '';

  const lines: string[] = [];
  let remainingChars = maxChars;

  for (let index = Math.max(0, messages.length - 12); index < messages.length; index += 1) {
    const line = `- ${formatCompactedMessageLine(messages[index], 220)}`;
    if (line.length > remainingChars) break;
    lines.push(line);
    remainingChars -= line.length + 1;
  }

  if (lines.length === 0) return '';

  if (messages.length > 12 && remainingChars > 32) {
    lines.unshift(`- 更早历史已压缩，共省略 ${messages.length - 12} 条消息`);
  }

  return lines.join('\n');
}

export function buildSelectedToolResults(messages: ChatMessage[], maxChars: number) {
  if (messages.length === 0 || maxChars <= 0) return '';

  const toolMessages = messages.filter((message) => message.role === 'tool');
  if (toolMessages.length === 0) return '';

  const lines: string[] = [];
  let remainingChars = maxChars;

  for (let index = toolMessages.length - 1; index >= 0; index -= 1) {
    const message = toolMessages[index];
    const line = `- ${message.name || 'tool'}: ${compactContent(message.content || '', 320)}`;
    if (line.length > remainingChars) break;
    lines.unshift(line);
    remainingChars -= line.length + 1;
    if (lines.length >= 4) break;
  }

  return lines.join('\n');
}
