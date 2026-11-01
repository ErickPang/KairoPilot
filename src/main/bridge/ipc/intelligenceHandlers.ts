import {ipcMain} from 'electron';
import {z} from 'zod';
import {KAIRO_INVOKE as C} from '../../../shared/ipc';
import {memoryState,setMemoryEnabled} from '../../store/intelligence';
import {requireMemoryProject,editProjectMemory,stopProjectMemoryJobs,retryProjectMemory} from '../../services/projectMemoryService';
import {requireTask} from '../../services/taskSettingsService';
import {stopDelegatedTask,retryDelegatedTask,delegatedTasksWithBudget} from '../../services/delegationService';
const id=z.string().trim().min(1).max(200);
export function registerIntelligenceHandlers(){
  ipcMain.handle(C.projectMemoryGet,(_,value)=>{const projectId=id.parse(value);requireMemoryProject(projectId);return memoryState(projectId);});
  ipcMain.handle(C.projectMemoryConfigure,(_,value)=>{const input=z.object({projectId:id,enabled:z.boolean()}).strict().parse(value);requireMemoryProject(input.projectId);setMemoryEnabled(input.projectId,input.enabled);stopProjectMemoryJobs(input.projectId);return memoryState(input.projectId);});
  ipcMain.handle(C.projectMemoryEdit,(_,value)=>{const input=z.object({projectId:id,id,revision:z.number().int().positive(),action:z.enum(['edit','forget','accept']),content:z.string().trim().min(1).max(800).optional()}).strict().parse(value);return editProjectMemory(input.projectId,input.id,input.revision,input.action,input.content);});
  ipcMain.handle(C.projectMemoryRetry,(_,value)=>{const input=z.object({projectId:id,runId:id,revision:z.number().int().positive()}).strict().parse(value);return retryProjectMemory(input.projectId,input.runId,input.revision);});
  ipcMain.handle(C.delegationList,(_,value)=>delegatedTasksWithBudget(requireTask(id.parse(value)).id));
  ipcMain.handle(C.delegationStop,(_,value)=>{const input=z.object({sessionId:id,id}).strict().parse(value);return stopDelegatedTask(input.sessionId,input.id);});
  ipcMain.handle(C.delegationRetry,(_,value)=>{const input=z.object({sessionId:id,id,revision:z.number().int().positive()}).strict().parse(value);return retryDelegatedTask(input.sessionId,input.id,input.revision);});
}
