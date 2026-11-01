import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KAIRO_INVOKE } from '../../../shared/ipc';
const handlers=vi.hoisted(()=>new Map<string,(...args:unknown[])=>Promise<unknown>>());
const state=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),runtime:vi.fn()}));
vi.mock('electron',()=>({ipcMain:{handle:(key:string,handler:(...args:unknown[])=>Promise<unknown>)=>handlers.set(key,handler)}}));
vi.mock('../../services/chatService',()=>({getActiveAgentSession:state.get,createActiveAgentSession:state.create}));
vi.mock('../../assistant/agentRuntime',()=>({ensureAgentRuntime:state.runtime}));
vi.mock('../../core/skills/manager',()=>({skillsManager:{}}));
vi.mock('./agentHandlerService',()=>({}));
import { registerAgentHandlers } from './agentHandlers';
beforeEach(()=>{vi.resetAllMocks();handlers.clear();registerAgentHandlers();});
describe('workbench startup',()=>{
 it('eight simultaneous requests create one task and never initialize a model',async()=>{
  state.get.mockReturnValue(null);state.create.mockImplementation(()=>state.get.mockReturnValue({id:'one'}));
  const results=await Promise.all(Array.from({length:8},()=>handlers.get(KAIRO_INVOKE.workbenchInit)!({})));
  expect(results.every((item)=>Boolean((item as {success:boolean}).success))).toBe(true);
  expect(state.create).toHaveBeenCalledTimes(1);expect(state.runtime).not.toHaveBeenCalled();
 });
 it('startup while a task is running only restores the current selection',async()=>{
  state.get.mockReturnValue({id:'running'});
  await handlers.get(KAIRO_INVOKE.workbenchInit)!({});
  expect(state.create).not.toHaveBeenCalled();expect(state.runtime).not.toHaveBeenCalled();
 });
 it('does not expose the retired agent initialization handler',()=>{expect(handlers.has('agent:init')).toBe(false);});
});
