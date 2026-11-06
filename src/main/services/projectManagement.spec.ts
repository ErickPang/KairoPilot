import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll,beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({authorized:vi.fn(),idle:vi.fn(),rename:vi.fn(),authorize:vi.fn(),insert:vi.fn(),project:vi.fn(),rules:vi.fn()}));
vi.mock('../store/workbench',()=>({isProjectAuthorized:state.authorized,renameProject:state.rename,authorizeProject:state.authorize,insertProject:state.insert,getProject:state.project,updateProjectMemory:state.rules}));
vi.mock('./workbenchExecution',()=>({assertWorkbenchIdle:state.idle,assertNoLiveExecution:state.idle}));
import { continueActiveProject,detachActiveProject,renameActiveProject,updateProjectRules } from './projectService';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kairo-global-project-')));
const next=path.join(root,'next');fs.mkdirSync(next);
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
beforeEach(()=>{vi.resetAllMocks();state.authorized.mockReturnValue(true);state.project.mockReturnValue({id:'project',rootPath:root});});
describe('workbench project boundaries',()=>{
 it('blocks mutations while execution holds the workbench',()=>{state.idle.mockImplementation(()=>{throw new Error('busy');});expect(()=>renameActiveProject('project','new')).toThrow('busy');expect(state.rename).not.toHaveBeenCalled();});
 it('requires explicit project authorization before editing rules or creating a successor',()=>{state.authorized.mockReturnValue(false);expect(()=>updateProjectRules('project','rules','memory')).toThrow('Authorize');expect(()=>continueActiveProject('project','next',next)).toThrow('Authorize');expect(state.rules).not.toHaveBeenCalled();});
 it('revokes project execution without deleting task or project records',()=>{detachActiveProject('project');expect(state.authorize).toHaveBeenCalledWith('project',false);});
 it('a successor has a new immutable root and keeps a link to the original',()=>{continueActiveProject('project','next',next);expect(state.insert).toHaveBeenCalledWith('next',next,'workbench','project');expect(state.project()).toMatchObject({rootPath:root});expect(()=>continueActiveProject('project','same',root)).toThrow('another');});
 it('stores project rules separately rather than applying them globally',()=>{updateProjectRules('project','ONLY_PROJECT','PROJECT_MEMORY');expect(state.rules).toHaveBeenCalledWith('project','PROJECT_MEMORY');expect(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8')).toBe('ONLY_PROJECT');});
});
