import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, SystemStats, ModelConfig } from '../types';
import { IconUser, IconBot, IconTool, IconSend, IconTrash, IconCpu } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { Select } from './Select';

interface ChatInterfaceProps {
  messages: Message[];
  input: string;
  setInput: (input: string | ((prev: string) => string)) => void;
  loading: boolean;
  handleSend: () => void;
  handleClear: () => void;
  systemStats: SystemStats | null;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  models: ModelConfig[];
  activeModelId: string | null;
  onModelChange: (modelId: string) => void;
}

export function ChatInterface({ 
  messages, 
  input, 
  setInput, 
  loading, 
  handleSend, 
  handleClear, 
  systemStats,
  messagesEndRef,
  models,
  activeModelId,
  onModelChange
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const dragCounter = React.useRef(0);

  const isImageResource = React.useCallback((value: string) => {
    const normalized = value.trim().split('?')[0].split('#')[0];
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(normalized);
  }, []);

  const toRenderableUri = React.useCallback((rawUri: string) => {
    const uri = rawUri.trim();
    if (uri.startsWith('kairopilot://')) {
      const localPath = uri.slice('kairopilot://'.length);
      if (!localPath) {
        return uri;
      }
      const normalizedPath = localPath.startsWith('/') ? localPath : `/${localPath}`;
      return `file://${encodeURI(normalizedPath)}`;
    }
    if (uri.startsWith('/')) {
      return `file://${encodeURI(uri)}`;
    }
    return uri;
  }, []);

  const toRenderableMarkdown = React.useCallback((content?: string) => {
    const text = content || '';
    const lines = text.split('\n');
    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.includes('![')) {
          return line;
        }
        if (
          (trimmed.startsWith('kairopilot://') || trimmed.startsWith('file://') || trimmed.startsWith('/')) &&
          isImageResource(trimmed)
        ) {
          return `![image](${trimmed})`;
        }
        return line;
      })
      .join('\n');
  }, [isImageResource]);

  const markdownComponents = React.useMemo(() => {
    return {
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        if (!src) {
          return null;
        }
        const imageSrc = toRenderableUri(src);
        return (
          <button
            type="button"
            className="chat-image-trigger"
            onClick={() => {
              setPreviewImageSrc(imageSrc);
              setPreviewZoom(1);
            }}
            title={t('chat.openImagePreview')}
          >
            <img src={imageSrc} alt={alt || 'image'} className="chat-message-image" loading="lazy" />
          </button>
        );
      },
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        if (!href) {
          return <>{children}</>;
        }
        const linkHref = href.startsWith('kairopilot://') ? toRenderableUri(href) : href;
        return (
          <a href={linkHref} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
    };
  }, [t, toRenderableUri]);

  const adjustPreviewZoom = React.useCallback((delta: number) => {
    setPreviewZoom((prev) => {
      const next = prev + delta;
      return Math.min(4, Math.max(0.25, Number(next.toFixed(2))));
    });
  }, []);

  const closePreview = React.useCallback(() => {
    setPreviewImageSrc(null);
    setPreviewZoom(1);
  }, []);

  const resetPreviewZoom = React.useCallback(() => {
    setPreviewZoom(1);
  }, []);

  const handlePreviewWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      adjustPreviewZoom(0.1);
      return;
    }
    adjustPreviewZoom(-0.1);
  }, [adjustPreviewZoom]);

  // Group messages to hide intermediate process steps
  const groupedMessages = React.useMemo(() => {
    const groups: { type: 'user' | 'final_answer' | 'process', messages: Message[] }[] = [];
    let currentProcess: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      if (msg.role === 'user') {
        if (currentProcess.length > 0) {
          groups.push({ type: 'process', messages: currentProcess });
          currentProcess = [];
        }
        groups.push({ type: 'user', messages: [msg] });
      } else {
        // It's an assistant, tool, or thinking message.
        // Check if it's the final assistant message in this turn.
        let isFinalInTurn = false;
        if (msg.role === 'assistant') {
          let hasMoreAfter = false;
          for (let j = i + 1; j < messages.length; j++) {
            if (messages[j].role === 'user') {
              break;
            }
            if (messages[j].role === 'assistant' || messages[j].role === 'tool' || messages[j].role === 'thinking') {
              hasMoreAfter = true;
              break;
            }
          }
          if (!hasMoreAfter) {
            isFinalInTurn = true;
          }
        }

        if (isFinalInTurn) {
          if (currentProcess.length > 0) {
            groups.push({ type: 'process', messages: currentProcess });
            currentProcess = [];
          }
          groups.push({ type: 'final_answer', messages: [msg] });
        } else {
          currentProcess.push(msg);
        }
      }
    }

    if (currentProcess.length > 0) {
      groups.push({ type: 'process', messages: currentProcess });
    }

    return groups;
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, messagesEndRef]);

  useEffect(() => {
    if (!previewImageSrc) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePreview();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closePreview, previewImageSrc]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const addedText = files.map(f => {
        const path = (f as File & { path?: string }).path;
        if (!path) return '';
        if (f.type.startsWith('image/')) {
          return `![${f.name}](kairopilot://${path})`;
        } else {
          return `Context file: ${path}`;
        }
      }).filter(Boolean).join('\n');
      
      if (addedText) {
        setInput(prev => prev ? `${prev}\n${addedText}` : addedText);
      }
    }
  };

  return (
    <div 
      className="chat-interface"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-overlay">
          {t('chat.dropFiles')}
        </div>
      )}

      <div className="chat-header">
        <div className="header-title">
          {loading ? t('chat.thinking') : t('chat.agentName')}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {systemStats && (
            <div className="system-stats">
              CPU: {systemStats.cpuUsage}% | MEM: {systemStats.memoryUsage}%
            </div>
          )}
          <button onClick={handleClear} className="icon-btn" title={t('common.delete')}>
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 && (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%', 
            color: 'var(--muted-fg)',
            paddingBottom: '20%'
          }}>
            <h2 style={{ color: 'var(--foreground)', marginBottom: '0.5rem' }}>{t('chat.welcome')}</h2>
            <p>{t('chat.welcomeDesc')}</p>
          </div>
        )}
        
        {groupedMessages.map((group, groupIdx) => {
          if (group.type === 'process') {
            const isLatestLoading = loading && groupIdx === groupedMessages.length - 1;
            return (
              <div key={`group-wrapper-${groupIdx}`} className="message system" style={{ margin: '0.5rem auto' }}>
                <div className="avatar" style={{ backgroundColor: 'transparent', color: 'var(--muted-fg)' }}>
                  <IconCpu size={18} />
                </div>
                <div className="message-content" style={{ width: '100%', padding: 0 }}>
                  <details 
                    key={`group-${groupIdx}`} 
                    open={isLatestLoading}
                    className="message-process-group" 
                    style={{ background: 'var(--sidebar-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: '0.5rem' }}
                  >
                    <summary className="process-summary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted-fg)', fontSize: '0.85rem', userSelect: 'none', padding: '0.25rem' }}>
                      {isLatestLoading ? t('chat.working') : t('chat.viewProcess', { count: group.messages.length })}
                    </summary>
                    <div className="process-content" style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {group.messages.map((msg, i) => (
                        <div key={i} className={`message ${msg.role} process-item`} style={{ padding: '0.5rem', margin: 0, fontSize: '0.9em', background: 'var(--background)', border: '1px solid var(--border)', maxWidth: '100%' }}>
                          <div className="avatar" style={{ width: '24px', height: '24px', padding: '4px' }}>
                            {msg.role === 'tool' ? <IconTool size={14} /> : <IconBot size={14} />}
                          </div>
                          <div className="message-content" style={{ padding: '0.25rem 0.5rem' }}>
                            {msg.role === 'tool' ? (
                              <div className="markdown-body">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                  {toRenderableMarkdown(msg.content)}
                                </ReactMarkdown>
                                {msg.details && (
                                  <details className="message-details">
                                    <summary className="message-summary">{t('chat.details')}</summary>
                                    <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                                  </details>
                                )}
                              </div>
                            ) : (
                              <div className="markdown-body">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                  {toRenderableMarkdown(msg.content)}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
            );
          }

          return group.messages.map((msg, i) => (
            <div key={`msg-${groupIdx}-${i}`} className={`message ${msg.role}`}>
              <div className="avatar">
                {msg.role === 'user' ? <IconUser size={18} /> : (msg.role === 'tool' ? <IconTool size={18} /> : <IconBot size={18} />)}
              </div>
              <div className="message-content">
                {msg.role === 'user' || msg.role === 'tool' ? (
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                    {msg.details && (
                      <details className="message-details">
                        <summary className="message-summary">{t('chat.details')}</summary>
                        <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                ) : (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {toRenderableMarkdown(msg.content)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ));
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <div className="input-box">
          <textarea
            className="input-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t('chat.placeholder')}
            disabled={loading}
            rows={1}
            style={{ height: 'auto', minHeight: '24px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
          />
          <div className="input-actions">
            <div className="input-tools" style={{ display: 'flex', alignItems: 'center' }}>
              <Select 
                value={activeModelId || ''}
                onChange={onModelChange}
                options={models.map(m => ({ 
                  value: m.id, 
                  label: m.name, 
                  description: m.model 
                }))}
                placeholder={t('chat.selectModel')}
                disabled={loading}
                placement="top"
                size="sm"
                icon={<IconCpu size={14} style={{ color: 'var(--muted-fg)' }} />}
                dropdownTitle={t('chat.selectModelTitle')}
              />
            </div>
            <button 
              className="send-btn" 
              onClick={handleSend} 
              disabled={loading || !input.trim()}
              title={t('chat.send')}
            >
              <IconSend size={16} />
            </button>
          </div>
        </div>
      </div>

      {previewImageSrc && (
        <div className="image-preview-overlay" onClick={closePreview}>
          <div className="image-preview-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-preview-toolbar">
              <button
                type="button"
                className="image-preview-btn"
                onClick={() => adjustPreviewZoom(-0.1)}
                title={t('chat.imagePreviewZoomOut')}
              >
                −
              </button>
              <button
                type="button"
                className="image-preview-btn"
                onClick={() => adjustPreviewZoom(0.1)}
                title={t('chat.imagePreviewZoomIn')}
              >
                +
              </button>
              <button
                type="button"
                className="image-preview-btn"
                onClick={resetPreviewZoom}
                title={t('chat.imagePreviewReset')}
              >
                100%
              </button>
              <span className="image-preview-zoom-text">{Math.round(previewZoom * 100)}%</span>
              <button
                type="button"
                className="image-preview-btn image-preview-close"
                onClick={closePreview}
                title={t('chat.imagePreviewClose')}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="image-preview-canvas" onWheel={handlePreviewWheel}>
              <img
                src={previewImageSrc}
                alt="preview"
                className="image-preview-content"
                style={{ transform: `scale(${previewZoom})` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
