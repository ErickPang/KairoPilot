import type { AppConfirmationOptions } from '../types';

interface ActionConfirmationModalProps {
  request: AppConfirmationOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ActionConfirmationModal({ request, onConfirm, onCancel }: ActionConfirmationModalProps) {
  const isDanger = request.variant === 'danger';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className={`modal-content action-confirmation-modal ${isDanger ? 'is-danger' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className={`action-confirmation-title ${isDanger ? 'is-danger' : ''}`}>{request.title}</h3>
          <button type="button" className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p className="action-confirmation-message">{request.message}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {request.cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
