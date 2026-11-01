import { getDb, getRunById, getApprovalRecord, resolveApprovalRecord, updateRunStep, updateToolCallRecord, createRunStep, updateRun } from '../../store/chat';
/** Cancellation never needs a provider credential, runtime initialization, or file access. */
export function cancelSuspendedRun(runId: string) {
  const run=getRunById(runId);
  if (!run || !['paused','waiting_approval'].includes(run.status)) throw new Error('Run is not suspended.');
  getDb().transaction(()=>{
    const approval=run.waitingApprovalId ? getApprovalRecord(run.waitingApprovalId) : null;
    if (approval) {
      resolveApprovalRecord(approval.id,false);
      if (approval.stepId) updateRunStep(approval.stepId,{status:'cancelled',output:{approved:false,cancelled:true},metadata:{...approval.metadata,approvalId:approval.id}});
      if (typeof approval.metadata?.toolStepId==='string') updateRunStep(approval.metadata.toolStepId,{status:'cancelled',error:'Run cancelled by user.'});
      if (typeof approval.metadata?.toolRecordId==='string') updateToolCallRecord(approval.metadata.toolRecordId,{status:'cancelled'});
    }
    createRunStep(runId,'summary','运行已取消',{status:'cancelled',output:{reason:'cancel_requested'}});
    updateRun(runId,{status:'cancelled',error:'Run cancelled by user.',waitingApprovalId:null,completedAt:Date.now()});
  })();
}
