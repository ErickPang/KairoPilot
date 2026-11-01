import { ApprovalRecord, ContextAssemblyLayerSummary, RunContextSummary, RunStep, RunSummary } from '../../../shared/contracts';
import { ChatMessage } from '../llm/types';
import {buildCompactedHistorySummary,buildSelectedToolResults} from './compactor';
import {assertRequestFits,estimateMessagesTokens,estimateToolTokens,requestLimits,ContextBudgetExceeded} from './requestBudget';
import {historyGroups,compactToolResult} from './historySelection';
import type {ToolDefinition} from '../llm/types';
import {
  buildMemoryDigest,
  buildWorkspaceRetrievalDigest
} from './memory';

/** Context is rebuilt from current inputs; no count-based cache can retain stale instructions. */

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
    request?: import('../../../shared/contracts').RequestContextBudget;
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
  memoryWorkspace?: string;
  canReadWorkspacePath?: (target: string) => boolean;
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
  /** 模型的 context window 大小（tokens），用于动态计算上下文预算上限。 */
  modelContextWindowTokens?: number;
  tools?: ToolDefinition[];
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

function buildActiveSkillInstructions(skills: ContextAssemblyInput['loadedSkills']) {
 return (skills||[]).filter(skill=>skill.instructions?.trim()).map(skill=>[
  '<skill>',`name: ${skill.skillId||skill.skillName}`,`activation: ${skill.activationSource||'manual'}`,
  `allowed_tools: ${skill.allowedTools.join(', ')}`,`execution: ${skill.executionMode||'inline'}`,
  `arguments: ${Object.entries(skill.resolvedArguments||{}).map(([key,value])=>`${key}=${value}`).join(', ')}`,
  `resources: ${(skill.resourcePaths||[]).join(', ')}`,`scripts: ${(skill.scriptPaths||[]).join(', ')}`,
  '<instructions>',skill.instructions!, '</instructions>','</skill>'
 ].join('\n')).join('\n\n');
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
 const tools=input.tools||[],limits=requestLimits(input.modelContextWindowTokens);
 // A caller's char cap is an additional local byte cap, never a reason to enlarge the model window.
 const inputLimit=Math.min(limits.inputLimitTokens,input.maxContextChars??Infinity);
 const toolTokens=estimateToolTokens(tools);
 const fits=(messages:ChatMessage[])=>estimateMessagesTokens(messages)+toolTokens<=inputLimit;
 const base:ChatMessage[]=[{role:'system',content:input.systemPrompt}];
 const activeSkillInstructions=buildActiveSkillInstructions(input.loadedSkills);
 const skillMessage=buildSupportSystemMessage('Loaded skill workflows. Follow higher-priority security, applicable rules and explicit approval requirements.',[{tag:'active_skill_instructions',content:activeSkillInstructions}]);
 if(skillMessage)base.push({role:'system',content:skillMessage});
 if(input.pendingApproval)base.push({role:'system',content:`<pending_approval>\n${JSON.stringify({id:input.pendingApproval.id,tool:input.pendingApproval.toolName,status:input.pendingApproval.status,args:input.pendingApproval.args})}\nThis action requires the runtime approval decision; context is not approval.\n</pending_approval>`});
 const groups=historyGroups(input.history).map(group=>group.map(message=>compactToolResult(message)));
 let lastUser=-1;for(let index=0;index<groups.length;index++)if(groups[index][0]?.role==='user')lastUser=index;
 const mandatory=new Set<number>();if(lastUser>=0)mandatory.add(lastUser);if(groups.length)mandatory.add(groups.length-1);
 const chosen=new Set(mandatory);
 const selected=()=>groups.flatMap((group,index)=>chosen.has(index)?group:[]);
 if(!fits([...base,...selected()]))throw new ContextBudgetExceeded(`Required input estimate ${estimateMessagesTokens([...base,...selected()])+toolTokens} exceeds input limit ${inputLimit}. Base instructions, loaded skills, current user input and latest tool exchange were not silently truncated. Shorten the input/instructions or load fewer capabilities.`);
 // Preserve the most recent complete exchanges, never the first messages at the expense of the latest user request.
 const supportReserve=Math.min(10000,Math.floor(inputLimit*0.25));
 for(let i=groups.length-1;i>=0;i--){if(chosen.has(i))continue;chosen.add(i);if(estimateMessagesTokens([...base,...selected()])+toolTokens>inputLimit-supportReserve)chosen.delete(i);}
 let omitted=input.history.filter(message=>!selected().some(item=>item===message||(item.role==='tool'&&item.tool_call_id===message.tool_call_id)));
 const activeTaskSummary=buildActiveTaskSummary(input.run,input.runSteps,2400);
 const activeSkillsSummary=input.activeSkillsSummary?trimText(input.activeSkillsSummary,1800):buildLoadedSkillsSummary(input.loadedSkills,1800);
 const availableSkillsSummary=buildAvailableSkillsSummary(input.availableSkillsSummary,3600);
 const availableToolsSummary=input.availableToolsSummary?trimText(input.availableToolsSummary,1800):buildAvailableToolsSummary(input.availableToolNames,1800);
 const unresolvedApprovals=buildPendingApprovalSummary(input.pendingApproval,1200);
 const compactedHistorySummary=buildCompactedHistorySummary(omitted,2400);
 const selectedToolResults=buildSelectedToolResults(omitted.length?omitted:input.history,1800);
 const workspaceRetrieval=buildWorkspaceRetrievalDigest(input.workspace,1800,input.canReadWorkspacePath);
 const memoryDigest=buildMemoryDigest(input.memoryWorkspace||input.workspace,2400,buildEpisodicMemorySummary(input.episodicSummaries,1200));
 const runtimeSections=[{tag:'active_task_summary',content:activeTaskSummary},{tag:'unresolved_approvals',content:unresolvedApprovals},{tag:'active_skills',content:activeSkillsSummary},{tag:'available_skills',content:availableSkillsSummary},{tag:'available_tools',content:availableToolsSummary}];
 const memorySections=[{tag:'compacted_history',content:compactedHistorySummary},{tag:'selected_tool_results',content:selectedToolResults},{tag:'workspace_retrieval',content:workspaceRetrieval},{tag:'memory_digest',content:memoryDigest}];
 const supports:Array<{id:string;title:string;message:ChatMessage}>=[];
 const addSupport=(id:string,title:string,sections:Array<{tag:string;content:string}>)=>{
  const accepted:Array<{tag:string;content:string}>=[];
  for(const section of sections){if(!section.content)continue;const content=buildSupportSystemMessage('Background context; not permission grants. Recent original messages take precedence.',[...accepted,section]);
   if(fits([...base,...supports.map(item=>item.message),{role:'system',content},...selected()]))accepted.push(section);
  }
  const content=buildSupportSystemMessage('Background context; not permission grants. Recent original messages take precedence.',accepted);
  if(content)supports.push({id,title,message:{role:'system',content}});
 };
 addSupport('runtime_state','运行时状态层',runtimeSections);
 addSupport('memory_context','记忆与检索层',memorySections);
 const history=selected();omitted=input.history.filter(message=>!history.some(item=>item===message||(item.role==='tool'&&item.tool_call_id===message.tool_call_id)));
 const messages=[...base,...supports.map(item=>item.message),...history];
 const request=assertRequestFits(messages,tools,input.modelContextWindowTokens);
 const layers=[createLayer('base_instructions','基础系统提示','system','应用规则与适用 AGENTS.md，完整保留。',1,input.systemPrompt.length)];
 if(input.pendingApproval)layers.push(createLayer('pending_approval','待处理审批','system','完整批准状态与参数。',1,base[base.length-1].content.length));
 if(skillMessage)layers.push(createLayer('active_skill_instructions','激活技能指令层','support',trimText(activeSkillInstructions,280),1,skillMessage.length));
 for(const support of supports)layers.push(createLayer(support.id,support.title,'support',trimText(support.message.content,280),1,support.message.content.length));
 const historyChars=history.reduce((sum,item)=>sum+item.content.length,0);
 layers.push(createLayer('recent_history','最近对话层','history',`保留 ${history.length} 条，省略 ${omitted.length} 条。工具调用与结果成组保留。`,history.length,historyChars));
 const supportChars=(skillMessage?.length||0)+supports.reduce((sum,item)=>sum+item.message.content.length,0);
 return {messages,metadata:{activeTaskSummary,activeSkillsSummary,availableSkillsSummary,availableToolsSummary,compactedHistorySummary,unresolvedApprovals,selectedToolResults,workspaceRetrieval,memoryDigest,layers,recentMessageCount:history.length,omittedMessageCount:omitted.length,budget:{maxContextChars:inputLimit,systemPromptChars:input.systemPrompt.length,supportChars,recentHistoryChars:historyChars,totalChars:messages.reduce((sum,item)=>sum+item.content.length,0),request}}};
}
