import {requireTask,settingsForTask} from '../src/main/services/taskSettingsService';
import fs from 'node:fs';import path from 'node:path';import type {ServerResponse} from 'node:http';import type {BrowserWindow} from 'electron';
import {KAIRO_INVOKE as C} from '../src/shared/ipc';
import type {AgentRuntimeInvokeResult,ModelConfig,SessionSummary,RunContextSummary} from '../src/shared/contracts';
import {skillsManager} from '../src/main/core/skills/manager';import {pluginManager} from '../src/main/core/plugins/manager';
import {getDb,getLatestContextSnapshot,getRunById,getRunSteps} from '../src/main/store/chat';
import type {RuntimeSnapshot} from '../src/main/core/agent/approvalCoordinator';
import {WORKBENCH_OWNER} from '../src/main/store/configWorkbench';
type Request={messages:Array<{role:string;content:string;name?:string}>;tools?:Array<{function:{name:string}}> ;max_tokens?:number};
const requests:Request[]=[];
export function capabilitiesFixture(input:Request,response:ServerResponse){
 const last=input.messages.filter(message=>message.role==='user').at(-1)?.content||'';if(!last.includes('B2_'))return false;
 requests.push(input);const userIndex=input.messages.map(message=>message.role).lastIndexOf('user');const results=input.messages.slice(userIndex+1).filter(message=>message.role==='tool');let name='',args:unknown={};
 if(last.includes('B2_IMPLICIT')&&!results.length){name='load_skill';args={name:'b2-workflow'};}
 if(last.includes('B2_MANUAL_DENIED')&&!results.length){name='load_skill';args={name:'b2-manual'};}
 if(last.includes('B2_PLUGIN')){
  if(!results.some(message=>message.content.includes('kairo-weather-plugin')&&message.content.includes('tools'))){name='search_tools';args={query:'kairo-weather-plugin',limit:1};}
  else if(!results.some(message=>message.content.includes('Synthetic City')&&message.content.includes('temperatureCelsius'))){name=input.tools?.find(tool=>tool.function.name.startsWith('plugin_'))?.function.name||'missing_plugin';args={city:'Synthetic City'};}
 }
 response.writeHead(200,{'Content-Type':'text/event-stream'});
 const delta=name?{role:'assistant',tool_calls:[{index:0,id:`b2-${results.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'B2_DONE'};
 response.end(`data: ${JSON.stringify({id:'batch2',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta,finish_reason:name?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);return true;
}
export async function verifyCapabilities(window:BrowserWindow,invoke:<T=unknown>(channel:string,...args:unknown[])=>Promise<T>,output:string,phase:string,assert:(ok:unknown,label:string)=>void){
 if(phase==='4'){
  const pending=JSON.parse(fs.readFileSync(path.join(output,'batch2-restart.json'),'utf8')) as {approvalId:string;runId:string};
  assert(getLatestContextSnapshot<RuntimeSnapshot>(pending.runId)?.deferredTools?.some(item=>item.pluginId==='kairo-weather-plugin'),'B2: discovered plugin selections survive process restart');
  const result=await invoke<AgentRuntimeInvokeResult>(C.agentConfirmResponse,{id:pending.approvalId,approved:true});assert(result.success&&result.status==='completed','B2: approved plugin call rehydrates schemas and executes after restart');
  assert(requests.at(-1)?.messages.some(message=>message.role==='tool'&&message.content.includes('Synthetic City')),'B2: restarted execution returns actual sandbox plugin result');return;
 }
 const makeSkill=(id:string,manual=false)=>{const root=path.join(skillsManager.getPublicSkillsDirectoryPath(),id);fs.mkdirSync(path.join(root,'agents'),{recursive:true});fs.writeFileSync(path.join(root,'SKILL.md'),`---\nname: ${id}\ndescription: Synthetic ${id} workflow for batch two validation\n---\n# B2_FULL_SKILL_BODY\n${'Read only synthetic context.\n'.repeat(440)}NEVER_PUBLISH_WITHOUT_APPROVAL_B2`);if(manual)fs.writeFileSync(path.join(root,'agents','openai.yaml'),'policy:\n  allow_implicit_invocation: false\n');return root;};
 makeSkill('b2-workflow');makeSkill('b2-manual',true);await skillsManager.getSkillCatalogSnapshot(WORKBENCH_OWNER,{force:true});
 await pluginManager.installPlugin('kairo-weather-plugin');
 const run=async(input:string,always=false)=>{const task=await invoke<SessionSummary>(C.chatCreateSession);if(always){/* Isolated fixture only: public task settings intentionally reject arbitrary permission objects. */ const settings=settingsForTask(requireTask(task.id));settings.permissions.policy.approvalMode='always';getDb().prepare('UPDATE sessions SET execution_settings=? WHERE id=?').run(JSON.stringify(settings),task.id);}const index=requests.length;const result=await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:task.id,content:input});return {task,result,sent:requests.slice(index)};};
 const unrelated=await run('B2_NO_SKILL: explain a greeting');assert(unrelated.result.success,'B2: ordinary task completes without forced skill activation');assert(!unrelated.sent[0].messages.some(message=>message.role==='system'&&message.content.includes('B2_FULL_SKILL_BODY')),'B2: skill metadata is visible without eagerly injecting skill bodies');
 assert(!unrelated.sent[0].tools?.some(tool=>tool.function.name.startsWith('plugin_'))&&unrelated.sent[0].tools?.some(tool=>tool.function.name==='search_tools'),'B2: plugin schemas are absent before discovery');
 const explicit=await run('$b2-workflow B2_EXPLICIT');assert(explicit.result.success&&explicit.sent[0].messages.some(message=>message.role==='system'&&message.content.includes('NEVER_PUBLISH_WITHOUT_APPROVAL_B2')),'B2: explicit skill preload retains its full final approval requirement');
 const implicit=await run('B2_IMPLICIT: follow the synthetic workflow');assert(implicit.result.success&&implicit.sent.length===2,'B2: model-selected skill loads through the tool loop');assert(implicit.sent[1].messages.some(message=>message.role==='system'&&message.content.includes('NEVER_PUBLISH_WITHOUT_APPROVAL_B2')),'B2: next inference receives the complete loaded skill body');
 const denied=await run('B2_MANUAL_DENIED: attempt an implicit manual-only skill');assert(denied.result.success&&denied.sent.at(-1)!.messages.some(message=>message.role==='tool'&&message.content.includes('requires an explicit user invocation')),'B2: OpenAI manual-only policy rejects model-initiated activation');
 const manual=await run('$b2-manual B2_EXPLICIT_MANUAL');assert(manual.result.success&&manual.sent[0].messages.some(message=>message.role==='system'&&message.content.includes('NEVER_PUBLISH_WITHOUT_APPROVAL_B2')),'B2: OpenAI manual-only policy permits explicit user activation');
 const plugin=await run('B2_PLUGIN: use the demo weather capability');assert(plugin.result.success&&plugin.sent.length===3,'B2: plugin search, schema discovery and action execute in separate inference steps');assert(!plugin.sent[0].tools?.some(tool=>tool.function.name.startsWith('plugin_'))&&plugin.sent[1].tools?.some(tool=>tool.function.name.startsWith('plugin_')),'B2: tool definitions refresh after discovery');assert(plugin.sent[2].messages.some(message=>message.role==='tool'&&message.content.includes('Synthetic City')),'B2: actual sandbox plugin output reaches the model');
 assert(plugin.sent.every(request=>request.max_tokens===4096),'B2: every streaming request includes the reserved output limit');
 const summary=await invoke<RunContextSummary>(C.chatGetLatestContextSummary,plugin.task.id);assert(summary.budget.request&&summary.budget.request.toolTokens>0&&summary.budget.request.estimatedInputTokens+summary.budget.request.outputTokens+summary.budget.request.safetyTokens<=summary.budget.request.contextTokens,'B2: persisted context summary accounts for messages, schemas, output and safety reserve');
 const after=await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:plugin.task.id,content:'B2_NO_SKILL: a new unrelated instruction'});assert(after.success&&!requests.at(-1)!.tools?.some(tool=>tool.function.name.startsWith('plugin_')),'B2: a new user run clears previously discovered plugin schemas');
 const models=await invoke<ModelConfig[]>(C.configGetModels);const model=models.find(item=>item.id==='fixture')!;const before=requests.length;
 try{await invoke(C.configSaveModel,{...model,apiKey:'',availableModels:model.availableModels!.map(item=>({...item,contextWindowTokens:4096}))});const limited=await run('B2_OVER_BUDGET '+('x'.repeat(10000)));assert(!limited.result.success&&requests.length===before&&getRunById(limited.result.runId!)?.status==='failed','B2: over-budget current input fails without a model request or stuck running state');}finally{await invoke(C.configSaveModel,{...model,apiKey:''});}
 const pending=await run('B2_PLUGIN_APPROVAL: exercise restart recovery',true);assert(pending.result.status==='waiting_approval','B2: discovery obeys an explicit always-confirm policy');
 const second=await invoke<AgentRuntimeInvokeResult>(C.agentConfirmResponse,{id:pending.result.approvalId,approved:true});assert(second.status==='waiting_approval'&&getLatestContextSnapshot<RuntimeSnapshot>(second.runId!)?.deferredTools?.length,'B2: plugin action retains its separate approval and discovery checkpoint');
 fs.writeFileSync(path.join(output,'batch2-restart.json'),JSON.stringify({approvalId:second.approvalId,runId:second.runId}));
 fs.writeFileSync(path.join(output,'batch2-payload-summary.json'),JSON.stringify(requests.map(request=>({toolNames:request.tools?.map(tool=>tool.function.name),maxOutputTokens:request.max_tokens,messageCount:request.messages.length})),null,2));
 assert(getRunSteps(plugin.result.runId!).some(step=>step.type==='tool_call'),'B2: dynamic plugin calls remain in the execution audit trail');
 await invoke(C.chatSetActiveSession,plugin.task.id);await window.reload();
 const js=(code:string)=>window.webContents.executeJavaScript(code);
 const wait=(condition:string)=>js(`new Promise(resolve=>{const end=Date.now()+8000;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true);}else if(Date.now()>end){clearInterval(timer);resolve(false);}},25);})`);
 assert(await wait(`document.querySelector('.chat-interface[data-session-id="${plugin.task.id}"] [data-run-summary]') && document.querySelectorAll('.workbench-panel-buttons button').length===3`),'B2: selected task and its run finish restoring before inspecting details');
 await js(`(()=>{const button=document.querySelectorAll('.workbench-panel-buttons button')[2];if(button.getAttribute('aria-pressed')!=='true')button.click();})()`);
 assert(await wait(`document.querySelector('[data-request-budget]')`),'B2: real run details display the persisted request budget');
 await js(`(()=>{const node=document.querySelector('[data-request-budget]');node.closest('details').open=true;node.scrollIntoView({block:'center'});})()`);await new Promise(resolve=>setTimeout(resolve,200));fs.writeFileSync(path.join(output,'batch2-request-budget.png'),(await window.webContents.capturePage()).toPNG());
 await wait(`document.querySelector('[data-nav-tab=settings]') && !document.querySelector('[data-nav-tab=settings]').disabled`);await js(`document.querySelector('[data-nav-tab=settings]').click()`);await wait(`document.querySelector('[data-settings-section=model]')`);await js(`document.querySelector('[data-settings-section=model]').click()`);await wait(`document.querySelector('.config-card .card-actions button')`);await js(`document.querySelector('.config-card .card-actions button').click()`);
 assert(await wait(`document.querySelector('[data-model-context-limits] input')`),'B2: model settings expose optional per-model context limits');await js(`(()=>{const node=document.querySelector('[data-model-context-limits]');node.open=true;node.scrollIntoView({block:'center'});})()`);await new Promise(resolve=>setTimeout(resolve,200));fs.writeFileSync(path.join(output,'batch2-model-limits.png'),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-settings-back]').click()`);

}
