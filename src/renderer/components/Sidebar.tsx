import React, { useState } from 'react';
import { SessionSummary } from '../types';
import { IconPlus, IconEdit, IconTrash, IconSearch, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  handleCreateSession: () => void;
  handleSelectSession: (id: string) => void;
  handleDeleteSession: (e: React.MouseEvent, id: string) => void;
  handleUpdateSessionTitle: (id: string, title: string) => void;
  focusSearchToken: number;
  shortcutModifierLabel: string;
}

export const Sidebar = React.memo(function Sidebar({ 
  sessions, 
  activeSessionId, 
  handleCreateSession, 
  handleSelectSession, 
  handleDeleteSession, 
  handleUpdateSessionTitle,
  focusSearchToken,
  shortcutModifierLabel
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchText, setSearchText] = useState('');
  const { t } = useTranslation();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const sortedSessions = React.useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );
  const filteredSessions = React.useMemo(() => {
    const normalizedQuery = searchText.trim().toLowerCase();
    if (!normalizedQuery) {
      return sortedSessions;
    }

    return sortedSessions.filter((session) =>
      (session.title || t('sidebar.newChat')).toLowerCase().includes(normalizedQuery)
    );
  }, [searchText, sortedSessions, t]);
  const sidebarTitle = searchText ? t('sidebar.searchResults') : t('sidebar.recent');

  const formatSessionMeta = React.useCallback((updatedAt: number) => {
    const date = new Date(updatedAt);
    const now = new Date();
    const isSameDay = date.toDateString() === now.toDateString();
    return new Intl.DateTimeFormat(undefined, {
      month: isSameDay ? undefined : 'short',
      day: isSameDay ? undefined : 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }, []);

  React.useEffect(() => {
    if (!focusSearchToken) {
      return;
    }

    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [focusSearchToken]);

  const startEditing = (e: React.MouseEvent, session: SessionSummary) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const saveTitle = (id: string) => {
    if (editTitle.trim()) {
      handleUpdateSessionTitle(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      saveTitle(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-copy">
          <div className="sidebar-header-text">
            <h2 className="sidebar-title">{sidebarTitle}</h2>
          </div>
          <p className="sidebar-description">{searchText ? `${filteredSessions.length}/${sessions.length}` : sessions.length}</p>
        </div>
        <button type="button" className="new-chat-btn" onClick={handleCreateSession} title={`${t('sidebar.newChat')} · ${shortcutModifierLabel}+N`}>
          <IconPlus size={16} /> {t('sidebar.newChat')}
        </button>
      </div>
      <div className="sidebar-tools">
        <div className="sidebar-search">
          <IconSearch size={14} />
          <input
            ref={searchInputRef}
            type="text"
            className="sidebar-search-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (searchText) {
                  e.preventDefault();
                  setSearchText('');
                  return;
                }

                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            title={`${t('sidebar.searchPlaceholder')} · ${shortcutModifierLabel}+K`}
          />
          {searchText && (
            <button
              type="button"
              className="icon-btn sidebar-search-clear"
              onClick={() => setSearchText('')}
              title={t('common.clear')}
            >
              <IconX size={14} />
            </button>
          )}
        </div>
        <div className="sidebar-toolbar">
          <div className="sidebar-toolbar-hint">{t('sidebar.shortcutSearch', { shortcut: `${shortcutModifierLabel}+K` })}</div>
        </div>
      </div>
      <div className="session-list">
        {sessions.length === 0 && (
          <div className="sidebar-empty-state">
            <div className="sidebar-empty-title">{t('chat.welcome')}</div>
            <div className="sidebar-empty-description">{t('chat.welcomeDesc')}</div>
          </div>
        )}
        {sessions.length > 0 && filteredSessions.length === 0 && (
          <div className="sidebar-empty-state sidebar-empty-state-search">
            <div className="sidebar-empty-title">{t('sidebar.noResultsTitle')}</div>
            <div className="sidebar-empty-description">{t('sidebar.noResultsDescription')}</div>
          </div>
        )}
        {filteredSessions.map(session => (
          <div 
            key={session.id} 
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => handleSelectSession(session.id)}
          >
            {editingId === session.id ? (
              <input
                type="text"
                className="session-title-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => saveTitle(session.id)}
                onKeyDown={(e) => handleKeyDown(e, session.id)}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <div className="session-main">
                  <span className="session-title" title={session.title}>{session.title || t('sidebar.newChat')}</span>
                  <span className="session-meta">{formatSessionMeta(session.updatedAt)}</span>
                </div>
                <div className="session-actions">
                  <button 
                    className="icon-btn"
                    onClick={(e) => startEditing(e, session)}
                    title={t('sidebar.rename')}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button 
                    className="icon-btn"
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    title={t('sidebar.delete')}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
