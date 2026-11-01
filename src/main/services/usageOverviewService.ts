import {getDb} from '../store/chat';
import {buildMonitoringWhereClause} from '../store/chatStoreUtils';
import type {UsageOverview} from '../../shared/usageOverview';
interface Group {date:string;model:string;source:'main'|'delegation'|'memory';prompt:number;completion:number;total:number;records:number}
export function aggregateUsageOverview(rows:Group[],activity:{activeDays:number;runCount:number},now=new Date()):UsageOverview{
 const local=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const first=new Date(now);first.setHours(0,0,0,0);first.setDate(first.getDate()-364);const startDate=local(first),endDate=local(now);
 const totals={promptTokens:0,completionTokens:0,totalTokens:0,records:0,peakDailyTokens:0,...activity};const days=new Map<string,{totalTokens:number;models:Record<string,number>}>();const models=new Map<string,UsageOverview['models'][number]>();const sources={main:0,delegation:0,memory:0};
 for(const row of rows){
  totals.promptTokens+=row.prompt;totals.completionTokens+=row.completion;totals.totalTokens+=row.total;totals.records+=row.records;sources[row.source]+=row.total;
  const day=days.get(row.date)||{totalTokens:0,models:Object.create(null) as Record<string,number>};day.totalTokens+=row.total;day.models[row.model]=(day.models[row.model]||0)+row.total;days.set(row.date,day);
  const model=models.get(row.model)||{model:row.model,totalTokens:0,promptTokens:0,completionTokens:0,records:0};model.totalTokens+=row.total;model.promptTokens+=row.prompt;model.completionTokens+=row.completion;model.records+=row.records;models.set(row.model,model);
 }
 totals.peakDailyTokens=Math.max(0,...[...days.values()].map(day=>day.totalTokens));
 const daily:UsageOverview['daily']=[];
 for(const date=new Date(first);local(date)<=endDate;date.setDate(date.getDate()+1)){const key=local(date);daily.push({date:key,...(days.get(key)||{totalTokens:0,models:{}})});}
 return {totals,daily,models:[...models.values()].sort((a,b)=>b.totalTokens-a.totalTokens||a.model.localeCompare(b.model)),sources,startDate,endDate,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
}
export function getUsageOverview(projectId?:string):UsageOverview{
 const db=getDb();const {whereClause,params}=buildMonitoringWhereClause({projectId});
 const rows=db.prepare(`WITH usage_records AS (
   SELECT role,content,timestamp,usage,tool_calls,model,session_id,'main' AS source FROM messages
   UNION ALL SELECT 'assistant',purpose,timestamp,usage,NULL,model,session_id,CASE WHEN purpose='project-memory' THEN 'memory' ELSE 'delegation' END FROM auxiliary_usage
  ), candidates AS (
   SELECT date(messages.timestamp/1000,'unixepoch','localtime') AS date,COALESCE(NULLIF(messages.model,''),'Unknown') AS model,messages.source,
    CASE WHEN json_valid(messages.usage) THEN messages.usage ELSE '{}' END AS usage
   FROM usage_records AS messages JOIN sessions ON sessions.id=messages.session_id ${whereClause}
    AND messages.role IN ('user','assistant') AND length(trim(messages.content))>0
  ), reported AS (
   SELECT * FROM candidates WHERE json_type(usage,'$.total_tokens') IN ('integer','real') AND json_extract(usage,'$.total_tokens')>=0
  ) SELECT date,model,source,COUNT(*) AS records,
    SUM(CASE WHEN json_type(usage,'$.prompt_tokens') IN ('integer','real') THEN MAX(0,json_extract(usage,'$.prompt_tokens')) ELSE 0 END) AS prompt,
    SUM(CASE WHEN json_type(usage,'$.completion_tokens') IN ('integer','real') THEN MAX(0,json_extract(usage,'$.completion_tokens')) ELSE 0 END) AS completion,
    SUM(json_extract(usage,'$.total_tokens')) AS total FROM reported GROUP BY date,model,source`).all(...params) as Group[];
 const activity=db.prepare(`SELECT COUNT(*) AS runCount,COUNT(DISTINCT date(runs.created_at/1000,'unixepoch','localtime')) AS activeDays FROM runs JOIN sessions ON sessions.id=runs.session_id ${projectId?'WHERE sessions.project_id=?':''}`).get(...(projectId?[projectId]:[])) as {runCount:number;activeDays:number};
 return aggregateUsageOverview(rows,activity);
}
