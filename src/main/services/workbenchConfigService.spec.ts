import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeAgentsFile} from '../core/instructions/agents';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createDefaultAgentPermissions,type WorkbenchConfig} from '../../shared/contracts';
const state=vi.hoisted(()=>({read:vi.fn(),save:vi.fn()}));
vi.mock('../store/configRepository',()=>({readKairoPilotConfig:state.read,saveKairoPilotConfig:state.save}));
vi.mock('./workbenchExecution',()=>({assertWorkbenchIdle:vi.fn()}));
import {strictTaskModel,workbenchAgent,getWorkbenchConfig,saveWorkbenchConfig} from './workbenchConfigService';
const permissions=()=>({...createDefaultAgentPermissions(),executionProfile:'trusted_automation' as const,fileSystem:{read:true,write:true,allowedPaths:[]},shell:{enabled:true,allowedCommands:['node']},network:{enabled:true,allowedDomains:['example.invalid']}});
let config:WorkbenchConfig;
beforeEach(()=>{state.save.mockReset();config={version:2,defaultModel:'fixture/valid',managementRoot:'/synthetic',permissions:permissions(),instructions:'GLOBAL_RULES'};state.read.mockImplementation(()=>({workbench:config,models:{providers:{fixture:{provider:'custom',baseUrl:'https://synthetic.invalid',apiKey:'synthetic',model:[{id:'valid',name:'valid'}]}}}}));});
describe('workbench execution limits',()=>{
 it('does not silently replace a removed task model',()=>{expect(()=>strictTaskModel('fixture/removed')).toThrow('unavailable');expect(strictTaskModel('fixture/valid').model).toBe('valid');});
 it('intersects task capabilities with current global revocations',()=>{const settings={model:'fixture/valid',permissions:permissions()};config.permissions.fileSystem.write=false;config.permissions.shell.allowedCommands=[];const agent=workbenchAgent(settings,'task-a');expect(agent.permissions.fileSystem.write).toBe(false);expect(agent.permissions.shell.allowedCommands).toEqual([]);});
 it('disjoint network lists deny network access rather than becoming unrestricted',()=>{const policy=permissions();policy.network.allowedDomains=['other.invalid'];const agent=workbenchAgent({model:'fixture/valid',permissions:policy},'task-a');expect(agent.permissions.network.enabled).toBe(false);expect(agent.permissions.network.allowedDomains).toEqual([]);});
 it('task automation cannot weaken global approval or redaction rules',()=>{const policy=permissions();policy.policy.approvalMode='never';policy.policy.redactSensitiveOutput=false;config.permissions.policy.approvalMode='always';config.permissions.policy.dataClass='sensitive';const agent=workbenchAgent({model:'fixture/valid',permissions:policy},'task-a');expect(agent.permissions.policy).toMatchObject({approvalMode:'always',redactSensitiveOutput:true,dataClass:'sensitive'});});
});

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'kairo-rules-'));roots.push(root);config.managementRoot=path.join(root,'workbench');config.instructionRoot=root;writeAgentsFile(root,'CURRENT_RULE');return root;}
describe('workbench rules',()=>{
 it('saves AGENTS.md and uses it for task execution',()=>{fixture();saveWorkbenchConfig({defaultModel:config.defaultModel,permissions:config.permissions,instructions:'NEW_RULE'});expect(getWorkbenchConfig().instructions).toBe('NEW_RULE');expect(workbenchAgent().systemPrompt).toBe('NEW_RULE');});
 it('restores rules when settings persistence fails',()=>{fixture();state.save.mockImplementation(()=>{throw new Error('save failed');});expect(()=>saveWorkbenchConfig({defaultModel:config.defaultModel,permissions:config.permissions,instructions:'NEW_RULE'})).toThrow('save failed');expect(getWorkbenchConfig().instructions).toBe('CURRENT_RULE');});
});
