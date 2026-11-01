import fs from 'node:fs/promises';
import path from 'node:path';
import type {PlanningInvestigation,AgentConfig} from '../../../shared/contracts';
import type {ToolDefinition} from '../llm/types';
import type {PermissionGuard} from '../security/permissions';
import {fingerprint} from '../security/executionContext';
import {ReadFileTool,ListDirectoryTool} from '../tools/filesystem';
import {createCodebaseTools} from '../tools/codebase';
import {toolError,unwrapToolExecutionResult} from '../tools/result';
export function restrictPlanningAgent(agent:AgentConfig,root:string){
 agent.permissions={...agent.permissions,executionProfile:agent.permissions.executionProfile==='chat_only'?'chat_only':'read_only_workspace',fileSystem:{read:agent.permissions.executionProfile!=='chat_only'&&agent.permissions.fileSystem.read,write:false,allowedPaths:[root]},network:{enabled:false,allowedDomains:[]},shell:{enabled:false,allowedCommands:[]}};
 return agent;
}

export function createPlanningTools(root:string,guard:PermissionGuard,record?:(entry:PlanningInvestigation)=>void):ToolDefinition[]{
 const tools=[ReadFileTool,ListDirectoryTool,...createCodebaseTools(root,guard).filter(tool=>tool.name==='grep'||tool.name==='glob')];
 return tools.map(tool=>({...tool,metadata:{source:'builtin' as const,riskLevel:'low' as const},execute:async(args:Record<string,unknown>)=>{
  const target=typeof args.path==='string'?args.path:root;
  if(!path.isAbsolute(target)||!guard.checkFileSystem(target,'read'))return toolError('Planning read permission denied.');
  if(tool.name==='read_file'){
   const stat=await fs.stat(target);
   if(!stat.isFile()||stat.size>256*1024)return toolError('Planning reads are limited to text files up to 256 KiB. Use a focused search.');
  }
  let result=await tool.execute({...args,path:target});
  if(tool.name==='list_directory'){
   const value=unwrapToolExecutionResult(result);
   if(value.ok){const data=value.data as {files:string[]};result={__toolResult:true,ok:true,data:{files:data.files.filter(name=>guard.checkFileSystem(path.join(target,name),'read'))}};}
  }
  if(unwrapToolExecutionResult(result).ok)record?.({tool:tool.name,args:{...args,path:target},digest:fingerprint(result)});
  return result;
 }}));
}
