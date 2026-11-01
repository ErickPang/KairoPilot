import fs from 'node:fs';
import type {TaskPlan} from '../../shared/contracts';
import {getSessionById,getRunById,getSessionAttachmentById} from '../store/chat';
import * as plans from '../store/taskPlans';
import {fingerprint} from '../core/security/executionContext';
import {requireTask,settingsForTask} from './taskSettingsService';
import {executionAgentForTask,executionContextForSession,permissionGuardForSession} from './projectService';
import {createPlanningTools} from '../core/agent/planningTools';
import {resolveTaskReferences} from './taskOrganizationService';
import {isTaskExecuting,assertTaskMutable} from './workbenchExecution';

export function taskPlanFingerprint(plan:Pick<TaskPlan,'sessionId'|'referenceIds'|'attachmentIds'>,includeHistory=true):string {
 const task=requireTask(plan.sessionId);
 const agent=executionAgentForTask(task);
 const context=executionContextForSession(task,agent);
 const metadata=(file:string)=>{const stat=fs.statSync(file);return {real:fs.realpathSync(file),size:stat.size,modified:stat.mtimeMs};};
 const references=resolveTaskReferences(task.id,plan.referenceIds,true).map(item=>({id:item.id,path:item.path,...metadata(item.path)}));
 const attachments=plan.attachmentIds.map(id=>{const item=getSessionAttachmentById(id,task.id);if(!item)throw new Error('Plan attachment is unavailable.');return {id,hash:item.contentHash,...metadata(item.storedPath)};});
 const history=includeHistory?getSessionById(task.id)!.messages:undefined;
 return fingerprint({context,settings:settingsForTask(task),references,attachments,history});
}
export function getLatestTaskPlan(sessionId:string):TaskPlan|null {
 requireTask(sessionId);
 let plan=plans.latestTaskPlan(sessionId);
 if(plan?.status==='planning'&&!isTaskExecuting(sessionId)&&(!plan.planningRunId||!['running','waiting_approval','paused'].includes(getRunById(plan.planningRunId)?.status||''))) {
  plan=plans.updateTaskPlan(plan.id,plan.revision,{status:'failed',error:'Planning was interrupted. Cancel any paused run and generate a new plan.'});
 }
 if(plan?.status==='executing'&&plan.executionRunId&&!isTaskExecuting(sessionId)){
  const run=getRunById(plan.executionRunId);
  if(run&&['completed','failed','cancelled'].includes(run.status))plan=plans.updateTaskPlan(plan.id,plan.revision,{status:run.status==='completed'?'completed':'failed',error:run.error});
 }
 return plan;
}
export function requirePendingPlan(sessionId:string,id:string,revision:number):TaskPlan {
 requireTask(sessionId);
 const plan=plans.getTaskPlan(id);
 if(!plan||plan.sessionId!==sessionId)throw new Error('Plan does not belong to this task.');
 if(plan.revision!==revision||plan.status!=='pending'||plans.latestTaskPlan(sessionId)?.id!==id)throw new Error('Plan changed or was already handled. Reload it.');
 return plan;
}
export function editTaskPlan(sessionId:string,id:string,revision:number,body:string):TaskPlan {
 assertTaskMutable(sessionId);requirePendingPlan(sessionId,id,revision);
 return plans.updateTaskPlan(id,revision,{body});
}
export function rejectTaskPlan(sessionId:string,id:string,revision:number):TaskPlan {
 assertTaskMutable(sessionId);requirePendingPlan(sessionId,id,revision);
 return plans.updateTaskPlan(id,revision,{status:'rejected'});
}
export function claimTaskPlan(sessionId:string,id:string,revision:number):TaskPlan {
 const plan=requirePendingPlan(sessionId,id,revision);
 if(requireTask(sessionId).archivedAt)throw new Error('Restore this task before executing its plan.');
 if(taskPlanFingerprint(plan)!==plan.fingerprint)throw new Error('Task context, model, permissions, rules, or referenced files changed. Generate a new plan.');
 return plans.updateTaskPlan(id,revision,{status:'executing',approvedRevision:revision+1});
}
export async function validatePlanInvestigation(sessionId:string,id:string,revision:number){
 const plan=requirePendingPlan(sessionId,id,revision);
 const task=requireTask(sessionId);
 const tools=createPlanningTools(task.executionRoot!,permissionGuardForSession(task));
 for(const entry of plan.investigations||[]){
  const tool=tools.find(item=>item.name===entry.tool);
  if(!tool||fingerprint(await tool.execute(tool.parameters.parse(entry.args) as Record<string,unknown>))!==entry.digest)throw new Error('Investigated files or search results changed. Generate a new plan.');
 }
 requirePendingPlan(sessionId,id,revision);
}
export function approvedPlanPrompt(plan:TaskPlan):string {
 return `\n\n<approved_task_plan id="${plan.id}" revision="${plan.approvedRevision}">\n用户已确认以下目标和计划。仅实施与目标相关的工作；计划不授予额外权限，工具审批与目录限制仍然有效。\n目标：${plan.goal}\n计划：\n${plan.body}\n</approved_task_plan>`;
}
