import {useEffect,useState,useRef} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {KAIRO_INVOKE as C} from '../../shared/ipc';
import type {ArtifactDiff,TaskResults,TaskArtifact,VerificationRecord} from '../../shared/contracts';
import type {RunSummary} from '../types';
import {useTranslation} from '../hooks/useTranslation';
import {DiffViewer} from './DiffViewer';
import {deliveryForRun} from './taskDelivery';

export function TaskResultsPanel({run,sessionId,onOpenFile,onReference,acceptance}:{
 run:RunSummary|null;sessionId:string|null;onOpenFile:(path:string)=>void;
 onReference?:(path:string)=>void;acceptance?:string;
}){
 const {t}=useTranslation();
 const viewKey=`${sessionId}:${run?.id||''}`;const currentView=useRef(viewKey);currentView.current=viewKey;const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [results,setResults]=useState<TaskResults>({artifacts:[],verifications:[]});
 const [diff,setDiff]=useState<ArtifactDiff|null>(null);
 const [workingDiff,setWorkingDiff]=useState<{available:boolean;diff:string;omittedFiles?:number}|null>(null);
 const [error,setError]=useState('');const [isLoading,setIsLoading]=useState(false);
 useEffect(()=>{
  let current=true;setDiff(null);setWorkingDiff(null);setResults({artifacts:[],verifications:[]});
  if(!sessionId)return;
  setIsLoading(true);setError('');
  void window.kairo.invoke(C.chatGetTaskResults,sessionId).then(value=>{if(current)setResults(value);})
   .catch(reason=>{if(current)setError(String(reason));}).finally(()=>{if(current)setIsLoading(false);});
  return()=>{current=false;};
 },[sessionId,run?.id,run?.status,run?.updatedAt]);
 const delivery=deliveryForRun(results,run?.id);
 const [busy,setBusy]=useState(false);
 const loadEvidence=async<T,>(load:()=>Promise<T>,apply:(value:T)=>void)=>{
  setError('');setBusy(true);const key=viewKey;
  try{const value=await load();if(alive.current&&currentView.current===key)apply(value);}catch(reason){if(alive.current&&currentView.current===key)setError(String(reason));}finally{if(alive.current&&currentView.current===key)setBusy(false);}
 };
 useEffect(()=>setBusy(false),[viewKey]);
 const renderArtifact=(artifact:TaskArtifact)=><li key={artifact.id} data-delivery-artifact={artifact.id}>
  <strong title={artifact.path}>{artifact.path.split(/[/\\]/).pop()}</strong>
  <span>{t(`workbench.artifact.${artifact.operation}`)} · {t(`workbench.availability.${artifact.availability||'available'}`)}</span>
  <small>{new Date(artifact.createdAt).toLocaleString()} · Run {artifact.runId.slice(0,8)}</small>
  <div className="delivery-actions">
   <button disabled={artifact.availability==='missing'||artifact.availability==='denied'||artifact.operation==='deleted'} onClick={()=>onOpenFile(artifact.path)}>{t('batch1.preview')}</button>
   <button data-delivery-reference disabled={!onReference||artifact.availability==='missing'||artifact.availability==='denied'||artifact.operation==='deleted'} onClick={()=>onReference?.(artifact.path)}>{t('batch1.continueWithArtifact')}</button>
   <button disabled={busy||!artifact.diffAvailable||artifact.availability==='denied'} onClick={()=>void loadEvidence(()=>window.kairo.invoke(C.chatGetArtifactDiff,artifact.id),setDiff)}>{t('workbench.savedDiff')}</button>
  </div>
 </li>;
 const renderVerification=(record:VerificationRecord)=><li key={record.id}>
  <strong>{t(`workbench.verification.${record.status}`)}{record.exitCode===undefined?'':` · exit ${record.exitCode}`}</strong>
  <code>{record.command}</code><small title={record.cwd}>{record.cwd} · Run {record.runId.slice(0,8)}</small>
  {record.outputAvailable===false?<p>{t('workbench.availability.denied')}</p>:<details><summary>{t('workbench.commandOutput')}</summary><pre>{record.stdout}{record.stderr?`\n${record.stderr}`:''}</pre></details>}
 </li>;
 return <section className="workbench-results" data-delivery-run={run?.id||''} data-delivery-ready={!isLoading}>
  <h2>{t('batch1.delivery')}</h2>
  {run&&<p className="config-subtitle delivery-goal" title={run.goal}>{t('batch1.thisRun')} · {run.id.slice(0,8)} · {run.goal}</p>}
  <p className="workbench-result-notice">{t('batch1.deliveryHelp')}</p>
  {isLoading&&<p role="status">{t('common.loading')}</p>}{error&&<p className="workbench-error" role="alert">{error}</p>}
  {!isLoading&&<>
   <div className="delivery-overview"><span>{t('workbench.taskArtifacts')}: {delivery.artifacts.length}</span><span>{t('workbench.changeSummary')}: {delivery.changes.length}</span><span>{t('workbench.verificationEvidence')}: {delivery.verifications.length}</span></div>
   <p className={delivery.verificationStatus==='failed'?'workbench-error':'workbench-result-notice'} role="status">{t(`workbench.currentVerification.${delivery.verificationStatus}`)}</p>
   <h3>{t('batch1.needsReview')}</h3>
   <ul className="delivery-review-list">
    {!run||run.status!=='completed'?<li>{t('batch1.runNotCompleted')}{run?.error?` · ${run.error}`:''}</li>:<li>{t('batch1.confirmRequirements')}</li>}
    {!delivery.verifications.length&&<li>{t('workbench.unverified')}</li>}
    {delivery.unavailableCount>0&&<li>{t('batch1.changedArtifacts',{count:delivery.unavailableCount})}</li>}
    {delivery.verificationStatus==='failed'&&<li>{t('batch1.failedChecks')}</li>}
   </ul>
   {acceptance&&<details><summary>{t('w4.acceptance')}</summary><p>{acceptance}</p></details>}
   <h3>{t('workbench.taskArtifacts')}</h3>
   <p className="workbench-result-notice">{t('workbench.artifactSourceNotice')}</p>
   {!delivery.artifacts.length&&<p className="workbench-panel-empty">{t('workbench.noArtifacts')}</p>}
   <ul className="workbench-evidence-list" data-current-artifacts>{delivery.artifacts.map(renderArtifact)}</ul>
   <h3>{t('workbench.changeSummary')}</h3>
   <ul className="workbench-evidence-list">{delivery.changes.map(change=><li key={change.path}>
    <strong title={change.path}>{change.path.split(/[/\\]/).pop()}</strong><span>{t(`workbench.change.${change.operation}`)} · {change.artifactIds.length} {t('workbench.recordedOperations')}</span>
    {change.hasDiscontinuity&&<p className="workbench-error">{t('workbench.changeDiscontinuity')}</p>}
    <button disabled={busy||!change.diffAvailable||change.availability==='denied'} onClick={()=>{
     void loadEvidence(()=>window.kairo.invoke(C.chatGetTaskChangeDiff,{sessionId:sessionId!,path:change.path,runId:run!.id}),setDiff);
    }}>{t('workbench.reviewChangeSummary')}</button>
   </li>)}</ul>
   <h3>{t('workbench.verificationEvidence')}</h3><p className="workbench-result-notice">{t('workbench.verificationNotice')}</p>
   <ul className="workbench-evidence-list" data-current-verifications>{delivery.verifications.map(renderVerification)}</ul>
   {run?.finalResponse&&<details className="workbench-result-response"><summary>{t('workbench.assistantResponse')}</summary><div className="workbench-result-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{run.finalResponse}</ReactMarkdown></div></details>}
   {(delivery.historyArtifacts.length>0||delivery.historyVerifications.length>0)&&<details className="delivery-history" data-delivery-history><summary>{t('batch1.previousResults')} · {delivery.historyArtifacts.length+delivery.historyVerifications.length}</summary><ul className="workbench-evidence-list">{delivery.historyArtifacts.map(renderArtifact)}{delivery.historyVerifications.map(renderVerification)}</ul></details>}
  </>}
  {diff&&<div className="workbench-evidence-diff"><p>{t('workbench.savedDiffNotice')}</p><button onClick={()=>setDiff(null)}>{t('common.close')}</button><DiffViewer oldText={diff.oldText} newText={diff.newText} filePath={diff.path}/></div>}
  <details className="delivery-working-diff"><summary>{t('workbench.workingDirectoryDiff')}</summary><p className="workbench-result-notice">{t('workbench.workingDiffNotice')}</p>
   <button disabled={!sessionId||busy} onClick={()=>{setWorkingDiff(null);void loadEvidence(()=>window.kairo.invoke(C.chatGetWorkingDiff,sessionId!),setWorkingDiff);}}>{t('workbench.readWorkingDiff')}</button>
   {workingDiff&&<div className="workbench-evidence-diff">{workingDiff.omittedFiles?<p>{t('workbench.diffOmitted',{count:workingDiff.omittedFiles})}</p>:null}<pre>{workingDiff.available?workingDiff.diff||t('workbench.noTrackedChanges'):t('workbench.gitDiffUnavailable')}</pre></div>}
  </details>
 </section>;
}
