import { createPortal } from 'react-dom';
import { WorkbenchDialog } from './WorkbenchDialog';
import type { useTaskDraft } from '../hooks/useTaskDraft';
import { useTranslation } from '../hooks/useTranslation';

type Props = { draft: ReturnType<typeof useTaskDraft>; disabled: boolean };

// Exceptional input recovery belongs to an application notice, never the composer.
export function InputRecoveryNotice({ draft, disabled }: Props) {
  const { t } = useTranslation();
  const root = document.querySelector('.workbench-app');
  if (!root || (!draft.error && !draft.errorKind && !draft.remoteDraft && !draft.localRecovery)) return null;
  return createPortal(<>
    {!draft.remoteDraft && <div className="workbench-input-notice" role="alert">
      <span>{t(draft.localRecovery && !draft.errorKind ? 'input.recoveryAvailable' : 'input.syncUnavailable')}</span>
      {draft.errorKind === 'conflict'
        ? <button type="button" data-draft-action="inspect" disabled={disabled || draft.isRecovering} onClick={() => void draft.inspectConflict()}>{t('input.review')}</button>
        : draft.error || draft.errorKind ? <button type="button" data-draft-action="retry" disabled={disabled || draft.isRecovering} onClick={() => void draft.retry().catch(() => undefined)}>{t('workbench.retry')}</button> : null}
      {draft.localRecovery && <button type="button" data-draft-action="restore-local" disabled={disabled || draft.isRecovering} onClick={draft.restoreLocal}>{t('input.restorePrevious')}</button>}
    </div>}
    {draft.remoteDraft && <WorkbenchDialog kind="input-recovery" className="input-recovery-dialog" title={t('input.chooseVersion')} busy={disabled || draft.isRecovering} onClose={draft.dismissConflict} actions={<><button type="button" className="btn btn-secondary" data-draft-action="use-saved" disabled={disabled || draft.isRecovering} onClick={() => void draft.resolveConflict(false)}>{t('input.useSaved')}</button><button type="button" className="btn btn-primary" data-draft-action="keep-local" disabled={disabled || draft.isRecovering} onClick={() => void draft.resolveConflict(true)}>{t('input.keepCurrent')}</button></>}>
      <p>{t('input.chooseVersionHelp')}</p><div className="input-recovery-versions"><section><strong>{t('input.currentVersion')}</strong><pre>{draft.currentInput}</pre></section><section><strong>{t('input.savedVersion')}</strong><pre>{draft.remoteDraft.input}</pre><p>{[...draft.remoteDraft.references, ...draft.remoteDraft.attachments].map(item => item.name).join(' · ')}</p></section></div>
    </WorkbenchDialog>}
  </>, root);
}
