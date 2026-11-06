import type {QueuedTaskMessage,TaskDraftInput} from '../../shared/contracts';
import {getDb,getLatestRun,getSessionAttachmentById} from '../store/chat';
import {getStoredDraft,clearAcceptedDraft} from '../store/taskOrganization';
import * as store from '../store/taskQueue';
import {requireTask} from './taskSettingsService';
import {taskPlanFingerprint,getLatestTaskPlan} from './taskPlanService';
import {redactSensitiveText} from '../core/security/permissions';
export function queueBasis(sessionId:string,data:TaskDraftInput){
 return taskPlanFingerprint({sessionId,referenceIds:data.referenceIds,attachmentIds:data.attachmentIds},false);
}
function publicMessage(item:store.StoredQueueMessage):QueuedTaskMessage{
 return {id:item.id,sessionId:item.sessionId,revision:item.revision,position:item.position,createdAt:item.createdAt,status:item.status,data:item.data,error:item.error,runId:item.runId};
}
export function listTaskQueue(sessionId:string){requireTask(sessionId);return store.queuedMessages(sessionId).map(publicMessage);}
export function enqueueTaskMessage(sessionId:string,draftRevision:number,data:TaskDraftInput){
 return getDb().transaction(()=>{
  const task=requireTask(sessionId);if(task.archivedAt)throw new Error('Restore this task before queueing messages.');
  const previous=getDb().prepare('SELECT id FROM task_message_queue WHERE session_id=? AND draft_revision=?').get(sessionId,draftRevision) as {id:string}|undefined;
  if(previous)return publicMessage(store.queueMessage(previous.id)!);
  const draft=getStoredDraft(sessionId);
  if(draft.revision!==draftRevision||JSON.stringify(draft.data)!==JSON.stringify(data))throw new Error('DRAFT_CONFLICT: Reload the task draft before queueing.');
  if(!data.input.trim()&&!data.referenceIds.length&&!data.attachmentIds.length)throw new Error('Message is empty.');
  if(store.queuedMessages(sessionId).length>=20)throw new Error('At most 20 pending messages per task.');
  const item=store.insertQueueMessage({sessionId,draftRevision,data,basis:queueBasis(sessionId,data),status:'queued'});
  clearAcceptedDraft(sessionId,draftRevision);return publicMessage(item);
 })();
}
function editableMessage(sessionId:string,id:string,revision:number){
 requireTask(sessionId);const item=store.queueMessage(id);
 if(!item||item.sessionId!==sessionId||item.revision!==revision||!['queued','blocked'].includes(item.status))throw new Error('Queued message changed or is already sending. Reload it.');
 return item;
}
export function changeQueuedMessage(sessionId:string,id:string,revision:number,action:'edit'|'remove'|'up'|'down'|'continue',content?:string){
 return getDb().transaction(()=>{
  const item=editableMessage(sessionId,id,revision);
  if(action==='remove')getDb().prepare('DELETE FROM task_message_queue WHERE id=?').run(id);
  else if(action==='edit'){
   if(!content?.trim()&&!item.data.referenceIds.length&&!item.data.attachmentIds.length)throw new Error('Message is empty.');
   store.updateQueueMessage(item,{data:{...item.data,input:content||''}});
  }else if(action==='continue'){
   if(getLatestTaskPlan(sessionId)?.status==='pending')throw new Error('Review or reject the pending plan before continuing the queue.');
   const task=requireTask(sessionId);if(task.archivedAt)throw new Error('Restore this task first.');
   store.updateQueueMessage(item,{status:'queued',error:undefined,basis:queueBasis(sessionId,item.data)});
  }else{
   const items=store.queuedMessages(sessionId);const index=items.findIndex(value=>value.id===id);const other=items[index+(action==='up'?-1:1)];
   if(other&&['queued','blocked'].includes(other.status)){store.updateQueueMessage(item,{position:other.position});store.updateQueueMessage(other,{position:item.position});}
  }
  return listTaskQueue(sessionId);
 })();
}
export function holdTaskQueue(sessionId:string,error:string){
 for(const item of store.queuedMessages(sessionId))if(item.status==='queued')store.updateQueueMessage(item,{status:'blocked',error:redactSensitiveText(error)});
}
export function nextTaskQueueMessage(){
 const items=store.queuedMessages();
 return items.find((item,index)=>item.status==='queued'&&!items.slice(0,index).some(previous=>previous.sessionId===item.sessionId));
}
export function claimQueuedMessage(item:store.StoredQueueMessage){
 const task=requireTask(item.sessionId);
 if(task.archivedAt)throw new Error('Task is archived. Restore it before continuing.');
 if(getLatestTaskPlan(item.sessionId)?.status==='pending')throw new Error('Review or reject the pending plan before continuing the queue.');
 if(queueBasis(item.sessionId,item.data)!==item.basis)throw new Error('Task settings or referenced files changed. Review and continue the queue.');
 return store.updateQueueMessage(item,{status:'dispatching',error:undefined});
}
export function acceptQueuedMessage(id:string,runId:string){
 const item=store.queueMessage(id);if(!item||item.status!=='dispatching')throw new Error('Queued message was already handled.');
 store.updateQueueMessage(item,{status:'sent',runId});
}
export function queuedRequest(item:store.StoredQueueMessage){
 return {sessionId:item.sessionId,content:item.data.input.trim()||(item.data.referenceIds.length?'Please review the referenced context.':'Please review the attached file(s).'),referenceIds:item.data.referenceIds,attachments:item.data.attachmentIds.map(id=>{const value=getSessionAttachmentById(id,item.sessionId);if(!value)throw new Error('Queued attachment is unavailable.');return value;})};
}
export function holdQueueAfterRun(sessionId:string){
 const latest=getLatestRun(sessionId);
 if(latest&&latest.status!=='completed')holdTaskQueue(sessionId,'Previous run did not complete. Review it before continuing the queue.');
 if(getLatestTaskPlan(sessionId)?.status==='pending')holdTaskQueue(sessionId,'A plan awaits confirmation. Review it before continuing the queue.');
}
