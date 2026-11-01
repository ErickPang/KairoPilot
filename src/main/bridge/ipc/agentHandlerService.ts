import {memorySnapshot,scheduleProjectMemory} from '../../services/projectMemoryService';
import {PLANNING_PROMPT} from '../../../shared/taskTemplates';
import {type TaskPlan} from '../../../shared/contracts';
import {restrictPlanningAgent} from '../../core/agent/planningTools';
import {PLANNING_TOOLS} from '../../../shared/planningPolicy';
import * as taskPlans from '../../store/taskPlans';
import {claimTaskPlan,approvedPlanPrompt,taskPlanFingerprint,validatePlanInvestigation} from '../../services/taskPlanService';
import { cancelSuspendedRun } from '../../core/agent/cancelSuspendedRun';
import { getSessionAttachmentById,getDb } from '../../store/chat';
import {acceptQueuedMessage,claimQueuedMessage,holdQueueAfterRun,holdTaskQueue,nextTaskQueueMessage,queuedRequest} from '../../services/taskQueueService';
import {queueMessage,updateQueueMessage,queuedMessages} from '../../store/taskQueue';
import { resolveTaskReferences } from '../../services/taskOrganizationService';
import { clearAcceptedDraft, getStoredDraft } from '../../store/taskOrganization';
import type { WebContents } from 'electron';
import { ensureAgentRuntime, getAgentRuntime } from '../../assistant/agentRuntime';
import { KAIRO_EVENT } from '../../../shared/ipc';
import { WORKBENCH_OWNER } from '../../store/configWorkbench';
import { executionAgentForTask } from '../../services/projectService';
import { requireTask,settingsForTask } from '../../services/taskSettingsService';
import { strictTaskModel } from '../../services/workbenchConfigService';
import { getApprovalRecord, getRunById, getSessionById, updateRun, updateSessionMessages } from '../../store/chat';
import { withTaskExecution, isTaskExecuting,isWorkbenchBusy } from '../../services/workbenchExecution';
import type { AgentRuntime } from '../../core/agent/runtime';
import type { ChatMessage } from '../../core/llm/types';
import type { RuntimeExecutionResult, RuntimeUpdate } from '../../core/agent/runEngine';
import type { AgentChatRequest, AgentRuntimeInvokeResult, ChatAttachment } from '../../../shared/contracts';
import { ipcFailure } from './ipcResult';
import { assertStoredExecutionContext, executionContextForSession } from '../../services/projectService';


export async function resolveRuntimeForRun(runId: string, sender: WebContents, cancellationOnly = false,planningApproval=false) {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const session = requireTask(run.sessionId);
  const planning=run.executionContext?.phase==='planning';
  if(planning&&!planningApproval)throw new Error('Planning runs cannot be resumed as execution. Cancel and generate a new plan.');
  const executionAgent = executionAgentForTask(session);
  if(planning){
    const plan=run.executionContext?.planId?taskPlans.getTaskPlan(run.executionContext.planId):null;
    if(!plan||plan.sessionId!==session.id||plan.planningRunId!==run.id||plan.status!=='planning'||run.status!=='waiting_approval')throw new Error('Planning approval does not match a pending investigation.');
    restrictPlanningAgent(executionAgent,session.executionRoot!);executionAgent.systemPrompt+=PLANNING_PROMPT;
  }
  if(!planning&&run.executionContext?.planId) {
    const plan=taskPlans.getTaskPlan(run.executionContext.planId);
    if(!plan||plan.sessionId!==session.id||plan.executionRunId!==run.id||plan.approvedRevision!==run.executionContext.planRevision)throw new Error('Approved plan does not match this execution.');
    executionAgent.systemPrompt+=approvedPlanPrompt(plan);
  }
  const config = {agent:executionAgent,model:strictTaskModel(executionAgent.model),executionContext:run.executionContext};
  if (!cancellationOnly) {
    if(!run.executionContext)throw new Error('Historical execution directory was not recorded. Cancel this run and start a new one.');
    assertStoredExecutionContext(executionAgent,run.executionContext,session.id);
  }
  const agent = cancellationOnly && getAgentRuntime(executionAgent.id) ? getAgentRuntime(executionAgent.id)! : await ensureAgentRuntime(config,sender);
  if (!agent) {
    throw new Error('Agent initialization failed.');
  }

  return { agent, run };
}

export async function resolveRuntimeForApproval(approvalId: string, sender: WebContents) {
  const approval = getApprovalRecord(approvalId);
  if (!approval) {
    throw new Error(`Approval record not found: ${approvalId}`);
  }

  const { agent, run } = await resolveRuntimeForRun(approval.runId, sender);
  return {
    agent,
    run,
    approval
  };
}

export function createRuntimeUpdateForwarder(sender: WebContents, sessionId?: string | null) {
  let owner: { id: string; agentId: string; sessionId: string } | null = null;
  return (update: RuntimeUpdate) => {
    if (owner?.id !== update.runId) {
      owner = getRunById(update.runId);
    }
    if (sender.isDestroyed()) return;
    sender.send(KAIRO_EVENT.agentUpdate, {
      ...update,
      ...(owner ? { agentId: owner.agentId } : {}),
      sessionId: owner?.sessionId || sessionId || update.sessionId
    });
  };
}

export function persistAgentSessionHistory(agent: { getSessionHistory: () => ChatMessage[]; getActiveSessionId?: () => string | null }, sessionId?: string | null) {
  if (sessionId && (!agent.getActiveSessionId || agent.getActiveSessionId() === sessionId)) {
    updateSessionMessages(sessionId, agent.getSessionHistory());
  }
}

export function mapRuntimeExecutionResult(result: RuntimeExecutionResult): AgentRuntimeInvokeResult {
  return {
    success: result.status === 'cancelled' || (result.status !== 'failed' && !result.error),
    content: result.content,
    error: result.error,
    status: result.status,
    runId: result.runId,
    approvalId: result.approvalId
  };
}

export function mapUnknownError(error: unknown, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : fallback;
}

export function mapRuntimeHandlerFailure(error: unknown) {
  return ipcFailure(mapUnknownError(error));
}

function normalizeAgentChatRequest(input: unknown): AgentChatRequest {

  if (!input || typeof input !== 'object') {
    throw new Error('A task request is required.');
  }

  const payload = input as Record<string, unknown>;
  if(typeof payload.sessionId !== 'string' || !payload.sessionId.trim())throw new Error('A task id is required.');
  const content = typeof payload.content === 'string' ? payload.content : '';
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments.filter((item): item is ChatAttachment => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const attachment = item as Record<string, unknown>;
        return typeof attachment.id === 'string'
          && typeof attachment.sessionId === 'string'
          && typeof attachment.storedPath === 'string';
      })
    : undefined;
  if (payload.referenceIds !== undefined && (!Array.isArray(payload.referenceIds) || payload.referenceIds.length > 50 || payload.referenceIds.some((id) => typeof id !== 'string'))) throw new Error('Invalid reference ids.');
  if (payload.draftRevision !== undefined && (!Number.isSafeInteger(payload.draftRevision) || Number(payload.draftRevision) < 0)) throw new Error('Invalid draft revision.');
  return { sessionId: payload.sessionId, content, attachments, referenceIds: payload.referenceIds as string[] | undefined, draftRevision: payload.draftRevision as number | undefined };
}

export async function runActiveAgentChat(input: unknown, sender: WebContents) {
  const request=normalizeAgentChatRequest(input);
  if(queuedMessages(request.sessionId).length)throw new Error('This task has pending queued messages. Send to its queue or cancel them first.');
  try{return await withTaskExecution(request.sessionId,()=>runTaskChatWithinLease(request,sender));}
  finally{holdQueueAfterRun(request.sessionId);scheduleQueuedMessages(sender);}
}
export async function approveStoredTaskPlan(sessionId:string,planId:string,revision:number,sender:WebContents) {
  try{return await withTaskExecution(sessionId,async()=>{
    await validatePlanInvestigation(sessionId,planId,revision);
    const plan=claimTaskPlan(sessionId,planId,revision);
    try {
      return await runTaskChatWithinLease({sessionId,content:`按已确认计划执行：${plan.goal}`,referenceIds:plan.referenceIds,attachments:plan.attachmentIds.map(id=>getSessionAttachmentById(id,sessionId)!)},sender,plan);
    }catch(error){
      const current=taskPlans.getTaskPlan(plan.id)!;
      taskPlans.updateTaskPlan(current.id,current.revision,{status:'failed',error:mapUnknownError(error)});
      throw error;
    }
  });}finally{holdQueueAfterRun(sessionId);scheduleQueuedMessages(sender);}
}
async function runTaskChatWithinLease(request:AgentChatRequest,sender:WebContents,approvedPlan?:TaskPlan,queueId?:string) {
  const session=getSessionById(requireTask(request.sessionId).id);
  if(!session)throw new Error('Task not found.');
  if(session.archivedAt)throw new Error('Restore this archived task before sending a message.');
  const attachments=request.attachments?.map(item=>{
    const stored=getSessionAttachmentById(item.id,session.id);
    if(!stored)throw new Error('Attachment does not belong to this task.');return stored;
  });
  const references=request.referenceIds?.length?resolveTaskReferences(session.id,request.referenceIds,true):[];
  if(request.draftRevision!==undefined && getStoredDraft(session.id).revision!==request.draftRevision)throw new Error('DRAFT_CONFLICT: Reload the task draft before sending.');
  const planning=settingsForTask(session).workflow==='plan'&&!approvedPlan;
  let plan=planning?taskPlans.createTaskPlan({sessionId:session.id,goal:request.content,model:settingsForTask(session).model,referenceIds:references.map(item=>item.id),attachmentIds:attachments?.map(item=>item.id)||[]}):approvedPlan;
  const planningBasis=planning&&plan?taskPlanFingerprint(plan,false):undefined;
  const executionAgent=executionAgentForTask(session);
  const selectedMemory=approvedPlan ? approvedPlan.memorySnapshot : memorySnapshot(session.id,request.content);
  if(planning&&plan)plan=taskPlans.updateTaskPlan(plan.id,plan.revision,{memorySnapshot:selectedMemory,fingerprint:planningBasis,scope:{directory:session.executionRoot!,profile:executionAgent.permissions.executionProfile}});
  if(planning){restrictPlanningAgent(executionAgent,session.executionRoot!);executionAgent.systemPrompt+=PLANNING_PROMPT;}
  if(approvedPlan)executionAgent.systemPrompt+=approvedPlanPrompt(approvedPlan);
  const executionContext={...executionContextForSession(session,executionAgent),memorySnapshot:selectedMemory,phase:planning?'planning' as const:'execution' as const,...(plan?{planId:plan.id,planRevision:plan.approvedRevision || plan.revision}:{})};
  const agent=await ensureAgentRuntime({agent:executionAgent,model:strictTaskModel(executionAgent.model),executionContext},sender);
  agent.setHistory(session.messages);
  try {
    const result=await agent.chat(request.content,createRuntimeUpdateForwarder(sender,session.id),{
      sessionId:session.id,agentId:WORKBENCH_OWNER,attachments,references,executionContext,
      onAccepted:()=>{
        if (!queueId && request.draftRevision === undefined) persistAgentSessionHistory(agent, session.id);
        if(queueId){
          getDb().transaction(()=>{persistAgentSessionHistory(agent,session.id);acceptQueuedMessage(queueId,agent.getActiveRunId()!);})();
          createRuntimeUpdateForwarder(sender,session.id)({type:'queue-dispatched',queueId,runId:agent.getActiveRunId()!,content:request.content,attachments,references});
        }
        if(plan)plan=taskPlans.updateTaskPlan(plan.id,plan.revision,planning?{planningRunId:agent.getActiveRunId()!}:{executionRunId:agent.getActiveRunId()!});
        if(request.draftRevision!==undefined){
          persistAgentSessionHistory(agent,session.id);clearAcceptedDraft(session.id,request.draftRevision);
          createRuntimeUpdateForwarder(sender,session.id)({type:'draft-accepted',runId:agent.getActiveRunId()!,revision:getStoredDraft(session.id).revision,referenceIds:references.map(item=>item.id),attachmentIds:attachments?.map(item=>item.id)||[]});
        }
        const titledSession = getDb().prepare('SELECT title FROM sessions WHERE id = ?').get(session.id) as {title: string} | undefined;
        if (titledSession && titledSession.title !== session.title) {
          createRuntimeUpdateForwarder(sender, session.id)({type:'session-title-updated', runId:agent.getActiveRunId()!, title:titledSession.title});
        }
      }
    });
    persistAgentSessionHistory(agent,session.id);
    if(plan){
      plan=taskPlans.getTaskPlan(plan.id)!;
      const pending=planning&&result.status==='completed'&&Boolean(result.content?.trim())&&result.content!.length<=30000&&taskPlanFingerprint(plan,false)===planningBasis;
      const suspended=['waiting_approval','paused'].includes(result.status);
      const patch=planning?{status:pending?'pending' as const:suspended?'planning' as const:'failed' as const,body:result.content?.slice(0,30000)||'',fingerprint:pending?taskPlanFingerprint(plan):planningBasis,error:result.error || (pending||suspended?undefined:'Planning was incomplete or its context changed. Generate a new plan.')}:{status:result.status==='completed'?'completed' as const:suspended?'executing' as const:'failed' as const,error:result.error};
      plan=taskPlans.updateTaskPlan(plan.id,plan.revision,patch);
    }
    if(planning&&plan?.status==='failed')return {...mapRuntimeExecutionResult(result),success:false,error:plan.error};
    if(result.status==='completed')scheduleProjectMemory(result.runId);
    return mapRuntimeExecutionResult(result);
  }catch(error){
    failExecutingRun(agent,sender);
    if(plan){const current=taskPlans.getTaskPlan(plan.id)!;taskPlans.updateTaskPlan(current.id,current.revision,{status:'failed',error:mapUnknownError(error)});}
    const runId=agent.getActiveRunId();
    if(plan&&runId)return mapRuntimeExecutionResult({runId,status:'failed',error:mapUnknownError(error)});
    throw error;
  }finally{persistAgentSessionHistory(agent,session.id);}
}

function failExecutingRun(agent: AgentRuntime, sender: WebContents) {
  const runId = agent.getActiveRunId();
  const run = runId ? getRunById(runId) : null;
  if (run?.status !== 'running') return;
  const error = 'Execution interrupted unexpectedly. Inspect the run before retrying.';
  updateRun(run.id, { status: 'failed', error, waitingApprovalId: null, completedAt: Date.now() });
  createRuntimeUpdateForwarder(sender, run.sessionId)({ type: 'run-failed', runId: run.id, status: 'failed', error });
}

export async function runStoredAgentAction(
  runId: string,
  sender: WebContents,
  operation: (agent: AgentRuntime) => Promise<RuntimeExecutionResult>,
  planningApproval=false
) {
  const run = getRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  try{return await withTaskExecution(run.sessionId, async () => {
    const { agent } = await resolveRuntimeForRun(runId, sender,false,planningApproval);
    try {
      const result=await operation(agent);
      persistAgentSessionHistory(agent,run.sessionId);
      if(planningApproval&&run.executionContext?.planId){
        const plan=taskPlans.getTaskPlan(run.executionContext.planId)!;
        const pending=result.status==='completed'&&Boolean(result.content?.trim())&&result.content!.length<=30000&&taskPlanFingerprint(plan,false)===plan.fingerprint;
        const suspended=['waiting_approval','paused'].includes(result.status);
        const next=taskPlans.updateTaskPlan(plan.id,plan.revision,{status:pending?'pending':suspended?'planning':'failed',body:result.content?.slice(0,30000)||'',fingerprint:pending?taskPlanFingerprint(plan):plan.fingerprint,error:result.error||(pending||suspended?undefined:'Planning was incomplete or its context changed. Generate a new plan.')});
        if(next.status==='failed')return mapRuntimeExecutionResult({...result,status:'failed',error:next.error});
      }
      if(result.status==='completed')scheduleProjectMemory(result.runId);
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      failExecutingRun(agent, sender);
      throw error;
    } finally {
      persistAgentSessionHistory(agent, run.sessionId);
    }
  }, { resumeRunId: runId });}finally{holdQueueAfterRun(run.sessionId);scheduleQueuedMessages(sender);}
}

let queueScheduled=false;
let queueDraining=false;
export function scheduleQueuedMessages(sender:WebContents){
 if(queueScheduled||queueDraining||sender.isDestroyed())return;
 queueScheduled=true;
 setTimeout(()=>{
  queueScheduled=false;
  if(sender.isDestroyed()||queueDraining||isWorkbenchBusy())return;
  const item=nextTaskQueueMessage();if(!item)return;
  queueDraining=true;
  void withTaskExecution(item.sessionId,async()=>{
   try{const claimed=claimQueuedMessage(item);await runTaskChatWithinLease(queuedRequest(claimed),sender,undefined,item.id);}
   catch(error){const current=queueMessage(item.id);if(current?.status==='dispatching'||current?.status==='queued')updateQueueMessage(current,{status:'blocked',error:mapUnknownError(error)});holdTaskQueue(item.sessionId,'Queued execution could not start. Review and continue explicitly.');}
   finally{holdQueueAfterRun(item.sessionId);}
  }).catch(()=>undefined).finally(()=>{queueDraining=false;scheduleQueuedMessages(sender);});
 },0);
}

export async function runApprovalResponse(approvalId: string, approved: boolean, sender: WebContents) {
  const approval = getApprovalRecord(approvalId);
  if (!approval) throw new Error(`Approval record not found: ${approvalId}`);
  const planning=getRunById(approval.runId)?.executionContext?.phase==='planning';
  if(planning&&!PLANNING_TOOLS.has(approval.toolName))throw new Error('Planning approval only permits read-only investigation.');
  return runStoredAgentAction(approval.runId, sender, (agent) => agent.resumeRun(
    approvalId, approved, createRuntimeUpdateForwarder(sender, approval.sessionId)
  ),planning);
}

export async function controlStoredRun(runId: string, action: 'pause' | 'cancel', sender: WebContents) {
  const run = getRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const control = async () => {
    if (action === 'pause' && run.status === 'running') { await getAgentRuntime(`task:${run.sessionId}`)!.pauseRun(runId); return; }
    if (action === 'cancel' && run.status === 'running') { await getAgentRuntime(`task:${run.sessionId}`)!.cancelRun(runId); return; }
    if (action === 'cancel' && run.status !== 'running') { requireTask(run.sessionId); cancelSuspendedRun(runId); return; }
    const { agent } = await resolveRuntimeForRun(runId, sender, action === 'cancel');
    if (action === 'pause') await agent.pauseRun(runId);
    else await agent.cancelRun(runId);
  };
  if (run.status === 'running') {
    if (!isTaskExecuting(run.sessionId) || !getAgentRuntime(`task:${run.sessionId}`)) {
      throw new Error('Run has no live execution. Restart the app to reconcile interrupted runs.');
    }
    await control();
  } else {
    // A suspended run has no live worker. Serialize cold initialization and
    // cancellation with approval/resume so they cannot create competing runtimes.
    await withTaskExecution(run.sessionId, control, { resumeRunId: runId, cancellation: action === 'cancel' });
  }
  holdTaskQueue(run.sessionId,'Run was paused or cancelled. Review queued messages before continuing.');
  // Execution persists its own history; cancelling a suspended run must not
  // overwrite its stored transcript with a freshly initialized runtime.
}
