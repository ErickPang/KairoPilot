import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationPage, RunSummary } from '../../shared/contracts';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import { isRunUnsettled } from './runtimeEventUtils';
import { useAdaptiveResource } from './useAdaptiveResource';

interface PageQuery { sessionId: string | null; before?: number; aroundRunId?: string }

export function useConversationFeed(sessionId: string | null, run: RunSummary | null, loading: boolean) {
  const [selection, setSelection] = useState<PageQuery>({ sessionId });
  const query = selection.sessionId === sessionId ? selection : { sessionId };
  const [target, setTarget] = useState<{ sessionId: string; runId: string }>();
  const key = JSON.stringify(query);
  // Tag results so a task/page change cannot briefly render the previous resource's data.
  const resource = useAdaptiveResource(key, async () => ({ key, page: sessionId ? await window.kairo.invoke(KAIRO_INVOKE.chatConversation, query) as ConversationPage : { rounds: [] } }), value => value.page.rounds.some(round => isRunUnsettled(round.run)));
  const data = resource.data?.key === key ? resource.data.page : undefined;
  const refresh = resource.refresh;
  const lastRun = useRef<string>();
  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    const identity = `${sessionId}:${runId}`;
    if (!runId || lastRun.current === identity) return;
    lastRun.current = identity;
    if (isRunUnsettled(runStatus ? { status: runStatus } : null)) {
      setSelection({ sessionId });
      setTarget(undefined);
    }
  }, [sessionId, runId, runStatus]);
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = window.kairo.on(KAIRO_EVENT.agentUpdate, raw => {
      if (raw.sessionId !== sessionId || timer !== undefined) return;
      timer = window.setTimeout(() => { timer = undefined; refresh(); }, 80);
    });
    return () => { unsubscribe(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [sessionId, refresh]);
  useEffect(() => { refresh(); }, [run?.id, run?.status, loading, refresh]);
  const jumpTo = useCallback((runId: string) => {
    if (!sessionId) return;
    setTarget({ sessionId, runId });
    if (!data?.rounds.some(round => round.run.id === runId)) setSelection({ sessionId, aroundRunId: runId });
  }, [sessionId, data]);
  const finishNavigation = useCallback(() => setTarget(undefined), []);
  return {
    data, error: resource.error, refresh, before: query.before,
    isHistory: query.before !== undefined || query.aroundRunId !== undefined,
    navigationTarget: target?.sessionId === sessionId ? target : undefined,
    finishNavigation,
    jumpTo,
    earlier: () => { if (data?.before) { setTarget(undefined); setSelection({ sessionId, before: data.before }); } },
    recent: () => { setTarget(undefined); setSelection({ sessionId }); }
  };
}
