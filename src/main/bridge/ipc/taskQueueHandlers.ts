import {ipcMain} from 'electron';
import {z} from 'zod';
import {KAIRO_INVOKE as C} from '../../../shared/ipc';
import {enqueueTaskMessage,listTaskQueue,changeQueuedMessage} from '../../services/taskQueueService';
import {scheduleQueuedMessages} from './agentHandlerService';
const id=z.string().trim().min(1).max(200);
const revision=z.number().int().nonnegative();
export function registerTaskQueueHandlers(){
 ipcMain.handle(C.taskQueueList,(_,value)=>listTaskQueue(id.parse(value)));
 ipcMain.handle(C.taskQueueAdd,(event,value)=>{
  const input=z.object({sessionId:id,draftRevision:revision,data:z.object({input:z.string().max(30000),referenceIds:z.array(id).max(50),attachmentIds:z.array(id).max(50)}).strict()}).strict().parse(value);
  const item=enqueueTaskMessage(input.sessionId,input.draftRevision,input.data);scheduleQueuedMessages(event.sender);return item;
 });
 ipcMain.handle(C.taskQueueChange,(event,value)=>{
  const input=z.object({sessionId:id,id,revision:revision.positive(),action:z.enum(['edit','remove','up','down','continue']),content:z.string().max(30000).optional()}).strict().parse(value);
  const items=changeQueuedMessage(input.sessionId,input.id,input.revision,input.action,input.content);scheduleQueuedMessages(event.sender);return items;
 });
}
