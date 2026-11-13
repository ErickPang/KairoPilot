import { useEffect, useRef, useState } from 'react';
import type { ConversationNavigationEntry, ConversationNavigationPage, ConversationPage } from '../../shared/contracts';
import { KAIRO_INVOKE } from '../../shared/ipc';

interface IndexState { sessionId: string | null; entries: ConversationNavigationEntry[]; before?: number }

export function useConversationNavigation(sessionId: string | null, revision: ConversationPage | undefined) {
  const [state, setState] = useState<IndexState>({ sessionId, entries: [] });
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const generation = useRef(0);
  const earlierBusy = useRef(false);
  useEffect(() => {
    const token = ++generation.current;
    setState({ sessionId, entries: [] });
    setError('');
    setLoadingEarlier(false);
    earlierBusy.current = false;
    return () => { generation.current = token + 1; };
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || !revision) return;
    let cancelled = false;
    void window.kairo.invoke(KAIRO_INVOKE.chatConversationNavigation, { sessionId }).then(raw => {
      if (cancelled) return;
      const page = raw as ConversationNavigationPage;
      setState(previous => {
        const older = previous.sessionId === sessionId ? previous.entries.filter(entry => entry.cursor < (page.entries[0]?.cursor ?? 0)) : [];
        return { sessionId, entries: [...older, ...page.entries], before: older.length ? previous.before : page.before };
      });
      setError('');
    }).catch(() => { if (!cancelled) setError('load'); });
    return () => { cancelled = true; };
  }, [sessionId, revision, retry]);
  const current = state.sessionId === sessionId ? state : { sessionId, entries: [] };
  const earlier = async () => {
    if (!sessionId || !current.before || earlierBusy.current) return;
    earlierBusy.current = true;
    const token = generation.current;
    setLoadingEarlier(true);
    try {
      const page = await window.kairo.invoke(KAIRO_INVOKE.chatConversationNavigation, { sessionId, before: current.before }) as ConversationNavigationPage;
      if (token !== generation.current) return;
      setState(previous => {
        const entries = new Map([...page.entries, ...previous.entries].map(entry => [entry.runId, entry]));
        return { sessionId, entries: [...entries.values()].sort((a, b) => a.cursor - b.cursor), before: page.before };
      });
      setError('');
    } catch { if (token === generation.current) setError('load'); }
    finally { if (token === generation.current) { earlierBusy.current = false; setLoadingEarlier(false); } }
  };
  return { ...current, error, loadingEarlier, earlier, retry: () => { setRetry(value => value + 1); if (current.before) void earlier(); } };
}
