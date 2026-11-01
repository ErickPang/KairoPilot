import { useEffect, useRef, useState } from 'react';
import { KAIRO_INVOKE } from '../../shared/ipc';
import type { SessionListPage, SessionListQuery } from '../../shared/contracts';

type Cursor = SessionListQuery['before'];
export function useTaskListPage(agentId: string | null, projectId: string | null | undefined, filter: SessionListQuery['filter'], search: string, refresh: unknown) {
  const [settledSearch, setSettledSearch] = useState(search);
  useEffect(() => { const timer = window.setTimeout(() => setSettledSearch(search), 180); return () => window.clearTimeout(timer); }, [search]);
  const key = JSON.stringify([agentId, projectId === undefined ? 'all' : projectId, filter, settledSearch]);
  const [navigation, setNavigation] = useState<{ key: string; cursors: Cursor[] }>({ key, cursors: [undefined] });
  const cursors = navigation.key === key ? navigation.cursors : [undefined];
  const before = cursors[cursors.length - 1];
  const cursorKey = JSON.stringify(before || null);
  const [recent, setRecent] = useState<{ key: string; items: SessionListPage['items'] }>();
  const [result, setResult] = useState<{ key: string; cursorKey: string; page: SessionListPage }>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    const request = ++version.current;
    if (!agentId) return;
    setIsLoading(true); setError('');
    const query = { ...(projectId !== undefined ? { projectId } : {}), filter, search: settledSearch };
    void Promise.all([
      window.kairo.invoke(KAIRO_INVOKE.chatQuerySessions, { ...query, before, limit: 50 }),
      before && !settledSearch ? window.kairo.invoke(KAIRO_INVOKE.chatQuerySessions, { ...query, limit: 5 }) : Promise.resolve(null)
    ]).then(([page, latest]) => {
      if (request !== version.current) return;
      setResult({ key, cursorKey, page });
      setRecent({ key, items: latest ? latest.items : page.items.slice(0, 5) });
    })
      .catch((reason: unknown) => { if (request === version.current) setError(String(reason)); })
      .finally(() => { if (request === version.current) setIsLoading(false); });
    return () => { version.current += 1; };
  }, [agentId, projectId, filter, settledSearch, before, key, cursorKey, refresh, retryToken]);
  const page = result?.key === key && result.cursorKey === cursorKey && agentId ? result.page : { items: [], total: result?.key === key ? result.page.total : 0 };
  return {
    key, error, isLoading, hasPrevious: cursors.length > 1, nextCursor: page.nextCursor,
    recentItems: settledSearch ? page.items : !before ? page.items.slice(0, 5) : recent?.key === key ? recent.items : [],
    historyItems: settledSearch ? [] : before ? page.items.filter(item => recent?.key !== key || !recent.items.some(latest => latest.id === item.id)) : page.items.slice(5),
    retry: () => setRetryToken((value) => value + 1),
    previous: () => setNavigation({ key, cursors: cursors.slice(0, -1) }),
    next: () => { if (page.nextCursor) setNavigation({ key, cursors: [...cursors, page.nextCursor] }); }
  };
}
