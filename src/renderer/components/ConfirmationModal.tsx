import { IconShield } from './Icons';

interface ConfirmationModalProps {
  request: { id: string; tool: string; args: any };
  onConfirm: () => void;
  onDeny: () => void;
}

export function ConfirmationModal({ request, onConfirm, onDeny }: ConfirmationModalProps) {
  // Determine if it's a highly destructive action
  const isDestructive = request.tool === 'delete_file' || request.tool === 'execute_command';

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ 
        maxWidth: '500px', 
        borderTop: isDestructive ? '4px solid var(--danger)' : '4px solid var(--primary)'
      }}>
        <div className="modal-header">
          <h3 style={{ color: isDestructive ? 'var(--danger)' : 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconShield size={20} /> 
            {isDestructive ? '高危操作警告 (High Risk)' : 'Permission Request'}
          </h3>
          <button className="close-btn" onClick={onDeny}>×</button>
        </div>
        
        <div className="modal-body">
          <p style={{ marginTop: 0, fontWeight: 'bold', color: isDestructive ? 'var(--danger)' : 'inherit' }}>
            KairoPilot 请求执行以下{isDestructive ? '高危' : ''}操作，请确认：
          </p>
          <div className="tool-details" style={{ backgroundColor: 'var(--bg-color)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>工具 (Tool):</strong> <code style={{ backgroundColor: 'var(--input-bg)', padding: '2px 6px', borderRadius: '4px', color: isDestructive ? 'var(--danger)' : 'inherit' }}>{request.tool}</code>
            </div>
            <div style={{ marginBottom: '0.25rem' }}><strong>参数 (Arguments):</strong></div>
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
          </div>
          {isDestructive && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px' }}>
              ⚠️ 警告：此操作可能会对您的系统或文件造成不可逆的修改，请仔细核对参数。
            </p>
          )}
        </div>
        
        <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
          <button onClick={onDeny} className="secondary" style={{ flex: 1 }}>拒绝 (Deny)</button>
          <button 
            onClick={onConfirm} 
            className="primary" 
            style={{ 
              flex: 1, 
              backgroundColor: isDestructive ? 'var(--danger)' : 'var(--primary)',
              borderColor: isDestructive ? 'var(--danger)' : 'var(--primary)'
            }}
          >
            允许执行 (Allow)
          </button>
        </div>
      </div>
    </div>
  );
}
