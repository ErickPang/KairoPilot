import { ApprovalRecord, RunContextSummary, RunStep, RunSummary } from '../../../shared/contracts';
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
  compactedHistorySummary: string;
  unresolvedApprovals: string;
  selectedToolResults: string;
  workspaceRetrieval: string;
  memoryDigest: string;
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
      summary.selectedToolResults ? `  tools: ${trimText(summary.selectedToolResults, 240)}` : '',
      summary.workspaceRetrieval ? `  workspace: ${trimText(summary.workspaceRetrieval, 180)}` : ''
    ].filter(Boolean).join('\n'))
    .join('\n');

  return trimText(rendered, maxChars);
}

function buildSupportSystemMessage(sections: Array<{ tag: string; content: string }>) {
  const rendered = sections
    .filter((section) => section.content.trim().length > 0)
    .map((section) => `<${section.tag}>\n${section.content}\n</${section.tag}>`)
    .join('\n\n');

  if (!rendered.trim()) {
    return '';
  }

  return [
    '<context_assembly>',
    'Use the following runtime context as a budget-managed summary.',
    'Prefer recent turns as source of truth when they conflict with compressed history.',
    rendered,
    '</context_assembly>'
  ].join('\n');
}

export function assembleRuntimeContext(input: ContextAssemblyInput): ContextAssemblyResult {
  const maxContextChars = Math.max(12000, input.maxContextChars ?? 48000);
  const systemPromptChars = input.systemPrompt.length;
  const remainingChars = Math.max(8000, maxContextChars - systemPromptChars);
  const supportBudget = Math.min(18000, Math.floor(remainingChars * 0.45));
  const recentHistoryBudget = Math.max(6000, remainingChars - supportBudget);
  const selection = selectRecentMessages(input.history, recentHistoryBudget, 8);

  const activeTaskSummary = buildActiveTaskSummary(input.run, input.runSteps, 3200);
  const unresolvedApprovals = buildPendingApprovalSummary(input.pendingApproval, 1200);
  const compactedHistorySummary = buildCompactedHistorySummary(selection.omittedMessages, 4200);
  const selectedToolResults = buildSelectedToolResults(selection.omittedMessages.length > 0 ? selection.omittedMessages : input.history, 3600);
  const workspaceRetrieval = buildWorkspaceRetrievalDigest(input.workspace, 2600);
  const episodicMemory = buildEpisodicMemorySummary(input.episodicSummaries, 1600);
  const memoryDigest = buildMemoryDigest(input.workspace, 3200, episodicMemory);

  const supportMessage = buildSupportSystemMessage([
    { tag: 'active_task_summary', content: activeTaskSummary },
    { tag: 'compacted_history', content: compactedHistorySummary },
    { tag: 'unresolved_approvals', content: unresolvedApprovals },
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

  if (supportMessage) {
    messages.push({
      role: 'system',
      content: trimText(supportMessage, supportBudget),
      timestamp: Date.now()
    });
  }

  messages.push(...selection.selectedMessages);

  const totalChars = messages.reduce((sum, message) => sum + (message.content?.length || 0), 0);

  return {
    messages,
    metadata: {
      activeTaskSummary,
      compactedHistorySummary,
      unresolvedApprovals,
      selectedToolResults,
      workspaceRetrieval,
      memoryDigest,
      recentMessageCount: selection.selectedMessages.length,
      omittedMessageCount: selection.omittedMessages.length,
      budget: {
        maxContextChars,
        systemPromptChars,
        supportChars: supportMessage.length,
        recentHistoryChars: selection.selectedChars,
        totalChars
      }
    }
  };
}
