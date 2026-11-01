import fs from 'node:fs';import path from 'node:path';import type {ServerResponse} from 'node:http';import type {BrowserWindow} from 'electron';
import {KAIRO_INVOKE as C} from '../src/shared/ipc';
import type {WorkbenchConfig,SessionSummary,TaskPlan,AgentRuntimeInvokeResult} from '../src/shared/contracts';
import {getRunById} from '../src/main/store/chat';
const requests:Array<{messages:Array<{role:string;content:string}>}>=[];
export function instructionsFixture(input:{messages:Array<{role:string;content:string}>},response:ServerResponse){
 if(!input.messages.filter(message=>message.role==='user').at(-1)?.content.startsWith('AGENTS_PROBE'))return false;
 requests.push(input);response.writeHead(200,{'Content-Type':'text/event-stream'});response.end(`data: ${JSON.stringify({id:'agents-fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{content:'AGENTS_DONE'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return true;
}
export async function verifyInstructions(window:BrowserWindow,invoke:<T=unknown>(channel:string,...args:unknown[])=>Promise<T>,output:string,assert:(ok:unknown,label:string)=>void){
 const js=(source:string)=>window.webContents.executeJavaScript(source);
 const wait=(condition:string)=>js(`new Promise(resolve=>{const end=Date.now()+8000;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true);}else if(Date.now()>end){clearInterval(timer);resolve(false);}},25);})`);
 const config=await invoke<WorkbenchConfig>(C.configGetWorkbench);assert(config.version===2&&config.instructions.includes('AGENTS.md')&&!('rules' in config),'AGENTS: workbench config exposes one instruction field and no persona fields');
 const global=path.join(config.instructionRoot||config.managementRoot,'AGENTS.md');const original=fs.readFileSync(global,'utf8');
 try{
  await invoke(C.configSaveWorkbench,{defaultModel:config.defaultModel,permissions:config.permissions,instructions:original+'\nGLOBAL_SENTINEL_A'});
  const root=path.join(output,'agents-project');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'PROJECT_SENTINEL_A');fs.writeFileSync(path.join(root,'KAIROPILOT.md'),'RETIRED_MUST_NOT_LOAD');
  const project=await invoke<{id:string}>(C.projectCreate,{name:'AGENTS fixture',rootPath:root});const task=await invoke<SessionSummary>(C.chatCreateSession,{projectId:project.id});
  const result=await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:task.id,content:'AGENTS_PROBE_FIRST'});assert(result.success,'AGENTS: direct task executes with portable project instructions');
  const sent=requests.at(-1)!.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
  assert(sent.includes('GLOBAL_SENTINEL_A')&&sent.includes('PROJECT_SENTINEL_A')&&!sent.includes('RETIRED_MUST_NOT_LOAD'),'AGENTS: actual model payload merges global and project without reading retired file');
  const run=getRunById(result.runId!)!;assert(run.executionContext?.instructionVersion===1&&run.executionContext.instructionSources?.length===2,'AGENTS: execution snapshot stores exact instruction source paths and hashes');
  fs.writeFileSync(path.join(root,'AGENTS.md'),'PROJECT_SENTINEL_B');
  const second=await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:task.id,content:'AGENTS_PROBE_SECOND'});assert(second.success&&requests.at(-1)!.messages.some(message=>message.role==='system'&&message.content.includes('PROJECT_SENTINEL_B')),'AGENTS: same-length file changes take effect on the next run');
  await invoke(C.chatUpdateTaskSettings,{sessionId:task.id,workflow:'plan'});
  await invoke(C.agentChat,{sessionId:task.id,content:'Review a synthetic task'});const plan=await invoke<TaskPlan>(C.taskPlanGet,task.id);
  fs.writeFileSync(path.join(root,'AGENTS.md'),'PROJECT_SENTINEL_C');
  const approved=await invoke<AgentRuntimeInvokeResult>(C.taskPlanApprove,{sessionId:task.id,planId:plan.id,revision:plan.revision});assert(!approved.success,'AGENTS: changing instructions invalidates a previously reviewed plan');
  await invoke(C.taskPlanReject,{sessionId:task.id,planId:plan.id,revision:plan.revision});
  await invoke(C.chatUpdateTaskSettings,{sessionId:task.id,workflow:'direct'});
  await invoke(C.projectUpdateRules,{projectId:project.id,rules:'PROJECT_REVIEWED',memory:'BACKGROUND_ONLY'});
  await invoke(C.chatSetActiveSession,task.id);await window.loadFile(path.join(output,'index.html'));assert(await wait(`document.querySelector('textarea')`),'AGENTS: project task reopens with current instructions');
  await wait(`document.querySelector('[data-nav-tab=settings]') && !document.querySelector('[data-nav-tab=settings]').disabled`);await js(`document.querySelector('[data-nav-tab=settings]').click()`);assert(await wait(`document.querySelector('[data-settings-section=rules]')`),'AGENTS: settings navigation mounts');await js(`document.querySelector('[data-settings-section=rules]').click()`);assert(await wait(`document.querySelector('.workbench-rule-input')`),'AGENTS: unified instruction editor mounts');
  const edited=original+'\nGLOBAL_SAVED_BY_UI';
  await js(`(()=>{const input=document.querySelector('.workbench-rule-input');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(edited)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await new Promise(resolve=>setTimeout(resolve,80));await js(`document.querySelector('.workbench-settings-form .form-actions button').click()`);
  const saved=await wait(`document.querySelector('.workbench-settings-form [role=status]')`);if(!saved)fs.writeFileSync(path.join(output,'agents-save-diagnostic.json'),JSON.stringify({matches:fs.readFileSync(global,'utf8')===edited,alert:await js(`document.querySelector('.workbench-settings-form [role=alert]')?.textContent`)}));assert(saved,'AGENTS: real settings save confirms successful persistence');assert(fs.readFileSync(global,'utf8')===edited,'AGENTS: setting editor writes the sole global AGENTS.md file');
  fs.writeFileSync(path.join(output,'agents-settings.png'),(await window.webContents.capturePage()).toPNG());
  const stored=JSON.parse(fs.readFileSync(path.join(config.managementRoot,'..','kairopilot.json'),'utf8'));
  assert(stored.version==='4.2.0'&&stored.workbench.version===2&&!stored.workbench.rules&&!stored.agents,'AGENTS: stored config retires the four-field rule model');
 }finally{await invoke(C.configSaveWorkbench,{defaultModel:config.defaultModel,permissions:config.permissions,instructions:original});}
}
