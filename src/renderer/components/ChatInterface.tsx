import React, { useEffect, useLayoutEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentConfig, ChatAttachment, Message, ModelConfig } from '../types';
import { IconUser, IconBot, IconTool, IconSend, IconCpu, IconChevronDown, IconCheck, IconPlus, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import type { I18nContextValue } from './layout/I18nContext';
import { KAIRO_INVOKE } from '../../shared/ipc';

interface ChatInterfaceProps {
  messages: Message[];
  input: string;
  setInput: (input: string | ((prev: string) => string)) => void;
  loading: boolean;
  handleSend: (attachments?: ChatAttachment[]) => void;
  handleClear: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  models: ModelConfig[];
  activeAgent: AgentConfig | null;
  activeModelId: string | null;
  activeAgentName: string;
  focusInputToken: number;
  onModelChange: (modelId: string) => void;
}

type MessageGroup = {
  type: 'user' | 'final_answer' | 'process';
  messages: Message[];
};

interface ChatMessagesPanelProps {
  activeAgentName: string;
  containerRef: React.RefObject<HTMLDivElement>;
  groupedMessages: MessageGroup[];
  loading: boolean;
  markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'];
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  setupSteps: SetupStep[];
  t: I18nContextValue['t'];
  toRenderableMarkdown: (content?: string) => string;
}

type SetupStep = {
  key: string;
  label: string;
  state: 'done' | 'pending';
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentList({ attachments, onRemove, compact = false }: { attachments?: ChatAttachment[]; onRemove?: (id: string) => void; compact?: boolean }) {
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
            <button type="button" className="attachment-remove" onClick={() => onRemove(attachment.id)} aria-label="Remove attachment">
              <IconX size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type PendingAttachmentFile = { path: string; name?: string; mimeType?: string };

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

const ChatMessagesPanel = React.memo(function ChatMessagesPanel({
  activeAgentName,
  containerRef,
  groupedMessages,
  loading,
  markdownComponents,
  messages,
  messagesEndRef,
  setupSteps,
  t,
  toRenderableMarkdown
}: ChatMessagesPanelProps) {
  return (
    <div ref={containerRef} className="messages-container">
      {messages.length === 0 && (
        <div className="chat-empty-state">
          <span className="chat-empty-kicker">{t('chat.welcome')}</span>
          <h2 className="chat-empty-title">{activeAgentName}</h2>
          <p className="chat-empty-description">{t('chat.welcomeDesc')}</p>
          <div className="chat-setup-checklist" aria-label={t('chat.setupTitle')}>
            <div className="chat-setup-title">{t('chat.setupTitle')}</div>
            {setupSteps.map((step) => (
              <div key={step.key} className={`chat-setup-step ${step.state === 'done' ? 'is-done' : 'is-pending'}`}>
                <span className="chat-setup-step-dot">
                  {step.state === 'done' ? <IconCheck size={12} /> : null}
                </span>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
          <div className="chat-empty-notes">
            <div className="chat-empty-note">
              <span className="chat-empty-note-label">{t('chat.currentTask')}</span>
              <strong>{t('chat.placeholder')}</strong>
            </div>
            <div className="chat-empty-note">
              <span className="chat-empty-note-label">{t('chat.availableTools')}</span>
              <strong>{t('chat.dropFiles')}</strong>
            </div>
          </div>
        </div>
      )}
      {groupedMessages.map((group, groupIdx) => {
        if (group.type === 'process') {
          return (
            <div key={`group-${groupIdx}`} className="message process-group">
              <div className="avatar">
                <IconBot size={18} />
              </div>
              <div className="message-content">
                <details className="process-steps-details">
                  <summary className="process-steps-summary">{t('chat.viewProcess', { count: group.messages.length })}</summary>
                  <div className="process-steps-list">
                    {group.messages.map((msg, i) => (
                      <div key={`process-${groupIdx}-${i}`} className={`message ${msg.role} ${i > 0 ? 'process-message-offset' : ''}`}>
                        <div className="message-content process-message-content">
                          {msg.role === 'tool' || msg.role === 'thinking' ? (
                            <div className="message-prewrap">
                              {msg.content}
                              <AttachmentList attachments={msg.attachments} compact />
                              {msg.details && (
                                <details className="message-details">
                                  <summary className="message-summary">{t('chat.details')}</summary>
                                  <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                                </details>
                              )}
                            </div>
                          ) : (
                            <div className="markdown-body">
                              <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
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
              {msg.role === 'user' ? <IconUser size={18} /> : msg.role === 'tool' ? <IconTool size={18} /> : <IconBot size={18} />}
            </div>
            <div className="message-content">
              {msg.role === 'user' || msg.role === 'tool' ? (
                <div className="message-prewrap">
                  {msg.content}
                  <AttachmentList attachments={msg.attachments} compact />
                  {msg.details && (
                    <details className="message-details">
                      <summary className="message-summary">{t('chat.details')}</summary>
                      <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
                    {toRenderableMarkdown(msg.content)}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ));
      })}
      {loading && messages.length > 0 && <div className="messages-loading-spacer" />}
      <div ref={messagesEndRef} />
    </div>
  );
});

export const ChatInterface = React.memo(function ChatInterface({
  messages,
  input,
  setInput,
  loading,
  handleSend,
  messagesEndRef,
  models,
  activeAgent,
  activeModelId,
  activeAgentName,
  focusInputToken,
  onModelChange
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [activeModelIndex, setActiveModelIndex] = useState(-1);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [failedAttachmentFiles, setFailedAttachmentFiles] = useState<PendingAttachmentFile[]>([]);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [modelDropdownPlacement, setModelDropdownPlacement] = useState<'top' | 'bottom'>('top');
  const dragCounter = React.useRef(0);
  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const modelDropdownRef = React.useRef<HTMLDivElement>(null);
  const modelTriggerRef = React.useRef<HTMLButtonElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const shouldAutoScrollRef = React.useRef(true);
  const activeProfile = activeAgent?.permissions.executionProfile;
  const setupSteps = React.useMemo<SetupStep[]>(() => {
    const hasModel = models.length > 0 && Boolean(activeModelId);
    const hasAgent = Boolean(activeAgent);
    const profileLabel = activeProfile
      ? t(`config.executionProfile.${activeProfile}` as Parameters<typeof t>[0])
      : t('chat.setupPermissionPending');

    return [
      {
        key: 'model',
        state: hasModel ? 'done' : 'pending',
        label: hasModel ? t('chat.setupModelReady') : t('chat.setupModelPending')
      },
      {
        key: 'agent',
        state: hasAgent ? 'done' : 'pending',
        label: hasAgent ? t('chat.setupAgentReady', { name: activeAgentName || t('chat.agentName') }) : t('chat.setupAgentPending')
      },
      {
        key: 'permission',
        state: hasAgent ? 'done' : 'pending',
        label: hasAgent ? t('chat.setupPermissionReady', { profile: profileLabel }) : t('chat.setupPermissionPending')
      },
      {
        key: 'start',
        state: hasModel && hasAgent ? 'done' : 'pending',
        label: t('chat.setupStart')
      }
    ];
  }, [activeAgent, activeAgentName, activeModelId, activeProfile, models.length, t]);

  const addAttachmentsFromPaths = React.useCallback(async (files: PendingAttachmentFile[]) => {
    const filteredFiles = files.filter((file) => file.path);
    if (filteredFiles.length === 0) {
      return;
    }

    setIsPreparingAttachments(true);
    setAttachmentError(null);
    try {
      const activeSession = await window.kairo.invoke(KAIRO_INVOKE.chatGetActiveSession) as { id?: string } | null;
      const sessionId = activeSession?.id || ((await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession, 'New Chat')) as { id?: string } | null)?.id;
      if (!sessionId) {
        throw new Error('Create or select a chat session before attaching files.');
      }
      const result = await window.kairo.invoke(KAIRO_INVOKE.chatPrepareAttachments, {
        sessionId,
        files: filteredFiles
      }) as { success?: boolean; attachments?: ChatAttachment[]; error?: string };
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to prepare attachments.');
      }
      setAttachments((prev) => [...prev, ...(result.attachments || [])]);
      setFailedAttachmentFiles([]);
    } catch (error) {
      setFailedAttachmentFiles(filteredFiles);
      setAttachmentError(error instanceof Error ? error.message : 'Failed to prepare attachments.');
    } finally {
      setIsPreparingAttachments(false);
    }
  }, []);

  const retryFailedAttachments = React.useCallback(async () => {
    await addAttachmentsFromPaths(failedAttachmentFiles);
  }, [addAttachmentsFromPaths, failedAttachmentFiles]);

  const handleAttachClick = React.useCallback(async () => {
    try {
      const selectedFiles = await window.kairo.invoke(KAIRO_INVOKE.systemSelectFiles);
      if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
        await addAttachmentsFromPaths(selectedFiles.map((filePath) => ({ path: String(filePath) })));
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Failed to select attachments.');
    }
  }, [addAttachmentsFromPaths]);

  const submitMessage = React.useCallback(() => {
    const nextAttachments = attachments;
    if (!input.trim() && nextAttachments.length === 0) {
      return;
    }
    handleSend(nextAttachments);
    setAttachments([]);
    setAttachmentError(null);
  }, [attachments, handleSend, input]);

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((attachment) => attachment.id === id);
      if (removed) {
        void window.kairo.invoke(KAIRO_INVOKE.chatDeleteAttachment, {
          sessionId: removed.sessionId,
          attachment: removed
        });
      }
      return prev.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const modelGroups = React.useMemo(
    () =>
      models.map((model) => {
        const options =
          model.availableModels && model.availableModels.length > 0
            ? model.availableModels
            : [{ id: model.model, name: model.model }];
        return {
          providerId: model.id,
          providerName: model.name,
          models: options
        };
      }),
    [models]
  );

  const activeProviderId = activeModelId?.split('/')[0] || '';
  const activeModelName = activeModelId?.split('/')[1] || '';
  const activeProvider = React.useMemo(
    () => modelGroups.find((group) => group.providerId === activeProviderId),
    [activeProviderId, modelGroups]
  );
  const activeModelDisplay = React.useMemo(
    () => (activeProvider ? `${activeProvider.providerName} (${activeModelName})` : activeModelId || t('chat.selectModel')),
    [activeModelId, activeModelName, activeProvider, t]
  );
  const flatModelOptions = React.useMemo(
    () =>
      modelGroups.flatMap((group) =>
        group.models.map((model) => ({
          value: `${group.providerId}/${model.id}`,
          modelId: model.id
        }))
      ),
    [modelGroups]
  );
  const modelIndexMap = React.useMemo(
    () => new Map(flatModelOptions.map((item, index) => [item.value, index])),
    [flatModelOptions]
  );

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

  const toRenderableMarkdown = React.useCallback(
    (content?: string) => {
      const text = content || '';
      return text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.includes('![')) {
            return line;
          }
          if ((trimmed.startsWith('kairopilot://') || trimmed.startsWith('file://') || trimmed.startsWith('/')) && isImageResource(trimmed)) {
            return `![image](${trimmed})`;
          }
          return line;
        })
        .join('\n');
    },
    [isImageResource]
  );

  const markdownComponents = React.useMemo(
    () => ({
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
    }),
    [t, toRenderableUri]
  );

  const groupedMessages = React.useMemo(() => {
    const groups: MessageGroup[] = [];
    let currentProcess: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        if (currentProcess.length > 0) {
          groups.push({ type: 'process', messages: currentProcess });
          currentProcess = [];
        }
        groups.push({ type: 'user', messages: [msg] });
        continue;
      }

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

    if (currentProcess.length > 0) {
      groups.push({ type: 'process', messages: currentProcess });
    }

    return groups;
  }, [messages]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return;
    }
    const updatePlacement = () => {
      const trigger = modelTriggerRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const requiredSpace = 320;
      if (spaceBelow >= requiredSpace || spaceBelow > spaceAbove) {
        setModelDropdownPlacement('bottom');
        return;
      }
      setModelDropdownPlacement('top');
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [isModelDropdownOpen]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      setActiveModelIndex(-1);
      return;
    }
    const selectedIndex = activeModelId ? flatModelOptions.findIndex((item) => item.value === activeModelId) : -1;
    setActiveModelIndex(selectedIndex >= 0 ? selectedIndex : flatModelOptions.length > 0 ? 0 : -1);
  }, [activeModelId, flatModelOptions, isModelDropdownOpen]);

  const updateAutoScrollState = React.useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      shouldAutoScrollRef.current = true;
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 96;
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    updateAutoScrollState();
    const handleScroll = () => {
      updateAutoScrollState();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [updateAutoScrollState]);

  useLayoutEffect(() => {
    if (messages.length > 0 && !shouldAutoScrollRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'end'
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [loading, messages, messagesEndRef]);

  useEffect(() => {
    if (!previewImageSrc) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewImageSrc(null);
        setPreviewZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [previewImageSrc]);

  useEffect(() => {
    if (!focusInputToken) {
      return;
    }

    textareaRef.current?.focus();
    const inputLength = textareaRef.current?.value.length ?? 0;
    textareaRef.current?.setSelectionRange(inputLength, inputLength);
  }, [focusInputToken]);

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

  const handlePreviewWheel = React.useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        adjustPreviewZoom(0.1);
        return;
      }
      adjustPreviewZoom(-0.1);
    },
    [adjustPreviewZoom]
  );

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
    if (files.length === 0) {
      return;
    }

    void addAttachmentsFromPaths(files
      .map((file) => ({
        path: (file as File & { path?: string }).path || '',
        name: file.name,
        mimeType: file.type
      }))
      .filter((file) => file.path));
  };

  return (
    <div className="chat-interface" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && <div className="drag-overlay">{t('chat.dropFiles')}</div>}

      <div className="chat-header">
        <div className="chat-header-copy">
          <span className="chat-header-kicker">{t('chat.currentAgentLabel')}</span>
          <div className="chat-header-main">
            <div className="header-title">{activeAgentName}</div>
            <span className={`chat-header-status ${loading ? 'is-busy' : ''}`}>
              {loading ? t('chat.thinking') : t('chat.currentRun')}
            </span>
          </div>
        </div>
      </div>

      <ChatMessagesPanel
        activeAgentName={activeAgentName}
        containerRef={messagesContainerRef}
        groupedMessages={groupedMessages}
        loading={loading}
        markdownComponents={markdownComponents}
        messages={messages}
        messagesEndRef={messagesEndRef}
        setupSteps={setupSteps}
        t={t}
        toRenderableMarkdown={toRenderableMarkdown}
      />

      <div className="input-container">
        <div className="input-box">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitMessage();
              }
            }}
            placeholder={t('chat.placeholder')}
            disabled={loading}
            rows={1}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
          />
          <AttachmentList attachments={attachments} onRemove={removeAttachment} />
          {attachmentError && (
            <div className="attachment-error">
              <span>{attachmentError}</span>
              {failedAttachmentFiles.length > 0 && (
                <button type="button" className="attachment-retry" onClick={retryFailedAttachments} disabled={isPreparingAttachments}>
                  {t('chat.retryAttachment')}
                </button>
              )}
            </div>
          )}
          <div className="input-actions">
            <button
              type="button"
              className="attach-btn"
              onClick={handleAttachClick}
              disabled={loading || isPreparingAttachments}
              title={t('chat.attachFiles')}
              aria-label={t('chat.attachFiles')}
            >
              <IconPlus size={16} />
            </button>
            <div ref={modelDropdownRef} className="model-switcher">
              <button
                ref={modelTriggerRef}
                type="button"
                disabled={loading}
                onClick={() => setIsModelDropdownOpen((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (!isModelDropdownOpen) {
                      setIsModelDropdownOpen(true);
                      return;
                    }
                    if (flatModelOptions.length > 0) {
                      setActiveModelIndex((prev) => (prev + 1 + flatModelOptions.length) % flatModelOptions.length);
                    }
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!isModelDropdownOpen) {
                      setIsModelDropdownOpen(true);
                      return;
                    }
                    if (flatModelOptions.length > 0) {
                      setActiveModelIndex((prev) => (prev - 1 + flatModelOptions.length) % flatModelOptions.length);
                    }
                    return;
                  }
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!isModelDropdownOpen) {
                      setIsModelDropdownOpen(true);
                      return;
                    }
                    if (activeModelIndex >= 0 && flatModelOptions[activeModelIndex]) {
                      onModelChange(flatModelOptions[activeModelIndex].value);
                      setIsModelDropdownOpen(false);
                    }
                    return;
                  }
                  if (e.key === 'Escape' && isModelDropdownOpen) {
                    e.preventDefault();
                    setIsModelDropdownOpen(false);
                  }
                }}
                className={`model-switcher-trigger ${isModelDropdownOpen ? 'is-open' : ''}`}
                title={t('chat.selectModelTitle')}
              >
                <IconCpu size={14} />
                <span className="model-switcher-trigger-label">{activeModelDisplay}</span>
                <IconChevronDown size={14} />
              </button>
              {isModelDropdownOpen && (
                <div className={`model-switcher-menu ${modelDropdownPlacement === 'top' ? 'is-top' : 'is-bottom'}`}>
                  {modelGroups.map((group) => (
                    <div key={group.providerId} className="model-switcher-group">
                      <div className="model-switcher-group-label">{group.providerName}</div>
                      {group.models.map((model) => {
                        const value = `${group.providerId}/${model.id}`;
                        const selected = value === activeModelId;
                        const itemIndex = modelIndexMap.get(value) ?? -1;
                        const highlighted = itemIndex === activeModelIndex;
                        return (
                          <div
                            key={value}
                            onMouseEnter={() => setActiveModelIndex(itemIndex)}
                            onClick={() => {
                              onModelChange(value);
                              setIsModelDropdownOpen(false);
                            }}
                            className={`model-switcher-item ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                          >
                            <div className="model-switcher-item-check">
                              {selected && <IconCheck size={14} />}
                            </div>
                            <span className="model-switcher-item-label">{model.id}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="send-btn" onClick={submitMessage} disabled={loading || (!input.trim() && attachments.length === 0)} title={`${t('chat.send')} · Enter`}>
              <IconSend size={16} />
            </button>
          </div>
        </div>
      </div>

      {previewImageSrc && (
        <div className="image-preview-overlay" onClick={closePreview}>
          <div className="image-preview-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-preview-toolbar">
              <button type="button" className="image-preview-btn" onClick={() => adjustPreviewZoom(-0.1)} title={t('chat.imagePreviewZoomOut')}>
                −
              </button>
              <button type="button" className="image-preview-btn" onClick={() => adjustPreviewZoom(0.1)} title={t('chat.imagePreviewZoomIn')}>
                +
              </button>
              <button type="button" className="image-preview-btn" onClick={() => setPreviewZoom(1)} title={t('chat.imagePreviewReset')}>
                100%
              </button>
              <span className="image-preview-zoom-text">{Math.round(previewZoom * 100)}%</span>
              <button type="button" className="image-preview-btn image-preview-close" onClick={closePreview} title={t('chat.imagePreviewClose')}>
                {t('common.close')}
              </button>
            </div>
            <div className="image-preview-canvas" onWheel={handlePreviewWheel}>
              <img src={previewImageSrc} alt="preview" className="image-preview-content" style={{ transform: `scale(${previewZoom})` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
