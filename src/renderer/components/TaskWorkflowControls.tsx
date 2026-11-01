import {Select} from './Select';
import {useEffect,useRef,useState} from 'react';
import {Plus} from 'lucide-react';
import {KAIRO_INVOKE as C} from '../../shared/ipc';
import type {TaskExecutionSettings,TaskTemplate} from '../../shared/contracts';
import {WorkbenchDialog} from './WorkbenchDialog';
import {useTranslation} from '../hooks/useTranslation';
import {DEFAULT_INTELLIGENCE_BUDGET} from '../../shared/intelligencePolicy';
interface Props {sessionId:string|null;settings?:TaskExecutionSettings;disabled:boolean;canAttach?:boolean;onAttach:()=>void;onChanged:()=>Promise<void>}
const empty={name:'',instructions:'',output:'',acceptance:''};
export function TaskWorkflowControls({sessionId,settings,disabled,canAttach=false,onAttach,onChanged}:Props){
 const {t}=useTranslation();
 const [menu,setMenu]=useState(false);const [open,setOpen]=useState(false);
 const [templates,setTemplates]=useState<TaskTemplate[]>([]);const [selected,setSelected]=useState('');
 const [workflow,setWorkflow]=useState<'direct'|'plan'>('direct');const [draft,setDraft]=useState(empty);
 const [delegation,setDelegation]=useState<'off'|'auto'|'manual'>('manual');
 const [budget,setBudget]=useState(DEFAULT_INTELLIGENCE_BUDGET);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const anchor=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!menu)return;const close=(event:PointerEvent)=>{if(!anchor.current?.contains(event.target as Node))setMenu(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[menu]);
 const show=async()=>{setMenu(false);setError('');setOpen(true);setBusy(true);try{const items=await window.kairo.invoke(C.taskTemplatesList);setTemplates(items);setSelected(settings?.template?.id || '');setWorkflow(settings?.workflow || 'direct');setDelegation(settings?.delegation || 'manual');setBudget(settings?.intelligenceBudget||DEFAULT_INTELLIGENCE_BUDGET);setDraft(items.find(item=>item.id===settings?.template?.id) || empty);}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 const saveTemplate=async()=>{setBusy(true);setError('');try{const item=await window.kairo.invoke(C.taskTemplatesSave,{name:draft.name,instructions:draft.instructions,output:draft.output,acceptance:draft.acceptance});setTemplates(current=>[...current,item]);setSelected(item.id);setDraft(item);}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 const apply=async()=>{if(!sessionId)return;setBusy(true);setError('');try{await window.kairo.invoke(C.chatUpdateTaskSettings,{sessionId,workflow,delegation,intelligenceBudget:budget,templateId:selected || null});await onChanged();setOpen(false);}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 return <><div className="task-workflow-control" ref={anchor} onKeyDown={event=>{if(event.key==='Escape'){setMenu(false);event.stopPropagation();}}}>
  <button type="button" className="attach-btn" data-task-action="options" aria-label={t('w4.taskOptions')} title={t('w4.taskOptions')} disabled={disabled&&!canAttach} aria-expanded={menu} aria-haspopup="menu" onClick={()=>setMenu(value=>!value)}><Plus size={16}/></button>
  {menu&&<div className="task-workflow-menu" role="menu"><button type="button" role="menuitem" onClick={()=>{setMenu(false);onAttach();}}>{t('chat.attachFiles')}</button><button type="button" role="menuitem" data-task-action="workflow" disabled={disabled} onClick={()=>void show()}>{t('w4.templatesAndWorkflow')}</button></div>}
 </div>
 {(settings?.template||settings?.workflow==='plan')&&<button type="button" className="task-workflow-chip" data-task-action="workflow-chip" disabled={disabled} onClick={()=>void show()} title={t('w4.templatesAndWorkflow')}>{settings?.template?.name || t('w4.noTemplate')}{settings?.workflow==='plan'?` · ${t('w4.planFirst')}`:''}</button>}
 {open&&<WorkbenchDialog kind="task-workflow" className="task-workflow-dialog" title={t('w4.templatesAndWorkflow')} busy={busy} onClose={()=>setOpen(false)} actions={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setOpen(false)}>{t('common.cancel')}</button><button type="button" className="btn btn-primary" data-task-action="apply-workflow" disabled={busy} onClick={()=>void apply()}>{t('w4.applyToTask')}</button></>}>
  <div className="task-workflow-form">
   <label>{t('w4.workflow')}<Select aria-label={t('w4.workflow')} data-task-workflow value={workflow} disabled={busy} onChange={value=>setWorkflow(value as 'direct'|'plan')} options={[{value:'direct',label:t('w4.direct')},{value:'plan',label:t('w4.planFirst')}]}/></label>
   <p className="config-subtitle">{t('w4.planningHelp')}</p>
   <label>{t('intelligence.delegation')}<Select aria-label={t('intelligence.delegation')} data-task-delegation value={delegation} disabled={busy} onChange={value=>setDelegation(value as 'off'|'auto'|'manual')} options={(['manual','auto','off'] as const).map(mode=>({value:mode,label:t(`intelligence.mode.${mode}`)}))}/></label>
   <p className="config-subtitle">{t('intelligence.readonlyHelp')}</p>
   <details><summary>{t('intelligence.budgetSettings')}</summary><label>{t('intelligence.tokenLimit')}<input className="form-control" data-intelligence-token-limit type="number" min={1000} max={1000000} step={1000} value={budget.maxTokens} onChange={event=>setBudget({...budget,maxTokens:Number(event.target.value)})}/></label><label>{t('intelligence.retryLimit')}<input className="form-control" type="number" min={0} max={5} step={1} value={budget.maxRetries} onChange={event=>setBudget({...budget,maxRetries:Number(event.target.value)})}/></label><p className="config-subtitle">{t('intelligence.budgetHelp')}</p></details>
   <label>{t('w4.template')}<Select aria-label={t('w4.template')} data-task-template value={selected} disabled={busy} onChange={value=>{setSelected(value);setDraft(templates.find(item=>item.id===value)||empty);}} options={[{value:'',label:t('w4.noTemplate')},...templates.map(item=>({value:item.id,label:`${item.name} · v${item.version}`}))]}/></label>
   <p className="config-subtitle">{t('w4.templateHelp')}</p>
   <details><summary>{t('w4.customTemplate')}</summary><label>{t('w4.templateName')}<input className="form-control" value={draft.name} maxLength={80} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>{(['instructions','output','acceptance'] as const).map(key=><label key={key}>{t(`w4.${key}`)}<textarea className="form-control" value={draft[key]} maxLength={key==='instructions'?10000:5000} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></label>)}<button type="button" className="btn btn-secondary" data-task-action="save-template" disabled={busy||Object.values(draft).some(value=>typeof value==='string'&&!value.trim())} onClick={()=>void saveTemplate()}>{t('w4.saveTemplateCopy')}</button></details>
   {selected&&<p className="task-template-preview">{templates.find(item=>item.id===selected)?.instructions}</p>}
   {error&&<p className="workbench-error" role="alert">{error}</p>}
  </div>
 </WorkbenchDialog>}
 </>;
}
