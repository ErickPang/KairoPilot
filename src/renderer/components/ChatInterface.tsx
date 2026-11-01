import {ApprovalCard} from './ApprovalCard';
import type {ConfirmationRequest} from '../types';
import {Select} from './Select';
import {Hand,Shield} from 'lucide-react';
import {DelegationPanel} from './DelegationPanel';
import {TaskWorkflowControls} from './TaskWorkflowControls';
import {TaskPlanPanel} from './TaskPlanPanel';
import {TaskQueuePanel} from './TaskQueuePanel';
import {useAdaptiveResource} from '../hooks/useAdaptiveResource';
import { InputRecoveryNotice } from './InputRecoveryNotice';
import { buildMessageGroups } from './chatMessagePresentation';
import { AttachmentList } from './AttachmentList';
import { ChatMessagesPanel, type SetupStep } from './ChatMessagesPanel';
import { TaskHistoryPanel } from './TaskHistoryPanel';
import { useTaskDraft, type ComposerHandle } from '../hooks/useTaskDraft';
import type { ExecutionProfile,ContextReference,TaskExecutionSettings,QueuedTaskMessage,RunSummary,RunStep } from '../../shared/contracts';
import React, { useEffect, useState } from 'react';
import { AgentConfig, ChatAttachment, Message, ModelConfig } from '../types';
import { IconX } from './Icons';
import { ArrowUp, Square } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import type { TaskViewState } from './taskViewState';
import { isRunUnsettled } from '../hooks/runtimeEventUtils';
import { KAIRO_INVOKE } from '../../shared/ipc';

interface ChatInterfaceProps {
  run: RunSummary | null;
  runSteps: RunStep[];
  onCancelRun: () => Promise<boolean | void>;
  onViewRun: () => void;
  approvalRequest?:ConfirmationRequest|null;
  onApprove:()=>void;
  onDeny:()=>void;
  approvalBusy:boolean;
  messages: Message[];
  input: string;
  setInput: (input: string | ((prev: string) => string)) => void;
  loading: boolean;
  handleSend: (attachments?: ChatAttachment[], references?: ContextReference[], draftRevision?: number) => Promise<boolean | void>;
  composerRef: React.MutableRefObject<ComposerHandle | null>;
  isQuitPending: boolean;
  onViewReference: (reference: ContextReference) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  models: ModelConfig[];
  activeAgent: AgentConfig | null;
  activeModelId: string | null;
  activeAgentName: string;
  focusInputToken: number;
  onModelChange: (modelId: string) => void;
  onOpenModelSettings?: () => void;
  onProfileChange?:(profile:ExecutionProfile)=>void;
  taskSettings?:TaskExecutionSettings;
  onTaskChanged:()=>Promise<void>;
  sessionId: string | null;
  isRunBlocked: boolean;
  canQueue?:boolean;
  viewKey: string;
  viewCache: Map<string, TaskViewState>;
}

type PendingAttachmentFile = { path: string; name?: string; mimeType?: string };

export const ChatInterface = React.memo(function ChatInterface({
  run,runSteps,onCancelRun,onViewRun,
  approvalRequest,onApprove,onDeny,approvalBusy,
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
  onModelChange,
  onOpenModelSettings,
  onProfileChange,
  taskSettings,
  onTaskChanged,
  sessionId,
  isRunBlocked,
  canQueue=false,
  viewKey,
  viewCache,
  composerRef,
  isQuitPending,
  onViewReference
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const currentRun = run?.sessionId === sessionId ? run : null;
  const isExecuting = loading || isRunUnsettled(currentRun);
  const [isStopping, setIsStopping] = useState(false);
  const stopPending = React.useRef(false);
  useEffect(() => { stopPending.current = false; setIsStopping(false); }, [currentRun?.id, isExecuting]);
  const stopRun = async () => {
    if (stopPending.current || !currentRun || !isRunUnsettled(currentRun)) return;
    stopPending.current = true;
    setIsStopping(true);
    try {
      if (await onCancelRun() !== true) { stopPending.current = false; setIsStopping(false); }
    } catch { stopPending.current = false; setIsStopping(false); }
  };
  const stopButton = <button type="button" className="send-btn is-stop" data-composer-stop disabled={isStopping || !isRunUnsettled(currentRun)} onClick={() => void stopRun()} title={t(isStopping ? 'progress.stopping' : 'workbench.cancel')} aria-label={t(isStopping ? 'progress.stopping' : 'workbench.cancel')}><Square size={13} fill="currentColor"/></button>;
  const approvalCard=approvalRequest?<ApprovalCard request={approvalRequest} busy={approvalBusy} onConfirm={onApprove} onDeny={onDeny} stopAction={isExecuting?stopButton:undefined}/>:null;
  const queued=useAdaptiveResource<QueuedTaskMessage[]>(sessionId||'',()=>sessionId?window.kairo.invoke(KAIRO_INVOKE.taskQueueList,sessionId):Promise.resolve([]),value=>loading||value.some(item=>item.status==='queued'||item.status==='dispatching'));
  const queueItems=queued.data||[];
  const shouldQueue=Boolean(sessionId&&canQueue&&(isRunBlocked||queueItems.length));
  const sendBlocked=isRunBlocked&&!shouldQueue;
  const refreshQueue=queued.refresh;
  useEffect(()=>refreshQueue(),[loading,refreshQueue]);
  const [isDragging, setIsDragging] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const draft = useTaskDraft(sessionId, input, setInput);
  const { attachments, setAttachments, references, setReferences, flush: flushDraft, flushForQuit, addReference } = draft;
  const hasRestoredScroll = React.useRef(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [failedAttachmentFiles, setFailedAttachmentFiles] = useState<PendingAttachmentFile[]>([]);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const preparingAttachments = React.useRef(0);
  React.useEffect(() => {
    composerRef.current = {
      flush: flushDraft,
      flushForQuit: async () => {
        if (preparingAttachments.current > 0) throw new Error('Attachment preparation is still in progress.');
        await flushForQuit();
      },
      addReference
    };
    return () => { composerRef.current = null; };
  }, [composerRef, flushDraft, flushForQuit, addReference]);
  const dragCounter = React.useRef(0);
  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const shouldAutoScrollRef = React.useRef(true);
  const autoScrollFrameRef = React.useRef<number | null>(null);
  const autoScrollTimeoutRef = React.useRef<number | null>(null);
  const lastAutoScrollAtRef = React.useRef(0);
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
  }, [activeAgent, activeModelId, activeProfile, models.length, t]);

  const addAttachmentsFromPaths = React.useCallback(async (files: PendingAttachmentFile[]) => {
    const filteredFiles = files.filter((file) => file.path);
    if (filteredFiles.length === 0) {
      return;
    }

    preparingAttachments.current += 1;
    setIsPreparingAttachments(true);
    setAttachmentError(null);
    try {

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
      preparingAttachments.current -= 1;
      setIsPreparingAttachments(preparingAttachments.current > 0);
    }
  }, [sessionId, setAttachments]);

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

  const submitMessage = React.useCallback(async () => {
    if (sendBlocked || isPreparingAttachments || !draft.ready || draft.isRecovering || Boolean(draft.errorKind)) return;
    if (!input.trim() && attachments.length === 0 && references.length === 0) return;
    shouldAutoScrollRef.current = true;
    await draft.send(async(revision) => {
      if(shouldQueue&&sessionId&&revision!==undefined){
        await window.kairo.invoke(KAIRO_INVOKE.taskQueueAdd,{sessionId,draftRevision:revision,data:{input,referenceIds:references.map(item=>item.id),attachmentIds:attachments.map(item=>item.id)}});
        setInput(value=>value===input?'':value);queued.refresh();return true;
      }
      return handleSend(attachments,references,revision);
    });
  }, [attachments, references, draft, handleSend, input, sendBlocked, shouldQueue,sessionId,setInput,queued,isPreparingAttachments]);

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, [setAttachments]);

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

  const modelOptions=React.useMemo(()=>modelGroups.flatMap(group=>group.models.map(model=>({value:`${group.providerId}/${model.id}`,label:model.id,group:group.providerName}))),[modelGroups]);
  const activeModelName=activeModelId?.slice((activeModelId.indexOf('/')+1))||t('chat.selectModel');
  const profileLabels:Record<ExecutionProfile,string>={chat_only:t('ui.profile.chat'),read_only_workspace:t('ui.profile.read'),approved_execution:t('ui.profile.confirm'),trusted_automation:t('ui.profile.auto')};
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

  const recentMessages = React.useMemo(() => messages.slice(-100), [messages]);
  const groupedMessages = React.useMemo(() => buildMessageGroups(recentMessages), [recentMessages]);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const wasHistoryVisible = React.useRef(false);
  useEffect(() => {
    if (wasHistoryVisible.current && !isHistoryVisible && messagesContainerRef.current) {
      shouldAutoScrollRef.current = true;
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
    wasHistoryVisible.current = isHistoryVisible;
  }, [isHistoryVisible]);


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
      viewCache.set(viewKey, { ...viewCache.get(viewKey), scrollTop: container.scrollTop });
      updateAutoScrollState();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [updateAutoScrollState, viewCache, viewKey]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!hasRestoredScroll.current && messages.length > 0) {
      hasRestoredScroll.current = true;
      const savedScroll = viewCache.get(viewKey)?.scrollTop;
      if (savedScroll !== undefined && messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = savedScroll;
        shouldAutoScrollRef.current = false;
        return;
      }
    }
    if (messages.length > 0 && !shouldAutoScrollRef.current) {
      return;
    }

    if (autoScrollTimeoutRef.current !== null || autoScrollFrameRef.current !== null) {
      return;
    }

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }

    const now = window.performance.now();
    const waitMs = Math.max(0, 80 - (now - lastAutoScrollAtRef.current));
    autoScrollTimeoutRef.current = window.setTimeout(() => {
      autoScrollTimeoutRef.current = null;
      autoScrollFrameRef.current = window.requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
        lastAutoScrollAtRef.current = window.performance.now();
        autoScrollFrameRef.current = null;
      });
    }, waitMs);
  }, [loading, messages, messagesEndRef, viewCache, viewKey]);

  useEffect(() => {
    return () => {
      if (autoScrollTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollTimeoutRef.current);
        autoScrollTimeoutRef.current = null;
      }
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, []);

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
    if (isQuitPending) { e.preventDefault(); return; }
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);

    // Handle file drops
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void addAttachmentsFromPaths(files
        .map((file) => ({
          path: (file as File & { path?: string }).path || '',
          name: file.name,
          mimeType: file.type
        }))
        .filter((file) => file.path));
      return;
    }

    // Handle text drops (e.g., from browser/editor text selection)
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      setInput((prev) => {
        const separator = prev ? '\n' : '';
        return prev + separator + text;
      });
      textareaRef.current?.focus();
    }
  };

  return (
    <div
      className={`chat-interface ${messages.length === 0 ? 'is-empty-session' : ''}`}
      data-session-id={sessionId || ''} data-save-state={draft.status}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <InputRecoveryNotice draft={draft} disabled={isQuitPending}/>
      {isDragging && <div className="drag-overlay">{t('chat.dropFiles')}</div>}

      {sessionId && (isHistoryVisible || messages.length >= 100) && <div className="workbench-history-toolbar"><span>{t(isHistoryVisible ? 'workbench.historyMode' : 'workbench.recentWindow')}</span><button type="button" aria-pressed={isHistoryVisible} onClick={() => setIsHistoryVisible((value) => !value)}>{t(isHistoryVisible ? 'workbench.returnRecent' : 'workbench.viewHistory')}</button></div>}
      {isHistoryVisible && sessionId ? <TaskHistoryPanel sessionId={sessionId} activeAgentName={activeAgentName} markdownComponents={markdownComponents} onViewReference={onViewReference} toRenderableMarkdown={toRenderableMarkdown}/> : (
      <ChatMessagesPanel
        onViewReference={onViewReference}
        activeAgentName={activeAgentName}
        containerRef={messagesContainerRef}
        groupedMessages={groupedMessages}
        run={currentRun} runSteps={runSteps} onViewRun={onViewRun}
        loading={loading}
        markdownComponents={markdownComponents}
        messages={recentMessages}
        messagesEndRef={messagesEndRef}
        setupSteps={setupSteps}
        t={t}
        toRenderableMarkdown={toRenderableMarkdown}
      />
      )}

      {sessionId&&<DelegationPanel sessionId={sessionId} loading={loading}/>}
      {sessionId&&<TaskPlanPanel sessionId={sessionId} onChanged={onTaskChanged}/>}
      {sessionId&&<TaskQueuePanel sessionId={sessionId} items={queueItems} contextLabel={`${activeModelId||''} · ${activeProfile?t(`config.executionProfile.${activeProfile}`):''}`} onChanged={queued.refresh}/>}
      {queued.error&&<p role="alert" className="workbench-error">{queued.error}</p>}
      <div className="input-container">
        {approvalCard}
        <div className="input-box" style={{display:approvalRequest?'none':undefined}} aria-hidden={Boolean(approvalRequest)}>
          <textarea
            ref={textareaRef}
            className="input-textarea"
            value={input}
            disabled={!draft.ready || draft.isRecovering || isQuitPending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitMessage();
              }
            }}
            placeholder={t('chat.placeholder')}
            rows={1}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
            }}
          />
          <AttachmentList attachments={attachments} onRemove={removeAttachment} disabled={isQuitPending} />
          <div className="context-reference-list">
            {references.map((reference) => <span key={reference.id} className="context-reference-chip">
              <button type="button" disabled={reference.availability !== 'available'} title={reference.path} onClick={() => onViewReference(reference)}>{reference.kind === 'directory' ? '▤' : '▧'} {reference.name}{reference.availability !== 'available' ? ` (${reference.availability})` : ''}</button>
              <button type="button" disabled={sendBlocked} aria-label={t('workbench.removeReference')} onClick={() => setReferences((items) => items.filter((item) => item.id !== reference.id))}><IconX size={12}/></button>
            </span>)}
          </div>
          {attachmentError && (
            <div className="attachment-error">
              <span>{attachmentError}</span>
              {failedAttachmentFiles.length > 0 && (
                <button type="button" className="attachment-retry" onClick={retryFailedAttachments} disabled={isPreparingAttachments || isQuitPending}>
                  {t('chat.retryAttachment')}
                </button>
              )}
            </div>
          )}
          <div className="input-actions">
            <TaskWorkflowControls canAttach={Boolean(sessionId&&canQueue&&!isPreparingAttachments&&!isQuitPending)} sessionId={sessionId} settings={taskSettings} disabled={isRunBlocked || isPreparingAttachments || !sessionId} onAttach={()=>void handleAttachClick()} onChanged={onTaskChanged}/>
            <Select className="workbench-permission" variant="inline" placement="top" aria-label={t('workbench.taskProfile')} icon={activeProfile==='trusted_automation'?<Shield size={15}/>:<Hand size={15}/>} value={activeProfile||'chat_only'} disabled={isRunBlocked} onChange={value=>onProfileChange?.(value as ExecutionProfile)} options={(['chat_only','read_only_workspace','approved_execution','trusted_automation'] as const).map(profile=>({value:profile,label:profileLabels[profile],description:t(`config.executionProfile.${profile}`)}))}/>
            <span className="composer-action-spacer"/>
            <Select className="model-switcher" variant="inline" align="end" placement="top" searchable aria-label={t('chat.selectModelTitle')} title={activeModelId||t('chat.selectModel')} displayValue={activeModelName} value={activeModelId||''} disabled={isRunBlocked} onChange={onModelChange} options={modelOptions} footer={onOpenModelSettings&&<button type="button" onClick={onOpenModelSettings}>{t('workbench.manageModels')}</button>}/>
            {isExecuting && !approvalRequest && shouldQueue && (input.trim() || attachments.length > 0 || references.length > 0) && <button type="button" className="composer-queue-btn" data-queue-send disabled={sendBlocked || isPreparingAttachments || !draft.ready || draft.isRecovering || Boolean(draft.errorKind)} onClick={() => void submitMessage()} title={`${t('batch1.addToQueue')} · Enter`}>{t('batch1.addToQueue')}</button>}
            {isExecuting && !approvalRequest ? stopButton : <button type="button" className="send-btn" onClick={submitMessage} disabled={sendBlocked || isPreparingAttachments || !draft.ready || draft.isRecovering || Boolean(draft.errorKind) || (!input.trim() && attachments.length === 0 && references.length === 0)} data-queue-send={shouldQueue||undefined} title={`${t(shouldQueue?'batch1.addToQueue':'chat.send')} · Enter`} aria-label={t(shouldQueue?'batch1.addToQueue':'chat.send')}>
              <ArrowUp size={18} />
            </button>}
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
