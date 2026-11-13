import Database from 'better-sqlite3';
import {verifyModelConfiguration} from './model-config-native';
import {verifyFileUi} from './files-ui-native';
import {verifyPluginConnections} from './plugin-connections-native';
import {initializeChatDatabase} from '../src/main/store/chatDb';
import {verifyInlineApproval} from './layout-native';
import {verifySessionApprovalRestart} from './session-approval-native';
import {capabilitiesFixture,verifyCapabilities} from './capabilities-native';
import {instructionsFixture,verifyInstructions} from './instructions-native';
import {verifyWebBoundaries} from './web-boundary-native';
import {verifyUIUnification} from './ui-unification-native';
import {batch1Fixture,verifyBatch1} from './batch1-native';
import {intelligenceFixture,verifyIntelligence} from './intelligence-native';
import {verifyTaskWorkflow} from './task-workflow-native';
import {verifyFreshStartup,quitWithExecutionCleanup,prepareAbruptExit,verifyAbruptRestart} from './execution-lifecycle-native';
import {startApplicationConversation} from '../src/main/services/applicationExecutionLifecycle';
import {getActiveSessionSummary} from '../src/main/store/taskPages';
import {app,BrowserWindow,safeStorage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {ensureAppPaths} from '../src/main/services/appRuntime';
import {DEFAULT_CONFIG} from '../src/main/store/configDefaults';
import {initializeKairoPilotConfig,readKairoPilotConfig} from '../src/main/store/configRepository';
import {getDb,createRun,getRunById,updateRun,getSessionById} from '../src/main/store/chat';
import {createDefaultAgentPermissions,createDefaultPolicyConfig} from '../src/shared/contracts';
import {setupHandlers} from '../src/main/bridge/ipc/setupHandlers';
import {KAIRO_INVOKE as C} from '../src/shared/ipc';
import {executionAgentForTask,executionContextForSession,permissionGuardForSession,assertStoredExecutionContext} from '../src/main/services/projectService';
import {strictTaskModel} from '../src/main/services/workbenchConfigService';
import {withTaskExecution} from '../src/main/services/workbenchExecution';
import {saveTaskDraft,getTaskDraft} from '../src/main/services/taskOrganizationService';
const output=process.env.KAIROPILOT_UNIFIED_OUTPUT!;
const stage=process.env.KAIROPILOT_UNIFIED_PHASE!;
const phase=stage==='1'?'3':'4';
if(!output||!process.env.KAIROPILOT_TEST_ROOT)throw new Error('Use isolated unified runner.');
app.setName('KairoPilot');
const paths=ensureAppPaths();
const checks:string[]=[];
const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);fs.writeFileSync(path.join(output,`report-progress-${stage}.json`),JSON.stringify({checkCount:checks.length,lastCheck:label}));};
let receivedSlow=false;
const fixture=http.createServer(async(request,response)=>{
 if(request.url?.startsWith('/search?')){fs.appendFileSync(path.join(output,'session-search-queries.jsonl'),JSON.stringify(new URL(request.url,'http://fixture').searchParams.get('q'))+'\n');response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({results:[{title:'Synthetic insurance policy',url:'https://example.invalid/policy',content:'Synthetic policy result for session approval verification.'}]}));return;}
 let body='';for await(const part of request)body+=part;
 const input=JSON.parse(body);if(capabilitiesFixture(input,response))return;if(instructionsFixture(input,response))return;if(await batch1Fixture(input,response))return;if(await intelligenceFixture(input,response))return;const last=input.messages.filter((item:{role:string})=>item.role==='user').at(-1)?.content || '';
 if(last.includes('SLOW'))receivedSlow=true;
 response.writeHead(200,{'Content-Type':'text/event-stream'});response.flushHeaders();
 const emit=(content:string,reason:string|null=null)=>response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{content},finish_reason:reason}]})}\n\n`);
 const lastUser=input.messages.map((item:{role:string})=>item.role).lastIndexOf('user');
 const planning=input.messages.some((item:{content?:string})=>typeof item.content==='string'&&item.content.includes('本轮仅生成待用户确认的实施计划'));
 if(!planning&&last.includes('W43_DELEGATE')&&!input.messages.slice(lastUser+1).some((item:{role:string})=>item.role==='tool')){
  response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'delegation-fixture',type:'function',function:{name:'delegate_readonly',arguments:JSON.stringify({tasks:JSON.parse(last.split('JOBS=')[1])})}}]},finish_reason:'tool_calls'}]})}\n\n`);
 }else if(planning&&!last.includes('W4_MALICIOUS_TOOL')){if(last.includes('W4_SLOW_PLANNER'))await new Promise(resolve=>setTimeout(resolve,1800));emit('# 实施计划\n1. 核对用户目标。\n2. 按确认内容实施。\n3. 验证交付物并报告结果。','stop');}
 else if(last.includes('SESSION_SEARCH')&&!input.messages.slice(lastUser+1).some((item:{role:string})=>item.role==='tool')){
  response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'synthetic-search',type:'function',function:{name:'web_search',arguments:JSON.stringify({query:last.split('QUERY=')[1],maxResults:last.includes('NEW')?7:3})}}]},finish_reason:'tool_calls'}]})}\n\n`);
 }
 else if(last.includes('SESSION_COMMAND')&&!input.messages.slice(lastUser+1).some((item:{role:string})=>item.role==='tool')){
  response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'synthetic-command',type:'function',function:{name:'execute_command',arguments:JSON.stringify({command:'node',args:last.includes('SESSION_COMMAND_CODE')?['-e','console.log("synthetic")']:[last.includes('SESSION_COMMAND_NEW')?'--help':'--version']})}}]},finish_reason:'tool_calls'}]})}\n\n`);
 }
 else if(last.includes('EDIT_APPROVAL')&&!input.messages.slice(lastUser+1).some((item:{role:string})=>item.role==='tool')){
  response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'synthetic-edit',type:'function',function:{name:'edit_file',arguments:JSON.stringify({file_path:last.split('TARGET=')[1],old_string:'BEFORE_EDIT',new_string:'AFTER_EDIT'})}}]},finish_reason:'tool_calls'}]})}\n\n`);
 }
 else if((last.includes('WRITE_APPROVAL')||last.includes('W4_WRITE')||last.includes('W4_MALICIOUS_TOOL'))&&!input.messages.slice(lastUser+1).some((item:{role:string})=>item.role==='tool')){
  response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local-a',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'synthetic-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:last.split('TARGET=')[1],content:'APPROVED_TASK_PROOF'})}}]},finish_reason:'tool_calls'}]})}\n\n`);
 }else{emit('SYNTHETIC_');if(last.includes('SLOW'))await new Promise(resolve=>setTimeout(resolve,1500));emit('DONE','stop');}
 response.end('data: [DONE]\n\n');
});
function seed(port:number){
 const config=structuredClone(DEFAULT_CONFIG);
 config.webSearch={...config.webSearch,providers:{...config.webSearch.providers,searxng:{enabled:true,baseUrl:`http://127.0.0.1:${port}`}}};
 config.models.providers={fixture:{provider:'custom',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'synthetic-only',model:[{id:'local-a',name:'Local A'},{id:'local-b',name:'Local B'}]}};
 config.workbench={version:2,defaultModel:'fixture/local-a',managementRoot:path.join(paths.userDataPath,'workbench'),instructionRoot:paths.userDataPath,instructions:'',permissions:{...createDefaultAgentPermissions(),executionProfile:'approved_execution',policy:{...createDefaultPolicyConfig('approved_execution'),approvalMode:'on_write'},fileSystem:{read:true,write:true,allowedPaths:[]},shell:{enabled:true,allowedCommands:['node']},network:{enabled:true,allowedDomains:['example.invalid',`http://127.0.0.1:${port}/search`]}}};
 fs.writeFileSync(path.join(paths.userDataPath,'kairopilot.json'),JSON.stringify(config));
}
let window:BrowserWindow;
async function run(){
 await app.whenReady();await new Promise<void>(resolve=>fixture.listen(phase==='4'?Number(fs.readFileSync(path.join(output,'fixture-port.txt'),'utf8')):0,'127.0.0.1',resolve));const port=(fixture.address() as {port:number}).port;
 fs.writeFileSync(path.join(output,'fixture-port.txt'),String(port));
 if(stage==='1')seed(port);
 else {const configPath=path.join(paths.userDataPath,'kairopilot.json');const stored=JSON.parse(fs.readFileSync(configPath,'utf8'));stored.models.providers.fixture.baseUrl=`http://127.0.0.1:${port}/v1`;fs.writeFileSync(configPath,JSON.stringify(stored));}
 await initializeKairoPilotConfig();const db=getDb();
 assert(readKairoPilotConfig().models.providers.fixture.apiKey==='synthetic-only','async secure storage restores the configured fixture credential');
 if(await safeStorage.isAsyncEncryptionAvailable()) {
  const saved=JSON.parse(fs.readFileSync(path.join(paths.userDataPath,'kairopilot.json'),'utf8')).models.providers.fixture;
  assert(saved.apiKey==='' && saved.apiKeyEncrypted?.startsWith('safe-storage:v1:'),'async secure storage keeps only ciphertext on disk');
 }
 const previousSelection=getActiveSessionSummary(undefined)?.id;
 const freshConversation=startApplicationConversation();
 assert((db.prepare('SELECT version FROM workbench_schema').get() as {version:number}).version===7,'schema v7 is ready');
 assert((db.pragma('foreign_key_check') as unknown[]).length===0,'foreign key integrity');
 if(stage==='1'){
  const incompatible=new Database(':memory:');incompatible.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('proof');");
  let rejected=false;try{initializeChatDatabase(incompatible);}catch{rejected=true;}
  assert(rejected,'unsupported schemas are rejected without conversion');
  assert((incompatible.prepare('SELECT id FROM sessions').get() as {id:string}).id==='proof'&&!incompatible.prepare("SELECT name FROM sqlite_master WHERE name='workbench_schema'").get(),'schema rejection preserves original records and table structure');incompatible.close();
 }

 await verifyWebBoundaries(assert);
 setupHandlers();
 window=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{preload:path.join(output,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const errors:string[]=[];window.webContents.on('console-message',(details)=>{if(details.level==='warning'||details.level==='error')errors.push(details.message.slice(0,1000));});
 await window.loadFile(path.join(output,'index.html'));
 const js=(source:string)=>window.webContents.executeJavaScript(source);
 const invoke=(channel:string,...args:unknown[])=>js(`window.kairo.invoke(${JSON.stringify(channel)},...${JSON.stringify(args)})`);
 const wait=(condition:string)=>js(`new Promise(resolve=>{const until=Date.now()+12000;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true);}else if(Date.now()>until){clearInterval(timer);resolve(false);}},25);})`);
 assert(await wait(`document.querySelector('.chat-input') || document.querySelector('textarea')`),'real React workbench mounts');
 if(stage==='1')await verifyModelConfiguration(output,assert);
 if(stage==='1')await verifyPluginConnections(output,assert);
 if(stage==='1')await verifyFileUi(output,assert);
 await verifyFreshStartup(window,invoke,freshConversation.id,previousSelection,assert);
 if(stage==='3'){await verifyAbruptRestart(invoke,output,freshConversation.id,assert);return;}
 const before=(db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as {count:number}).count;
 const initialized=await Promise.all(Array.from({length:8},()=>invoke(C.workbenchInit)));
 assert(initialized.every(item=>item.success),'eight concurrent workbench startup requests succeed');assert((db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as {count:number}).count===before,'startup is idempotent without acquiring an execution lease');
 assert(await js(`!document.querySelector('.agent-selector') && !document.querySelector('.agent-select')`),'no agent switcher in workbench');
 if(phase==='4')await verifyCapabilities(window,invoke,output,phase,assert);
 if(phase==='4')await verifySessionApprovalRestart(invoke,output,assert);
 if(phase==='3'||phase==='4'){await verifyTaskWorkflow(window,invoke,output,phase,assert);await verifyIntelligence(window,invoke,output,phase,assert);await verifyBatch1(window,invoke,output,phase,assert);}

 if(stage==='1'){
  const taskA=await invoke(C.chatCreateSession);const taskB=await invoke(C.chatCreateSession);
  assert(taskA.agentId==='workbench'&&taskA.executionRoot!==taskB.executionRoot,'independent tasks have separate immutable execution roots');
  await invoke(C.chatUpdateTaskSettings,{sessionId:taskB.id,model:'fixture/local-b',executionProfile:'chat_only'});
  assert(getSessionById(taskA.id)!.executionSettings!.model==='fixture/local-a','changing task B model does not change task A');
  assert(!permissionGuardForSession(getSessionById(taskB.id)).checkFileSystem(path.join(taskB.executionRoot,'proof.txt'),'read'),'chat-only task cannot access its own files');
  const missing=await invoke(C.agentChat,{content:'MISSING'});assert(!missing.success,'chat requires an explicit task id');
  const sent=invoke(C.agentChat,{sessionId:taskA.id,content:'SLOW_SYNTHETIC'});
  for(let count=0;count<100&&!receivedSlow;count++)await new Promise(resolve=>setTimeout(resolve,40));
  if(!receivedSlow){const result=await sent;throw new Error(`execution did not start: ${JSON.stringify(result)}`);}
  assert(receivedSlow,'execution reaches the synthetic model');
  const selected=await invoke(C.chatSetActiveSession,taskB.id);assert(selected.success,'viewing B is allowed while A runs');
  const duplicate=await invoke(C.agentChat,{sessionId:taskB.id,content:'DUPLICATE'});assert(!duplicate.success,'second task cannot execute while the first is active');
  saveTaskDraft(taskB.id,0,{input:'B_DRAFT',referenceIds:[],attachmentIds:[]});
  const completed=await sent;assert(completed.success,'task A completes after viewing B');
  assert(getSessionById(taskA.id)!.messages.some(item=>item.content.includes('SYNTHETIC_DONE')),'streamed response persists to task A');
  assert(getSessionById(taskB.id)!.messages.length===0&&getTaskDraft(taskB.id).input==='B_DRAFT','task B transcript and draft remain separate');
  const projectRoot=path.join(paths.userDataPath,'project');fs.mkdirSync(projectRoot);const project=await invoke(C.projectCreate,{name:'Synthetic Project',rootPath:projectRoot});
  await invoke(C.projectUpdateRules,{projectId:project.id,rules:'PROJECT_ONLY_RULE',memory:'PROJECT_ONLY_MEMORY'});
  const projectTask=await invoke(C.chatCreateSession,{projectId:project.id});
  assert(executionAgentForTask(getSessionById(projectTask.id)!).systemPrompt.includes('PROJECT_ONLY_RULE'),'project task receives its project rules');
  assert(!executionAgentForTask(getSessionById(taskA.id)!).systemPrompt.includes('PROJECT_ONLY_RULE'),'project rules do not leak into independent tasks');
  const context=executionContextForSession(getSessionById(projectTask.id)!,executionAgentForTask(getSessionById(projectTask.id)!));
  assert(!permissionGuardForSession(getSessionById(projectTask.id)).checkFileSystem(path.join(paths.userDataPath,'outside.txt'),'read'),'project file access is restricted to its execution root');
  const approvedPath=path.join(projectRoot,'approved.txt');
  const approvalRun=await invoke(C.agentChat,{sessionId:projectTask.id,content:`WRITE_APPROVAL TARGET=${approvedPath}`});
  assert(approvalRun.status==='waiting_approval'&&!fs.existsSync(approvedPath),'project write waits for task-specific approval');
  await invoke(C.chatSetActiveSession,taskB.id);
  const approvalResult=await invoke(C.agentConfirmResponse,{id:approvalRun.approvalId,approved:true});
  assert(approvalResult.success&&fs.readFileSync(approvedPath,'utf8')==='APPROVED_TASK_PROOF','approving task A while viewing B executes only in A');
  assert(getRunById(approvalRun.runId)!.sessionId===projectTask.id,'approval keeps its original task and run association');
  const revokedPath=path.join(projectRoot,'revoked.txt');
  const revokedRun=await invoke(C.agentChat,{sessionId:projectTask.id,content:`WRITE_APPROVAL TARGET=${revokedPath}`});
  await invoke(C.projectDetach,project.id);let revoked=false;try{executionAgentForTask(getSessionById(projectTask.id)!);}catch{revoked=true;}assert(revoked,'revoking project authorization blocks existing task execution');
  const deniedResume=await invoke(C.agentConfirmResponse,{id:revokedRun.approvalId,approved:true});
  assert(!deniedResume.success&&!fs.existsSync(revokedPath),'revoked project permissions block approval recovery');
  assert((await invoke(C.agentCancelRun,{runId:revokedRun.runId})).success,'a revoked waiting approval can still be cancelled');
  await invoke(C.projectBind,project.id);
  let mismatch=false;try{assertStoredExecutionContext(executionAgentForTask(getSessionById(projectTask.id)!),{...context,sessionId:'other'},projectTask.id);}catch{mismatch=true;}assert(mismatch,'task snapshot cannot be resumed by another task');
  const stale=createRun(taskB.id,'workbench','cancel invalid task','cancel');updateRun(stale.id,{status:'paused'});
  db.prepare('UPDATE sessions SET execution_root=NULL WHERE id=?').run(taskB.id);
  assert((await invoke(C.agentCancelRun,{runId:stale.id})).success&&getRunById(stale.id)!.status==='cancelled','paused task can be cancelled with an unavailable directory');
  let release!:()=>void;const executing=withTaskExecution(taskA.id,()=>new Promise<void>(resolve=>{release=resolve;}));
  let concurrent=false;try{await withTaskExecution(taskB.id,async()=>{});}catch{concurrent=true;}assert(concurrent,'global execution lease rejects overlapping initialization');release();await executing;
  assert(strictTaskModel('fixture/local-b').model==='local-b','configured task model resolves exactly');let invalid=false;try{strictTaskModel('fixture/missing');}catch{invalid=true;}assert(invalid,'missing model is rejected without fallback');
 }
 if(phase==='3'){await verifyUIUnification(window,invoke,output,assert);await verifyInstructions(window,invoke,output,assert);await verifyInlineApproval(window,invoke,output,assert);}
 if(phase==='3')await verifyCapabilities(window,invoke,output,phase,assert);
 await window.reload();
 assert(await wait(`document.querySelector('textarea')`),'workbench reloads from persisted task selection');
 for(const theme of ['light','dark']){
  await invoke(C.configSaveAppearance,{theme});await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  for(const width of [1440,980]){window.setContentSize(width,900);await new Promise(resolve=>setTimeout(resolve,180));const image=await window.webContents.capturePage();fs.writeFileSync(path.join(output,`workbench-${phase}-${theme}-${width}.png`),image.toPNG());assert(await js(`document.documentElement.scrollWidth<=innerWidth+1`),`${theme} ${width}px has no horizontal page overflow`);}
 }
 window.setContentSize(1440,900);
 await js(`document.querySelector('[data-nav-tab="settings"]').click()`);
 assert(await wait(`document.querySelector('.is-settings-page') && document.querySelector('[data-settings-section="execution"]')`),'settings exposes execution and rules instead of agent management');
 await js(`document.querySelector('[data-settings-section="execution"]').click()`);
 assert(await wait(`document.querySelector('.workbench-settings-form [role=combobox]')`),'global execution defaults render in independent settings');
 fs.writeFileSync(path.join(output,`settings-execution-${phase}.png`),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-settings-section="rules"]').click()`);
 assert(await wait(`document.querySelectorAll('.workbench-rule-input').length===1 && document.querySelector('.workbench-settings-form').textContent.includes('AGENTS.md')`),'rules page has one AGENTS.md editor instead of four persona editors');
 assert(await js(`Array.from(document.querySelectorAll('.workbench-settings-form .config-card')).every(card=>getComputedStyle(card).display==='block')`),'settings resource cards retain readable stacked layout');
 fs.writeFileSync(path.join(output,`settings-rules-${phase}.png`),(await window.webContents.capturePage()).toPNG());
 await js(`document.querySelector('[data-settings-section="dashboard"]').click()`);
 assert(await wait(`document.querySelector('.agent-token-trigger')`),'global usage dashboard renders without an agent selector');
 await js(`document.querySelector('.agent-token-trigger').click()`);
 assert(await wait(`document.querySelector('.date-field') && document.querySelector('.token-filter-panel [role=combobox]')`),'usage details expose project/task/model/time filters');
 fs.writeFileSync(path.join(output,`usage-${phase}.png`),(await window.webContents.capturePage()).toPNG());
 assert(await js(`!document.querySelector('[data-settings-section="audit"]') && !document.querySelector('[data-nav-tab="audit"]')`),'execution record navigation is removed');
 await js(`document.querySelector('[data-settings-back]').click()`);
 assert(await wait(`!document.querySelector('.is-settings-page') && document.querySelector('textarea')`),'returning to workbench retains task selection');
 fs.writeFileSync(path.join(output,`renderer-errors-${stage}.json`),JSON.stringify(errors));
 assert(errors.filter(item=>!item.includes('Electron Security Warning')&&!item.includes('Download the React DevTools')&&!item.includes('net::ERR_FILE_NOT_FOUND')).length===0,'no unexpected renderer errors');
 if(stage==='1')await quitWithExecutionCleanup(window,invoke,output,assert,()=>{writeReport();fixture.close();});
 if(stage==='2')await prepareAbruptExit(invoke,output,assert);
}
function writeReport(){fs.writeFileSync(path.join(output,`report-${stage}.json`),JSON.stringify({success:true,checks,checkCount:checks.length}));}
run().then(()=>{if(stage==='1')return;writeReport();fixture.close();window?.destroy();app.exit(0);}).catch(error=>{fs.writeFileSync(path.join(output,`report-${stage}.json`),JSON.stringify({success:false,error:error instanceof Error?error.message:String(error),checks,checkCount:checks.length}));app.exit(1);});
