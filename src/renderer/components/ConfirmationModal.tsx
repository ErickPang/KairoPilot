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
      <div className="modal-content" style={{ 
        maxWidth: '500px', 
        borderTop: isDestructive ? '4px solid var(--danger)' : '4px solid var(--primary)'
      }}>
        <div className="modal-header">
          <h3 style={{ color: isDestructive ? 'var(--danger)' : 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconShield size={20} /> 
            {isDestructive ? t('modal.highRisk') : t('modal.permissionRequest')}
          </h3>
          <button className="close-btn" onClick={onDeny}>×</button>
        </div>
        
        <div className="modal-body">
          <p style={{ marginTop: 0, fontWeight: 'bold', color: isDestructive ? 'var(--danger)' : 'inherit' }}>
            {isDestructive ? t('modal.requestDescHighRisk') : t('modal.requestDesc')}
          </p>
          <div className="tool-details" style={{ backgroundColor: 'var(--bg-color)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>{t('modal.tool')}:</strong> <code style={{ backgroundColor: 'var(--input-bg)', padding: '2px 6px', borderRadius: '4px', color: isDestructive ? 'var(--danger)' : 'inherit' }}>{request.tool}</code>
            </div>
            <div style={{ marginBottom: '0.25rem' }}><strong>{t('modal.arguments')}:</strong></div>
            <pre style={{ 
              margin: 0, 
              backgroundColor: 'var(--input-bg)', 
              padding: '0.5rem', 
              borderRadius: '4px', 
              border: '1px solid var(--border)', 
              maxHeight: '200px', 
              overflow: 'auto', 
              fontSize: '0.9rem',
              color: 'var(--foreground)'
            }}>
              {JSON.stringify(request.args, null, 2)}
            </pre>
            <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
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
                <div style={{ color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                  {t('modal.redactedNotice')}
                </div>
              )}
            </div>
          </div>
          {isDestructive && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px' }}>
              {t('modal.warning')}
            </p>
          )}
        </div>
        
        <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
          <button onClick={onDeny} className="secondary" style={{ flex: 1 }}>{t('modal.deny')}</button>
          <button 
            onClick={onConfirm} 
            className="primary" 
            style={{ 
              flex: 1, 
              backgroundColor: isDestructive ? 'var(--danger)' : 'var(--primary)',
              borderColor: isDestructive ? 'var(--danger)' : 'var(--primary)'
            }}
          >
            {t('modal.allow')}
          </button>
        </div>
      </div>
    </div>
  );
}
