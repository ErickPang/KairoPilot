import {Select} from './Select';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ListFilter } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectNavigation, type ProjectNavigationProps } from './ProjectNavigation';
import { ProjectSessionList } from './ProjectSessionList';
import type { SessionSummary } from '../types';
import { IconPlus, IconEdit, IconTrash, IconSearch, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

export type TaskFilter = 'open' | 'archived' | 'unread' | 'all';

interface SidebarProps {
  projectNavigation: ProjectNavigationProps;
  refresh: unknown;
  filter: TaskFilter;
  setFilter: (value: TaskFilter) => void;
  searchText: string;
  setSearchText: (value: string) => void;
  handleArchiveTask: (id: string, archived: boolean) => void;
  disabled: boolean;
  activeSessionId: string | null;
  handleCreateSession: () => void;
  handleSelectSession: (id: string) => void;
  handleDeleteSession: (e: React.MouseEvent, id: string) => void;
  handleUpdateSessionTitle: (id: string, title: string) => void;
  focusSearchToken: number;
  shortcutModifierLabel: string;
}

type SessionMenu = { session: SessionSummary; anchor: HTMLElement; x: number; y: number };

export const Sidebar = React.memo(function Sidebar(props: SidebarProps) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [menu, setMenu] = useState<SessionMenu | null>(null);
  const currentMenuRef = useRef(menu);
  currentMenuRef.current = menu;
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRoot = document.querySelector('.workbench-app');
  const closeMenu = useCallback((restoreFocus = false) => {
    restoreFocusRef.current = restoreFocus ? currentMenuRef.current?.anchor || null : null;
    setMenu(null);
  }, []);

  useEffect(() => {
    if (!props.focusSearchToken) return;
    searchInputRef.current?.focus(); searchInputRef.current?.select();
  }, [props.focusSearchToken]);
  useEffect(() => { closeMenu(); editingRef.current = null; setEditingId(null); }, [props.projectNavigation.agentId, props.filter, props.searchText, props.disabled, closeMenu]);
  useEffect(() => {
    if (!menu) {
      if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus({ preventScroll: true });
      restoreFocusRef.current = null;
      return;
    }
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    };
    const dismiss = () => closeMenu();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('wheel', dismiss, { capture: true, passive: true });
    document.addEventListener('touchmove', dismiss, { capture: true, passive: true });
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('wheel', dismiss, true);
      document.removeEventListener('touchmove', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu, closeMenu]);

  const openMenu = (session: SessionSummary, anchor: HTMLElement, x: number, y: number) => {
    if (props.disabled || editingId) return;
    setMenu({ session, anchor, x: Math.max(8, Math.min(x, window.innerWidth - 184)), y: Math.max(8, Math.min(y, window.innerHeight - 96)) });
  };
  const saveTitle = (id: string) => {
    if (editingRef.current !== id) return;
    editingRef.current = null;
    if (editTitle.trim()) props.handleUpdateSessionTitle(id, editTitle.trim());
    setEditingId(null);
  };
  const renderSession = (session: SessionSummary) => <div
    key={session.id} data-session-id={session.id} data-archived={Boolean(session.archivedAt)}
    className={`session-item ${session.id === props.activeSessionId ? 'active' : ''}`}
    role="button" tabIndex={props.disabled ? -1 : 0} aria-disabled={props.disabled}
    aria-current={session.id === props.activeSessionId ? 'page' : undefined} aria-haspopup="menu"
    onContextMenu={(event) => { event.preventDefault(); openMenu(session, event.currentTarget, event.clientX, event.clientY); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect();
        openMenu(session, event.currentTarget, bounds.left + 16, bounds.bottom); return;
      }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!props.disabled) props.handleSelectSession(session.id); }
    }}
    onClick={() => { if (!props.disabled && !editingId) props.handleSelectSession(session.id); }}>
    {editingId === session.id ? <input type="text" className="session-title-input" value={editTitle}
      aria-label={t('sidebar.rename')} autoFocus onChange={(event) => setEditTitle(event.target.value)}
      onBlur={() => saveTitle(session.id)} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); saveTitle(session.id); }
        if (event.key === 'Escape') { event.preventDefault(); editingRef.current = null; setEditingId(null); }
      }}/>
      : <><div className="session-main"><span className={`session-title ${(session.activityVersion || 0) > (session.readVersion || 0) ? 'is-unread' : ''}`} title={session.title}>{session.title || t('sidebar.newChat')}</span></div>
        <div className="session-actions"><button type="button" className="icon-btn" disabled={props.disabled}
          aria-label={t('sidebar.delete')} title={t('sidebar.delete')}
          onClick={(event) => { event.stopPropagation(); props.handleDeleteSession(event, session.id); }}><IconTrash size={14}/></button></div></>}
  </div>;
  return <div className="sidebar sidebar-shell">
    <div className="sidebar-header"><button type="button" disabled={props.disabled} className="new-chat-btn" onClick={props.handleCreateSession} title={`${t('sidebar.newChat')} · ${props.shortcutModifierLabel}+N`}><IconPlus size={16}/><span>{t('sidebar.newChat')}</span><kbd>{props.shortcutModifierLabel}N</kbd></button></div>
    <div className="sidebar-tools"><div className="sidebar-search"><IconSearch size={14}/><input ref={searchInputRef} type="text" className="sidebar-search-input"
      disabled={props.disabled} value={props.searchText} onChange={(event) => props.setSearchText(event.target.value)} placeholder={t('sidebar.searchPlaceholder')}
      title={`${t('sidebar.searchPlaceholder')} · ${props.shortcutModifierLabel}+K`} onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (props.searchText) { event.preventDefault(); props.setSearchText(''); } else event.currentTarget.blur();
      }}/>{props.searchText && <button type="button" className="icon-btn sidebar-search-clear" onClick={() => props.setSearchText('')} title={t('common.clear')}><IconX size={14}/></button>}</div>
      <label className="sidebar-filter-control" title={`${t('workbench.taskFilter')} · ${t(`workbench.filter.${props.filter}`)}`}>
        <ListFilter size={16} aria-hidden="true"/>
        <Select className="task-filter" size="sm" variant="inline" aria-label={t('workbench.taskFilter')} value={props.filter} disabled={props.disabled} onChange={value=>props.setFilter(value as TaskFilter)} options={(['open','unread','archived','all'] as const).map(value=>({value,label:t(`workbench.filter.${value}`)}))}/>
      </label>
    </div>

    <div className="session-list">
      {props.searchText ? <ProjectSessionList agentId={props.projectNavigation.agentId} filter={props.filter} search={props.searchText} refresh={props.refresh} renderSession={renderSession}/>
        : <ProjectNavigation {...props.projectNavigation} renderSessions={projectId => <ProjectSessionList key={projectId || 'unassigned'} agentId={props.projectNavigation.agentId} projectId={projectId} filter={props.filter} refresh={props.refresh} renderSession={renderSession}/>}/>}
    </div>
    {menu && menuRoot && createPortal(<div ref={menuRef} className="session-context-menu" role="menu" aria-label={menu.session.title || t('sidebar.newChat')} style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
      if (event.key === 'Tab') closeMenu();
    }}>
      <button type="button" role="menuitem" data-session-action="rename" onClick={() => { editingRef.current = menu.session.id; setEditingId(menu.session.id); setEditTitle(menu.session.title); closeMenu(); }}><IconEdit size={15}/>{t('sidebar.rename')}</button>
      <button type="button" role="menuitem" data-session-action="archive" onClick={() => { props.handleArchiveTask(menu.session.id, !menu.session.archivedAt); closeMenu(); }}>{menu.session.archivedAt ? <ArchiveRestore size={15}/> : <Archive size={15}/>} {t(menu.session.archivedAt ? 'workbench.restoreTask' : 'workbench.archiveTask')}</button>
    </div>, menuRoot)}
  </div>;
});
