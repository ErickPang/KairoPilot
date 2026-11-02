import { beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({cancel:vi.fn(),clear:vi.fn(),recover:vi.fn(),intelligence:vi.fn(),queue:vi.fn(),create:vi.fn(),children:vi.fn(),memory:vi.fn(),live:vi.fn(),gate:vi.fn()}));
vi.mock('../assistant/agentRuntime',()=>({cancelActiveAgentRuntimes:state.cancel,clearAgentRuntimes:state.clear}));
vi.mock('../store/chat',()=>({recoverInterruptedRuns:state.recover}));
vi.mock('../store/intelligence',()=>({recoverIntelligenceWork:state.intelligence}));
vi.mock('../store/taskQueue',()=>({recoverTaskQueue:state.queue}));
vi.mock('./chatService',()=>({createActiveAgentSession:state.create}));
vi.mock('./delegationService',()=>({stopAllDelegatedTasks:state.children}));
vi.mock('./projectMemoryService',()=>({stopAllProjectMemoryJobs:state.memory}));
vi.mock('./workbenchExecution',()=>({hasLiveTaskExecution:state.live,setWorkbenchShuttingDown:state.gate}));
import { startApplicationConversation, stopApplicationExecution } from './applicationExecutionLifecycle';
beforeEach(()=>{vi.resetAllMocks();state.live.mockReturnValue(false);});
describe('application execution boundary',()=>{
  it('invalidates orphaned execution before selecting a fresh conversation',()=>{
    startApplicationConversation();
    expect(state.recover.mock.invocationCallOrder[0]).toBeLessThan(state.create.mock.invocationCallOrder[0]);
    expect(state.intelligence).toHaveBeenCalledOnce();expect(state.create).toHaveBeenCalledWith('New Chat');
  });
  it('blocks dispatch and requests worker cancellation before expiring persisted approval state',async()=>{
    let settle!:()=>void;state.cancel.mockImplementation(()=>new Promise<void>(resolve=>{settle=resolve;}));
    const pending=stopApplicationExecution();
    expect(state.gate).toHaveBeenCalledWith(true);expect(state.queue).toHaveBeenCalledOnce();
    expect(state.children).toHaveBeenCalledOnce();expect(state.memory).toHaveBeenCalledOnce();expect(state.recover).not.toHaveBeenCalled();
    settle();await pending;
    expect(state.recover).toHaveBeenCalledWith(expect.stringContaining('RUN_INTERRUPTED_BY_EXIT:'));expect(state.clear).toHaveBeenCalledOnce();
  });
  it('releases the shutdown gate when cleanup fails so a cancelled quit does not lock the application',async()=>{
    state.cancel.mockRejectedValue(new Error('fixture'));await expect(stopApplicationExecution()).rejects.toThrow('fixture');
    expect(state.gate).toHaveBeenLastCalledWith(false);expect(state.clear).not.toHaveBeenCalled();
  });
});
