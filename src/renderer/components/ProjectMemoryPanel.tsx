import {Select} from './Select';
import {useEffect,useState} from 'react';
import type {ProjectMemoryEntry,ProjectMemoryState,ProjectSummary} from '../../shared/contracts';
import {KAIRO_INVOKE as C} from '../../shared/ipc';
import {useTranslation} from '../hooks/useTranslation';
import {useAdaptiveResource} from '../hooks/useAdaptiveResource';
export function ProjectMemoryPanel({projectId}:{projectId:string}) {
  const {t}=useTranslation();
  const resource=useAdaptiveResource<ProjectMemoryState>(projectId,()=>window.kairo.invoke(C.projectMemoryGet,projectId),value=>value.jobs.some(job=>['queued','running'].includes(job.status)));
  const state=resource.data;const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [edit,setEdit]=useState<{item:ProjectMemoryEntry;content:string}|null>(null);const [undo,setUndo]=useState<ProjectMemoryEntry|null>(null);
  const perform=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();resource.refresh();}catch(reason){setError(String(reason));}finally{setBusy(false);}};
  const jobRow=(job:ProjectMemoryState['jobs'][number])=><div className="memory-job" key={job.runId} data-memory-job={job.runId}><p className="config-subtitle">{t('intelligence.extraction')} · {t(`intelligence.status.${job.status}`)} · {t('intelligence.attempt')} {job.attempt}{job.reason==='capacity'&&` · ${t('intelligence.capacityReached')}`}{job.reason==='budget'&&` · ${t('intelligence.budgetReached')}`}{job.error&&` · ${job.error}`}</p>{['failed','cancelled','skipped'].includes(job.status)&&<button className="btn btn-secondary" data-memory-retry disabled={busy} onClick={()=>void perform(()=>window.kairo.invoke(C.projectMemoryRetry,{projectId,runId:job.runId,revision:job.revision}))}>{t('intelligence.retryExtraction')}</button>}</div>;
  return <section className="project-memory-panel" data-project-memory={projectId}>
    <p className="config-subtitle">{t('intelligence.memoryHelp')}</p>
    <label className="workbench-checkbox"><input data-memory-enabled type="checkbox" checked={state?.enabled || false} disabled={!state||busy} onChange={event=>void perform(()=>window.kairo.invoke(C.projectMemoryConfigure,{projectId,enabled:event.target.checked}))}/>{t('intelligence.autoMemory')}</label>
    {state?.entries.length===0&&<p>{t('intelligence.noMemories')}</p>}
    {state?.entries.map(item=><article className="memory-entry" data-memory-id={item.id} key={item.id}>
      <strong>{item.key}{item.status==='conflict'?` · ${t('intelligence.conflict')}`:''}</strong>
      {edit?.item.id===item.id?<textarea className="form-control" value={edit.content} maxLength={800} onChange={event=>setEdit({...edit,content:event.target.value})}/>:<p>{item.content}</p>}
      <details><summary>{t('intelligence.source')} · {new Date(item.updatedAt).toLocaleString()}</summary><blockquote>{item.quote}</blockquote><small>{item.sourceSessionId} / {item.sourceRunId}</small></details>
      <div className="memory-entry-actions">
        {edit?.item.id===item.id?<><button className="btn btn-secondary" disabled={busy||!edit.content.trim()||edit.item.revision!==item.revision} onClick={()=>void perform(async()=>{await window.kairo.invoke(C.projectMemoryEdit,{projectId,id:item.id,revision:edit.item.revision,action:'edit',content:edit.content});setEdit(null);})}>{t('common.save')}</button><button className="btn btn-secondary" onClick={()=>setEdit(null)}>{t('common.cancel')}</button></>:<button className="btn btn-secondary" disabled={busy} onClick={()=>setEdit({item,content:item.content})}>{t('intelligence.edit')}</button>}
        {item.status==='conflict'&&<button className="btn btn-secondary" disabled={busy} onClick={()=>void perform(()=>window.kairo.invoke(C.projectMemoryEdit,{projectId,id:item.id,revision:item.revision,action:'accept'}))}>{t('intelligence.acceptMemory')}</button>}
        <button className="btn btn-secondary" data-memory-forget disabled={busy} onClick={()=>void perform(async()=>{const next=await window.kairo.invoke(C.projectMemoryEdit,{projectId,id:item.id,revision:item.revision,action:'forget'});setUndo(next);setEdit(null);})}>{t('intelligence.forget')}</button>
      </div>
    </article>)}
    {undo&&<p role="status">{t('intelligence.forgotten')} <button className="btn btn-secondary" data-memory-undo disabled={busy} onClick={()=>void perform(async()=>{await window.kairo.invoke(C.projectMemoryEdit,{projectId,id:undo.id,revision:undo.revision,action:'edit',content:undo.content});setUndo(null);})}>{t('intelligence.undo')}</button></p>}
    {state?.jobs.slice(0,1).map(jobRow)}
    {state&&state.jobs.length>1&&<details><summary>{t('intelligence.extractionHistory')}</summary>{state.jobs.slice(1,10).map(jobRow)}</details>}
    {(error||resource.error)&&<p role="alert" className="workbench-error">{error||resource.error}</p>}
  </section>;
}
export function ProjectMemorySettings(){
  const {t}=useTranslation();const [projects,setProjects]=useState<ProjectSummary[]>([]);const [selected,setSelected]=useState('');const [error,setError]=useState('');
  useEffect(()=>{let alive=true;void window.kairo.invoke(C.projectList).then(items=>{if(alive){const active=items.filter(item=>item.authorized);setProjects(active);setSelected(active[0]?.id || '');}}).catch(reason=>{if(alive)setError(String(reason));});return()=>{alive=false;};},[]);
  return <section className="config-card"><h3>{t('intelligence.projectMemory')}</h3><label className="form-group">{t('workbench.project')}<Select aria-label={t('workbench.project')} data-memory-project value={selected} onChange={setSelected} options={projects.map(project=>({value:project.id,label:project.name}))}/></label>{selected?<ProjectMemoryPanel key={selected} projectId={selected}/>:<p>{t('workbench.noProjects')}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
