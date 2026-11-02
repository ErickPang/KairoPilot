import { createDefaultAgentPermissions, type AgentConfig, type RunStatus, type RunSummary, type RuntimeUpdateEvent, type TaskExecutionSettings, type TaskPlan, type TaskTemplate } from '../shared/contracts';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../shared/ipc';
import { BUILTIN_TASK_TEMPLATES } from '../shared/taskTemplates';
import type { Session } from './types';

// Browser-only, explicit development preview. No files, credentials or model requests.
export function installWorkbenchPreview() {
  const params = new URLSearchParams(window.location.search);
  const selected = params.get('workbench-preview');
  if (!selected) return;
  document.documentElement.dataset.workbenchPreview = 'true';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const permissions = createDefaultAgentPermissions();
  permissions.executionProfile = 'approved_execution';
  const agent: AgentConfig = { id: 'preview-agent', name: '工作助手', workspace: '/demo/workspace', workspaceName: '本地工作区', model: 'preview/demo-model', permissions, systemPrompt: '' };
  const now = Date.now();
  const finalResponse = '已完成本轮资料整理。\n\n- 按主题整理了工作区中的研究笔记。\n- 生成了报告结构和后续核验清单。\n\n### 下一步\n请在文件面板查看 `研究摘要.md`，并核对其中的来源。\n\n本次原型使用模拟内容，没有执行真实文件操作。';
  const sessions: Session[] = [
    { id: 'preview-task-1', title: '整理研究资料，生成项目摘要', agentId: agent.id, messages: selected === 'empty' ? [] : [{ role: 'user', content: '帮我整理研究资料，给出项目摘要和需要继续核验的事项。' }, { role: 'assistant', content: selected === 'completed' ? finalResponse : '我正在检查资料的主题与来源，接下来整理摘要和核验事项。' }], createdAt: now - 1800000, updatedAt: now },
    { id: 'preview-task-2', title: '梳理下周的工作安排', agentId: agent.id, messages: [{ role: 'user', content: '帮我梳理下周的工作安排。' }, { role: 'assistant', content: '请提供计划和约束，我会按优先级整理。' }], createdAt: now - 7200000, updatedAt: now - 3600000 }
  ];
  const validStatuses: RunStatus[] = ['running', 'waiting_approval', 'paused', 'completed', 'failed', 'cancelled'];
  const status = validStatuses.includes(selected as RunStatus) ? selected as RunStatus : 'running';
  let activeId = sessions[0].id;
  const runs = new Map<string, RunSummary>();
  if (selected !== 'empty') runs.set(activeId, { id: 'preview-run-1', agentId: agent.id, sessionId: activeId, status, goal: '整理研究资料，生成项目摘要', userInput: '整理研究资料', finalResponse: status === 'completed' ? finalResponse : undefined, error: status === 'failed' ? '模拟：资料读取失败，请核对目录后重试。' : undefined, createdAt: now - 120000, updatedAt: now });
  const drafts = new Map<string, import('../shared/contracts').TaskDraft>();
  const references = new Map<string, import('../shared/contracts').ContextReference>();
  const templates: TaskTemplate[] = structuredClone(BUILTIN_TASK_TEMPLATES);
  const plans = new Map<string, TaskPlan>();
  const listeners = new Set<(event: RuntimeUpdateEvent) => void>();
  const emit = (event: RuntimeUpdateEvent) => listeners.forEach((listener) => listener({ ...event, agentId: agent.id, sessionId: activeId }));
  const getSession = () => sessions.find((session) => session.id === activeId)!;
  window.kairo = {
    invoke: (async (channel: string, ...args: unknown[]) => {
      const run = runs.get(activeId);
      if (channel === KAIRO_INVOKE.chatConversation) {
        const run = runs.get(getSession().id);
        return { rounds: run ? [{ run, items: getSession().messages.map((message,index) => ({ id: `${run.id}:preview:${index}`, runId: run.id, sequence: index, kind: message.role === 'user' ? 'user' : run.status === 'completed' && index === getSession().messages.length - 1 ? 'final' : 'commentary', content: message.content || '', status: 'completed' })) }] : [] };
      }
      if (channel === KAIRO_INVOKE.chatConversationDetails) return {};
      if (channel === KAIRO_INVOKE.chatQuerySessions) {
        const query = (args[0] || {}) as import('../shared/contracts').SessionListQuery;
        const items = sessions.filter((session) => query.filter !== 'archived' && query.filter !== 'unread' && (!query.search || session.title.toLowerCase().includes(query.search.toLowerCase())))
          .map((session) => ({ ...session, messages: undefined, runStatus: runs.get(session.id)?.status }));
        return { items: items.slice(0, query.limit || 50), total: items.length, selectedSession: items.find((item) => item.id === query.includeSessionId) };
      }
      if (channel === KAIRO_INVOKE.chatGetActiveSummary) return { ...getSession(), messages: undefined };
      if (channel === KAIRO_INVOKE.chatGetMessagePage) {
        const query = args[0] as import('../shared/contracts').MessagePageQuery;
        const session = sessions.find((item) => item.id === query.sessionId)!;
        const end = query.before ? query.before.rowId - 1 : session.messages.length;
        const start = Math.max(0, end - (query.limit || 100));
        return { session: { ...session, messages: undefined }, messages: session.messages.slice(start, end), total: session.messages.length, generation: 0, ...(start > 0 ? { nextCursor: { rowId: start + 1, timestamp: 0, generation: 0 } } : {}) };
      }
      if (channel === KAIRO_INVOKE.chatGetDraft) return drafts.get(String(args[0])) || { revision: 0, input: '', referenceIds: [], attachmentIds: [], references: [], attachments: [], missingAttachmentIds: [] };
      if (channel === KAIRO_INVOKE.chatCreateReference) {
        const value = args[0] as { sessionId: string; path: string };
        const reference = { id: `preview-ref-${references.size}`, sessionId: value.sessionId, agentId: agent.id, path: value.path, name: value.path.split('/').pop() || value.path, kind: value.path.endsWith('.md') ? 'file' as const : 'directory' as const, createdAt: Date.now(), availability: 'available' as const };
        references.set(reference.id, reference); return reference;
      }
      if (channel === KAIRO_INVOKE.chatSaveDraft) {
        const value = args[0] as { sessionId: string; revision: number; data: import('../shared/contracts').TaskDraftInput };
        if ((drafts.get(value.sessionId)?.revision || 0) !== value.revision) throw new Error('DRAFT_CONFLICT: preview draft changed.');
        drafts.set(value.sessionId, { ...value.data, revision: value.revision + 1, references: value.data.referenceIds.flatMap((id) => references.has(id) ? [references.get(id)!] : []), attachments: [], missingAttachmentIds: [] });
        return value.revision + 1;
      }
      if (channel === KAIRO_INVOKE.delegationList) return [];
      if (channel === KAIRO_INVOKE.projectMemoryGet) return {enabled:false,epoch:0,entries:[],jobs:[]};
      if (channel === KAIRO_INVOKE.projectList) return [];
      if (channel === KAIRO_INVOKE.taskTemplatesList) return structuredClone(templates);
      if (channel === KAIRO_INVOKE.taskTemplatesSave) {
        const data = args[0] as Pick<TaskTemplate, 'name' | 'instructions' | 'output' | 'acceptance'>;
        const template: TaskTemplate = { ...data, id: `preview-template-${templates.length}`, version: 1, builtin: false };
        templates.push(template); return structuredClone(template);
      }
      if (channel === KAIRO_INVOKE.chatUpdateTaskSettings) {
        const data = args[0] as { sessionId: string; model?: string; workflow?: 'direct' | 'plan'; delegation?:'off'|'auto'|'manual';intelligenceBudget?:TaskExecutionSettings['intelligenceBudget']; templateId?: string | null; permissions?: TaskExecutionSettings['permissions'] };
        const session = sessions.find(item => item.id === data.sessionId);
        if (!session) throw new Error('Preview task unavailable.');
        const settings = session.executionSettings || { model: agent.model, permissions: structuredClone(permissions) };
        session.executionSettings = { ...settings, ...(data.intelligenceBudget?{intelligenceBudget:data.intelligenceBudget}:{}), ...(data.delegation ? {delegation:data.delegation} : {}), ...(data.model ? { model: data.model } : {}), ...(data.permissions ? { permissions: data.permissions } : {}), ...(data.workflow ? { workflow: data.workflow } : {}), ...(data.templateId !== undefined ? { template: structuredClone(templates.find(item => item.id === data.templateId) || null) } : {}) };
        const pending = plans.get(session.id);
        if (pending?.status === 'pending') { pending.status = 'superseded'; pending.revision++; }
        return session;
      }
      if (channel === KAIRO_INVOKE.taskPlanGet) return structuredClone(plans.get(String(args[0])) || null);
      if ([KAIRO_INVOKE.taskPlanEdit, KAIRO_INVOKE.taskPlanReject, KAIRO_INVOKE.taskPlanApprove].some(value => value === channel)) {
        const data = args[0] as { sessionId: string; planId: string; revision: number; body?: string };
        const plan = plans.get(data.sessionId);
        if (!plan || plan.id !== data.planId || plan.revision !== data.revision || plan.status !== 'pending') throw new Error('Preview plan changed or was already handled.');
        plan.revision++; plan.updatedAt = Date.now();
        if (channel === KAIRO_INVOKE.taskPlanEdit) { plan.body = data.body!; return structuredClone(plan); }
        if (channel === KAIRO_INVOKE.taskPlanReject) { plan.status = 'rejected'; return structuredClone(plan); }
        plan.status = 'completed'; plan.approvedRevision = plan.revision;
        const session = sessions.find(item => item.id === data.sessionId)!;
        const execution: RunSummary = { id: `preview-execution-${Date.now()}`, sessionId: session.id, agentId: agent.id, status: 'completed', goal: plan.goal, userInput: plan.goal, finalResponse, createdAt: Date.now(), updatedAt: Date.now() };
        plan.executionRunId = execution.id; runs.set(session.id, execution);
        session.messages.push({ role: 'assistant', content: finalResponse });
        if (session.id === activeId) emit({ type: 'assistant-response', content: finalResponse, runId: execution.id, status: 'completed' });
        return { success: true, status: 'completed', runId: execution.id };
      }
      if(channel===KAIRO_INVOKE.usageOverview)return {totals:{promptTokens:0,completionTokens:0,totalTokens:0,records:0,peakDailyTokens:0,activeDays:0,runCount:0},daily:[],models:[],sources:{main:0,delegation:0,memory:0},startDate:'',endDate:'',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
      if (channel === KAIRO_INVOKE.taskQueueList) return [];
      if (channel === KAIRO_INVOKE.chatGetTaskResults) return { artifacts: [], verifications: [] };
      if (channel === KAIRO_INVOKE.configGetAll) return { version: '4.2.0', workbench: {version:2,defaultModel:agent.model,managementRoot:agent.workspace,permissions:agent.permissions,instructions:agent.systemPrompt}, models: { providers: { preview: { provider: 'custom', apiKey: '', baseUrl: '', model: [{ id: 'demo-model', name: 'Demo model' }] } } }, plugins: { registry: [] }, skills: { registry: [] }, appearance: { theme } };
      if (channel === KAIRO_INVOKE.configGetAppearance) return { theme };
      if (channel === KAIRO_INVOKE.workbenchInit) return { success: true };
      if (channel === KAIRO_INVOKE.chatListSessions) return sessions.map((session) => ({ ...session, messages: undefined, runStatus: runs.get(session.id)?.status }));
      if (channel === KAIRO_INVOKE.chatGetActiveSession) return getSession();
      if (channel === KAIRO_INVOKE.chatGetSession) return sessions.find((session) => session.id === args[0]) || null;
      if (channel === KAIRO_INVOKE.chatSetActiveSession) { activeId = String(args[0]); return { success: true }; }
      if (channel === KAIRO_INVOKE.chatCreateSession) {
        const session: Session = { id: `preview-task-${sessions.length + 1}`, title: String(args[0] || '新建任务'), agentId: agent.id, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        sessions.unshift(session); activeId = session.id; return session;
      }
      if (channel === KAIRO_INVOKE.chatUpdateSessionTitle) { const data = args[0] as { sessionId: string; title: string }; const session = sessions.find((item) => item.id === data.sessionId); if (session) session.title = data.title; return { success: true }; }
      if (channel === KAIRO_INVOKE.chatGetLatestRun) return runs.get(String(args[0])) || null;
      if (channel === KAIRO_INVOKE.chatGetPendingApproval) { const target = runs.get(String(args[0])); return target?.status === 'waiting_approval' ? { id: 'preview-approval', runId: target.id, sessionId: activeId, toolName: 'write_file', args: { path: '/demo/workspace/研究摘要.md' }, status: 'pending', createdAt: now, updatedAt: now } : null; }
      if (channel === KAIRO_INVOKE.agentPauseRun || channel === KAIRO_INVOKE.agentCancelRun) { if (run) { run.status = channel === KAIRO_INVOKE.agentPauseRun ? 'paused' : 'cancelled'; emit({ type: run.status === 'paused' ? 'run-paused' : 'run-cancelled', runId: run.id, status: run.status }); } return { success: true }; }
      if (channel === KAIRO_INVOKE.agentConfirmResponse && !(args[0] as { approved: boolean }).approved) { if (run) { run.status = 'cancelled'; emit({ type: 'run-cancelled', runId: run.id, status: 'cancelled' }); } return { success: true, status: 'cancelled' }; }
      if (channel === KAIRO_INVOKE.agentResumeRun || channel === KAIRO_INVOKE.agentConfirmResponse) { if (run) { run.status = 'completed'; run.finalResponse = finalResponse; getSession().messages.push({ role: 'assistant', content: finalResponse }); emit({ type: 'assistant-response', content: finalResponse, runId: run.id, status: 'completed' }); } return { success: true, status: 'completed' }; }
      if (channel === KAIRO_INVOKE.agentChat) {
        const content = String((args[0] as { content?: string }).content || '');
        const planning = getSession().executionSettings?.workflow === 'plan';
        const response = planning ? '# 实施计划（模拟预览）\n\n1. 明确目标与约束。\n2. 整理已有资料，标注缺失条件。\n3. 交付结果并按验收标准检查。\n\n本预览不调用模型或执行文件操作。' : finalResponse;
        const next: RunSummary = { id: `preview-run-${Date.now()}`, sessionId: activeId, agentId: agent.id, status: 'completed', goal: content, userInput: content, finalResponse: response, createdAt: Date.now(), updatedAt: Date.now() };
        if (planning) plans.set(activeId, { id: `preview-plan-${Date.now()}`, sessionId: activeId, revision: 1, status: 'pending', goal: content, body: response, model: getSession().executionSettings?.model || agent.model, referenceIds: [], attachmentIds: [], fingerprint: 'preview-only', planningRunId: next.id, createdAt: Date.now(), updatedAt: Date.now() });
        runs.set(activeId, next); getSession().messages.push({ role: 'user', content }, { role: 'assistant', content: response }); emit({ type: 'assistant-response', content: response, runId: next.id, status: 'completed' }); return { success: true, status: 'completed', runId: next.id };
      }
      if (channel === KAIRO_INVOKE.systemListDirectory) return { children: [{ name: '研究摘要.md', path: '/demo/workspace/研究摘要.md', isDirectory: false, size: 640 }] };
      if (channel === KAIRO_INVOKE.systemReadFilePreview) return { kind: 'markdown', path: String(args[0]), name: '研究摘要.md', size: 640, extension: 'md', content: '# 项目研究摘要\n\n这是模拟文件，供工作台交互验收使用。\n\n## 待核验\n\n- 核对来源的发布时间\n- 确认资料覆盖范围' };
      if (channel === KAIRO_INVOKE.systemSelectFiles) return [];
      if (channel === KAIRO_INVOKE.skillsGetAll) return { public: [], workbench: [] };
      if (channel === KAIRO_INVOKE.configGetModels || channel === KAIRO_INVOKE.skillsGetRegistry || channel === KAIRO_INVOKE.pluginsGetInstalled) return [];
      return null;
    }) as KairoBridge['invoke'],
    on: ((channel: string, listener: (event: RuntimeUpdateEvent) => void) => { if (channel === KAIRO_EVENT.agentUpdate) listeners.add(listener); return () => { listeners.delete(listener); }; }) as KairoBridge['on']
  };
}
