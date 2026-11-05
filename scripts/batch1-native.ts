import {ListDirectoryTool} from '../src/main/core/tools/filesystem';
import {runActiveAgentChat} from '../src/main/bridge/ipc/agentHandlerService';
import fs from 'node:fs';
import path from 'node:path';
import type {ServerResponse} from 'node:http';
import type {BrowserWindow} from 'electron';
import type {QueuedTaskMessage,SessionSummary,TaskPlan,TaskResults,AgentRuntimeInvokeResult} from '../src/shared/contracts';
import {KAIRO_INVOKE as C} from '../src/shared/ipc';
import {getDb,getSessionById,getLatestRun,getRunSteps} from '../src/main/store/chat';
import {saveTaskDraft,getTaskDraft} from '../src/main/services/taskOrganizationService';
import {withTaskExecution,isTaskExecuting} from '../src/main/services/workbenchExecution';
import {holdTaskQueue} from '../src/main/services/taskQueueService';
import {insertVerification} from '../src/main/store/workbench';
const calls=new Map<string,number>();
export async function batch1Fixture(input:{messages:Array<{role:string;content:string}>},response:ServerResponse){
 const goal=input.messages.filter(item=>item.role==='user').at(-1)?.content;
 if(typeof goal!=='string'||!goal.includes('B1_'))return false;
 calls.set(goal,(calls.get(goal)||0)+1);
 if(goal.includes('B1_FAIL')){await new Promise(resolve=>setTimeout(resolve,1200));response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'Synthetic invalid request.'}}));return true;}
 const after=input.messages.slice(input.messages.map(item=>item.role).lastIndexOf('user')+1);
 const tool=after.find(item=>item.role==='tool');
 response.writeHead(200,{'Content-Type':'text/event-stream'});response.flushHeaders();
 const send=(delta:unknown,reason:string)=>response.write(`data: ${JSON.stringify({id:'batch1-fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta,finish_reason:reason}]})}\n\n`);
 if(goal.includes('B1_STREAM_MARKDOWN')){
  send({role:'assistant',content:'## 流式排版\n\n- 标题和列表保持原位\n\n```ts\nconst answer = 42;\nconst longValue = "'+'x'.repeat(220)+'";'},'');
  await new Promise(resolve=>setTimeout(resolve,1800));
  send({content:'\n```\n\n'+Array.from({length:20},(_,index)=>`流式验证段落 ${index+1}：保持长回复的阅读和滚动定位。`).join('\n\n')},'stop');
 }
 else if(goal.includes('B1_PROGRESS_READ')&&!tool){send({role:'assistant',content:'我先读取测试文件，再整理结果。'},'');send({tool_calls:[{index:0,id:'progress-read',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:goal.split('PATH=')[1]})}}]},'tool_calls');}
 else if(goal.includes('B1_PROGRESS_READ')&&after.filter(item=>item.role==='tool').length<3){const index=after.filter(item=>item.role==='tool').length;await new Promise(resolve=>setTimeout(resolve,index===1?1800:200));const folder=index===1?'agent':'components';send({tool_calls:[{index:0,id:`progress-search-${index}`,type:'function',function:{name:'list_directory',arguments:JSON.stringify({path:path.join(path.dirname(goal.split('PATH=')[1]),folder)})}}]},'tool_calls');}
 else if(goal.includes('B1_PLAN_READ')&&!tool){send({role:'assistant',tool_calls:[{index:0,id:'planning-read',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:goal.split('PATH=')[1]})}}]},'tool_calls');}
 else if(goal.includes('B1_DELIVER')&&!tool){const data=JSON.parse(goal.split('DATA=')[1]);send({role:'assistant',tool_calls:[{index:0,id:'deliver-write',type:'function',function:{name:'write_file',arguments:JSON.stringify(data)}}]},'tool_calls');}
 else{if(goal.includes('B1_PROGRESS_READ'))await new Promise(resolve=>setTimeout(resolve,2200));if(goal.includes('B1_SLOW'))await new Promise(resolve=>setTimeout(resolve,goal.includes('B1_SLOW_STOP')?7000:1800));send({role:'assistant',content:goal.includes('B1_PLAN_READ')?`# 调查与计划\n调查依据：${tool?.content}\n修改范围：仅目标文件。\n步骤：按证据实施。\n验收：核对原文与变更。\n待确认：用户批准。`:`B1_COMPLETED ${goal}${goal.includes('B1_PROGRESS_READ')?'\n\n'+Array.from({length:22},(_,index)=>`合成验收结果 ${index+1}：仅用于检查长对话中的发送定位。`).join('\n\n'):''}`},'stop');}
 response.end('data: [DONE]\n\n');return true;
}
export async function verifyBatch1(window:BrowserWindow,invokeRaw:(channel:string,...args:unknown[])=>Promise<unknown>,output:string,phase:string,assert:(ok:unknown,label:string)=>void){
 const invoke=invokeRaw as <T=unknown>(channel:string,...args:unknown[])=>Promise<T>;
 const js=(code:string)=>window.webContents.executeJavaScript(code);
 const until=async(check:()=>boolean|Promise<boolean>)=>{for(let i=0;i<600;i++){if(await check())return true;await new Promise(resolve=>setTimeout(resolve,20));}return false;};
 const send=(sessionId:string,content:string)=>invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId,content});
 const list=(sessionId:string)=>invoke<QueuedTaskMessage[]>(C.taskQueueList,sessionId);
 const queue=async(sessionId:string,input:string)=>{const draft=getTaskDraft(sessionId);const data={input,referenceIds:[],attachmentIds:[]};const draftRevision=saveTaskDraft(sessionId,draft.revision,data);const request={sessionId,draftRevision,data};return {item:await invoke<QueuedTaskMessage>(C.taskQueueAdd,request),request};};
 const change=(item:QueuedTaskMessage,action:'edit'|'remove'|'up'|'down'|'continue',content?:string)=>invoke<QueuedTaskMessage[]>(C.taskQueueChange,{sessionId:item.sessionId,id:item.id,revision:item.revision,action,content});
 if(phase==='4'){
  const progress = JSON.parse(fs.readFileSync(path.join(output,'conversation-restart.json'),'utf8')) as { sessionId: string; runId: string };
  await invoke(C.chatSetActiveSession,progress.sessionId);await window.loadFile(path.join(output,'index.html'));
  assert(await until(()=>js(`Boolean(document.querySelector('[data-process-run="${progress.runId}"]'))`)),'restart restores earlier round identity and duration');
  await js(`document.querySelector('[data-process-run="${progress.runId}"] > summary').click()`);
  assert(await until(()=>js(`document.querySelector('[data-process-run="${progress.runId}"]')?.textContent.includes('我先读取测试文件')`)),'restart restores commentary from persisted conversation records on expansion');
  assert(await js(`!document.querySelector('[data-process-run="${progress.runId}"]')?.textContent.includes('合成验收结果') && document.querySelector('.conversation-final-answer')?.textContent.includes('合成验收结果')`),'historical final answer remains outside the restored process');
  const saved=JSON.parse(fs.readFileSync(path.join(output,'batch1-restart.json'),'utf8')) as {sessionId:string;id:string;sentId:string;count:number};
  const items=await list(saved.sessionId);const item=items.find(value=>value.id===saved.id)!;
  assert(item.status==='blocked'&&getSessionById(saved.sessionId)!.messages.length===saved.count,'restart preserves pending queue without automatic execution');
  assert(!items.some(value=>value.id===saved.sentId),'accepted queued message is not replayed after restart');
  await change(item,'continue');assert(await until(async()=>!(await list(saved.sessionId)).length),'explicit continuation after restart drains the preserved message');
  assert(getSessionById(saved.sessionId)!.messages.filter(value=>value.role==='user'&&value.content==='B1_RESTART_PENDING').length===1,'restart continuation creates exactly one user message');
  return;
 }
 const task=await invoke<SessionSummary>(C.chatCreateSession);
 const source=path.join(task.executionRoot!,'source.txt');fs.writeFileSync(source,'B1_FACT_BRANCH=staging');
 await invoke(C.chatUpdateTaskSettings,{sessionId:task.id,workflow:'plan'});
 const planned=await send(task.id,`B1_PLAN_READ PATH=${source}`);let plan=await invoke<TaskPlan>(C.taskPlanGet,task.id);
 assert(planned.success&&plan.status==='pending'&&plan.body.includes('B1_FACT_BRANCH=staging'),'planning reads authorized source and uses actual tool evidence');
 assert(plan.investigations?.length===1&&fs.readFileSync(source,'utf8')==='B1_FACT_BRANCH=staging','planning persists read evidence and makes no file edits');
 fs.writeFileSync(source,'B1_FACT_BRANCH=release');
 assert(!(await invoke<AgentRuntimeInvokeResult>(C.taskPlanApprove,{sessionId:task.id,planId:plan.id,revision:plan.revision})).success,'changed investigated file invalidates plan confirmation');
 await send(task.id,`B1_PLAN_READ PATH=${source}`);plan=await invoke<TaskPlan>(C.taskPlanGet,task.id);
 await invoke(C.chatSetActiveSession,task.id);await window.loadFile(path.join(output,'index.html'));
 assert(await until(()=>js(`Boolean(document.querySelector('[data-task-action="review-plan"]'))`)),'read-only plan appears in the real task view');
 await js(`document.querySelector('[data-task-action="review-plan"]').click()`);
 assert(await until(()=>js(`Boolean(document.querySelector('[data-plan-investigations]'))`)),'plan review exposes persisted investigation sources');
 fs.writeFileSync(path.join(output,'batch1-plan-evidence.png'),(await window.webContents.capturePage()).toPNG());
 await invoke(C.taskPlanReject,{sessionId:task.id,planId:plan.id,revision:plan.revision});
 await invoke(C.chatUpdateTaskSettings,{sessionId:task.id,workflow:'direct'});
 const guarded=await invoke<SessionSummary>(C.chatCreateSession);const guardedSource=path.join(guarded.executionRoot!,'guarded.txt');fs.writeFileSync(guardedSource,'B1_GUARDED_PROOF');
 const guardedSettings=getSessionById(guarded.id)!.executionSettings!;guardedSettings.workflow='plan';guardedSettings.permissions.policy.approvalMode='always';
 getDb().prepare('UPDATE sessions SET execution_settings=? WHERE id=?').run(JSON.stringify(guardedSettings),guarded.id);
 const investigation=await send(guarded.id,`B1_PLAN_READ PATH=${guardedSource}`);
 assert(investigation.status==='waiting_approval'&&(await invoke<TaskPlan>(C.taskPlanGet,guarded.id)).status==='planning','planning preserves an existing always-confirm read policy');
 assert(!(await invoke<AgentRuntimeInvokeResult>(C.agentResumeRun,{runId:investigation.runId})).success,'generic resume cannot bypass a planning read approval');
 const continued=await invoke<AgentRuntimeInvokeResult>(C.agentConfirmResponse,{id:investigation.approvalId,approved:true});const guardedPlan=await invoke<TaskPlan>(C.taskPlanGet,guarded.id);
 assert(continued.success&&guardedPlan.status==='pending'&&guardedPlan.body.includes('B1_GUARDED_PROOF'),'approved planning read returns to planning rather than implementation');
 await invoke(C.taskPlanReject,{sessionId:guarded.id,planId:guardedPlan.id,revision:guardedPlan.revision});
 const other=await invoke<SessionSummary>(C.chatCreateSession);
 const slow=send(task.id,'B1_SLOW_QUEUE');assert(await until(()=>Boolean(calls.get('B1_SLOW_QUEUE'))),'queue test starts a real streaming round');
 const first=await queue(task.id,'B1_FIRST');const second=await queue(task.id,'B1_SECOND');const removed=await queue(task.id,'B1_REMOVED');
 const duplicate=await invoke<QueuedTaskMessage>(C.taskQueueAdd,first.request);
 assert(duplicate.id===first.item.id&&(await list(task.id)).length===3,'queue submission is idempotent by accepted draft revision');
 assert(getTaskDraft(task.id).input===''&&!getSessionById(task.id)!.messages.some(value=>value.content==='B1_FIRST'),'queued input clears its draft without entering the active transcript early');
 let items=await change(second.item,'up');const ordered=items.map(value=>value.id);assert(ordered[0]===second.item.id,'queued messages can be reordered before dispatch');
 const edited=items.find(value=>value.id===first.item.id)!;items=await change(edited,'edit','B1_FIRST_EDITED');
 const stale=await change(edited,'remove').then(()=>false,()=>true);assert(stale,'stale queue revision cannot overwrite an edited message');
 await change(items.find(value=>value.id===removed.item.id)!,'remove');
 const cross=await invoke(C.taskQueueChange,{sessionId:other.id,id:first.item.id,revision:items.find(value=>value.id===first.item.id)!.revision,action:'remove'}).then(()=>false,()=>true);assert(cross,'queued actions reject another task identity');
 await invoke(C.chatSetActiveSession,other.id);
 assert((await slow).success&&await until(async()=>!(await list(task.id)).length&&calls.get('B1_SECOND')===1&&calls.get('B1_FIRST_EDITED')===1&&getLatestRun(task.id)?.status==='completed'),'queued follow-ups drain after the original round despite switching selection');
 const users=getSessionById(task.id)!.messages.filter(value=>value.role==='user').map(value=>value.content);
 assert(users.indexOf('B1_SECOND')<users.indexOf('B1_FIRST_EDITED')&&!users.includes('B1_REMOVED')&&calls.get('B1_SECOND')===1&&calls.get('B1_FIRST_EDITED')===1,'queue order, cancellation and exactly-once dispatch survive actual execution');
 assert(!getSessionById(other.id)!.messages.some(value=>String(value.content).includes('B1_FIRST')),'queued transcript never leaks into the viewed task');
 const failing=send(task.id,'B1_FAIL');assert(await until(()=>Boolean(calls.get('B1_FAIL'))),'failure queue fixture starts');
 const blocked=await queue(task.id,'B1_AFTER_FAILURE');assert(!(await failing).success,'provider failure is visible before continuation');
 assert(await until(async()=>(await list(task.id)).some(value=>value.status==='blocked'))&&!calls.get('B1_AFTER_FAILURE'),'failed round holds queued follow-ups without silent retry');
 const blockedItem=(await list(task.id)).find(value=>value.id===blocked.item.id)!;
 await invoke(C.chatUpdateTaskSettings,{sessionId:task.id,model:'fixture/local-b'});await change(blockedItem,'continue');
 assert(await until(async()=>!(await list(task.id)).length&&!isTaskExecuting(task.id)&&getLatestRun(task.id)?.status==='completed')&&getLatestRun(task.id)?.executionContext?.model==='fixture/local-b','explicit continuation revalidates current task settings');
 const cancel=send(task.id,'B1_SLOW_CANCEL');assert(await until(()=>Boolean(calls.get('B1_SLOW_CANCEL'))),'cancel queue fixture starts');
 await queue(task.id,'B1_AFTER_CANCEL');await invoke(C.agentCancelRun,{runId:getLatestRun(task.id)!.id});await cancel;
 assert((await list(task.id)).every(value=>value.status==='blocked')&&!calls.get('B1_AFTER_CANCEL'),'cancelling a round holds remaining queued instructions');
 for(const item of await list(task.id))await change(item,'remove');
 // Exercise the actual composer while its original request is still awaiting completion.
 await invoke(C.chatSetActiveSession,task.id);await window.loadFile(path.join(output,'index.html'));
 assert(await until(()=>js(`Boolean(document.querySelector('.chat-interface[data-session-id="${task.id}"][data-save-state="saved"] .input-textarea:not(:disabled)'))`)),'queue composer mounts its acknowledged task draft');
 const type=async(value:string)=>{await js(`(()=>{const input=document.querySelector('.input-textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
 await type('B1_SLOW_UI');assert(await until(()=>js(`Boolean(document.querySelector('.send-btn:not(:disabled)'))`)),'composer enables send after input renders');await js(`document.querySelector('.send-btn').click()`);assert(await until(()=>Boolean(calls.get('B1_SLOW_UI'))),'real composer starts a running round');
 await js(`document.querySelector('[data-task-action="options"]').click()`);assert(await until(()=>js(`Boolean(document.querySelector('[data-task-action="workflow"]:disabled') && document.querySelector('.task-workflow-menu button:first-child:not(:disabled)'))`)),'running composer permits attachments while keeping execution settings locked');await js(`document.querySelector('[data-task-action="options"]').click()`);
 await type('B1_UI_QUEUED');assert(await until(()=>js(`Boolean(document.querySelector('[data-queue-send="true"]:not(:disabled)'))`)),'follow-up queue action remains available beside stop during execution');
 await js(`document.querySelector('[data-queue-send="true"]').click()`);
 assert(await until(()=>js(`document.querySelector('[data-task-queue]')?.textContent.includes('B1_UI_QUEUED')`)),'real composer persists and shows its queued follow-up');
 assert(await js(`!Array.from(document.querySelectorAll('.workbench-topbar button')).some(button=>/暂停|取消运行|Pause|Cancel run/.test(button.textContent))`),'top toolbar omits runtime actions');
 fs.writeFileSync(path.join(output,'batch1-message-queue.png'),(await window.webContents.capturePage()).toPNG());
 assert(await until(()=>Boolean(calls.get('B1_UI_QUEUED')))&&await until(()=>getLatestRun(task.id)?.status==='completed'),'real composer follow-up executes after its original request');
 assert(await until(()=>js(`document.querySelector('.chat-interface')?.textContent.includes('B1_COMPLETED B1_UI_QUEUED')`)),'queued user message and assistant result appear in the same task view');
 assert(getTaskDraft(task.id).input===''&&getSessionById(task.id)!.messages.filter(value=>value.role==='user'&&value.content==='B1_UI_QUEUED').length===1,'overlapping composer acceptance does not restore or duplicate the queued draft');
 const streamingTask=await invoke<SessionSummary>(C.chatCreateSession);await invoke(C.chatSetActiveSession,streamingTask.id);await window.loadFile(path.join(output,'index.html'));
 assert(await until(()=>js(`Boolean(document.querySelector('.chat-interface[data-session-id="${streamingTask.id}"] .input-textarea:not(:disabled)'))`)),'streaming markdown task mounts');
 await type('B1_STREAM_MARKDOWN');assert(await until(()=>js(`Boolean(document.querySelector('.send-btn:not(:disabled)'))`)),'streaming markdown can submit');await js(`document.querySelector('.send-btn').click()`);
 assert(await until(()=>js(`Boolean(document.querySelector('[data-run-summary=running]')) && document.querySelector('.markdown-body h2')?.textContent==='流式排版' && Boolean(document.querySelector('.markdown-body pre code.language-ts'))`)),'streaming renders headings and an unfinished code fence before completion');
 const initialBlocks=await js(`(()=>{const body=document.querySelector('.markdown-body');return ['h2','ul','pre'].map(tag=>body.querySelector(tag).outerHTML);})()`);
 assert(await js(`(()=>{const pre=document.querySelector('.markdown-body pre');return pre.scrollWidth>pre.clientWidth && getComputedStyle(pre).overflowX==='auto' && document.documentElement.scrollWidth<=innerWidth+1;})()`),'long streaming code scrolls within its block rather than widening the page');
 await new Promise(resolve=>setTimeout(resolve,300));
 fs.writeFileSync(path.join(output,'conversation-streaming-markdown.png'),(await window.webContents.capturePage()).toPNG());
 assert(await until(()=>getLatestRun(streamingTask.id)?.status==='completed')&&await until(()=>js(`document.querySelector('.conversation-final-answer .markdown-body')?.textContent.includes('流式验证段落 20')`)),'streaming markdown completes with every paragraph');
 assert(await js(`(()=>{const body=document.querySelector('.conversation-final-answer .markdown-body');return JSON.stringify(['h2','ul','pre'].map(tag=>body.querySelector(tag).outerHTML))===${JSON.stringify(JSON.stringify(initialBlocks))};})()`),'completed headings, lists and code retain their streaming markup');
 assert(await until(()=>js(`(()=>{const el=document.querySelector('.messages-container');return el.scrollHeight-el.scrollTop-el.clientHeight<4;})()`)),'long markdown completion follows the latest output');
 for(const theme of ['light','dark'])for(const width of [1440,980]){
  window.setContentSize(width,900);await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await new Promise(resolve=>setTimeout(resolve,150));
  assert(await js(`(()=>{const pre=document.querySelector('.conversation-final-answer pre');return pre.scrollWidth>pre.clientWidth && document.documentElement.scrollWidth<=innerWidth+1 && getComputedStyle(pre).fontSize==='13px';})()`),`markdown code stays readable and inside the viewport in ${theme} ${width}`);
 }
 await js(`document.querySelector('.conversation-final-answer h2').scrollIntoView({block:'start'})`);await new Promise(resolve=>setTimeout(resolve,300));
 fs.writeFileSync(path.join(output,'conversation-markdown-dark-980.png'),(await window.webContents.capturePage()).toPNG());
 window.setContentSize(1440,900);await js(`document.documentElement.dataset.theme='light'`);
 // Use a clean task to review the conversation progress in the real renderer.
 const progressTask=await invoke<SessionSummary>(C.chatCreateSession);await invoke(C.chatSetActiveSession,progressTask.id);await window.loadFile(path.join(output,'index.html'));
 assert(await until(()=>js(`Boolean(document.querySelector('.chat-interface[data-session-id="${progressTask.id}"][data-save-state="saved"] .input-textarea:not(:disabled)'))`)),'progress task mounts with its own ready composer');
 const listDirectory=ListDirectoryTool.execute;
 ListDirectoryTool.execute=async(args,signal)=>{if(typeof args.path==='string'&&args.path.startsWith(progressTask.executionRoot!))await new Promise(resolve=>setTimeout(resolve,1800));return listDirectory(args,signal);};
 for(const folder of ['agent','components']){fs.mkdirSync(path.join(progressTask.executionRoot!,folder));fs.writeFileSync(path.join(progressTask.executionRoot!,folder,'example.ts'),'export const fixture = true;');}
 const progressSource=path.join(progressTask.executionRoot!,'worker-prompt.md');fs.writeFileSync(progressSource,'SYNTHETIC_PROGRESS_EVIDENCE');
 await type(`B1_PROGRESS_READ PATH=${progressSource}`);assert(await until(()=>js(`Boolean(document.querySelector('.send-btn:not(:disabled)'))`)),'progress task can submit its initial instruction');await js(`document.querySelector('.send-btn').click()`);
 assert(await until(()=>js(`Array.from(document.querySelectorAll('.message.assistant')).some(item=>item.textContent.includes('我先读取测试文件')) && Boolean(document.querySelector('[data-run-activity]')) && Boolean(document.querySelector('[data-run-summary=running]'))`)),'intermediate assistant commentary stays visible while execution continues');
 await js(`document.querySelector('[data-run-activity]').scrollIntoView({block:'end'});document.documentElement.setAttribute('data-theme','light');document.documentElement.style.colorScheme='light'`);await new Promise(resolve=>setTimeout(resolve,300));
 fs.writeFileSync(path.join(output,'conversation-progress.png'),(await window.webContents.capturePage()).toPNG());
 assert(await js(`document.querySelector('[data-run-summary=running]')?.textContent.startsWith('已处理 ') && !document.querySelector('[data-run-summary=running] > svg')`),'live heading matches the reference elapsed label without a disclosure arrow');
 assert(await js(`!document.querySelector('.conversation-run-info, .workbench-run-meta, [data-request-budget], [data-instruction-sources], .workbench-step') && !document.querySelector('.messages-container')?.textContent.includes('模型推理')`),'conversation has no old run details or internal step presentation');
 fs.writeFileSync(path.join(output,'conversation-thinking.png'),(await window.webContents.capturePage()).toPNG());
 for(const folder of ['agent','components']){
  assert(await until(()=>js(`document.querySelector('[data-run-activity]')?.textContent.includes('正在搜索 ${folder} 文件夹中的文件')`)),`live activity describes the actual ${folder} folder search`);
  await js(`document.querySelector('[data-run-activity]').scrollIntoView({block:'end'})`);await new Promise(resolve=>setTimeout(resolve,150));
  fs.writeFileSync(path.join(output,`conversation-search-${folder}.png`),(await window.webContents.capturePage()).toPNG());
 }

 assert(await until(()=>getLatestRun(progressTask.id)?.status==='completed')&&await until(()=>js(`Boolean(document.querySelector('[data-run-summary=completed]')) && !document.querySelector('[data-composer-stop]')`)),'normal completion restores the arrow and freezes the duration');
 ListDirectoryTool.execute=listDirectory;
 const progressRunId=getLatestRun(progressTask.id)!.id;
 assert(await js(`!document.querySelector('[data-process-run="${progressRunId}"][open]') && !document.querySelector('[data-process-commentary]') && document.querySelector('.conversation-final-answer')?.textContent.includes('合成验收结果')`),'completion folds commentary and operations together while leaving the final answer visible');
 await js(`document.querySelector('[data-process-run="${progressRunId}"] > summary').click()`);
 assert(await until(()=>js(`document.querySelector('[data-process-run="${progressRunId}"][open]')?.textContent.includes('我先读取测试文件')`)),'expanding duration restores commentary in the same process');
 assert(await js(`!document.querySelector('[data-process-run="${progressRunId}"]')?.textContent.includes('合成验收结果')`),'final answer is not duplicated inside the process');
 await js(`document.querySelector('[data-process-run="${progressRunId}"] .conversation-tool > summary').click()`);
 assert(await until(()=>js(`Boolean(document.querySelector('[data-process-run="${progressRunId}"] .conversation-tool[open] pre'))`)),'individual operation output is rendered after an actual click');
 await new Promise(resolve=>setTimeout(resolve,300));await js(`document.querySelector('[data-process-run="${progressRunId}"] > summary').scrollIntoView({block:'start'})`);await new Promise(resolve=>setTimeout(resolve,200));
 assert(await js(`document.querySelector('.conversation-tool[open] pre')?.textContent==='SYNTHETIC_PROGRESS_EVIDENCE' && !document.querySelector('.conversation-run-info, [data-request-budget]')`),'expanded activity shows actual output without the old input/output JSON or run details');
 fs.writeFileSync(path.join(output,'conversation-completed-expanded.png'),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-process-run="${progressRunId}"] > summary').click()`);
 await new Promise(resolve=>setTimeout(resolve,300));await js(`document.querySelector('[data-process-run="${progressRunId}"] > summary').scrollIntoView({block:'start'})`);await new Promise(resolve=>setTimeout(resolve,200));
 fs.writeFileSync(path.join(output,'conversation-completed-collapsed.png'),(await window.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(output,'conversation-restart.json'),JSON.stringify({sessionId:progressTask.id,runId:progressRunId}));
 assert(getRunSteps(getLatestRun(progressTask.id)!.id).some(item=>item.type==='tool_result'&&JSON.stringify(item.output).includes('SYNTHETIC_PROGRESS_EVIDENCE')),'progress comes from an actual authorized file read');
 // Stop the real request from the composer while preserving unsent follow-up text.
 assert(await js(`(()=>{const container=document.querySelector('.messages-container');return container.scrollHeight>container.clientHeight+100;})()`),'scroll fixture has enough actual conversation content to overflow');
 await js(`document.querySelector('.messages-container').scrollTop=0`);
 await new Promise(resolve=>setTimeout(resolve,100));
 await type('B1_SLOW_STOP');assert(await until(()=>js(`Boolean(document.querySelector('.send-btn:not(:disabled)'))`)),'stop fixture submits from a previous scroll position');await js(`document.querySelector('.send-btn').click()`);
 assert(await until(()=>js(`Boolean(document.querySelector('[data-composer-stop]:not(:disabled)'))`)),'running request replaces the composer arrow with a stop square');
 assert(await until(()=>js(`document.querySelector('[data-run-activity]')?.textContent.includes('正在思考')`)),'running request shows a quiet thinking status in the conversation');
 assert(await until(()=>js(`(()=>{const activity=document.querySelector('[data-run-activity]'),container=document.querySelector('.messages-container');return activity && activity.getBoundingClientRect().bottom<=container.getBoundingClientRect().bottom+1;})()`)),'sending from history follows the latest execution activity into view');
 await type('keep this unsent');await new Promise(resolve=>setTimeout(resolve,150));
 fs.writeFileSync(path.join(output,'conversation-running.png'),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-composer-stop]').click()`);
 assert(await until(()=>getLatestRun(progressTask.id)?.status==='cancelled')&&await until(()=>js(`!document.querySelector('[data-composer-stop]') && !!document.querySelector('.send-btn .lucide-arrow-up')`)),'composer stop cancels the actual run and restores the arrow');
 assert(await until(()=>js(`document.querySelector('.input-textarea').value==='keep this unsent' && !document.querySelector('[data-run-activity]') && document.querySelector('[data-run-summary=cancelled]')?.textContent.includes('已停止')`)),'stopping retains the typed draft and renders an accurate terminal summary');
 await js(`document.querySelector('[data-run-summary=cancelled]').click()`);
 assert(await until(()=>js(`Boolean(document.querySelector('.messages-container .conversation-run[open] .conversation-process-body')) && !document.querySelector('.workbench-auxiliary')`)),'duration summary expands execution details in chat without opening a side panel');
 fs.writeFileSync(path.join(output,'conversation-stopped.png'),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-run-summary=cancelled]').click()`);
 assert(await until(()=>js(`!document.querySelector('.conversation-run[open]')`)),'execution process collapses again without leaving chat');
 const crossSlow=runActiveAgentChat({sessionId:task.id,content:'B1_SLOW_OTHER_TASK'},window.webContents);assert(await until(()=>Boolean(calls.get('B1_SLOW_OTHER_TASK'))),'another task owns the serial execution before queueing');
 await invoke(C.chatSetActiveSession,other.id);await window.loadFile(path.join(output,'index.html'));
 assert(await until(()=>js(`Boolean(document.querySelector('.chat-interface[data-session-id="${other.id}"][data-save-state="saved"] .input-textarea:not(:disabled)'))`)),'other task composer restores its own draft during execution');
 await type('B1_CROSS_TASK_QUEUED');assert(await until(()=>js(`Boolean(document.querySelector('[data-queue-send="true"]:not(:disabled)'))`)),'global running-task state routes another task submission to its queue');
 assert(await js(`!document.querySelector('[data-composer-stop]')`),'viewing another task never offers to stop the background task');
 await js(`document.querySelector('.send-btn').click()`);await crossSlow;
 assert(await until(()=>getSessionById(other.id)!.messages.some(value=>value.role==='user'&&value.content==='B1_CROSS_TASK_QUEUED'))&&await until(()=>getLatestRun(other.id)?.status==='completed'),'queued work in the viewed task waits for the other task and executes with its own identity');
 const deliver=await invoke<SessionSummary>(C.chatCreateSession);const target=path.join(deliver.executionRoot!,'deliverable.md');
 const write=async(content:string)=>{const result=await send(deliver.id,`B1_DELIVER DATA=${JSON.stringify({path:target,content})}`);if(result.status==='waiting_approval')return invoke<AgentRuntimeInvokeResult>(C.agentConfirmResponse,{id:result.approvalId!,approved:true});return result;};
 const old=await write('VERSION_ONE');const latest=await write('VERSION_TWO');assert(old.success&&latest.success,'delivery fixture records two actual file-writing rounds');
 insertVerification({runId:old.runId!,sessionId:deliver.id,toolCallId:'historical-fixture-check',command:'synthetic historical check',cwd:deliver.executionRoot!,status:'passed',exitCode:0,stdout:'synthetic fixture',stderr:''});
 const results=await invoke<TaskResults>(C.chatGetTaskResults,deliver.id);assert(results.artifacts.some(item=>item.runId===latest.runId)&&results.artifacts.some(item=>item.runId===old.runId),'delivery evidence retains both rounds');
 const scoped=await invoke<{oldText:string;newText:string}>(C.chatGetTaskChangeDiff,{sessionId:deliver.id,path:target,runId:latest.runId});assert(scoped.oldText==='VERSION_ONE'&&scoped.newText==='VERSION_TWO','current round change diff uses its own boundaries');
 assert(await invoke(C.chatGetTaskChangeDiff,{sessionId:other.id,path:target,runId:latest.runId}).then(()=>false,()=>true),'delivery diff rejects a run from another task');
 await invoke(C.chatSetActiveSession,deliver.id);await window.loadFile(path.join(output,'index.html'));
 assert(await until(()=>js(`Boolean(document.querySelector('.chat-interface[data-session-id="${deliver.id}"]') && document.querySelector('.workbench-panel-buttons button[aria-label="成果"]'))`)),'delivery toolbar mounts the selected task');
 await js(`document.querySelector('.workbench-panel-buttons button[aria-label="成果"]').click()`);
 assert(await until(()=>js(`document.querySelector('[data-delivery-run]')?.getAttribute('data-delivery-run')===${JSON.stringify(latest.runId)}`)),'results panel selects the latest round');
 assert(await until(()=>js(`document.querySelectorAll('[data-current-artifacts] li').length===1 && document.querySelectorAll('[data-current-verifications] li').length===0 && Boolean(document.querySelector('[data-delivery-history]:not([open])'))`)),'current delivery excludes old checks and folds historical results');
 assert(await js(`(()=>{const panel=document.querySelector('.workbench-results'),status=panel.querySelector('[data-current-verification]'),files=panel.querySelector('[data-current-artifacts]');return status.dataset.currentVerification==='unverified' && Boolean(status.compareDocumentPosition(files)&Node.DOCUMENT_POSITION_FOLLOWING) && !panel.querySelector('[data-delivery-changes]').open && !panel.querySelector('[data-delivery-verifications]').open && !files.querySelector('.delivery-artifact-details').open;})()`),'delivery prioritizes the verification conclusion and files while technical records start folded');
 assert(await js(`getComputedStyle(document.querySelector('[data-current-verification]')).fontSize==='13px' && getComputedStyle(document.querySelector('.delivery-artifact-details small')).fontSize==='12px'`),'delivery uses 13px descriptions and 12px operation metadata');
 await js(`document.querySelector('.delivery-artifact-details > summary').click();document.querySelector('[data-delivery-changes] > summary').click()`);
 assert(await until(()=>js(`document.querySelector('.delivery-artifact-details').open && Boolean(document.querySelector('.delivery-artifact-details button:not(:disabled)')) && document.querySelector('[data-delivery-changes]').open`)),'file operation details and change summaries expand on actual clicks');
 await js(`document.querySelector('.delivery-artifact-details > summary').click();document.querySelector('[data-delivery-changes] > summary').click()`);
 await new Promise(resolve=>setTimeout(resolve,350));
 assert(await until(()=>js(`Boolean(document.querySelector('[data-delivery-ready="true"] [data-current-artifacts] li'))`)),'delivery screenshot waits for settled evidence');
 for(const width of [1440,980]){window.setContentSize(width,900);await new Promise(resolve=>setTimeout(resolve,100));assert(await js(`(()=>{const panel=document.querySelector('.workbench-results');return panel.scrollWidth<=panel.clientWidth+1;})()`),`delivery evidence stays within its panel at ${width}px`);}
 window.setContentSize(1440,900);await new Promise(resolve=>setTimeout(resolve,100));
 fs.writeFileSync(path.join(output,'batch1-delivery-review.png'),(await window.webContents.capturePage()).toPNG());
 insertVerification({runId:latest.runId!,sessionId:deliver.id,toolCallId:'current-fixture-failure',command:'synthetic current check',cwd:deliver.executionRoot!,status:'failed',exitCode:1,stdout:'',stderr:'SYNTHETIC_FAILURE'});
 await window.reload();
 assert(await until(()=>js(`document.querySelector('[data-current-verification]')?.dataset.currentVerification==='failed' && document.querySelector('[data-delivery-verifications]')?.open && document.querySelector('[data-current-verifications]')?.textContent.includes('synthetic current check')`)),'failed checks remain visible and automatically expand their evidence');
 await new Promise(resolve=>setTimeout(resolve,300));
 fs.writeFileSync(path.join(output,'batch1-delivery-failed.png'),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-current-artifacts] [data-delivery-reference]').click()`);
 assert(await until(()=>getTaskDraft(deliver.id).referenceIds.length===1),'artifact follow-up adds an owned reference without executing a new round');
 assert(getLatestRun(deliver.id)?.id===latest.runId,'referencing a deliverable does not silently start execution');
 const restart=await invoke<SessionSummary>(C.chatCreateSession);let release!:()=>void;
 const lease=withTaskExecution(restart.id,()=>new Promise<void>(resolve=>{release=resolve;}));
 const accepted=await queue(restart.id,'B1_RESTART_ACCEPTED');holdTaskQueue(restart.id,'Synthetic deterministic restart preparation');const held=(await list(restart.id)).find(item=>item.id===accepted.item.id)!;release();await lease;await change(held,'continue');
 assert(await until(async()=>!(await list(restart.id)).length&&getLatestRun(restart.id)?.status==='completed'),'restart fixture first sends one accepted queued message');
 const hold=withTaskExecution(restart.id,()=>new Promise<void>(resolve=>{release=resolve;}));const pending=await queue(restart.id,'B1_RESTART_PENDING');holdTaskQueue(restart.id,'Synthetic pre-restart hold');release();await hold;
 fs.writeFileSync(path.join(output,'batch1-restart.json'),JSON.stringify({sessionId:restart.id,id:pending.item.id,sentId:accepted.item.id,count:getSessionById(restart.id)!.messages.length}));
 assert((await list(restart.id)).length===1,'pending queue is prepared for process-restart recovery');
 assert((getDb().pragma('foreign_key_check') as unknown[]).length===0,'queue operations preserve foreign-key integrity');
}
