import { IconShield } from './Icons';

interface ConfirmationModalProps {
  request: { id: string; tool: string; args: any };
  onConfirm: () => void;
  onDeny: () => void;
}

export function ConfirmationModal({ request, onConfirm, onDeny }: ConfirmationModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h3><IconShield size={20} /> Permission Request</h3>
          <button className="close-btn" onClick={onDeny}>×</button>
        </div>
        
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>The agent wants to execute the following action:</p>
          <div className="tool-details" style={{ backgroundColor: '#f9f9f9', padding: '1rem', borderRadius: '6px', border: '1px solid #eee' }}>
            <div style={{ marginBottom: '0.5rem' }}><strong>Tool:</strong> <code style={{ backgroundColor: '#e0e0e0', padding: '2px 4px', borderRadius: '4px' }}>{request.tool}</code></div>
            <div style={{ marginBottom: '0.25rem' }}><strong>Arguments:</strong></div>
            <pre style={{ margin: 0, backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd', maxHeight: '200px', overflow: 'auto', fontSize: '0.9rem' }}>
              {JSON.stringify(request.args, null, 2)}
            </pre>
          </div>
        </div>
        
        <div className="modal-actions">
          <button onClick={onDeny} className="secondary">Deny</button>
          <button onClick={onConfirm} className="primary">Allow</button>
        </div>
      </div>
    </div>
  );
}
