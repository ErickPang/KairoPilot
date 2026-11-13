import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatInterface } from '../src/renderer/components/ChatInterface';
import { I18nProvider } from '../src/renderer/components/layout/I18nProvider';
import type { ComposerHandle } from '../src/renderer/hooks/useTaskDraft';
import type { ConversationRound, RunSummary } from '../src/shared/contracts';
import type { TaskViewState } from '../src/renderer/components/taskViewState';
import { KAIRO_INVOKE as C, KAIRO_EVENT as E } from '../src/shared/ipc';
import '../src/renderer/index.css';
import '../src/renderer/App.css';
import '../src/renderer/components/Workbench.css';

document.documentElement.dataset.theme = 'light';
const rounds = (session: string, count: number): ConversationRound[] => Array.from({ length: count }, (_, n) => {
  const id = `${session}-${n + 1}`;
  return { run: { id, status: 'completed', createdAt: n * 1000, updatedAt: n * 1000 + 500, completedAt: n * 1000 + 500 }, items: [
    { id: `${id}:user`, runId: id, sequence: 0, kind: 'user', status: 'completed', content: `第 ${n + 1} 轮：${session === 'a' ? '分析工作台的交互与任务流程' : '另一项任务的问题'}` },
    { id: `${id}:final`, runId: id, sequence: 1, kind: 'final', status: 'completed', content: `已完成第 ${n + 1} 轮分析，保留任务上下文并说明验证结果。\n\n` + '这里是本轮回复的详细说明，用来验证长对话中的精确定位、滚动和预览。\n\n'.repeat(3) }
  ] };
});
const tasks = { a: rounds('a', 125), b: rounds('b', 3), empty: [] as ConversationRound[] };
const calls: Array<{ channel: string; query: { sessionId?: string; before?: number; aroundRunId?: string } }> = [];
const listeners = new Set<(raw: unknown) => void>();
let delayIndex = false;
let failIndex = false;
let releaseIndex: (() => void) | undefined;
const fixture = {
  calls,
  delayIndex: () => { delayIndex = true; },
  failIndex: () => { failIndex = true; },
  recoverIndex: () => { failIndex = false; },
  pendingIndex: () => Boolean(releaseIndex),
  releaseIndex: () => { releaseIndex?.(); releaseIndex = undefined; },
  stream: () => {
    const round = tasks.a[tasks.a.length - 1]; round.run.status = 'running';
    round.items[1].content += '\n\n流式更新的新内容。'.repeat(10);
    for (const listener of listeners) listener({ sessionId: 'a', runId: round.run.id, type: 'assistant-delta', content: round.items[1].content });
  }
};
Object.assign(window, { navigationFixture: fixture });
window.kairo = {
  invoke: async (channel: string, query: { sessionId?: string; before?: number; aroundRunId?: string }) => {
    calls.push({ channel, query });
    if (channel === C.chatConversation || channel === C.chatConversationNavigation) {
      const all = tasks[query.sessionId as keyof typeof tasks] || [];
      if (channel === C.chatConversationNavigation) {
        const end = query.before ? query.before - 1 : all.length;
        const start = Math.max(0, end - 100);
        const value = { entries: all.slice(start,end).map((round,n) => ({ runId: round.run.id, cursor: start + n + 1, question: round.items[0].content, answer: round.items[1].content.slice(0,240), status: round.run.status })), ...(start ? { before: start + 1 } : {}) };
        if (failIndex) throw new Error('Synthetic index failure');
        if (delayIndex) { delayIndex = false; await new Promise<void>(resolve => { releaseIndex = resolve; }); }
        return value;
      }
      let end = query.before ? query.before - 1 : all.length;
      if (query.aroundRunId) end = Math.min(all.length, all.findIndex(round => round.run.id === query.aroundRunId) + 20);
      const start = Math.max(0, end - 20);
      return structuredClone({ rounds: all.slice(start,end), ...(start ? { before: start + 1 } : {}) });
    }
    if (channel === C.chatGetDraft) return { revision: 0, input: '', referenceIds: [], attachmentIds: [], references: [], attachments: [], missingAttachmentIds: [] };
    if (channel === C.taskPlanGet) return null;
    if (channel === C.skillsGetAll) return { global: [], project: [], builtin: [] };
    if ([C.delegationList, C.taskQueueList, C.taskTemplatesList].includes(channel as typeof C.delegationList)) return [];
    throw new Error(`Unexpected fixture IPC: ${channel}`);
  },
  on: (channel: string, listener: (raw: unknown) => void) => { if (channel === E.agentUpdate) listeners.add(listener); return () => { listeners.delete(listener); }; }
} as unknown as KairoBridge;
const cache = new Map<string, TaskViewState>();
export function Fixture() {
  const [session, setSession] = useState<keyof typeof tasks>('a');
  const [input, setInput] = useState('');
  const composerRef = useRef<ComposerHandle | null>(null);
  const current = tasks[session].slice(-1)[0]?.run;
  const run = current ? { ...current, agentId: 'fixture', sessionId: session, goal: '', userInput: '' } as RunSummary : null;
  return <div className="workbench-app" style={{ flexDirection: 'column' }}>
    <header style={{ display: 'flex', gap: 12, padding: '8px 52px', borderBottom: '1px solid var(--border-soft)' }}>
      <button id="task-a" onClick={() => setSession('a')}>长对话</button><button id="task-b" onClick={() => setSession('b')}>切换任务</button><button id="task-empty" onClick={() => setSession('empty')}>空任务</button>
    </header>
    <div style={{ flex: 1, minHeight: 0 }}>
      <ChatInterface key={session} sessionId={session} run={run} loading={false} onCancelRun={async () => true} onApprove={() => {}} onDeny={() => {}} approvalBusy={false}
        input={input} setInput={setInput} handleSend={async () => true} composerRef={composerRef} isQuitPending={false} onViewReference={() => {}}
        models={[]} activeAgent={null} activeModelId={null} focusInputToken={0} onModelChange={() => {}} onTaskChanged={async () => {}} isRunBlocked={false} viewKey={session} viewCache={cache}/>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture/></I18nProvider>);
