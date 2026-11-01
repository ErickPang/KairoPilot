import type { AppConfirmationOptions } from '../types';
import { WorkbenchDialog } from './WorkbenchDialog';

interface ActionConfirmationModalProps {
  request: AppConfirmationOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ActionConfirmationModal({ request, onConfirm, onCancel }: ActionConfirmationModalProps) {
  const isDanger = request.variant === 'danger';
  return <WorkbenchDialog title={request.title} kind="confirm-action" className={`action-confirmation-modal ${isDanger ? 'is-danger' : ''}`} onClose={onCancel} actions={<>
    <button type="button" className="btn btn-secondary" onClick={onCancel}>{request.cancelLabel}</button>
    <button type="button" className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{request.confirmLabel}</button>
  </>}><p className="action-confirmation-message">{request.message}</p></WorkbenchDialog>;
}
