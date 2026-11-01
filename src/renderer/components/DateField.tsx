import {useState,useEffect} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {WorkbenchDialog} from './WorkbenchDialog';
import {useTranslation} from '../hooks/useTranslation';
import {localDateValue,isValidDateValue} from './dateValue';
export function DateField({value,onChange,label}:{value:string;onChange:(value:string)=>void;label:string}){
 const {t}=useTranslation();const [text,setText]=useState(value);const [open,setOpen]=useState(false);const [month,setMonth]=useState(()=>new Date());
 useEffect(()=>setText(value),[value]);
 const invalid=Boolean(text&&!isValidDateValue(text));const year=month.getFullYear(),index=month.getMonth();const count=new Date(year,index+1,0).getDate(),offset=(new Date(year,index,1).getDay()+6)%7;
 const commit=(next:string)=>{onChange(next);setText(next);setOpen(false);};
 return <div className="date-field"><div className="date-field-input"><input type="text" inputMode="numeric" className="form-control" aria-label={label} aria-invalid={invalid||undefined} placeholder="YYYY-MM-DD" value={text} maxLength={10} onChange={event=>{const next=event.target.value;setText(next);if(!next||isValidDateValue(next))onChange(next);}}/><button type="button" className="workbench-icon-button" aria-label={`${label} · ${t('ui.calendar')}`} onClick={()=>{setMonth(isValidDateValue(value)?new Date(`${value}T12:00:00`):new Date());setOpen(true);}}><CalendarDays size={16}/></button></div>{invalid&&<small role="alert">{t('ui.invalidDate')}</small>}
  {open&&<WorkbenchDialog kind="calendar" className="calendar-dialog" title={label} onClose={()=>setOpen(false)} actions={<><button className="btn btn-secondary" onClick={()=>commit('')}>{t('dashboard.clearFilters')}</button><button className="btn btn-primary" onClick={()=>commit(localDateValue(new Date()))}>{t('ui.today')}</button></>}>
   <div className="calendar-header"><button aria-label={t('common.previous')} onClick={()=>setMonth(new Date(year,index-1,1))}><ChevronLeft size={17}/></button><strong>{year} / {String(index+1).padStart(2,'0')}</strong><button aria-label={t('common.next')} onClick={()=>setMonth(new Date(year,index+1,1))}><ChevronRight size={17}/></button></div>
   <div className="calendar-weekdays" aria-hidden="true">{Array.from({length:7},(_,i)=><span key={i}>{Intl.DateTimeFormat(undefined,{weekday:'narrow'}).format(new Date(2026,0,5+i))}</span>)}</div>
   <div className="calendar-grid">{Array.from({length:offset},(_,i)=><span key={`pad-${i}`}/>)}{Array.from({length:count},(_,i)=>{const day=localDateValue(new Date(year,index,i+1));return <button key={day} aria-label={day} aria-pressed={day===value} onClick={()=>commit(day)}>{i+1}</button>;})}</div>
  </WorkbenchDialog>}
 </div>;
}
