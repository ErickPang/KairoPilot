import { IconShield } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import type { ConfirmationRequest } from '../types';

interface ConfirmationModalProps {
  request: ConfirmationRequest;
  onConfirm: () => void;
  onDeny: () => void;
}

export function ConfirmationModal({ request, onConfirm, onDeny }: ConfirmationModalProps) {
  const { t } = useTranslation();
  const riskLevel = request.riskLevel || (request.tool === 'delete_file' || request.tool === 'execute_command' ? 'high' : 'medium');
  const isDestructive = riskLevel === 'high' || riskLevel === 'critical';
  const riskLevelLabel = riskLevel === 'critical'
    ? t('modal.risk.critical')
    : riskLevel === 'high'
      ? t('modal.risk.high')
      : riskLevel === 'low'
        ? t('modal.risk.low')
        : t('modal.risk.medium');
  const approvalModeLabel = request.approvalMode === 'never'
    ? t('modal.approvalMode.never')
    : request.approvalMode === 'on_write'
      ? t('modal.approvalMode.on_write')
      : request.approvalMode === 'on_external'
        ? t('modal.approvalMode.on_external')
        : request.approvalMode === 'always'
          ? t('modal.approvalMode.always')
          : null;

  return (
    <div className="modal-overlay">
      <div className={`modal-content confirmation-modal ${isDestructive ? 'is-destructive' : ''}`}>
        <div className="modal-header">
          <h3 className={`confirmation-modal-title ${isDestructive ? 'is-destructive' : ''}`}>
            <IconShield size={20} /> 
            {isDestructive ? t('modal.highRisk') : t('modal.permissionRequest')}
          </h3>
          <button type="button" className="close-btn" onClick={onDeny}>×</button>
        </div>
        
        <div className="modal-body">
          <p className={`confirmation-modal-lead ${isDestructive ? 'is-destructive' : ''}`}>
            {isDestructive ? t('modal.requestDescHighRisk') : t('modal.requestDesc')}
          </p>
          <div className="tool-details confirmation-modal-details">
            <div className="confirmation-modal-row">
              <strong>{t('modal.tool')}:</strong> <code className={`confirmation-modal-code ${isDestructive ? 'is-destructive' : ''}`}>{request.tool}</code>
            </div>
            <div className="confirmation-modal-row-label"><strong>{t('modal.arguments')}:</strong></div>
            <pre className="confirmation-modal-pre">
              {JSON.stringify(request.args, null, 2)}
            </pre>
            <div className="confirmation-modal-meta">
              <div>
                <strong>{t('modal.riskLevel')}:</strong> {riskLevelLabel}
              </div>
              {approvalModeLabel && (
                <div>
                  <strong>{t('modal.approvalMode')}:</strong> {approvalModeLabel}
                </div>
              )}
              {request.policyTags && request.policyTags.length > 0 && (
                <div>
                  <strong>{t('modal.policyTags')}:</strong> {request.policyTags.join(', ')}
                </div>
              )}
              {request.redacted && (
                <div className="confirmation-modal-muted">
                  {t('modal.redactedNotice')}
                </div>
              )}
            </div>
          </div>
          {isDestructive && (
            <p className="confirmation-modal-warning">
              {t('modal.warning')}
            </p>
          )}
        </div>
        
        <div className="modal-actions confirmation-modal-actions">
          <button type="button" onClick={onDeny} className="btn btn-secondary confirmation-modal-action">{t('modal.deny')}</button>
          <button 
            type="button"
            onClick={onConfirm} 
            className={`btn ${isDestructive ? 'btn-danger' : 'btn-primary'} confirmation-modal-action`}
          >
            {t('modal.allow')}
          </button>
        </div>
      </div>
    </div>
  );
}
