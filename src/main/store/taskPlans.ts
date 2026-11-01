import {randomUUID} from 'node:crypto';
import type {TaskPlan} from '../../shared/contracts';
import {getDb} from './chat';
export function getTaskPlan(id:string):TaskPlan|null {
 const row=getDb().prepare('SELECT data FROM task_plans WHERE id=?').get(id) as {data:string}|undefined;
 return row?JSON.parse(row.data) as TaskPlan:null;
}
export function latestTaskPlan(sessionId:string):TaskPlan|null {
 const row=getDb().prepare('SELECT data FROM task_plans WHERE session_id=? ORDER BY rowid DESC LIMIT 1').get(sessionId) as {data:string}|undefined;
 return row?JSON.parse(row.data) as TaskPlan:null;
}
export function createTaskPlan(value:Pick<TaskPlan,'sessionId'|'goal'|'model'|'referenceIds'|'attachmentIds'>):TaskPlan {
 const plan:TaskPlan={...value,id:randomUUID(),revision:1,status:'planning',body:'',fingerprint:'',createdAt:Date.now(),updatedAt:Date.now()};
 getDb().transaction(()=>{
  const existing=latestTaskPlan(value.sessionId);
  if(existing&&['planning','pending'].includes(existing.status))updateTaskPlan(existing.id,existing.revision,{status:'superseded'});
  getDb().prepare('INSERT INTO task_plans(id,session_id,revision,status,data) VALUES(?,?,?,?,?)').run(plan.id,plan.sessionId,plan.revision,plan.status,JSON.stringify(plan));
 })();return plan;
}
export function updateTaskPlan(id:string,revision:number,patch:Partial<Pick<TaskPlan,'investigations'|'memorySnapshot'|'status'|'body'|'fingerprint'|'planningRunId'|'executionRunId'|'approvedRevision'|'scope'|'error'>>):TaskPlan {
 return getDb().transaction(()=>{
  const current=getTaskPlan(id);if(!current||current.revision!==revision)throw new Error('Plan changed. Reload it before acting.');
  const next={...current,...patch,revision:revision+1,updatedAt:Date.now()};
  const changed=getDb().prepare('UPDATE task_plans SET revision=?,status=?,data=? WHERE id=? AND revision=?').run(next.revision,next.status,JSON.stringify(next),id,revision);
  if(!changed.changes)throw new Error('Plan changed. Reload it before acting.');return next;
 })();
}
