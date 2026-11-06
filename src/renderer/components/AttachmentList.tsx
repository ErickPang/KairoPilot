import type { ChatAttachment } from '../types';
import { IconX } from './Icons';

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentList({ attachments, onRemove, compact = false, disabled = false }: { attachments?: ChatAttachment[]; onRemove?: (id: string) => void; compact?: boolean; disabled?: boolean }) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className={`attachment-list ${compact ? 'is-compact' : ''}`}>
      {attachments.map((attachment) => (
        <div key={attachment.id} className="attachment-chip" title={attachment.name}>
          {attachment.kind === 'image' && attachment.previewUri ? (
            <img className="attachment-thumb" src={attachment.previewUri} alt={attachment.name} />
          ) : (
            <span className="attachment-file-icon">{attachment.kind === 'text' ? 'TXT' : 'FILE'}</span>
          )}
          <span className="attachment-meta">
            <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
            <span className="attachment-size">{formatBytes(attachment.size)}</span>
          </span>
          {onRemove && (
            <button type="button" className="attachment-remove" disabled={disabled} onClick={() => onRemove(attachment.id)} aria-label="Remove attachment">
              <IconX size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
