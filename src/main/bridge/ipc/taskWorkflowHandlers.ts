import {ipcMain} from 'electron';
import {z} from 'zod';
import {KAIRO_INVOKE} from '../../../shared/ipc';
import {listTaskTemplates,saveTaskTemplate} from '../../store/taskTemplates';
import {editTaskPlan,getLatestTaskPlan,rejectTaskPlan} from '../../services/taskPlanService';
import {approveStoredTaskPlan,mapRuntimeHandlerFailure} from './agentHandlerService';
const id=z.string().trim().min(1).max(200);
const planInput=z.object({sessionId:id,planId:id,revision:z.number().int().positive()}).strict();
export function registerTaskWorkflowHandlers(){
 ipcMain.handle(KAIRO_INVOKE.taskTemplatesList,()=>listTaskTemplates());
 ipcMain.handle(KAIRO_INVOKE.taskTemplatesSave,(_,value)=>saveTaskTemplate(z.object({id:id.optional(),version:z.number().int().positive().optional(),name:z.string().trim().min(1).max(80),instructions:z.string().trim().min(1).max(10000),output:z.string().trim().min(1).max(5000),acceptance:z.string().trim().min(1).max(5000)}).strict().parse(value)));
 ipcMain.handle(KAIRO_INVOKE.taskPlanGet,(_,value)=>getLatestTaskPlan(id.parse(value)));
 ipcMain.handle(KAIRO_INVOKE.taskPlanEdit,(_,value)=>{const input=planInput.extend({body:z.string().trim().min(1).max(30000)}).strict().parse(value);return editTaskPlan(input.sessionId,input.planId,input.revision,input.body);});
 ipcMain.handle(KAIRO_INVOKE.taskPlanReject,(_,value)=>{const input=planInput.parse(value);return rejectTaskPlan(input.sessionId,input.planId,input.revision);});
 ipcMain.handle(KAIRO_INVOKE.taskPlanApprove,async(event,value)=>{
  try{const input=planInput.parse(value);return await approveStoredTaskPlan(input.sessionId,input.planId,input.revision,event.sender);}catch(error){return mapRuntimeHandlerFailure(error);}
 });
}
