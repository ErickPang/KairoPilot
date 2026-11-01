import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { KAIRO_INVOKE } from '../../shared/ipc';
import type { MessagePageQuery, SessionMessagePage } from '../../shared/contracts';
import type { Message } from '../types';
import { ChatMessagesPanel } from './ChatMessagesPanel';
import { buildMessageGroups } from './chatMessagePresentation';
import { useTranslation } from '../hooks/useTranslation';

type Props = Pick<ComponentProps<typeof ChatMessagesPanel>, 'activeAgentName' | 'markdownComponents' | 'onViewReference' | 'toRenderableMarkdown'> & { sessionId: string };
export function TaskHistoryPanel(props: Props) {
  const { t } = useTranslation();
  const [cursors, setCursors] = useState<Array<MessagePageQuery['before']>>([undefined]);
  const [page, setPage] = useState<SessionMessagePage<Message>>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const before = cursors[cursors.length - 1];
  useEffect(() => {
    let current = true;
    setIsLoading(true); setError('');
    void window.kairo.invoke(KAIRO_INVOKE.chatGetMessagePage, { sessionId: props.sessionId, limit: 100, before })
      .then((value) => { if (current) { setPage(value); if (containerRef.current) containerRef.current.scrollTop = 0; } })
      .catch((reason: unknown) => { if (current) setError(String(reason)); })
      .finally(() => { if (current) setIsLoading(false); });
    return () => { current = false; };
  }, [props.sessionId, before, retry]);
  const messages = useMemo(() => page?.messages || [], [page]);
  const groupedMessages = useMemo(() => buildMessageGroups(messages), [messages]);
  return <div className="workbench-history-panel">
    <div className="workbench-pagination">
      <button type="button" data-history-action="newer" disabled={isLoading || cursors.length === 1} onClick={() => setCursors((items) => items.slice(0, -1))}>{t('workbench.newerMessages')}</button>
      <span>{t('workbench.pageNumber', { page: cursors.length })} · {page?.total || 0}</span>
      <button type="button" data-history-action="older" disabled={isLoading || !page?.nextCursor || Boolean(error)} onClick={() => { if (page?.nextCursor) setCursors((items) => [...items, page.nextCursor]); }}>{t('workbench.olderMessages')}</button>
      <button type="button" data-history-action="reload" disabled={isLoading} onClick={() => { setCursors([undefined]); setRetry((value) => value + 1); }}>{t('workbench.reloadHistory')}</button>
    </div>
    {error && <p className="workbench-error" role="alert">{error}</p>}
    {isLoading && <p role="status">{t('common.loading')}</p>}
    <ChatMessagesPanel {...props} containerRef={containerRef} messagesEndRef={messagesEndRef} messages={messages} groupedMessages={groupedMessages} loading={false} setupSteps={[]} t={t}/>
  </div>;
}
