import {randomUUID} from 'node:crypto';
import type {DelegatedTask, ProjectMemoryEntry, ProjectMemoryState,IntelligenceUsage,IntelligenceBudgetState} from '../../shared/contracts';
import type {LLMUsage} from '../core/llm/types';
import {validReportedUsage,IntelligenceBudgetExceeded} from '../core/agent/intelligenceBudget';
import {getDb} from './chat';

export function memorySettings(projectId:string) {
  const value=getDb().prepare('SELECT enabled,epoch FROM project_memory_settings WHERE project_id=?').get(projectId) as {enabled:number;epoch:number}|undefined;
  return {enabled:Boolean(value?.enabled),epoch:value?.epoch || 0};
}
export function setMemoryEnabled(projectId:string,enabled:boolean) {
  getDb().prepare(`INSERT INTO project_memory_settings VALUES(?,?,1) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,epoch=epoch+1`).run(projectId,Number(enabled));
}
export const PROJECT_MEMORY_LIMIT=200;
export function listMemories(projectId:string):ProjectMemoryEntry[] {
  return (getDb().prepare("SELECT data FROM project_memories WHERE project_id=? AND json_extract(data,'$.status') IN ('active','conflict') ORDER BY rowid DESC").all(projectId) as {data:string}[]).map(row=>JSON.parse(row.data));
}
export function getMemory(projectId:string,id:string):ProjectMemoryEntry|undefined {
  const row=getDb().prepare('SELECT data FROM project_memories WHERE project_id=? AND id=?').get(projectId,id) as {data:string}|undefined;
  return row?JSON.parse(row.data):undefined;
}
export function hasForgottenTopic(projectId:string,key:string):boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM project_memories WHERE project_id=? AND json_extract(data,'$.status')='forgotten' AND json_extract(data,'$.key')=? LIMIT 1").get(projectId,key));
}
export function isMemoryFull(projectId:string):boolean {
  const row=getDb().prepare("SELECT COUNT(*) AS count FROM project_memories WHERE project_id=? AND json_extract(data,'$.status') IN ('active','conflict')").get(projectId) as {count:number};
  return row.count>=PROJECT_MEMORY_LIMIT;
}
export function putMemory(entry:ProjectMemoryEntry,expectedRevision?:number) {
  const old=getDb().prepare('SELECT data FROM project_memories WHERE id=?').get(entry.id) as {data:string}|undefined;
  if(expectedRevision!==undefined&&(!old||JSON.parse(old.data).revision!==expectedRevision))throw new Error('Memory changed. Reload before editing.');
  getDb().prepare('INSERT INTO project_memories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(entry.id,entry.projectId,JSON.stringify(entry));
}
export interface MemoryJob {projectId:string;sessionId:string;runId:string;input:string;model:string;epoch:number;revision?:number;attempt?:number;usage?:IntelligenceUsage;reason?:'capacity'|'budget';error?:string}
export function putMemoryJob(job:MemoryJob,status:string) {
  const previous=memoryJob(job.runId);
  getDb().prepare('INSERT INTO intelligence_jobs VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,data=excluded.data').run(job.runId,status,JSON.stringify({...job,revision:(previous?(previous.data.revision||1):0)+1,attempt:job.attempt||1}));
}
export function memoryJob(runId:string):{status:ProjectMemoryState['jobs'][number]['status'];data:MemoryJob}|undefined {
 const row=getDb().prepare('SELECT status,data FROM intelligence_jobs WHERE run_id=?').get(runId) as {status:ProjectMemoryState['jobs'][number]['status'];data:string}|undefined;
 return row?{status:row.status,data:JSON.parse(row.data)}:undefined;
}
export function memoryState(projectId:string):ProjectMemoryState {
  const jobs=(getDb().prepare("SELECT run_id,status,data FROM intelligence_jobs WHERE json_extract(data,'$.projectId')=? ORDER BY rowid DESC LIMIT 100").all(projectId) as {run_id:string;status:ProjectMemoryState['jobs'][number]['status'];data:string}[]).map(row=>{const job:MemoryJob=JSON.parse(row.data);return {runId:row.run_id,status:row.status,revision:job.revision||1,attempt:job.attempt||1,reason:job.reason,error:job.error};});
  return {...memorySettings(projectId),entries:listMemories(projectId),jobs};
}
export function listDelegates(sessionId:string,parentRunId?:string):DelegatedTask[] {
  const rows=getDb().prepare(`SELECT data FROM delegated_tasks WHERE session_id=? ${parentRunId?'AND parent_run_id=?':''} ORDER BY rowid DESC LIMIT 50`).all(...(parentRunId?[sessionId,parentRunId]:[sessionId])) as {data:string}[];
  return rows.map(row=>JSON.parse(row.data));
}
export function putDelegate(item:DelegatedTask) {
  getDb().prepare('INSERT INTO delegated_tasks VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(item.id,item.parentRunId,item.sessionId,item.status,JSON.stringify(item));
}
export function getDelegate(id:string):DelegatedTask|undefined {
 const row=getDb().prepare('SELECT data FROM delegated_tasks WHERE id=?').get(id) as {data:string}|undefined;
 return row?JSON.parse(row.data):undefined;
}
const emptyUsage=():IntelligenceUsage=>({charged:0,reported:0,reserved:0,unknownRequests:0});
export function intelligenceUsage(runId:string,limit:number):IntelligenceBudgetState {
 const children=(getDb().prepare('SELECT data FROM delegated_tasks WHERE parent_run_id=?').all(runId) as {data:string}[]).map(row=>(JSON.parse(row.data) as DelegatedTask).usage);
 const budgets=[...children,memoryJob(runId)?.data.usage].filter((value):value is IntelligenceUsage=>Boolean(value));
 const reported=(getDb().prepare("SELECT COALESCE(SUM(json_extract(usage,'$.total_tokens')),0) AS tokens FROM auxiliary_usage WHERE run_id=?").get(runId) as {tokens:number}).tokens;
 const reserved=budgets.reduce((sum,item)=>sum+item.reserved,0);
 const charged=reported+budgets.reduce((sum,item)=>sum+Math.max(0,item.charged-item.reported),0);
 return {limit,charged,reported,reserved,unknownRequests:budgets.reduce((sum,item)=>sum+item.unknownRequests,0),remaining:Math.max(0,limit-charged-reserved)};
}
type RequestOwner={kind:'memory';id:string}|{kind:'delegation';id:string};
function requestOwner(owner:RequestOwner){
 if(owner.kind==='memory'){const job=memoryJob(owner.id);if(!job)throw new Error('Memory job no longer exists.');return {data:job.data,runId:job.data.runId,save:(usage:IntelligenceUsage)=>putMemoryJob({...job.data,usage},job.status)};}
 const child=getDelegate(owner.id);if(!child)throw new Error('Subtask no longer exists.');
 return {data:child,runId:child.parentRunId,save:(usage:IntelligenceUsage)=>putDelegate({...child,usage})};
}
export function reserveIntelligenceRequest(owner:RequestOwner,limit:number,tokens:number){
 getDb().transaction(()=>{
  const current=requestOwner(owner);const usage=current.data.usage||emptyUsage();
  if(!Number.isSafeInteger(tokens)||tokens<1||usage.reserved||tokens>intelligenceUsage(current.runId,limit).remaining)throw new IntelligenceBudgetExceeded('Extra model token budget reached.');
  current.save({...usage,reserved:tokens});
 })();
}
export function settleIntelligenceRequest(owner:RequestOwner,reported?:LLMUsage){
 getDb().transaction(()=>{
  const current=requestOwner(owner);const usage=current.data.usage||emptyUsage();if(!usage.reserved)return;
  const known=validReportedUsage(reported);const tokens=known?reported.total_tokens:usage.reserved;
  current.save({charged:usage.charged+tokens,reported:usage.reported+(known?tokens:0),reserved:0,unknownRequests:usage.unknownRequests+(known?0:1)});
 })();
}
export function recordAuxiliaryUsage(runId:string,sessionId:string,purpose:string,model:string,usage?:LLMUsage) {
  if(!validReportedUsage(usage))return;
  getDb().prepare('INSERT INTO auxiliary_usage VALUES(?,?,?,?,?,?,?)').run(randomUUID(),runId,sessionId,purpose,model,JSON.stringify(usage),Date.now());
}
export function recoverIntelligenceWork() {
  // Interrupted work is visible, never silently restarted or billed again.
  for(const row of getDb().prepare("SELECT data FROM delegated_tasks WHERE status='running'").all() as {data:string}[]){let item:DelegatedTask=JSON.parse(row.data);settleIntelligenceRequest({kind:'delegation',id:item.id});item=getDelegate(item.id)!;putDelegate({...item,status:'failed',trace:item.trace?.map(entry=>entry.status==='running'?{...entry,status:'failed' as const,output:'Interrupted by application restart.'}:entry),error:'Interrupted by application restart. Retry from the parent task.',revision:item.revision+1,updatedAt:Date.now()});}
  for(const row of getDb().prepare("SELECT data FROM intelligence_jobs WHERE status IN ('queued','running')").all() as {data:string}[]){let job:MemoryJob=JSON.parse(row.data);settleIntelligenceRequest({kind:'memory',id:job.runId});job=memoryJob(job.runId)!.data;putMemoryJob({...job,error:'Interrupted. Retry explicitly from project memory.'},'failed');}
}
