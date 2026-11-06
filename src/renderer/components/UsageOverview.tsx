import {useEffect,useMemo,useState} from 'react';
import {KAIRO_INVOKE as C} from '../../shared/ipc';
import type {UsageOverview as UsageData} from '../../shared/usageOverview';
import {useTranslation} from '../hooks/useTranslation';
import {Select} from './Select';
import '../styles/usage-overview.css';
export interface UsageDetailSelection {projectId?:string;date?:string;model?:string}
const colors=['#3182e4','#6a9fd7','#39597f','#78b0a4','#8c83b8'];
export function UsageOverview({isActive,projects,onDetails}:{isActive:boolean;projects:Array<{id:string;name:string}>;onDetails:(selection:UsageDetailSelection)=>void}){
 const {t}=useTranslation();const [project,setProject]=useState('');const [data,setData]=useState<UsageData>();const [error,setError]=useState('');const [days,setDays]=useState(7);const [selected,setSelected]=useState<string[]>([]);const [hover,setHover]=useState('');const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!isActive)return;let alive=true;let fetching=false;
  const load=async()=>{if(fetching)return;fetching=true;try{const next=await window.kairo.invoke(C.usageOverview,{projectId:project||undefined});if(alive){setData(next);setError('');}}catch(reason){if(alive)setError(String(reason));}finally{fetching=false;if(alive)setLoading(false);}};
  setData(undefined);setError('');setLoading(true);setSelected([]);setHover('');void load();const timer=setInterval(()=>void load(),20000);return()=>{alive=false;clearInterval(timer);};
 },[isActive,project]);
 const format=(value:number)=>Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value);
 const detail=(date?:string,model?:string)=>onDetails({projectId:project||undefined,date,model});
 const grid=useMemo(()=>{
  if(!data?.daily.length)return [];
  const first=new Date(`${data.startDate}T12:00:00`);const pads=(first.getDay()+6)%7;
  return [...Array.from({length:pads},()=>null),...data.daily];
 },[data]);
 const trend=data?.daily.slice(-days)||[];const models=data?.models||[];const visibleModels=selected.length?models.filter(item=>selected.includes(item.model)):models.slice(0,5);
 const modelTokens=(day:UsageData['daily'][number],model:string)=>Object.prototype.hasOwnProperty.call(day.models,model)?day.models[model]:0;
 const max=Math.max(1,...trend.flatMap(day=>visibleModels.map(model=>modelTokens(day,model.model))));
 const peak=Math.max(1,...(data?.daily.map(day=>day.totalTokens)||[]));
 return <section className="usage-overview" data-usage-overview aria-busy={loading}>
  <header className="usage-page-header"><div><h1>{t('ui.usage')}</h1><span>{t('ui.appUsage')}</span></div><Select className="usage-project" aria-label={t('workbench.project')} value={project} onChange={setProject} options={[{value:'',label:t('workbench.allProjects')},...projects.map(item=>({value:item.id,label:item.name}))]}/></header>
  {error&&<p role="alert" className="workbench-error">{error}</p>}
  {loading&&<div className="usage-loading" role="status">{t('common.loading')}</div>}
  {data&&<>
   <div className="usage-kpis" data-usage-kpis>{[
    [t('ui.totalTokens'),format(data.totals.totalTokens)],
    [t('ui.peakTokens'),format(data.totals.peakDailyTokens)],
    [t('ui.activeDays'),String(data.totals.activeDays)],
    [t('ui.runCount'),String(data.totals.runCount)],
    [t('ui.inputOutput'),`${format(data.totals.promptTokens)} / ${format(data.totals.completionTokens)}`]
   ].map(([label,value])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
   <div className="usage-card"><div className="usage-section-header"><h2>{t('ui.activity')}</h2><small>{t('ui.lastYear')}</small></div>
    <div className="usage-heatmap" data-usage-heatmap style={{gridTemplateColumns:`repeat(${Math.ceil(grid.length/7)||1},minmax(0,1fr))`}}>{grid.map((day,index)=>{
     if(!day)return <span key={`pad-${index}`} className="usage-day is-padding"/>;
     const level=day.totalTokens===0?0:Math.min(4,Math.ceil(day.totalTokens/peak*4));const label=`${day.date} · ${day.totalTokens.toLocaleString()} Tokens`;
     return <button key={day.date} className={`usage-day level-${level}`} aria-label={label} data-usage-day={day.date} onFocus={()=>setHover(label)} onMouseEnter={()=>setHover(label)} onClick={()=>detail(day.date)}/>;
    })}</div>
    <div className="usage-heatmap-months">{grid.flatMap((day,index)=>{if(!day||day.date.slice(-2)!=='01')return [];const date=new Date(`${day.date}T12:00:00`);return <span key={day.date} style={{left:`${Math.floor(index/7)/Math.ceil(grid.length/7)*100}%`}}>{Intl.DateTimeFormat(undefined,{month:'short'}).format(date)}</span>;})}</div>
    <div className="usage-activity-caption"><span aria-live="polite">{hover||`${data.startDate} — ${data.endDate}`}</span><span>{t('ui.less')} <i className="level-0"/><i className="level-1"/><i className="level-2"/><i className="level-3"/><i className="level-4"/> {t('ui.more')}</span></div>
   </div>
   <div className="usage-section-header usage-range"><h2>{t('ui.timeRange')}</h2><div className="usage-segment" role="group" aria-label={t('ui.timeRange')}>{[7,30].map(value=><button key={value} aria-pressed={days===value} onClick={()=>setDays(value)}>{t(value===7?'ui.sevenDays':'ui.thirtyDays')}</button>)}</div></div>
   <div className="usage-card"><h2>{t('ui.dailyTrend')}</h2>
    <div className="usage-model-toggles">{models.map((model,index)=><button key={model.model} aria-pressed={visibleModels.some(item=>item.model===model.model)} onClick={()=>setSelected(current=>{const base=current.length?current:models.slice(0,5).map(item=>item.model);const next=base.includes(model.model)?base.filter(item=>item!==model.model):[...base,model.model];return next.length?next:[model.model];})}><i style={{background:colors[index%colors.length]}}/>{model.model}</button>)}</div>
    {!models.length?<p className="usage-empty">{t('dashboard.noActivity')}</p>:<svg className="usage-trend" viewBox="0 0 800 250" role="img" aria-label={t('ui.dailyTrend')}>
     {[0,.5,1].map(ratio=><g key={ratio}><line x1="54" x2="780" y1={210-ratio*170} y2={210-ratio*170} stroke="var(--border-muted)" strokeDasharray="3 6"/><text x="46" y={214-ratio*170} textAnchor="end">{format(max*ratio)}</text></g>)}
     {visibleModels.map(model=>{const modelIndex=models.findIndex(item=>item.model===model.model);return <polyline key={model.model} fill="none" stroke={colors[modelIndex%colors.length]} strokeWidth="2.5" strokeLinejoin="round" points={trend.map((day,index)=>`${54+index/Math.max(1,trend.length-1)*726},${210-modelTokens(day,model.model)/max*170}`).join(' ')}/>;})}
     {[0,Math.floor((trend.length-1)/2),trend.length-1].filter((value,index,array)=>value>=0&&array.indexOf(value)===index).map(index=><text key={index} x={54+index/Math.max(1,trend.length-1)*726} y="239" textAnchor={index===0?'start':index===trend.length-1?'end':'middle'}>{trend[index].date.slice(5)}</text>)}
    </svg>}
    <details className="usage-chart-data"><summary>{t('ui.chartData')}</summary><table><thead><tr><th>{t('audit.time')}</th>{visibleModels.map(model=><th key={model.model}>{model.model}</th>)}</tr></thead><tbody>{trend.map(day=><tr key={day.date}><th>{day.date}</th>{visibleModels.map(model=><td key={model.model}>{modelTokens(day,model.model).toLocaleString()}</td>)}</tr>)}</tbody></table></details>
   </div>
   <div className="usage-card"><div className="usage-section-header"><h2>{t('ui.modelUsage')}</h2><button className="agent-token-trigger" onClick={()=>detail()}>{t('ui.viewDetails')}</button></div><ul className="usage-ranking">{models.map(model=><li key={model.model}><button onClick={()=>detail(undefined,model.model)}>{model.model}</button><span className="usage-rank-bar"><i style={{width:`${data.totals.totalTokens?model.totalTokens/data.totals.totalTokens*100:0}%`}}/></span><strong>{format(model.totalTokens)}</strong></li>)}</ul>{!models.length&&<p className="usage-empty">{t('dashboard.noActivity')}</p>}</div>
   <p className="usage-scope-note">{t('ui.usageScope')} · {data.timeZone}</p><p className="usage-source-totals">{t('ui.mainUsage')}: {format(data.sources.main)} · {t('ui.delegatedUsage')}: {format(data.sources.delegation)} · {t('ui.memoryUsage')}: {format(data.sources.memory)}</p>
  </>}
 </section>;
}
