import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({get:vi.fn(),active:vi.fn(),query:vi.fn(),create:vi.fn(),set:vi.fn(),title:vi.fn(),remove:vi.fn(),mutable:vi.fn(),ids:vi.fn(),initialize:vi.fn()}));
vi.mock('../store/chat',()=>({getDb:()=>({prepare:()=>({all:state.ids})}),getSessionById:state.get,createSession:state.create,setActiveSessionId:state.set,updateSessionTitle:state.title,deleteSession:state.remove}));
vi.mock('../store/taskPages',()=>({getOwnedSessionSummary:(_owner:unknown,id:string)=>state.get(id),getActiveSessionSummary:state.active,querySessionPage:state.query}));
vi.mock('./workbenchExecution',()=>({assertTaskMutable:state.mutable}));
vi.mock('./taskSettingsService',()=>({initializeIndependentDirectory:state.initialize,newTaskSettings:()=>({model:'fixture/local'})}));
vi.mock('./projectService',()=>({contextForProjectSession:()=>({})}));
import {clearActiveAgentSessions,createActiveAgentSession,deleteActiveAgentSession,listActiveAgentSessions,setActiveAgentSession,updateActiveAgentSessionTitle} from './chatService';
beforeEach(()=>{vi.resetAllMocks();state.query.mockReturnValue({items:[{id:'a',agentId:'old-a'},{id:'b',agentId:'old-b'}]});state.get.mockReturnValue({id:'new',messages:[]});});
describe('unified task service',()=>{
 it('lists both historical sources through an unscoped query',()=>{expect(listActiveAgentSessions()).toHaveLength(2);expect(state.query).toHaveBeenCalledWith(undefined,expect.anything());});
 it('creates a workbench task with explicit settings and its own directory',()=>{state.create.mockReturnValue({id:'new'});createActiveAgentSession('New');expect(state.create).toHaveBeenCalledWith('New','workbench',expect.objectContaining({executionSettings:{model:'fixture/local'}}));expect(state.initialize).toHaveBeenCalledWith('new');});
 it('allows viewing another task while execution continues',()=>{state.mutable.mockImplementation(()=>{throw new Error('busy');});expect(()=>setActiveAgentSession('b')).not.toThrow();expect(state.set).toHaveBeenCalledWith('b','workbench');});
 it('renames historical tasks regardless of their old source',()=>{updateActiveAgentSessionTitle('b','renamed');expect(state.title).toHaveBeenCalledWith('b','renamed');});
 it('rejects missing tasks and protects an executing task from deletion',()=>{state.get.mockReturnValue(null);expect(()=>setActiveAgentSession('missing')).toThrow('not found');state.get.mockReturnValue({id:'a'});state.mutable.mockImplementation(()=>{throw new Error('busy');});expect(()=>deleteActiveAgentSession('a')).toThrow('busy');expect(state.remove).not.toHaveBeenCalled();});
 it('clear-all checks every task before deleting anything and is not limited to the first page',()=>{state.ids.mockReturnValue(Array.from({length:150},(_,i)=>({id:String(i)})));clearActiveAgentSessions();expect(state.mutable).toHaveBeenCalledTimes(150);expect(state.remove).toHaveBeenCalledTimes(150);});
});
