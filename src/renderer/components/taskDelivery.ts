import type {TaskResults} from '../../shared/contracts';
import {summarizeTaskChanges} from '../../shared/taskChangeSummary';
export function deliveryForRun(results:TaskResults,runId?:string){
 const current=results.artifacts.filter(item=>item.runId===runId);
 const artifacts=[...new Map([...current].reverse().map(item=>[item.path,item])).values()].reverse();
 const verifications=results.verifications.filter(item=>item.runId===runId);
 const verificationStatus:'unverified'|'failed'|'interrupted'|'passed'=!verifications.length?'unverified':verifications.some(item=>item.status==='failed')?'failed':verifications.some(item=>item.status==='interrupted'||item.outputAvailable===false)?'interrupted':'passed';
 return {artifacts,verifications,verificationStatus,changes:summarizeTaskChanges(current),unavailableCount:artifacts.filter(item=>item.availability&&item.availability!=='available').length,historyArtifacts:results.artifacts.filter(item=>item.runId!==runId),historyVerifications:results.verifications.filter(item=>item.runId!==runId)};
}
