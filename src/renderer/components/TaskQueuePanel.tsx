import {useState} from 'react';
import type {QueuedTaskMessage} from '../../shared/contracts';
import {useTranslation} from '../hooks/useTranslation';
import {WorkbenchDialog} from './WorkbenchDialog';
import {KAIRO_INVOKE as C} from '../../shared/ipc';
export function TaskQueuePanel({sessionId,items,onChanged,contextLabel}:{sessionId:string;items:QueuedTaskMessage[];onChanged:()=>void;contextLabel:string}){
 const {t}=useTranslation();const [editing,setEditing]=useState<QueuedTaskMessage|null>(null);const [content,setContent]=useState('');const [continuing,setContinuing]=useState<QueuedTaskMessage|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const change=async(item:QueuedTaskMessage,action:'edit'|'remove'|'up'|'down'|'continue')=>{
  setBusy(true);setError('');try{await window.kairo.invoke(C.taskQueueChange,{sessionId,id:item.id,revision:item.revision,action,content:action==='edit'?content:undefined});setEditing(null);setContinuing(null);onChanged();}catch(reason){setError(String(reason));onChanged();}finally{setBusy(false);}
 };
 if(!items.length)return null;
 return <section className="task-queue" data-task-queue aria-label={t('batch1.queue')}>
  <details open><summary>{t('batch1.queue')} · {items.length}</summary><p className="config-subtitle">{t('batch1.queueHelp')}</p>
  {items.map((item,index)=><div className="task-queue-item" data-queue-id={item.id} data-queue-state={item.status} key={item.id}>
   <div><span className="task-queue-content" title={item.data.input}>{item.data.input||t('batch1.contextMessage')}</span><small>{t(`batch1.queue.${item.status}`)} · {item.data.referenceIds.length+item.data.attachmentIds.length} {t('batch1.contextItems')}</small>{item.error&&<p role="status" className="config-subtitle">{item.error}</p>}</div>
   {item.status!=='dispatching'&&<div className="task-queue-actions"><button disabled={busy||index===0} aria-label={t('batch1.moveUp')} onClick={()=>void change(item,'up')}>↑</button><button disabled={busy||index===items.length-1} aria-label={t('batch1.moveDown')} onClick={()=>void change(item,'down')}>↓</button><button disabled={busy} onClick={()=>{setEditing(item);setContent(item.data.input);}}>{t('common.edit')}</button><button disabled={busy} onClick={()=>void change(item,'remove')}>{t('common.delete')}</button>{(item.status==='blocked'||item.status==='queued')&&<button data-queue-continue disabled={busy} onClick={()=>setContinuing(item)}>{t('batch1.continueQueue')}</button>}</div>}
  </div>)}</details>{error&&<p role="alert" className="workbench-error">{error}</p>}
  {continuing&&<WorkbenchDialog kind="queue-continue" title={t('batch1.continueQueue')} busy={busy} onClose={()=>setContinuing(null)} actions={<><button className="btn btn-secondary" disabled={busy} onClick={()=>setContinuing(null)}>{t('common.cancel')}</button><button className="btn btn-primary" data-confirm-queue disabled={busy} onClick={()=>void change(continuing,'continue')}>{t('batch1.continueQueue')}</button></>}><p>{continuing.data.input}</p><p>{contextLabel}</p><p className="config-subtitle">{t('batch1.queueEditHelp')}</p></WorkbenchDialog>}
  {editing&&<WorkbenchDialog kind="queue-edit" title={t('batch1.editQueued')} busy={busy} onClose={()=>setEditing(null)} actions={<><button className="btn btn-secondary" disabled={busy} onClick={()=>setEditing(null)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={()=>void change(editing,'edit')}>{t('common.save')}</button></>}><textarea className="form-control" rows={5} maxLength={30000} value={content} onChange={event=>setContent(event.target.value)}/><p className="config-subtitle">{t('batch1.queueEditHelp')}</p></WorkbenchDialog>}
 </section>;
}
