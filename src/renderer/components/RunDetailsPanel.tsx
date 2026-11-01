import { RunPauseControl } from './RunPauseControl';
import { runStatusLabel } from '../hooks/runPresentation';
import type { RunStep, SessionContextState } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { IconRefresh, IconShield } from './Icons';

interface RunDetailsPanelProps {
  context: SessionContextState;
  onRetryStep: (stepId: string) => Promise<void>;
  disabled: boolean;
  onPause: () => Promise<boolean | void>;
  onResume: () => Promise<boolean | void>;
}

export function RunDetailsPanel({ context, onRetryStep, disabled, onPause, onResume }: RunDetailsPanelProps) {
  const { t } = useTranslation();
  const run = context.latestRun;
  const summary = context.latestContextSummary?.runId === run?.id ? context.latestContextSummary : null;
  const steps = context.activeRunSteps.filter((step) => step.runId === run?.id);
  const renderStep = (step: RunStep) => (
    <li key={step.id} className={`workbench-step is-${step.status}`}>
      <span className="workbench-step-dot" aria-hidden="true" />
      <div>
        <strong>{step.title}</strong>
        <span className="workbench-step-status">{step.status === 'pending' ? t('workbench.pending') : t(runStatusLabel[step.status])}</span>
        {step.error && <p className="workbench-error">{step.error}</p>}
        {(step.input !== undefined || step.output !== undefined) && (
          <details>
            <summary>{t('workbench.stepDetails')}</summary>
            <pre>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre>
          </details>
        )}
        {run?.executionContext?.phase!=='planning' && run?.status === 'failed' && step.status === 'failed' && step.metadata?.retryable === true && (
          <button type="button" disabled={disabled} onClick={() => void onRetryStep(step.id)}>
            <IconRefresh size={13} /> {t('workbench.retryStep')}
          </button>
        )}
      </div>
    </li>
  );
  return (
    <section className="workbench-run-details" aria-label={t('workbench.details')}>
      <div className="workbench-section-heading"><IconShield size={16} /><h2>{t('workbench.details')}</h2></div>
      {!run ? <p className="workbench-panel-empty">{t('workbench.noRun')}</p> : <>
        <RunPauseControl run={run} onPause={onPause} onResume={onResume} disabled={disabled}/>
        <dl className="workbench-run-meta">
          {run.executionContext?.phase&&<><dt>{t('w4.runPhase')}</dt><dd>{t(run.executionContext.phase==='planning'?'w4.planningRun':'w4.executionRun')}</dd></>}
          <dt>{t('workbench.goal')}</dt><dd>{run.goal}</dd>
          <dt>{t('workbench.runId')}</dt><dd className="workbench-mono">{run.id}</dd>
          <dt>{t('workbench.runDirectory')}</dt><dd>{run.executionContext?.executionRoot || t('workbench.historyRootUnknown')}</dd>
          {run.executionContext && <><dt>{t('workbench.runModel')}</dt><dd>{run.executionContext.model}</dd><dt>{t('workbench.agentPromptDirectory')}</dt><dd>{run.executionContext.agentWorkspace}</dd></>}
          <dt>{t('workbench.verification')}</dt><dd>{t('workbench.verificationInResults')}</dd>
        </dl>
        {run.executionContext?.instructionSources&&<details className="workbench-context-summary" data-instruction-sources><summary>AGENTS.md</summary><ul>{run.executionContext.instructionSources.map(source=><li key={source.path}><code>{source.path}</code> · {source.scope} · <code>{source.hash.slice(0,12)}</code></li>)}</ul></details>}
        {summary && <details className="workbench-context-summary">
          <summary>{t('workbench.context')}</summary>
          {!summary.budget.request&&<p>{summary.budget.totalChars.toLocaleString()} / {summary.budget.maxContextChars.toLocaleString()} {t('workbench.characters')}</p>}
          {summary.budget.request&&<div data-request-budget><p>{t('workbench.requestBudget')}: {summary.budget.request.estimatedInputTokens.toLocaleString()} / {summary.budget.request.inputLimitTokens.toLocaleString()}</p><p>{t('workbench.requestBudgetBreakdown',{messages:summary.budget.request.messageTokens.toLocaleString(),tools:summary.budget.request.toolTokens.toLocaleString(),output:summary.budget.request.outputTokens.toLocaleString(),safety:summary.budget.request.safetyTokens.toLocaleString()})}</p><p>{t(summary.budget.request.source==='local_fallback'?'workbench.localBudgetLimit':'workbench.configuredBudgetLimit')}: {summary.budget.request.contextTokens.toLocaleString()}</p><p>{t('workbench.requestBudgetHelp')}</p></div>}
          <p>{t('workbench.recentMessages')}: {summary.recentMessageCount} · {t('workbench.omittedMessages')}: {summary.omittedMessageCount}</p>
          <ul>{summary.layers.map((layer) => <li key={layer.id}>{layer.title}: {layer.charCount.toLocaleString()} {t('workbench.characters')}</li>)}</ul>
        </details>}
        {run.error && <p role="alert" className="workbench-error">{run.error}</p>}
        <h3>{t('workbench.activity')}</h3>
        {steps.length ? <ol className="workbench-step-list">{steps.map(renderStep)}</ol> : <p className="workbench-panel-empty">{t('workbench.noSteps')}</p>}
      </>}
    </section>
  );
}
