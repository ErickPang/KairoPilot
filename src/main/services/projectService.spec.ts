import { beforeEach,describe,expect,it,vi } from 'vitest';
import { createDefaultAgentPermissions } from '../../shared/contracts';
import type { AgentConfig,RunExecutionContext } from '../../shared/contracts';
import {fingerprint} from '../core/security/executionContext';
const state=vi.hoisted(()=>({task:vi.fn(),model:vi.fn()}));
vi.mock('./taskSettingsService',()=>({requireTask:state.task,settingsForTask:()=>({})}));
vi.mock('./workbenchConfigService',()=>({strictTaskModel:state.model}));
import { assertStoredExecutionContext } from './projectService';
beforeEach(()=>{state.task.mockReturnValue({id:'task',executionRoot:'/tmp/root'});state.model.mockReturnValue({provider:'custom',baseUrl:'https://changed.invalid/v1',model:'model'});});
describe('stored task execution configuration',()=>{
 const agent={id:'task:task',model:'configured/model',permissions:createDefaultAgentPermissions()} as AgentConfig;
 const context={version:2,sessionId:'task',executionRoot:'/tmp/root',agentId:'workbench',model:'configured/model',provider:'custom'} as RunExecutionContext;
 it('cannot silently restore a checkpoint with a changed provider endpoint',()=>{expect(()=>assertStoredExecutionContext(agent,{...context,modelConfigHash:fingerprint({binding:agent.model,provider:'custom',baseUrl:'https://original.invalid/v1',model:'model'})})).toThrow('model configuration changed');});
 it('rejects a model binding change before accessing an old directory',()=>{expect(()=>assertStoredExecutionContext(agent,{...context,model:'old/model'})).toThrow('model configuration changed');});
 it('rejects another task’s execution snapshot',()=>{expect(()=>assertStoredExecutionContext(agent,{...context,sessionId:'other'})).toThrow('does not belong');});
 it('rejects directory changes even if the model still exists',()=>{expect(()=>assertStoredExecutionContext(agent,{...context,executionRoot:'/tmp/other'})).toThrow('directory differs');});
});
