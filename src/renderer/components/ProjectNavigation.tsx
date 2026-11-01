import {ProjectMemoryPanel} from './ProjectMemoryPanel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Folder, FolderOpen, FolderPlus, MessageSquarePlus, MoreHorizontal, Plus } from 'lucide-react';
import { KAIRO_INVOKE } from '../../shared/ipc';
import type { ProjectSummary } from '../../shared/contracts';
import { useTranslation } from '../hooks/useTranslation';
import { useWorkbenchPreference } from '../hooks/useWorkbenchViewState';
import { WorkbenchDialog } from './WorkbenchDialog';

type Mode = 'create' | 'rename' | 'continue' | 'detach' | 'rules';
export interface ProjectNavigationProps {
  agentId: string | null; projectId?: string; disabled: boolean;
  onSelect: (id?: string) => Promise<void>; onCreateSession: (id?: string) => Promise<void>;
  onError: (message: string) => void; onBusyChange: (value: boolean) => void;
}
export function ProjectNavigation({ agentId, projectId, disabled, onSelect, onCreateSession, onError, onBusyChange, renderSessions }: ProjectNavigationProps & { renderSessions: (id: string | null) => ReactNode }) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [expanded, setExpanded] = useWorkbenchPreference<Record<string, boolean>>(`kairo.workbench.projects.${agentId}`, {}, (value): value is Record<string, boolean> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'boolean')));
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const [dialog, setDialog] = useState<{ mode: Mode; project?: ProjectSummary } | null>(null);
  const [menu, setMenu] = useState<{ project: ProjectSummary; anchor: HTMLElement; x: number; y: number } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pending = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const owner = useRef(agentId); owner.current = agentId;
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [rules, setRules] = useState('');
  const [memoryProject,setMemoryProject]=useState<string|null>(null);
  const [memory, setMemory] = useState('');
  const [error, setError] = useState('');
  const root = document.querySelector('.workbench-app');
  useEffect(() => {
    let current = true;
    if (agentId) void window.kairo.invoke(KAIRO_INVOKE.projectList).then(items => { if (current) setProjects(items); }).catch(reason => { if (current) onError(String(reason)); });
    return () => { current = false; };
  }, [agentId, onError]);
  useEffect(() => { if (projectId) setExpanded(current => ({ ...current, [projectId]: true })); setIsSectionOpen(true); }, [projectId, setExpanded]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(null); menu.anchor.focus({ preventScroll: true }); } };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', onKey);
    document.addEventListener('wheel', close, { capture: true, passive: true }); window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKey); document.removeEventListener('wheel', close, true); window.removeEventListener('resize', close); };
  }, [menu]);
  const openDialog = (mode: Mode, project?: ProjectSummary) => { dialogTrigger.current = menu?.anchor || document.activeElement as HTMLElement; setMenu(null); setDialog({ mode, project }); setName(project?.name || ''); setRules(project?.rules || ''); setMemory(project?.memory || ''); setRootPath(''); setError(''); };
  const perform = async (operation: () => Promise<void>) => {
    if (pending.current || disabled || !agentId) return;
    const operationOwner = agentId;
    pending.current = true; setIsPending(true); onBusyChange(true); setError('');
    try {
      await operation();
      const items = await window.kairo.invoke(KAIRO_INVOKE.projectList);
      if (owner.current === operationOwner) setProjects(items);
    } catch (reason) {
      if (owner.current === operationOwner) { if (dialog) setError(String(reason)); else onError(String(reason)); }
    } finally { pending.current = false; setIsPending(false); onBusyChange(false); }
  };
  const toggle = (id: string) => setExpanded(current => ({ ...current, [id]: !(current[id] ?? (id === 'unassigned' && !projectId)) }));
  const submit = () => void perform(async () => {
    if (!dialog) return;
    const { mode, project } = dialog;
    if (mode === 'rules' && project) await window.kairo.invoke(KAIRO_INVOKE.projectUpdateRules,{projectId:project.id,rules,memory});
    else if (mode === 'rename' && project) await window.kairo.invoke(KAIRO_INVOKE.projectRename, { projectId: project.id, name });
    else if (mode === 'detach' && project) { await window.kairo.invoke(KAIRO_INVOKE.projectDetach, project.id); if (projectId === project.id) await onSelect(undefined); }
    else {
      const created = mode === 'continue' && project
        ? await window.kairo.invoke(KAIRO_INVOKE.projectContinue, { projectId: project.id, name, rootPath })
        : await window.kairo.invoke(KAIRO_INVOKE.projectCreate, { name, rootPath });
      await onSelect(created.id);
    }
    setDialog(null);
  });
  const actionLabel = dialog ? t(dialog.mode === 'rules' ? 'workbench.projectRules' : dialog.mode === 'rename' ? 'workbench.renameProject' : dialog.mode === 'continue' ? 'workbench.continueProject' : dialog.mode === 'detach' ? 'workbench.detachProject' : 'workbench.addProject') : '';
  const canSubmit = dialog?.mode === 'rules' || dialog?.mode === 'detach' || Boolean(name.trim() && (dialog?.mode === 'rename' || rootPath));
  return <>
    <section className="workbench-project-tree" aria-label={t('workbench.project')}>
      <div className="project-section-heading"><button type="button" aria-expanded={isSectionOpen} onClick={() => setIsSectionOpen(value => !value)}><span>{t('workbench.project')}</span><ChevronDown size={14}/></button><button type="button" className="workbench-icon-button" data-project-action="add" aria-label={t('workbench.addProject')} disabled={disabled || !agentId} onClick={() => openDialog('create')}><Plus size={17}/></button></div>
      {isSectionOpen && projects.map(project => <div className={`project-node ${project.id === projectId ? 'is-active' : ''}`} key={project.id} data-project-id={project.id} data-bound={Boolean(project.authorized)}>
        <div className="project-node-row">
          <button type="button" className="project-node-toggle" title={project.rootPath} aria-expanded={Boolean(expanded[project.id])} onClick={() => toggle(project.id)}>{expanded[project.id] ? <FolderOpen size={17}/> : <Folder size={17}/>}<span>{project.name}</span></button>
          <div className="project-node-actions"><button type="button" className="workbench-icon-button" data-project-action="manage" aria-label={`${t('workbench.manageProject')} · ${project.name}`} disabled={disabled} aria-haspopup="menu" onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setMenu({ project, anchor: event.currentTarget, x: Math.max(8, Math.min(bounds.left, window.innerWidth - 208)), y: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 176)) }); }}><MoreHorizontal size={16}/></button>
          {project.authorized && <button type="button" className="workbench-icon-button" data-project-action="new-task" aria-label={`${t('sidebar.newChat')} · ${project.name}`} disabled={disabled} onClick={() => void onCreateSession(project.id)}><MessageSquarePlus size={16}/></button>}</div>
        </div>
        {expanded[project.id] && (project.authorized ? renderSessions(project.id) : <button type="button" className="project-bind-action" data-project-action="rebind" disabled={disabled} onClick={() => void perform(async () => { await window.kairo.invoke(KAIRO_INVOKE.projectBind, project.id); await onSelect(project.id); })}>{t('workbench.bindProject')}</button>)}
      </div>)}
      {isSectionOpen && projects.length === 0 && <p className="project-list-notice">{t('workbench.noProjects')}</p>}
    </section>
    <section className={`project-node standalone-sessions ${!projectId ? 'is-active' : ''}`} data-project-id="unassigned">
      <div className="project-node-row"><button type="button" className="project-node-toggle" aria-expanded={Boolean(expanded.unassigned ?? !projectId)} onClick={() => toggle('unassigned')}><span>{t('workbench.independentSessions')}</span><ChevronDown size={14} className={(expanded.unassigned ?? !projectId) ? '' : 'is-closed'}/></button><button type="button" className="workbench-icon-button" data-project-action="new-task" aria-label={`${t('sidebar.newChat')} · ${t('workbench.independentSessions')}`} disabled={disabled || !agentId} onClick={() => void onCreateSession(undefined)}><MessageSquarePlus size={16}/></button></div>
      {(expanded.unassigned ?? !projectId) && renderSessions(null)}
    </section>
    {menu && root && createPortal(<div ref={menuRef} className="session-context-menu project-context-menu" role="menu" aria-label={t('workbench.manageProject')} style={{ left: menu.x, top: menu.y }} onKeyDown={event => { const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = items.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } if (event.key === 'Tab') setMenu(null); }}>
      <button type="button" role="menuitem" data-project-action="memory" disabled={!menu.project.authorized} onClick={()=>{setMemoryProject(menu.project.id);setMenu(null);}}>{t('intelligence.projectMemory')}</button>
      <button type="button" role="menuitem" data-project-action="rules" disabled={!menu.project.authorized || disabled} onClick={() => openDialog('rules',menu.project)}>{t('workbench.projectRules')}</button>
      <button type="button" role="menuitem" data-project-action="rename" disabled={!menu.project.authorized || disabled} onClick={() => openDialog('rename', menu.project)}>{t('workbench.renameProject')}</button>
      <button type="button" role="menuitem" data-project-action="continue" disabled={!menu.project.authorized || disabled} onClick={() => openDialog('continue', menu.project)}>{t('workbench.continueProject')}</button>
      {menu.project.authorized ? <button type="button" role="menuitem" data-project-action="detach" disabled={disabled} onClick={() => openDialog('detach', menu.project)}>{t('workbench.detachProject')}</button> : <button type="button" role="menuitem" data-project-action="rebind" disabled={disabled} onClick={() => { const id = menu.project.id; setMenu(null); void perform(async () => { await window.kairo.invoke(KAIRO_INVOKE.projectBind, id); await onSelect(id); }); }}>{t('workbench.bindProject')}</button>}
    </div>, root)}
    {memoryProject&&<WorkbenchDialog kind="project-memory" title={`${t('intelligence.projectMemory')} · ${projects.find(item=>item.id===memoryProject)?.name || ''}`} onClose={()=>setMemoryProject(null)}><ProjectMemoryPanel key={memoryProject} projectId={memoryProject}/></WorkbenchDialog>}
    {dialog && <WorkbenchDialog kind={`project-${dialog.mode}`} className="project-dialog" returnFocus={dialogTrigger.current} title={actionLabel} busy={isPending} onClose={() => setDialog(null)} actions={<><button type="button" className="btn btn-secondary" disabled={isPending} onClick={() => setDialog(null)}>{t('common.cancel')}</button><button type="submit" form="workbench-project-form" className="btn btn-primary" disabled={isPending || !canSubmit}>{isPending ? t('common.loading') : actionLabel}</button></>}>
      <form id="workbench-project-form" className="workbench-project-form" data-project-mode={dialog.mode} onSubmit={event => { event.preventDefault(); if (canSubmit) submit(); }}>
        {dialog.mode === 'rules' ? <><label>AGENTS.md <small>{dialog.project?.instructionPath}</small><textarea data-autofocus value={rules} maxLength={100000} onChange={event=>setRules(event.target.value)}/></label><label>{t('workbench.projectMemory')}<textarea value={memory} maxLength={100000} onChange={event=>setMemory(event.target.value)}/></label></> : dialog.mode === 'detach' ? <p>{t('workbench.projectManagementNotice')}</p> : <>
          <label>{t('workbench.projectName')}<input data-autofocus aria-label={t('workbench.projectName')} placeholder={t('workbench.projectName')} value={name} maxLength={100} required disabled={isPending} onChange={event => setName(event.target.value)}/></label>
          {dialog.mode !== 'rename' && <label>{t('workbench.sourceDirectory')}<button type="button" className="project-directory-select" disabled={isPending} title={rootPath} onClick={() => { const selectionOwner = agentId; void window.kairo.invoke(KAIRO_INVOKE.systemSelectDirectory).then(directory => { if (directory && owner.current === selectionOwner) { setRootPath(directory); if (!name) setName(directory.split(/[/\\]/).filter(Boolean).pop() || 'Project'); } }).catch(reason => setError(String(reason))); }}><FolderPlus size={24}/><span>{rootPath || t('workbench.chooseProjectDirectory')}</span><small>{t('workbench.localDevice')}</small></button></label>}
          <p>{t(dialog.mode === 'continue' ? 'workbench.continueProjectNotice' : dialog.mode === 'rename' ? 'workbench.renameProjectNotice' : 'workbench.projectPermissionsNote')}</p>
        </>}
      </form>
      {error && <p className="project-form-error" role="alert">{error}</p>}
    </WorkbenchDialog>}
  </>;
}
