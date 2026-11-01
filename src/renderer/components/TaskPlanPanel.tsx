import {useCallback,useEffect,useRef,useState} from 'react';
import type {TaskPlan} from '../../shared/contracts';
import {KAIRO_INVOKE as C} from '../../shared/ipc';
import {WorkbenchDialog} from './WorkbenchDialog';
import {useTranslation} from '../hooks/useTranslation';
export function TaskPlanPanel({sessionId,onChanged}:{sessionId:string;onChanged:()=>Promise<void>}){
 const {t}=useTranslation();
 const [plan,setPlan]=useState<TaskPlan|null>(null);const [open,setOpen]=useState(false);
 const [body,setBody]=useState('');const [revision,setRevision]=useState(0);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const alive=useRef(true);
 const refresh=useCallback(async()=>{try{const value=await window.kairo.invoke(C.taskPlanGet,sessionId);if(alive.current)setPlan(value);}catch(reason){if(alive.current)setError(String(reason));}},[sessionId]);
 useEffect(()=>{alive.current=true;void refresh();const timer=window.setInterval(()=>void refresh(),1500);return()=>{alive.current=false;window.clearInterval(timer);};},[refresh]);
 const review=()=>{if(!plan)return;setBody(plan.body);setRevision(plan.revision);setError('');setOpen(true);};
 const handleReject=async()=>{if(!plan)return;setBusy(true);setError('');try{const next=await window.kairo.invoke(C.taskPlanReject,{sessionId,planId:plan.id,revision});setPlan(next);setOpen(false);}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 const approve=async()=>{
  if(!plan)return;setBusy(true);setError('');
  try{
   let current=plan;
   if(body!==plan.body)current=await window.kairo.invoke(C.taskPlanEdit,{sessionId,planId:plan.id,revision,body});
   setOpen(false);
   const result=await window.kairo.invoke(C.taskPlanApprove,{sessionId,planId:current.id,revision:current.revision});
   if(!result.success)throw new Error(result.error || 'Unable to execute this plan.');
   await onChanged();await refresh();
  }catch(reason){if(alive.current)setError(String(reason));}finally{if(alive.current)setBusy(false);}
 };
 if(!plan)return error?<p role="alert" className="workbench-error">{error}</p>:null;
 const pending=plan.status==='pending';
 return <><section className={`task-plan-card is-${plan.status}`} data-task-plan-state={plan.status} aria-label={t('w4.taskPlan')}>
  <div><strong>{t(`w4.planStatus.${plan.status}`)}</strong><span title={plan.goal}>{plan.goal}</span></div>
  {pending&&<button type="button" className="btn btn-secondary" data-task-action="review-plan" disabled={busy} onClick={review}>{t('w4.reviewPlan')}</button>}
  {!pending&&plan.body&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={review}>{t('w4.viewPlan')}</button>}
 </section>{(error||plan.error)&&<p className="workbench-error" role="alert">{error || plan.error}</p>}
 {open&&<WorkbenchDialog kind="task-plan" className="task-plan-dialog" title={t('w4.taskPlan')} busy={busy} onClose={()=>setOpen(false)} actions={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setOpen(false)}>{t('common.close')}</button>{pending&&<><button type="button" className="btn btn-secondary" data-task-action="reject-plan" disabled={busy||plan.revision!==revision} onClick={()=>void handleReject()}>{t('w4.rejectPlan')}</button><button type="button" className="btn btn-primary" data-task-action="approve-plan" disabled={busy||plan.revision!==revision||!body.trim()} onClick={()=>void approve()}>{t('w4.approvePlan')}</button></>}</>}>
  <p>{plan.goal}</p><p className="config-subtitle">{plan.model} · {t('w4.planReviewHelp')}</p>
  {plan.scope&&<p className="task-plan-scope"><strong>{t('workbench.runDirectory')}</strong> <code>{plan.scope.directory}</code><br/>{t(`config.executionProfile.${plan.scope.profile}`)}</p>}
  {Boolean(plan.investigations?.length)&&<details data-plan-investigations><summary>{t('batch1.investigation')} · {plan.investigations!.length}</summary><ul>{plan.investigations!.map((entry,index)=><li key={index}><code>{entry.tool} · {String(entry.args.path||'')}</code></li>)}</ul></details>}
  <textarea className="form-control task-plan-body" aria-label={t('w4.planBody')} value={body} maxLength={30000} readOnly={!pending} disabled={busy} onChange={event=>setBody(event.target.value)}/>
  {pending&&plan.revision!==revision&&<p role="alert">{t('w4.planChanged')}</p>}{error&&<p className="workbench-error" role="alert">{error}</p>}
 </WorkbenchDialog>}
 </>;
}
