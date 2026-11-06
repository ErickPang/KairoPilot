import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SessionSummary } from '../types';
import type { TaskFilter } from './Sidebar';
import { useTaskListPage } from '../hooks/useTaskListPage';
import { useTranslation } from '../hooks/useTranslation';

export function ProjectSessionList({ agentId, projectId, filter, search = '', refresh, renderSession }: {
  agentId: string | null; projectId?: string | null; filter: TaskFilter; search?: string; refresh: unknown;
  renderSession: (session: SessionSummary) => ReactNode;
}) {
  const { t } = useTranslation();
  const page = useTaskListPage(agentId, projectId, filter, search, refresh);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const expanded = expandedKey === page.key;
  const controls = (page.hasPrevious || page.nextCursor) && <div className="session-history-controls">
    {page.hasPrevious && <button type="button" data-session-history-action="newer" disabled={page.isLoading} onClick={page.previous}>{t('sidebar.newerSessions')}</button>}
    {page.nextCursor && <button type="button" data-session-history-action="older" disabled={page.isLoading} onClick={page.next}>{t('sidebar.olderSessions')}</button>}
  </div>;
  return <div className="project-session-list" aria-busy={page.isLoading}>
    {page.isLoading && page.recentItems.length === 0 && <p className="project-list-notice" role="status">{t('common.loading')}</p>}
    {page.error && <div className="workbench-error" role="alert">{page.error}<button type="button" onClick={page.retry}>{t('workbench.retry')}</button></div>}
    {!page.isLoading && !page.error && page.recentItems.length === 0 && <p className="project-list-notice">{t(search ? 'sidebar.noResultsTitle' : 'workbench.noProjectSessions')}</p>}
    <div className="session-recent-list">{page.recentItems.map(renderSession)}</div>
    {!search && (page.historyItems.length > 0 || page.nextCursor || page.hasPrevious) && <div className="session-history-group">
      <button type="button" className="session-history-toggle" data-session-history-toggle aria-expanded={expanded} onClick={() => setExpandedKey(expanded ? null : page.key)}><ChevronDown size={14}/>{t('sidebar.historySessions')}</button>
      {expanded && <div className="session-history-list">{page.historyItems.map(renderSession)}{controls}</div>}
    </div>}
    {search && controls}
  </div>;
}
