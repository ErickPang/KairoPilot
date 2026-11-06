import {app} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {z} from 'zod';
import {ensureAppPaths} from '../src/main/services/appRuntime';
import {readKairoPilotConfig,initializeKairoPilotConfig} from '../src/main/store/configRepository';
import {splitAgentModel} from '../src/main/store/configModelUtils';
import {DEFAULT_CONFIG} from '../src/main/store/configDefaults';
import {createDefaultAgentPermissions,createDefaultPolicyConfig} from '../src/shared/contracts';
import {createLLMProvider} from '../src/main/core/llm/provider';
import type {ChatMessage,LLMUsage,ToolDefinition} from '../src/main/core/llm/types';
import {createActiveProject,executionAgentForTask,executionContextForSession} from '../src/main/services/projectService';
import {createActiveAgentSession} from '../src/main/services/chatService';
import {requireTask,updateTaskSettings} from '../src/main/services/taskSettingsService';
import {createRun,updateRun} from '../src/main/store/chat';
import {memoryState,setMemoryEnabled,listDelegates} from '../src/main/store/intelligence';
import {drainMemoryJobs,scheduleProjectMemory,memorySnapshot,editProjectMemory} from '../src/main/services/projectMemoryService';
import {createDelegationTool} from '../src/main/services/delegationService';
import {isToolExecutionResult} from '../src/main/core/tools/result';
import {redactSensitiveValue} from '../src/main/core/security/permissions';

const output=process.env.KAIROPILOT_REAL_MODEL_OUTPUT;
if(!output||!process.env.KAIROPILOT_TEST_ROOT)throw new Error('Use the isolated real-model runner.');
app.setName('KairoPilot');
const checks:string[]=[];
const samples:unknown[]=[];
const usages:LLMUsage[]=[];
let stage='initialization';
let calls=0;
const progress=(message:string)=>{stage=message;process.stdout.write(JSON.stringify({stage})+'\n');};
const assert=(condition:unknown,label:string)=>{if(!condition)throw new Error(label);checks.push(label);};
let binding='';
let server:http.Server|undefined;

async function run(){
 await app.whenReady();
 // Read the configured model and credential only. Never initialize or write the real profile.
 const source=readKairoPilotConfig(path.join(os.homedir(),'.kairopilot','kairopilot.json'));
 binding=source.workbench!.defaultModel;
 const selected=splitAgentModel(binding);
 const provider=selected?source.models.providers[selected.providerKey]:undefined;
 if(!selected||!provider||!provider.model.some(item=>item.id===selected.modelId))throw new Error('Configured model is unavailable.');
 const external=createLLMProvider({provider:provider.provider,model:selected.modelId,baseUrl:provider.baseUrl,apiKey:provider.apiKey});
 // Forward the isolated profile's protocol requests in memory. No real credentials are copied to disk.
 server=http.createServer(async(request,response)=>{
  const controller=new AbortController();response.on('close',()=>{if(!response.writableEnded)controller.abort();});
  try{
   if(++calls>24)throw new Error('Acceptance request budget reached.');
   let body='';for await(const part of request)body+=part;
   const input=JSON.parse(body) as {messages:ChatMessage[];tools?:Array<{function:{name:string;description:string;parameters:Record<string,unknown>}}> ;max_tokens?:number};
   const tools:ToolDefinition[]|undefined=input.tools?.map(({function:tool})=>({...tool,parameters:z.unknown(),parametersJsonSchema:tool.parameters,execute:async()=>{throw new Error('Proxy does not execute tools.');}}));
   const result=await external.complete({messages:input.messages,tools,signal:controller.signal,generationConfig:{maxOutputTokens:input.max_tokens}});
   if(result.usage)usages.push(result.usage);
   response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({id:'real-model',object:'chat.completion',created:Math.floor(Date.now()/1000),model:selected.modelId,choices:[{index:0,message:result.message,finish_reason:result.finishReason||'stop'}],usage:result.usage}));
  }catch(reason){
   let message=reason instanceof Error?reason.message:'Provider request failed';
   if(provider.apiKey)message=message.split(provider.apiKey).join('[REDACTED]');
   message=String(redactSensitiveValue(message)).replace(/https?:\/\/[^\s"']+/g,'[provider endpoint]').slice(0,500);
   fs.writeFileSync(path.join(output!,'provider-failure.json'),JSON.stringify({stage,call:calls,name:reason instanceof Error?reason.name:'unknown',message}),{mode:0o600});
   response.writeHead(502,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:`Configured provider request failed (${reason instanceof Error?reason.name:'unknown'}).`}}));
  }
 });
 await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Proxy unavailable.');
 const paths=ensureAppPaths();
 const config=structuredClone(DEFAULT_CONFIG);
 config.models.providers={acceptance:{provider:'custom',baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:'',model:[{id:selected.modelId,name:'Configured acceptance model'}]}};
 const workspace=path.join(paths.userDataPath,'synthetic-rules');fs.mkdirSync(workspace,{recursive:true});
 const permissions={...createDefaultAgentPermissions(),executionProfile:'read_only_workspace' as const,policy:{...createDefaultPolicyConfig('read_only_workspace'),approvalMode:'never' as const},fileSystem:{read:true,write:false,allowedPaths:[]},shell:{enabled:false,allowedCommands:[]},network:{enabled:false,allowedDomains:[]}};
 config.workbench={version:2,defaultModel:`acceptance/${selected.modelId}`,permissions,managementRoot:path.join(paths.userDataPath,'workbench'),instructionRoot:paths.userDataPath,instructions:''};
 fs.writeFileSync(path.join(paths.userDataPath,'kairopilot.json'),JSON.stringify(config),{mode:0o600});
 initializeKairoPilotConfig();
 const root=path.join(paths.userDataPath,'synthetic-project');fs.mkdirSync(root);
 fs.writeFileSync(path.join(root,'alpha.txt'),'Synthetic Atlas alpha module: timeout=17; owner=Team Cedar; validation=unit-alpha.');
 fs.writeFileSync(path.join(root,'beta.txt'),'Synthetic Atlas beta module: timeout=29; owner=Team Pine; validation=unit-beta.');
 const project=createActiveProject('Synthetic Atlas',root);
 const task=createActiveAgentSession('Synthetic memory',project.id);
 setMemoryEnabled(project.id,true);
 async function extract(input:string,label:string){
  progress(label);
  const current=requireTask(task.id);const context=executionContextForSession(current,executionAgentForTask(current));
  const run=createRun(task.id,'workbench',input,input,context);updateRun(run.id,{status:'completed'});
  scheduleProjectMemory(run.id);await drainMemoryJobs();
  const state=memoryState(project.id);const job=state.jobs.find(item=>item.runId===run.id);
  samples.push({label,input,job,entries:state.entries});
  assert(job?.status==='completed',`${label}: extraction completed`);return state;
 }
 if(!process.env.KAIROPILOT_REAL_MODEL_DELEGATION_ONLY){
 let state=await extract('请记住，Atlas 项目的正式发布分支固定为 release-amber；验收报告必须使用中文。','memory: explicit durable facts');
 assert(state.entries.some(item=>item.status==='active'&&item.content.includes('release-amber')),'durable release branch extracted');
 const count=state.entries.length;
 state=await extract('Atlas 项目的正式发布分支固定为 release-amber；验收报告必须使用中文。','memory: duplicate facts');
 assert(state.entries.length===count,'repeated facts do not create duplicate entries');
 state=await extract('更正：Atlas 项目的正式发布分支现已改为 release-violet，旧的 release-amber 已废弃。','memory: contradictory correction');
 assert(state.entries.some(item=>item.status==='conflict'&&item.content.includes('release-violet')),'contradictory correction requires review');
 assert(!memorySnapshot(task.id,'正式发布分支')?.entries.some(item=>item.content.includes('release-violet')),'unconfirmed correction excluded from recall');
 const beforeTemporary=state.entries.length;
 state=await extract('这次临时帮我算一下 13 加 8，算完不用记住。','memory: temporary request');
 assert(state.entries.length===beforeTemporary,'temporary calculation is not stored as durable memory');
 const conflict=state.entries.find(item=>item.status==='conflict'&&item.content.includes('release-violet'))!;
 const forgotten=editProjectMemory(project.id,conflict.id,conflict.revision,'forget');
 assert(editProjectMemory(project.id,conflict.id,forgotten.revision,'edit',conflict.content).status==='conflict','real extracted conflict remains pending after undo');
 }

 updateTaskSettings(task.id,{delegation:'auto'});
 const local=createLLMProvider({provider:'custom',model:selected.modelId,baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:''});
 async function investigate(goal:string,label:string){
  progress(label);
  const current=requireTask(task.id);const agent=executionAgentForTask(current);const context=executionContextForSession(current,agent);
  const parent=createRun(task.id,'workbench',goal,goal,context);updateRun(parent.id,{status:'running'});
  const tool=createDelegationTool(task.id,()=>parent.id,context);
  const messages:ChatMessage[]=[{role:'system',content:agent.systemPrompt},{role:'user',content:goal}];
  const response=await local.complete({messages,tools:[tool],signal:AbortSignal.timeout(60000),generationConfig:{maxOutputTokens:1800}});
  messages.push(response.message);
  for(const raw of response.message.tool_calls||[]){
   const call=raw as {id:string;function:{name:string;arguments:string}};
   assert(call.function.name===tool.name,`${label}: available tool selected`);
   const result=await tool.execute(JSON.parse(call.function.arguments),AbortSignal.timeout(65000));
   assert(isToolExecutionResult(result)&&result.ok,`${label}: bounded delegation accepted`);
   messages.push({role:'tool',tool_call_id:call.id,name:tool.name,content:JSON.stringify(result)});
  }
  const children=listDelegates(task.id,parent.id);
  samples.push({label,goal,children});
  progress(`${label}: summarize`);
  const final=response.message.tool_calls?.length?await local.complete({messages,signal:AbortSignal.timeout(60000),generationConfig:{maxOutputTokens:1800}}):response;
  samples.push({label,goal,children,answer:final.message.content});updateRun(parent.id,{status:'completed'});
  return {children,answer:final.message.content};
 }
 const simple=await investigate('13 加 8 等于多少？直接给出答案。','delegation: trivial task');
 assert(simple.children.length===0&&simple.answer.includes('21'),'trivial calculation remains in the main task');
 const complex=await investigate(`请用两个子智能体分别调查两个独立模块：一个读取 ${path.join(root,'alpha.txt')}，另一个读取 ${path.join(root,'beta.txt')}。分别核实 timeout、owner、validation 并带文件证据回传，再汇总比较。只读，不写文件、不用 Shell。`,'delegation: independent evidence');
 assert(complex.children.length===2&&complex.children.every(item=>item.status==='completed'),'two independent real-model investigations complete');
 assert(complex.children.some(item=>item.result.includes('17')&&item.result.includes('Cedar'))&&complex.children.some(item=>item.result.includes('29')&&item.result.includes('Pine')),'children report correct synthetic file facts');
 assert(complex.answer.includes('17')&&complex.answer.includes('29'),'main model summarizes both child results');
 assert(fs.readFileSync(path.join(root,'alpha.txt'),'utf8').includes('timeout=17'),'synthetic files remain unchanged');
}
void run().then(()=>finish(true)).catch(reason=>finish(false,reason));
function finish(success:boolean,reason?:unknown){
 const report={success,binding,stage,calls,checks,usage:usages.reduce((sum,item)=>({prompt_tokens:sum.prompt_tokens+item.prompt_tokens,completion_tokens:sum.completion_tokens+item.completion_tokens,total_tokens:sum.total_tokens+item.total_tokens}),{prompt_tokens:0,completion_tokens:0,total_tokens:0}),error:reason instanceof Error?reason.message:reason?String(reason):undefined};
 fs.writeFileSync(path.join(output!,'samples.json'),JSON.stringify(samples,null,2),{mode:0o600});
 fs.writeFileSync(path.join(output!,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 server?.close();app.exit(success?0:1);
}
