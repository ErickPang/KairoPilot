import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({runs:[] as Array<{id:string;sessionId:string;status:string}>}));
vi.mock('../store/chat',()=>({getDb:()=>({prepare:()=>({get:(excluded?:string)=>state.runs.find(run=>run.id!==excluded&&['running','paused','waiting_approval'].includes(run.status))})}),getLatestRun:(id:string)=>state.runs.find(run=>run.sessionId===id)}));
import {assertNoLiveExecution,assertTaskMutable,assertWorkbenchIdle,isTaskExecuting,isWorkbenchBusy,setWorkbenchShuttingDown,withTaskExecution} from './workbenchExecution';
beforeEach(()=>{state.runs=[];setWorkbenchShuttingDown(false);});
describe('workbench serial task execution',()=>{
 it('rejects another task until the current execution settles',async()=>{let finish!:()=>void;const pending=withTaskExecution('a',()=>new Promise<void>(resolve=>{finish=resolve;}));expect(isTaskExecuting('a')).toBe(true);await expect(withTaskExecution('b',async()=>{})).rejects.toThrow('already in progress');finish();await pending;expect(isTaskExecuting('a')).toBe(false);});
 it('rejects duplicate execution for the same task',async()=>{await withTaskExecution('a',async()=>{await expect(withTaskExecution('a',async()=>{})).rejects.toThrow('already in progress');});});
 it('releases the lease after execution fails',async()=>{await expect(withTaskExecution('a',async()=>{throw new Error('fixture');})).rejects.toThrow('fixture');await expect(withTaskExecution('b',async()=>7)).resolves.toBe(7);});
 it('paused or waiting runs block new execution but allow recovery of that exact run',async()=>{state.runs=[{id:'paused',sessionId:'a',status:'paused'}];await expect(withTaskExecution('b',async()=>{})).rejects.toThrow('pending run');await expect(withTaskExecution('a',async()=>true,{resumeRunId:'paused'})).resolves.toBe(true);});
 it('permits navigation and edits to B while A holds the execution lease',async()=>{await withTaskExecution('a',async()=>{expect(()=>assertTaskMutable('b')).not.toThrow();expect(()=>assertTaskMutable('a')).toThrow('pending run');expect(()=>assertWorkbenchIdle()).toThrow('pending run');expect(()=>assertNoLiveExecution()).toThrow('Pause or cancel');});});
 it('global configuration stays fixed while a run is suspended',()=>{state.runs=[{id:'waiting',sessionId:'a',status:'waiting_approval'}];expect(()=>assertWorkbenchIdle()).toThrow('pending run');expect(()=>assertTaskMutable('a')).toThrow('pending run');expect(()=>assertNoLiveExecution()).not.toThrow();});
 it('cancels a cold run without initializing it despite other persisted unsettled records',async()=>{state.runs=[{id:'waiting',sessionId:'a',status:'waiting_approval'}];await expect(withTaskExecution('a',async()=>true,{cancellation:true})).resolves.toBe(true);});
 it('blocks new execution, approval recovery and queue dispatch while quitting',async()=>{
  setWorkbenchShuttingDown(true);const operation=vi.fn();
  expect(isWorkbenchBusy()).toBe(true);
  await expect(withTaskExecution('a',operation)).rejects.toThrow('quitting');
  await expect(withTaskExecution('a',operation,{resumeRunId:'old'})).rejects.toThrow('quitting');
  expect(operation).not.toHaveBeenCalled();
 });
});
