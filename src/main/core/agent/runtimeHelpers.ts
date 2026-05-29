import path from 'path';
import type { ChatMessage } from '../llm/types';
import { normalizeExecuteCommandInput } from '../tools/shell';
import type { LoadedSkillCapability } from './capabilityOrchestrator';

export interface SkillCatalogEntry {
  id: string;
  summary: string;
}

export interface SkillCatalogSnapshot {
  fingerprint: string;
  fullSummary: string;
  entries: SkillCatalogEntry[];
}

export interface SessionSkillCatalogState {
  fingerprint: string;
  announcedSkillIds: string[];
}

export interface ActiveSkillSnapshot {
  fingerprint: string;
  fullSummary: string;
  skillNames: string[];
  entries: Array<{
    skillName: string;
    summary: string;
  }>;
}

export interface SessionActiveSkillState {
  fingerprint: string;
  announcedSkillNames: string[];
}

export interface ToolCatalogSnapshot {
  fingerprint: string;
  fullSummary: string;
  toolNames: string[];
}

export interface SessionToolCatalogState {
  fingerprint: string;
  announcedToolNames: string[];
}

export interface RuntimeSupportSnapshot {
  activeSkillSessions?: Record<string, SessionActiveSkillState>;
  skillCatalogSessions?: Record<string, SessionSkillCatalogState>;
  toolCatalogSessions?: Record<string, SessionToolCatalogState>;
}

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

export function computeSkillCatalogUpdate(
  snapshot: SkillCatalogSnapshot | undefined,
  previousState?: SessionSkillCatalogState,
  maxChars: number = 2200
): {
  summary: string;
  nextState?: SessionSkillCatalogState;
} {
  if (!snapshot || !snapshot.fullSummary.trim()) {
    return {
      summary: '',
      nextState: previousState
    };
  }

  const nextState: SessionSkillCatalogState = {
    fingerprint: snapshot.fingerprint,
    announcedSkillIds: snapshot.entries.map((entry) => entry.id)
  };

  if (!previousState || !previousState.fingerprint) {
    return {
      summary: snapshot.fullSummary,
      nextState
    };
  }

  if (previousState.fingerprint === snapshot.fingerprint) {
    return {
      summary: '',
      nextState: previousState
    };
  }

  const previousIds = new Set(previousState.announcedSkillIds);
  const currentIds = new Set(nextState.announcedSkillIds);
  const addedEntries = snapshot.entries.filter((entry) => !previousIds.has(entry.id));
  const removedCount = previousState.announcedSkillIds.filter((id) => !currentIds.has(id)).length;

  if (addedEntries.length === 0 && removedCount === 0) {
    return {
      summary: '',
      nextState
    };
  }

  const lines: string[] = [];
  if (addedEntries.length > 0) {
    lines.push('Skills catalog update:');
    const includedEntries: string[] = [];
    for (const entry of addedEntries) {
      const candidateEntries = [...includedEntries, entry.summary];
      const omittedCount = addedEntries.length - candidateEntries.length;
      const suffix = omittedCount > 0
        ? [`- ${omittedCount} more new skills omitted from this update.`]
        : [];
      const removedLines = removedCount > 0
        ? [`- ${removedCount} previously announced skills are no longer available.`]
        : [];
      const candidate = [...lines, ...candidateEntries, ...suffix, ...removedLines].join('\n');
      if (candidate.length > maxChars) {
        break;
      }
      includedEntries.push(entry.summary);
    }

    lines.push(...includedEntries);
    const omittedCount = addedEntries.length - includedEntries.length;
    if (omittedCount > 0) {
      lines.push(`- ${omittedCount} more new skills omitted from this update.`);
    }
  }

  if (removedCount > 0) {
    lines.push(`- ${removedCount} previously announced skills are no longer available.`);
  }

  const summary = lines.join('\n').trim();
  if (!summary || summary.length > maxChars) {
    const compactSummary = buildCompactCatalogUpdateSummary(
      'Skills catalog update:',
      'new_skills',
      addedEntries.map((entry) => entry.id),
      'removed_skills',
      previousState.announcedSkillIds.filter((id) => !currentIds.has(id)),
      maxChars
    );
    if (compactSummary) {
      return {
        summary: compactSummary,
        nextState
      };
    }

    return {
      summary: snapshot.fullSummary,
      nextState
    };
  }

  return {
    summary,
    nextState
  };
}

export function buildAvailableSkillsPromptSummary(
  snapshot: SkillCatalogSnapshot | undefined,
  maxChars: number = 2200
) {
  if (!snapshot || !snapshot.fullSummary.trim() || maxChars <= 0) {
    return '';
  }

  return trimToMaxChars(snapshot.fullSummary, maxChars);
}

export function createToolCatalogSnapshot(
  toolNames: string[],
  maxChars: number = 1800
): ToolCatalogSnapshot | undefined {
  const uniqueToolNames = Array.from(new Set(toolNames.map((name) => name.trim()).filter(Boolean)));
  if (uniqueToolNames.length === 0) {
    return undefined;
  }

  const fullSummary = trimToMaxChars(uniqueToolNames.join(', '), maxChars);
  return {
    fingerprint: JSON.stringify(uniqueToolNames),
    fullSummary,
    toolNames: uniqueToolNames
  };
}

export function createActiveSkillsSnapshot(
  loadedSkills: LoadedSkillCapability[],
  maxChars: number = 2200
): ActiveSkillSnapshot | undefined {
  const summarizeSkillPaths = (paths: string[] | undefined, maxItems: number = 3) => {
    const normalizedPaths = Array.from(new Set((paths ?? []).map((entry) => entry.trim()).filter(Boolean)));
    if (normalizedPaths.length === 0) {
      return 'none';
    }

    const displayedPaths = normalizedPaths.slice(0, maxItems);
    const remainder = normalizedPaths.length - displayedPaths.length;
    return remainder > 0
      ? `${displayedPaths.join(', ')} (+${remainder} more)`
      : displayedPaths.join(', ');
  };

  const normalizedSkills = loadedSkills
    .slice()
    .sort((left, right) => left.skillName.localeCompare(right.skillName))
    .map((skill) => {
      const normalizedSkillName = skill.skillName.trim();
      const allowedTools = Array.from(new Set(skill.allowedTools.map((toolName) => toolName.trim()).filter(Boolean)));
      const allowedToolsSummary = allowedTools.length > 0
        ? allowedTools.join(', ')
        : 'none';
      const resourceSummary = summarizeSkillPaths(skill.resourcePaths);
      const scriptSummary = summarizeSkillPaths(skill.scriptPaths, 2);
      const invocation = skill.modelInvocable === false
        ? (skill.userInvocable === false ? 'hidden' : 'manual_only')
        : 'auto';
      const source = skill.source ? ` | source: ${skill.source}` : '';
      const hash = skill.contentHash ? ` | hash: ${skill.contentHash.slice(0, 12)}` : '';
      const activation = skill.activationSource ? ` | activation: ${skill.activationSource}` : '';
      const reasonSummary = skill.resolverReasons && skill.resolverReasons.length > 0
        ? ` | reasons: ${skill.resolverReasons.slice(0, 3).join(', ')}`
        : '';
      const instructionsSummary = typeof skill.instructions === 'string' && skill.instructions.trim()
        ? ` | instructions: ${trimToMaxChars(skill.instructions.trim().replace(/\s+/g, ' '), 280)}`
        : '';
      return {
        skillName: normalizedSkillName,
        summary: `- ${normalizedSkillName} | invocation: ${invocation} | execution: ${skill.executionMode || 'inline'}${activation}${source}${hash}${reasonSummary} | allowed_tools: ${allowedToolsSummary} | resources: ${resourceSummary} | scripts: ${scriptSummary}${instructionsSummary}`
      };
    })
    .filter((skill) => skill.skillName);

  if (normalizedSkills.length === 0) {
    return undefined;
  }

  const fullSummary = trimToMaxChars(normalizedSkills.map((skill) => skill.summary).join('\n'), maxChars);
  return {
    fingerprint: JSON.stringify(normalizedSkills.map((skill) => skill.summary)),
    fullSummary,
    skillNames: normalizedSkills.map((skill) => skill.skillName),
    entries: normalizedSkills
  };
}

export function computeActiveSkillsUpdate(
  snapshot: ActiveSkillSnapshot | undefined,
  previousState?: SessionActiveSkillState,
  maxChars: number = 1800
): {
  summary: string;
  nextState?: SessionActiveSkillState;
} {
  if (!snapshot || !snapshot.fullSummary.trim()) {
    return {
      summary: '',
      nextState: previousState
    };
  }

  const nextState: SessionActiveSkillState = {
    fingerprint: snapshot.fingerprint,
    announcedSkillNames: snapshot.skillNames
  };

  if (!previousState || !previousState.fingerprint) {
    return {
      summary: snapshot.fullSummary,
      nextState
    };
  }

  if (previousState.fingerprint === snapshot.fingerprint) {
    return {
      summary: '',
      nextState: previousState
    };
  }

  const previousSkillNames = new Set(previousState.announcedSkillNames);
  const currentSkillNames = new Set(nextState.announcedSkillNames);
  const addedEntries = snapshot.entries.filter((entry) => !previousSkillNames.has(entry.skillName));
  const removedSkills = previousState.announcedSkillNames.filter((skillName) => !currentSkillNames.has(skillName));

  const detailedSummary = [
    addedEntries.length > 0 ? 'Active skills update:' : '',
    ...addedEntries.map((entry) => entry.summary),
    removedSkills.length > 0 ? `- removed_skills: ${removedSkills.join(', ')}` : ''
  ].filter(Boolean).join('\n').trim();

  if (detailedSummary && detailedSummary.length <= maxChars) {
    return {
      summary: detailedSummary,
      nextState
    };
  }

  const compactSummary = buildCompactCatalogUpdateSummary(
    'Active skills update:',
    'new_active_skills',
    addedEntries.map((entry) => entry.skillName),
    'removed_active_skills',
    removedSkills,
    maxChars
  );
  if (compactSummary) {
    return {
      summary: compactSummary,
      nextState
    };
  }

  return {
    summary: trimToMaxChars(snapshot.fullSummary, maxChars),
    nextState
  };
}

export function computeToolCatalogUpdate(
  snapshot: ToolCatalogSnapshot | undefined,
  previousState?: SessionToolCatalogState,
  maxChars: number = 1400
): {
  summary: string;
  nextState?: SessionToolCatalogState;
} {
  if (!snapshot || !snapshot.fullSummary.trim()) {
    return {
      summary: '',
      nextState: previousState
    };
  }

  const nextState: SessionToolCatalogState = {
    fingerprint: snapshot.fingerprint,
    announcedToolNames: snapshot.toolNames
  };

  if (!previousState || !previousState.fingerprint) {
    return {
      summary: snapshot.fullSummary,
      nextState
    };
  }

  if (previousState.fingerprint === snapshot.fingerprint) {
    return {
      summary: '',
      nextState: previousState
    };
  }

  const previousToolNames = new Set(previousState.announcedToolNames);
  const currentToolNames = new Set(nextState.announcedToolNames);
  const addedTools = snapshot.toolNames.filter((name) => !previousToolNames.has(name));
  const removedTools = previousState.announcedToolNames.filter((name) => !currentToolNames.has(name));
  const compactSummary = buildCompactCatalogUpdateSummary(
    'Tools catalog update:',
    'new_tools',
    addedTools,
    'removed_tools',
    removedTools,
    maxChars
  );

  if (!compactSummary) {
    return {
      summary: trimToMaxChars(snapshot.fullSummary, maxChars),
      nextState
    };
  }

  return {
    summary: compactSummary,
    nextState
  };
}

function buildCompactCatalogUpdateSummary(
  title: string,
  addedLabel: string,
  addedItems: string[],
  removedLabel: string,
  removedItems: string[],
  maxChars: number
) {
  const lines = [title];

  if (addedItems.length > 0) {
    const addedList = buildCommaSeparatedList(addedItems, `${addedLabel}: `, maxChars);
    if (addedList) {
      lines.push(`- ${addedLabel}: ${addedList}`);
    } else {
      lines.push(`- ${addedLabel}_count: ${addedItems.length}`);
    }
  }

  if (removedItems.length > 0) {
    const removedList = buildCommaSeparatedList(removedItems, `${removedLabel}: `, maxChars);
    if (removedList) {
      lines.push(`- ${removedLabel}: ${removedList}`);
    } else {
      lines.push(`- ${removedLabel}_count: ${removedItems.length}`);
    }
  }

  const summary = lines.join('\n').trim();
  if (!summary) {
    return '';
  }
  if (summary.length <= maxChars) {
    return summary;
  }

  const compactCountLines = [
    title,
    addedItems.length > 0 ? `- ${addedLabel}_count: ${addedItems.length}` : '',
    removedItems.length > 0 ? `- ${removedLabel}_count: ${removedItems.length}` : ''
  ].filter(Boolean).join('\n').trim();
  if (compactCountLines.length <= maxChars) {
    return compactCountLines;
  }

  return '';
}

function buildCommaSeparatedList(items: string[], prefix: string, maxChars: number) {
  if (items.length === 0) {
    return '';
  }

  const included: string[] = [];
  for (const item of items) {
    const candidateItems = [...included, item];
    const omittedCount = items.length - candidateItems.length;
    const suffix = omittedCount > 0 ? ` (+${omittedCount} more)` : '';
    const candidate = `${prefix}${candidateItems.join(', ')}${suffix}`;
    if (candidate.length > maxChars) {
      break;
    }
    included.push(item);
  }

  if (included.length === 0) {
    return '';
  }

  const omittedCount = items.length - included.length;
  return omittedCount > 0
    ? `${included.join(', ')} (+${omittedCount} more)`
    : included.join(', ');
}

function trimToMaxChars(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
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
