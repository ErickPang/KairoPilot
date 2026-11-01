import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { IconCode, IconCollapse, IconExpand, IconFolder, IconLink, IconPreview } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

type FilePreviewPayload =
  | {
      kind: 'directory';
      path: string;
      name: string;
      size: number;
    }
  | {
      kind: 'image';
      path: string;
      name: string;
      size: number;
      extension: string;
    }
  | {
      kind: 'text' | 'markdown';
      path: string;
      name: string;
      size: number;
      extension: string;
      content: string;
      truncated?: boolean;
    }
  | {
      kind: 'unsupported';
      reason?: 'too_large' | 'binary';
      path: string;
      name: string;
      size: number;
      extension: string;
    }
  | {
      kind: 'error';
      path: string;
      error: string;
    };

interface FilePreviewProps {
  filePath: string;
  onInsertPath?: (filePath: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

type PreviewMode = 'code' | 'preview';

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

function getDefaultPreviewMode(preview: FilePreviewPayload | null): PreviewMode {
  if (!preview) return 'code';
  if (preview.kind === 'image' || preview.kind === 'markdown') return 'preview';
  if (preview.kind === 'text' && (preview.extension === 'html' || preview.extension === 'htm')) return 'preview';
  return 'code';
}

function formatCodeContent(preview: Extract<FilePreviewPayload, { kind: 'text' | 'markdown' }>): string {
  if (preview.extension === 'json') {
    try {
      return JSON.stringify(JSON.parse(preview.content), null, 2);
    } catch {
      return preview.content;
    }
  }

  return preview.content;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreview({ filePath, onInsertPath, isExpanded, onToggleExpand }: FilePreviewProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<PreviewMode>('code');

  const loadPreview = useCallback(async () => {
    if (!filePath) {
      setPreview(null);
      return;
    }

    setLoading(true);
    const result = await window.kairo.invoke(KAIRO_INVOKE.systemReadFilePreview, filePath) as FilePreviewPayload;
    setPreview(result);
    setLoading(false);
  }, [filePath]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    setMode(getDefaultPreviewMode(preview));
  }, [preview]);

  const title = useMemo(() => {
    if (!preview) {
      return filePath.split(/[/\\]/).pop() || filePath;
    }
    if ('name' in preview) {
      return preview.name;
    }
    return filePath.split(/[/\\]/).pop() || filePath;
  }, [filePath, preview]);

  const canPreviewRender = preview?.kind === 'image' || preview?.kind === 'markdown' || (preview?.kind === 'text' && (preview.extension === 'html' || preview.extension === 'htm'));
  const codeContent = preview && (preview.kind === 'text' || preview.kind === 'markdown') ? formatCodeContent(preview) : '';
  const codeLines = useMemo(() => codeContent.split('\n'), [codeContent]);

  return (
    <aside className="file-preview-pane">
      <div className="file-preview-header">
        <div className="file-preview-topbar">
          <div className="file-preview-mode-switch">
            <button
              type="button"
              className={`file-preview-mode-btn ${mode === 'code' ? 'active' : ''}`}
              onClick={() => setMode('code')}
              title={t('filePreview.codeMode')}
            >
              <IconCode size={16} />
            </button>
            <button
              type="button"
              className={`file-preview-mode-btn ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
              title={t('filePreview.previewMode')}
            >
              <IconPreview size={16} />
            </button>
          </div>
          <div className="file-preview-actions">
            <button type="button" className="file-preview-icon-btn" disabled={!onInsertPath} onClick={() => onInsertPath?.(filePath)} title={t('filePreview.insertPath')}>
              <IconLink size={14} />
            </button>
            <button type="button" className="file-preview-icon-btn" onClick={onToggleExpand} title={isExpanded ? t('filePreview.collapse') : t('filePreview.expand')}>
              {isExpanded ? <IconCollapse size={14} /> : <IconExpand size={14} />}
            </button>
          </div>
        </div>

        <div className="file-preview-header-copy">
          <h3 className="file-preview-title">{title}</h3>
          {preview && preview.kind !== 'error' && preview.kind !== 'directory' && 'size' in preview && (
            <div className="file-preview-subline">
              {'extension' in preview ? preview.extension.toUpperCase() : 'FILE'} · {formatFileSize(preview.size)}
              {'truncated' in preview && preview.truncated ? ` · ${t('filePreview.truncated')}` : ''}
            </div>
          )}
        </div>
      </div>

      <div className="file-preview-body">
        {loading && <div className="file-preview-empty">{t('common.loading')}</div>}

        {!loading && preview?.kind === 'error' && (
          <div className="file-preview-empty">{preview.error}</div>
        )}

        {!loading && preview?.kind === 'directory' && (
          <div className="file-preview-empty">
            <IconFolder size={18} />
            <span>{t('filePreview.directoryHint')}</span>
          </div>
        )}

        {!loading && preview?.kind === 'unsupported' && (
          <div className="file-preview-empty">
            <span>{t(preview.reason === 'too_large' ? 'filePreview.tooLarge' : preview.reason === 'binary' ? 'filePreview.binary' : 'filePreview.unsupported')}</span>
            <span className="file-preview-empty-meta">{preview.extension.toUpperCase()} · {formatFileSize(preview.size)}</span>
          </div>
        )}

        {!loading && preview?.kind === 'image' && mode === 'preview' && (
          <div className="file-preview-image-shell">
            <img className="file-preview-image" src={`file://${preview.path}`} alt={preview.name} />
            <div className="file-preview-meta">{preview.extension.toUpperCase()} · {formatFileSize(preview.size)}</div>
          </div>
        )}

        {!loading && mode === 'code' && (preview?.kind === 'text' || preview?.kind === 'markdown') && (
          <div className="file-preview-content-shell">
            <div className="file-preview-codeblock">
              <div className="file-preview-codeblock-header">
                <span className="file-preview-code-lines">{codeLines.length} {t('filePreview.lines')}</span>
              </div>
              <div className="file-preview-codebody">
                {codeLines.map((line, index) => (
                  <div key={`${index}-${line}`} className="file-preview-code-row">
                    <span className="file-preview-line-number">{index + 1}</span>
                    <code className="file-preview-line-code">{line || ' '}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!loading && mode === 'preview' && (preview?.kind === 'text' || preview?.kind === 'markdown') && (
          <div className="file-preview-content-shell">
            {preview.kind === 'markdown' ? (
              <div className="file-preview-rendered markdown-body">
                <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS}>{preview.content}</ReactMarkdown>
              </div>
            ) : preview.extension === 'html' || preview.extension === 'htm' ? (
              <iframe
                className="file-preview-iframe"
                sandbox=""
                srcDoc={preview.content}
                title={preview.name}
              />
            ) : canPreviewRender ? null : (
              <div className="file-preview-empty">
                <span>{t('filePreview.previewUnavailable')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
