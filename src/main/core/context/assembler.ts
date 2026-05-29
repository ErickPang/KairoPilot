import { ApprovalRecord, ContextAssemblyLayerSummary, RunContextSummary, RunStep, RunSummary } from '../../../shared/contracts';
import { ChatMessage } from '../llm/types';
import {
  buildCompactedHistorySummary,
  buildSelectedToolResults,
  selectRecentMessages
} from './compactor';
import {
  buildMemoryDigest,
  buildWorkspaceRetrievalDigest
} from './memory';

export interface ContextAssemblyMetadata {
  activeTaskSummary: string;
  activeSkillsSummary: string;
  availableSkillsSummary: string;
  availableToolsSummary: string;
  compactedHistorySummary: string;
  unresolvedApprovals: string;
  selectedToolResults: string;
  workspaceRetrieval: string;
  memoryDigest: string;
  layers: ContextAssemblyLayerSummary[];
  recentMessageCount: number;
  omittedMessageCount: number;
  budget: {
    maxContextChars: number;
    systemPromptChars: number;
    supportChars: number;
    recentHistoryChars: number;
    totalChars: number;
  };
}

export interface ContextAssemblyResult {
  messages: ChatMessage[];
  metadata: ContextAssemblyMetadata;
}

interface ContextAssemblyInput {
  systemPrompt: string;
  workspace: string;
  history: ChatMessage[];
  loadedSkills?: Array<{
    skillName: string;
    skillId?: string;
    contentHash?: string;
    source?: string;
    allowedTools: string[];
    loadedAt: number;
    description?: string;
    whenToUse?: string;
    instructions?: string;
    userInvocable?: boolean;
    modelInvocable?: boolean;
    executionMode?: 'inline' | 'fork';
    activationSource?: 'manual' | 'automatic';
    resolvedArguments?: Record<string, string>;
    resourcePaths?: string[];
    scriptPaths?: string[];
  }>;
  activeSkillsSummary?: string;
  availableSkillsSummary?: string;
  availableToolsSummary?: string;
  availableToolNames?: string[];
  run?: RunSummary | null;
  runSteps?: RunStep[];
  pendingApproval?: ApprovalRecord | null;
  episodicSummaries?: RunContextSummary[];
  maxContextChars?: number;
}

function trimText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildActiveTaskSummary(run: RunSummary | null | undefined, runSteps: RunStep[] | undefined, maxChars: number) {
  if (!run || maxChars <= 0) {
    return '';
  }

  const sections = [
    `- runId: ${run.id}`,
    `- goal: ${trimText(run.goal || run.userInput || '', 320)}`,
    `- status: ${run.status}`
  ];
  const steps = Array.isArray(runSteps) ? runSteps : [];
  const recentSteps = steps.slice(-6).map((step) => {
    const suffix = step.error
      ? ` | error: ${trimText(step.error, 160)}`
      : step.output
        ? ` | output: ${trimText(JSON.stringify(step.output), 180)}`
        : '';
    return `- step ${step.stepIndex} [${step.type}/${step.status}] ${step.title}${suffix}`;
  });

  if (recentSteps.length > 0) {
    sections.push(...recentSteps);
  }

  return trimText(sections.join('\n'), maxChars);
}

function buildPendingApprovalSummary(pendingApproval: ApprovalRecord | null | undefined, maxChars: number) {
  if (!pendingApproval || maxChars <= 0) {
    return '';
  }

  const argsText = trimText(JSON.stringify(pendingApproval.args || {}), 240);
  return trimText([
    `- approvalId: ${pendingApproval.id}`,
    `- tool: ${pendingApproval.toolName}`,
    `- status: ${pendingApproval.status}`,
    `- args: ${argsText}`
  ].join('\n'), maxChars);
}

function buildEpisodicMemorySummary(summaries: RunContextSummary[] | undefined, maxChars: number) {
  if (!Array.isArray(summaries) || summaries.length === 0 || maxChars <= 0) {
    return '';
  }

  const rendered = summaries
    .slice(0, 3)
    .map((summary, index) => [
      `- memory ${index + 1}: run ${summary.runId}`,
      `  task: ${trimText(summary.activeTaskSummary, 220)}`,
      summary.activeSkillsSummary ? `  skills: ${trimText(summary.activeSkillsSummary, 180)}` : '',
      summary.selectedToolResults ? `  tools: ${trimText(summary.selectedToolResults, 240)}` : '',
      summary.workspaceRetrieval ? `  workspace: ${trimText(summary.workspaceRetrieval, 180)}` : ''
    ].filter(Boolean).join('\n'))
    .join('\n');

  return trimText(rendered, maxChars);
}

function buildStructuredSection(tag: string, content: string) {
  if (!content.trim()) {
    return '';
  }
  return `<${tag}>\n${content}\n</${tag}>`;
}

function buildSupportSystemMessage(
  header: string,
  sections: Array<{ tag: string; content: string }>
) {
  const rendered = sections
    .filter((section) => section.content.trim().length > 0)
    .map((section) => buildStructuredSection(section.tag, section.content))
    .join('\n\n');

  if (!rendered.trim()) {
    return '';
  }

  return [
    '<context_assembly>',
    header,
    'Prefer recent turns as source of truth when they conflict with compressed history.',
    rendered,
    '</context_assembly>'
  ].join('\n');
}

function allocateSupportSectionBudgets(
  sections: Array<{ tag: string; content: string; priority: number; maxChars: number }>,
  totalBudget: number
) {
  if (totalBudget <= 0) {
    return sections.map((section) => ({
      tag: section.tag,
      content: ''
    }));
  }

  const normalizedSections = sections
    .filter((section) => section.content.trim().length > 0)
    .sort((left, right) => right.priority - left.priority);
  if (normalizedSections.length === 0) {
    return sections.map((section) => ({
      tag: section.tag,
      content: ''
    }));
  }

  const allocated = new Map<string, string>();
  let remainingBudget = totalBudget;

  for (let index = 0; index < normalizedSections.length; index += 1) {
    const section = normalizedSections[index];
    const remainingSections = normalizedSections.length - index;
    const targetBudget = Math.max(120, Math.floor(remainingBudget / remainingSections));
    const sectionBudget = Math.min(section.maxChars, Math.max(targetBudget, Math.min(section.content.length, section.maxChars)));
    const trimmedContent = trimText(section.content, sectionBudget);
    allocated.set(section.tag, trimmedContent);
    remainingBudget = Math.max(0, remainingBudget - trimmedContent.length);
  }

  return sections.map((section) => ({
    tag: section.tag,
    content: allocated.get(section.tag) || ''
  }));
}

function buildLoadedSkillsSummary(
  loadedSkills: Array<{
    skillName: string;
    contentHash?: string;
    source?: string;
    allowedTools: string[];
    loadedAt: number;
    description?: string;
    whenToUse?: string;
    instructions?: string;
    userInvocable?: boolean;
    modelInvocable?: boolean;
    executionMode?: 'inline' | 'fork';
    activationSource?: 'manual' | 'automatic';
    resourcePaths?: string[];
    scriptPaths?: string[];
  }> | undefined,
  maxChars: number
) {
  if (!Array.isArray(loadedSkills) || loadedSkills.length === 0 || maxChars <= 0) {
    return '';
  }

  const summarizePaths = (paths: string[] | undefined, maxItems: number) => {
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

  const rendered = loadedSkills
    .slice()
    .sort((left, right) => right.loadedAt - left.loadedAt)
    .slice(0, 4)
    .map((skill, index) => {
      const allowedTools = skill.allowedTools.length > 0
        ? skill.allowedTools.join(', ')
        : 'none';
      const invocation = skill.modelInvocable === false
        ? (skill.userInvocable === false ? 'hidden' : 'manual_only')
        : 'auto';
      const resourceSummary = summarizePaths(skill.resourcePaths, 3);
      const scriptSummary = summarizePaths(skill.scriptPaths, 2);
      const source = skill.source ? ` | source: ${skill.source}` : '';
      const hash = skill.contentHash ? ` | hash: ${skill.contentHash.slice(0, 12)}` : '';
      return [
        `- skill ${index + 1}: ${skill.skillName}`,
        skill.description ? `  description: ${trimText(skill.description, 220)}` : '',
        skill.whenToUse ? `  when_to_use: ${trimText(skill.whenToUse, 260)}` : '',
        `  invocation: ${invocation} | execution: ${skill.executionMode || 'inline'} | activation: ${skill.activationSource || 'manual'}${source}${hash}`,
        `  allowed_tools: ${trimText(allowedTools, 220)}`,
        skill.instructions ? `  instructions: ${trimText(skill.instructions, 420)}` : '',
        `  resources: ${trimText(resourceSummary, 240)}`,
        `  scripts: ${trimText(scriptSummary, 180)}`
      ].filter(Boolean).join('\n');
    })
    .join('\n');

  return trimText(rendered, maxChars);
}

function buildActiveSkillInstructions(
  loadedSkills: Array<{
    skillName: string;
    skillId?: string;
    contentHash?: string;
    source?: string;
    allowedTools: string[];
    loadedAt: number;
    instructions?: string;
    executionMode?: 'inline' | 'fork';
    activationSource?: 'manual' | 'automatic';
    resolvedArguments?: Record<string, string>;
    resourcePaths?: string[];
    scriptPaths?: string[];
  }> | undefined,
  maxChars: number
) {
  if (!Array.isArray(loadedSkills) || loadedSkills.length === 0 || maxChars <= 0) {
    return '';
  }

  const skillsWithInstructions = loadedSkills
    .filter((skill) => typeof skill.instructions === 'string' && skill.instructions.trim().length > 0)
    .sort((left, right) => right.loadedAt - left.loadedAt)
    .slice(0, 3);

  if (skillsWithInstructions.length === 0) {
    return '';
  }

  const renderPathSummary = (label: string, paths: string[] | undefined, maxItems: number) => {
    const normalizedPaths = Array.from(new Set((paths ?? []).map((entry) => entry.trim()).filter(Boolean)));
    if (normalizedPaths.length === 0) {
      return '';
    }
    const displayedPaths = normalizedPaths.slice(0, maxItems);
    const omittedCount = normalizedPaths.length - displayedPaths.length;
    const suffix = omittedCount > 0 ? ` (+${omittedCount} more)` : '';
    return `${label}: ${displayedPaths.join(', ')}${suffix}`;
  };

  const renderedSkills: string[] = [];

  for (const skill of skillsWithInstructions) {
    const identity = skill.skillId && skill.skillId !== skill.skillName
      ? `${skill.skillName} (${skill.skillId})`
      : skill.skillName;
    const allowedTools = skill.allowedTools.length > 0 ? skill.allowedTools.join(', ') : 'none';
    const argumentEntries = Object.entries(skill.resolvedArguments ?? {});
    const argumentSummary = argumentEntries.length > 0
      ? `arguments: ${argumentEntries.map(([key, value]) => `${key}=${value}`).join(', ')}`
      : '';
    const resourceSummary = renderPathSummary('resources', skill.resourcePaths, 5);
    const scriptSummary = renderPathSummary('scripts', skill.scriptPaths, 3);
    const metadata = [
      `name: ${identity}`,
      skill.source ? `source: ${skill.source}` : '',
      skill.contentHash ? `content_hash: ${skill.contentHash}` : '',
      `activation: ${skill.activationSource || 'manual'}`,
      `execution: ${skill.executionMode || 'inline'}`,
      `allowed_tools: ${allowedTools}`,
      argumentSummary,
      resourceSummary,
      scriptSummary
    ].filter(Boolean).join('\n');
    const block = [
      `<skill>`,
      metadata,
      '<instructions>',
      skill.instructions?.trim() || '',
      '</instructions>',
      '</skill>'
    ].join('\n');
    const candidate = [...renderedSkills, block].join('\n\n');
    const omittedCount = skillsWithInstructions.length - renderedSkills.length - 1;
    const candidateWithSuffix = omittedCount > 0
      ? `${candidate}\n\n- ${omittedCount} more loaded skills omitted from full instruction context.`
      : candidate;

    if (candidateWithSuffix.length > maxChars) {
      if (renderedSkills.length === 0) {
        return trimText(block, maxChars);
      }
      break;
    }

    renderedSkills.push(block);
  }

  const omittedCount = skillsWithInstructions.length - renderedSkills.length;
  const suffix = omittedCount > 0
    ? `\n\n- ${omittedCount} more loaded skills omitted from full instruction context.`
    : '';

  return trimText(`${renderedSkills.join('\n\n')}${suffix}`, maxChars);
}

function buildAvailableSkillsSummary(availableSkillsSummary: string | undefined, maxChars: number) {
  if (!availableSkillsSummary || maxChars <= 0) {
    return '';
  }

  return trimText(availableSkillsSummary, maxChars);
}

function buildAvailableToolsSummary(availableToolNames: string[] | undefined, maxChars: number) {
  if (!Array.isArray(availableToolNames) || availableToolNames.length === 0 || maxChars <= 0) {
    return '';
  }

  const uniqueToolNames = Array.from(new Set(availableToolNames.map((name) => name.trim()).filter(Boolean)));
  if (uniqueToolNames.length === 0) {
    return '';
  }

  return trimText(uniqueToolNames.join(', '), maxChars);
}

function createLayer(
  id: string,
  title: string,
  kind: 'system' | 'support' | 'history',
  summary: string,
  messageCount: number,
  charCount: number
): ContextAssemblyLayerSummary {
  return {
    id,
    title,
    kind,
    summary,
    messageCount,
    charCount
  };
}

export function assembleRuntimeContext(input: ContextAssemblyInput): ContextAssemblyResult {
  const maxContextChars = Math.max(12000, input.maxContextChars ?? 48000);
  const systemPromptChars = input.systemPrompt.length;
  const remainingChars = Math.max(8000, maxContextChars - systemPromptChars);
  const supportBudget = Math.min(18000, Math.floor(remainingChars * 0.45));
  const recentHistoryBudget = Math.max(6000, remainingChars - supportBudget);
  const selection = selectRecentMessages(input.history, recentHistoryBudget, 8);
  const hasLoadedSkillInstructions = Array.isArray(input.loadedSkills)
    && input.loadedSkills.some((skill) => typeof skill.instructions === 'string' && skill.instructions.trim().length > 0);
  const activeSkillInstructionsBudget = hasLoadedSkillInstructions
    ? Math.min(10000, Math.max(1800, Math.floor(supportBudget * 0.48)))
    : 0;
  const remainingSupportBudget = Math.max(0, supportBudget - activeSkillInstructionsBudget);
  const runtimeStateBudget = Math.min(7000, Math.max(1200, Math.floor(remainingSupportBudget * 0.45)));
  const memoryBudget = Math.max(0, remainingSupportBudget - runtimeStateBudget);

  const activeTaskSummary = buildActiveTaskSummary(input.run, input.runSteps, 3200);
  const activeSkillsSummary = input.activeSkillsSummary
    ? trimText(input.activeSkillsSummary, 2200)
    : buildLoadedSkillsSummary(input.loadedSkills, 2200);
  const activeSkillInstructions = buildActiveSkillInstructions(input.loadedSkills, activeSkillInstructionsBudget);
  const availableSkillsSummary = buildAvailableSkillsSummary(input.availableSkillsSummary, 2600);
  const availableToolsSummary = input.availableToolsSummary
    ? trimText(input.availableToolsSummary, 1800)
    : buildAvailableToolsSummary(input.availableToolNames, 1800);
  const unresolvedApprovals = buildPendingApprovalSummary(input.pendingApproval, 1200);
  const compactedHistorySummary = buildCompactedHistorySummary(selection.omittedMessages, 4200);
  const selectedToolResults = buildSelectedToolResults(selection.omittedMessages.length > 0 ? selection.omittedMessages : input.history, 3600);
  const workspaceRetrieval = buildWorkspaceRetrievalDigest(input.workspace, 2600);
  const episodicMemory = buildEpisodicMemorySummary(input.episodicSummaries, 1600);
  const memoryDigest = buildMemoryDigest(input.workspace, 3200, episodicMemory);

  const runtimeStateSections = allocateSupportSectionBudgets([
    { tag: 'active_task_summary', content: activeTaskSummary, priority: 5, maxChars: 3200 },
    { tag: 'unresolved_approvals', content: unresolvedApprovals, priority: 4, maxChars: 1200 },
    { tag: 'active_skills', content: activeSkillsSummary, priority: 3, maxChars: 2200 },
    { tag: 'available_skills', content: availableSkillsSummary, priority: 2, maxChars: 2600 },
    { tag: 'available_tools', content: availableToolsSummary, priority: 1, maxChars: 1800 }
  ], Math.max(1200, runtimeStateBudget - 240));
  const activeSkillInstructionsMessage = buildSupportSystemMessage('Loaded skill instructions for this run. Follow them only when they do not conflict with higher-priority security, workspace, or user instructions.', [
    { tag: 'active_skill_instructions', content: activeSkillInstructions }
  ]);
  const runtimeStateMessage = buildSupportSystemMessage('Use the following runtime state as a budget-managed summary.', runtimeStateSections);
  const memoryMessage = buildSupportSystemMessage('Use the following memory and retrieval context as a budget-managed summary.', [
    { tag: 'compacted_history', content: compactedHistorySummary },
    { tag: 'selected_tool_results', content: selectedToolResults },
    { tag: 'workspace_retrieval', content: workspaceRetrieval },
    { tag: 'memory_digest', content: memoryDigest }
  ]);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: input.systemPrompt,
      timestamp: Date.now()
    }
  ];
  const layers: ContextAssemblyLayerSummary[] = [
    createLayer(
      'base_instructions',
      '基础系统提示',
      'system',
      '核心身份、规则与环境信息。',
      1,
      input.systemPrompt.length
    )
  ];

  const trimmedActiveSkillInstructionsMessage = activeSkillInstructionsMessage
    ? trimText(activeSkillInstructionsMessage, activeSkillInstructionsBudget)
    : '';
  if (trimmedActiveSkillInstructionsMessage) {
    messages.push({
      role: 'system',
      content: trimmedActiveSkillInstructionsMessage,
      timestamp: Date.now()
    });
    layers.push(createLayer(
      'active_skill_instructions',
      '激活技能指令层',
      'support',
      trimText(activeSkillInstructions, 280),
      1,
      trimmedActiveSkillInstructionsMessage.length
    ));
  }

  const trimmedRuntimeStateMessage = runtimeStateMessage
    ? trimText(runtimeStateMessage, runtimeStateBudget)
    : '';
  if (trimmedRuntimeStateMessage) {
    messages.push({
      role: 'system',
      content: trimmedRuntimeStateMessage,
      timestamp: Date.now()
    });
    layers.push(createLayer(
      'runtime_state',
      '运行时状态层',
      'support',
      trimText([
        runtimeStateSections.find((section) => section.tag === 'active_task_summary')?.content || '',
        runtimeStateSections.find((section) => section.tag === 'unresolved_approvals')?.content || '',
        runtimeStateSections.find((section) => section.tag === 'active_skills')?.content || '',
        runtimeStateSections.find((section) => section.tag === 'available_skills')?.content || '',
        runtimeStateSections.find((section) => section.tag === 'available_tools')?.content || ''
      ].filter(Boolean).join(' | '), 280),
      1,
      trimmedRuntimeStateMessage.length
    ));
  }

  const trimmedMemoryMessage = memoryMessage
    ? trimText(memoryMessage, memoryBudget)
    : '';
  if (trimmedMemoryMessage) {
    messages.push({
      role: 'system',
      content: trimmedMemoryMessage,
      timestamp: Date.now()
    });
    layers.push(createLayer(
      'memory_context',
      '记忆与检索层',
      'support',
      trimText([
        compactedHistorySummary,
        selectedToolResults,
        workspaceRetrieval,
        memoryDigest
      ].filter(Boolean).join(' | '), 280),
      1,
      trimmedMemoryMessage.length
    ));
  }

  messages.push(...selection.selectedMessages);
  layers.push(createLayer(
    'recent_history',
    '最近对话层',
    'history',
    trimText(`保留最近 ${selection.selectedMessages.length} 条消息，省略 ${selection.omittedMessages.length} 条历史消息。`, 160),
    selection.selectedMessages.length,
    selection.selectedChars
  ));

  const totalChars = messages.reduce((sum, message) => sum + (message.content?.length || 0), 0);
  const supportChars = [
    trimmedActiveSkillInstructionsMessage.length,
    trimmedRuntimeStateMessage.length,
    trimmedMemoryMessage.length
  ].reduce((sum, size) => sum + size, 0);

  return {
    messages,
    metadata: {
      activeTaskSummary,
      activeSkillsSummary,
      availableSkillsSummary,
      availableToolsSummary,
      compactedHistorySummary,
      unresolvedApprovals,
      selectedToolResults,
      workspaceRetrieval,
      memoryDigest,
      layers,
      recentMessageCount: selection.selectedMessages.length,
      omittedMessageCount: selection.omittedMessages.length,
      budget: {
        maxContextChars,
        systemPromptChars,
        supportChars,
        recentHistoryChars: selection.selectedChars,
        totalChars
      }
    }
  };
}
