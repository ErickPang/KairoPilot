import path from 'path';
import type { ChatMessage } from '../llm/types';
import { normalizeExecuteCommandInput } from '../tools/shell';

export function repairToolArgs(toolName: string, args: Record<string, unknown>, context: ChatMessage[]): Record<string, unknown> {
  if (toolName === 'execute_command') {
    try {
      const normalizedCommand = normalizeExecuteCommandInput(args);
      return {
        ...args,
        command: normalizedCommand.command,
        args: normalizedCommand.args
      };
    } catch {
      return args;
    }
  }

  if (toolName === 'run_skill_script') {
    const scriptPath = typeof args.scriptPath === 'string' ? args.scriptPath.trim() : '';
    if (!scriptPath) {
      return args;
    }

    const extension = path.extname(scriptPath).toLowerCase();
    const command = extension === '.py'
      ? 'python3'
      : extension === '.sh'
        ? 'bash'
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? 'node'
          : '';

    if (!command) {
      return args;
    }

    return {
      ...args,
      command
    };
  }

  if (toolName !== 'web_search') {
    return args;
  }

  const latestUserQuery = getLatestUserQuery(context);
  const requestedQuery = typeof args.query === 'string' && args.query.trim().length > 0
    ? args.query.trim()
    : latestUserQuery;
  if (!requestedQuery) {
    return args;
  }

  return {
    ...args,
    query: buildSearchQuery(requestedQuery)
  };
}

export function shouldBlockSensitiveDisclosure(systemPrompt: string, userInput: string, assistantOutput: string): boolean {
  const normalizedUserInput = (userInput || '').toLowerCase();
  if (!normalizedUserInput.trim()) {
    return false;
  }

  const extractionPatterns = [
    'system prompt',
    'developer prompt',
    'hidden prompt',
    'internal prompt',
    'show your prompt',
    'reveal prompt',
    'print prompt',
    '输出系统提示词',
    '显示系统提示词',
    '泄露提示词',
    '泄露系统',
    '提示词原文',
    '开发者指令',
    '隐藏指令',
    '越狱'
  ];
  const isExtractionAttempt = extractionPatterns.some(pattern => normalizedUserInput.includes(pattern));
  if (!isExtractionAttempt) {
    return false;
  }

  const normalizedOutput = (assistantOutput || '').toLowerCase();
  const sensitiveMarkers = [
    '<core_identity>',
    '<instruction_priority>',
    '<security_and_behavior_rules>',
    '<conflict_resolution_protocol>',
    '<skills_instructions>',
    '<core_directives>',
    '<identity>',
    '<session_user_context>',
    '<session_soul_context>',
    '<long_term_memory>',
    '<environment>'
  ];
  if (sensitiveMarkers.some(marker => normalizedOutput.includes(marker))) {
    return true;
  }

  const promptPrefix = systemPrompt.slice(0, 120).toLowerCase();
  return promptPrefix.length > 40 && normalizedOutput.includes(promptPrefix);
}

export function parseToolArgs(toolName: string, rawArgs: string) {
  try {
    if (!rawArgs || !rawArgs.trim()) {
      return {
        success: true as const,
        args: {}
      };
    }
    const parsedArgs = JSON.parse(rawArgs);
    return {
      success: true as const,
      args: parsedArgs && typeof parsedArgs === 'object' ? parsedArgs as Record<string, unknown> : {}
    };
  } catch (error) {
    return {
      success: false as const,
      error: `Invalid JSON arguments for ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

function getLatestUserQuery(context: ChatMessage[]): string {
  for (let i = context.length - 1; i >= 0; i -= 1) {
    const message = context[i];
    if (message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content.trim() : '';
      if (text) {
        return text;
      }
    }
  }
  return '';
}

function buildSearchQuery(query: string): string {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return query;
  }

  if (!isRecencyQuery(normalizedQuery)) {
    return normalizedQuery;
  }

  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const currentDate = `${currentYear}-${currentMonth}-${String(now.getDate()).padStart(2, '0')}`;
  const lowerCaseQuery = normalizedQuery.toLowerCase();
  const hasExplicitYear = /\b20\d{2}\b/.test(normalizedQuery);
  const hasExplicitIsoDate = /\b20\d{2}-\d{2}-\d{2}\b/.test(normalizedQuery);
  const isChineseQuery = /[\u4e00-\u9fff]/.test(normalizedQuery);
  const suffixTerms = new Set<string>();

  if (!hasExplicitYear) {
    suffixTerms.add(currentYear);
  }
  if (!hasExplicitIsoDate && (lowerCaseQuery.includes('today') || normalizedQuery.includes('今天'))) {
    suffixTerms.add(currentDate);
  }
  if (isChineseQuery) {
    suffixTerms.add('最新');
    suffixTerms.add('当前');
  } else {
    suffixTerms.add('latest');
    suffixTerms.add('current');
  }

  const suffix = Array.from(suffixTerms)
    .filter(term => term && !normalizedQuery.toLowerCase().includes(term.toLowerCase()))
    .join(' ');

  return suffix ? `${normalizedQuery} ${suffix}` : normalizedQuery;
}

function isRecencyQuery(query: string): boolean {
  const recencyPattern = /\b(latest|current|recent|today|this week|this month|this year|release notes|changelog|docs?|documentation|pricing|news|update)\b/i;
  return recencyPattern.test(query) || /最新|当前|最近|今天|本周|本月|今年|文档|教程|发布说明|更新|新闻|价格|行情/.test(query);
}
