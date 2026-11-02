import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { AgentRuntimeInvokeResult, SessionSummary } from '../src/shared/contracts';
import { KAIRO_INVOKE as C } from '../src/shared/ipc';
import { getDb, getRunById } from '../src/main/store/chat';

type Invoke = <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
type Assert = (ok: unknown, label: string) => void;

export async function verifySessionApproval(window: BrowserWindow, invoke: Invoke, output: string, assert: Assert) {
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const wait = (condition: string) => js(`new Promise(resolve=>{const end=Date.now()+8000;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true);}else if(Date.now()>end){clearInterval(timer);resolve(false);}},25);})`);
  const task = await invoke<SessionSummary>(C.chatCreateSession);
  const other = await invoke<SessionSummary>(C.chatCreateSession);
  const target = path.join(task.executionRoot!, 'conversation-grant.txt');
  const input = `WRITE_APPROVAL TARGET=${target}`;
  const run = () => invoke<AgentRuntimeInvokeResult>(C.agentChat, { sessionId: task.id, content: input });
  const once = await run();
  await invoke(C.chatSetActiveSession, task.id); await window.reload();
  assert(await wait(`document.querySelector('[data-inline-approval] .approval-scope-select [role="combobox"]')`), 'session approval: allow button has a separate dropdown for reusable permissions');
  await js(`document.querySelector('[data-approval-action="allow"]').click()`);
  assert(await wait(`!document.querySelector('[data-inline-approval]') && document.querySelector('[data-run-summary="completed"]')`) && getRunById(once.runId!)?.status === 'completed', 'session approval: main button keeps allow-once behavior');
  const repeated = await run();
  assert(repeated.status === 'waiting_approval', 'session approval: allow once does not authorize an identical later operation');
  assert(await wait(`document.querySelector('.approval-scope-select [role="combobox"]')`), 'session approval: repeated operation offers an explicit session choice');
  await js(`document.querySelector('.approval-scope-select [role="combobox"]').click()`);
  assert(await wait(`document.querySelector('[data-option-value="session"]')`), 'session approval: dropdown exposes once and conversation scopes');
  await js(`document.querySelector('.approval-scope-select [role="combobox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert(await wait(`!document.querySelector('[data-select-popover]')`) && getRunById(repeated.runId!)?.status === 'waiting_approval', 'session approval: Escape closes the dropdown without denying the operation');
  await js(`document.querySelector('.approval-scope-select [role="combobox"]').click()`);
  assert(await js(`(()=>{const main=document.querySelector('[data-approval-action="allow"]'),arrow=document.querySelector('.approval-scope-select [role="combobox"]');return getComputedStyle(main).borderTopRightRadius==='0px' && getComputedStyle(arrow).borderTopLeftRadius==='0px' && Math.abs(main.getBoundingClientRect().right-arrow.getBoundingClientRect().left)<=1;})()`), 'session approval: main action and compact dropdown form one joined button');
  for (const [theme, width] of [['light', 1440], ['dark', 980]] as const) {
    window.setContentSize(width, 900);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await new Promise(resolve => setTimeout(resolve, 160));
    await window.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 160));
    assert(await js(`(()=>{const r=document.querySelector('[data-select-popover]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()`), `session approval: ${theme} dropdown fits ${width}px window`);
    assert(await js(`document.querySelectorAll('[data-select-popover] [data-option-value]').length===2 && document.querySelector('[data-option-value="session"]').textContent==='本会话始终允许' && !document.querySelector('[data-option-value="session"] .custom-select-option-description')`), `session approval: ${theme} menu keeps two fixed choices without scope descriptions`);
    fs.writeFileSync(path.join(output, `approval-scope-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
  }
  window.setContentSize(1440, 900);
  await js(`document.documentElement.dataset.theme='light';document.querySelector('[data-option-value="session"]').click()`);
  assert(await wait(`!document.querySelector('[data-inline-approval]') && document.querySelectorAll('[data-run-summary="completed"]').length===2`), 'session approval: choosing conversation scope approves and executes the reviewed operation');
  const metadata = getDb().prepare('SELECT metadata FROM approval_records WHERE id=?').get(repeated.approvalId) as {metadata:string};
  assert(JSON.parse(metadata.metadata).decisionScope === 'session', 'session approval: approval audit records the selected conversation scope');
  const replay = await run();
  assert(replay.status === 'completed' && !replay.approvalId, 'session approval: identical operation in a later round executes without another prompt');
  const otherTarget = path.join(other.executionRoot!, 'conversation-grant.txt');
  const foreign = await invoke<AgentRuntimeInvokeResult>(C.agentChat, {sessionId:other.id,content:`WRITE_APPROVAL TARGET=${otherTarget}`});
  assert(foreign.status === 'waiting_approval', 'session approval: another conversation still needs its own decision');
  await invoke(C.agentConfirmResponse, {id:foreign.approvalId,approved:false});
  const changed = await invoke<AgentRuntimeInvokeResult>(C.agentChat, {sessionId:task.id,content:`WRITE_APPROVAL TARGET=${target}.changed`});
  assert(changed.status === 'completed' && fs.readFileSync(`${target}.changed`,'utf8') === 'APPROVED_TASK_PROOF', 'session approval: a new filename in the same directory reuses the write action grant');
  assert(!fs.existsSync(otherTarget), 'session approval: denied operations produce no files');
  fs.writeFileSync(otherTarget,'BEFORE_EDIT');
  const edit = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:other.id,content:`EDIT_APPROVAL TARGET=${otherTarget}`});
  assert(edit.status === 'waiting_approval' && fs.readFileSync(otherTarget,'utf8') === 'BEFORE_EDIT', 'session approval: first edit in on-write mode waits without modifying the file');
  await invoke(C.agentConfirmResponse,{id:edit.approvalId,approved:true,scope:'session'});
  assert(getRunById(edit.runId!)?.status === 'completed' && fs.readFileSync(otherTarget,'utf8') === 'AFTER_EDIT', 'session approval: approved edit executes the reviewed replacement');
  const writeAfterEdit = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:other.id,content:`WRITE_APPROVAL TARGET=${otherTarget}.after-edit`});
  assert(writeAfterEdit.status === 'completed' && fs.existsSync(`${otherTarget}.after-edit`), 'session approval: editing and writing share the directory modification grant');

  const commandTask = await invoke<SessionSummary>(C.chatCreateSession);
  const settings = commandTask.executionSettings!; settings.permissions.policy.approvalMode = 'always';
  getDb().prepare('UPDATE sessions SET execution_settings=? WHERE id=?').run(JSON.stringify(settings),commandTask.id);
  const command = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:commandTask.id,content:'SESSION_COMMAND'});
  assert(command.status === 'waiting_approval', 'session approval: an actual shell command first requests approval');
  await invoke(C.agentConfirmResponse,{id:command.approvalId,approved:true,scope:'session'});
  const commandReplay = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:commandTask.id,content:'SESSION_COMMAND'});
  assert(commandReplay.status === 'completed', 'session approval: recognized shell action repeats without another approval');
  const commandChanged = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:commandTask.id,content:'SESSION_COMMAND_NEW'});
  assert(commandChanged.status === 'completed', 'session approval: changing version to help reuses the runtime information action grant');
  const commandCode = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:commandTask.id,content:'SESSION_COMMAND_CODE'});
  assert(commandCode.status === 'waiting_approval', 'session approval: changing runtime information into code execution requires a new decision');
  await invoke(C.agentConfirmResponse,{id:commandCode.approvalId,approved:false});
  await invoke(C.chatUpdateTaskSettings,{sessionId:commandTask.id,executionProfile:'read_only_workspace'});
  await invoke(C.chatUpdateTaskSettings,{sessionId:commandTask.id,executionProfile:'approved_execution'});
  assert(!(getDb().prepare('SELECT 1 FROM session_approval_grants WHERE session_id=?').get(commandTask.id)), 'session approval: permission changes permanently clear prior conversation grants');

  const searchTask = await invoke<SessionSummary>(C.chatCreateSession);
  const searchSettings = searchTask.executionSettings!; searchSettings.permissions.policy.approvalMode = 'always';
  getDb().prepare('UPDATE sessions SET execution_settings=? WHERE id=?').run(JSON.stringify(searchSettings),searchTask.id);
  const search = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:searchTask.id,content:'SESSION_SEARCH QUERY=保险政策'});
  assert(search.status === 'waiting_approval', 'session approval: first search requests permission');
  await invoke(C.agentConfirmResponse,{id:search.approvalId,approved:true,scope:'session'});
  assert(getRunById(search.runId!)?.status === 'completed' && fs.readFileSync(path.join(output,'session-search-queries.jsonl'),'utf8').includes('保险政策'), 'session approval: approved search completes through the real local provider');
  for (const query of ['2026年保险新政策','金融监管总局 最新通知']) {
    const result = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:searchTask.id,content:`SESSION_SEARCH_NEW QUERY=${query}`});
    assert(result.status === 'completed' && !result.approvalId && fs.readFileSync(path.join(output,'session-search-queries.jsonl'),'utf8').includes(query), `session approval: changed search query and result count run without another prompt (${query})`);
  }
  fs.writeFileSync(path.join(output, 'session-approval-restart.json'), JSON.stringify({sessionId:task.id,input,searchSessionId:searchTask.id}));
}

export async function verifySessionApprovalRestart(invoke: Invoke, output: string, assert: Assert) {
  const fixture = JSON.parse(fs.readFileSync(path.join(output,'session-approval-restart.json'),'utf8')) as {sessionId:string;input:string;searchSessionId:string};
  const result = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:fixture.sessionId,content:fixture.input});
  assert(result.status === 'completed' && !result.approvalId, 'session approval: conversation grant survives a complete Electron process restart');
  const search = await invoke<AgentRuntimeInvokeResult>(C.agentChat,{sessionId:fixture.searchSessionId,content:'SESSION_SEARCH_NEW QUERY=重启后保险政策查询'});
  assert(search.status === 'completed' && !search.approvalId && fs.readFileSync(path.join(output,'session-search-queries.jsonl'),'utf8').includes('重启后保险政策查询'), 'session approval: changed search query reuses its capability grant after a complete process restart');
}
