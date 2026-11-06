import { useEffect, useRef, useState } from 'react';
import type { ConversationPage, RunSummary } from '../../shared/contracts';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import { isRunUnsettled } from './runtimeEventUtils';
import { useAdaptiveResource } from './useAdaptiveResource';

export function useConversationFeed(sessionId: string | null, run: RunSummary | null, loading: boolean) {
  const [before, setBefore] = useState<number>();
  const [cursors, setCursors] = useState<Array<number | undefined>>([]);
  const feed = useAdaptiveResource<ConversationPage>(`${sessionId}:${before || ''}`, async () => sessionId ? await window.kairo.invoke(KAIRO_INVOKE.chatConversation, { sessionId, before }) as ConversationPage : { rounds: [] }, value => value.rounds.some(round => isRunUnsettled(round.run)));
  const refresh = feed.refresh;
  const lastRunId = useRef<string>();
  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || lastRunId.current === runId) return;
    lastRunId.current = runId;
    if (isRunUnsettled(runStatus ? { status: runStatus } : null)) { setBefore(undefined); setCursors([]); }
  }, [runId, runStatus]);
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = window.kairo.on(KAIRO_EVENT.agentUpdate, raw => {
      if (raw.sessionId !== sessionId || timer !== undefined) return;
      timer = window.setTimeout(() => { timer = undefined; refresh(); }, 80);
    });
    return () => { unsubscribe(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [sessionId, refresh]);
  useEffect(() => { refresh(); }, [run?.id, run?.status, loading, refresh]);
  return {
    ...feed, before,
    earlier: () => { setCursors(previous => [...previous, before]); setBefore(feed.data?.before); },
    recent: () => { setBefore(cursors[cursors.length - 1]); setCursors(previous => previous.slice(0, -1)); }
  };
}
