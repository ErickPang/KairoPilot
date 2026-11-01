import React, { useEffect, useState } from 'react';
import { BookOpen, Terminal, Search, Wrench, ChevronRight } from 'lucide-react';
import { currentRunActivity, runElapsedSeconds } from './runProgressPresentation';
import { isRunUnsettled } from '../hooks/runtimeEventUtils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../types';
import type { ContextReference, RunSummary, RunStep } from '../../shared/contracts';
import { IconCheck } from './Icons';
import { AttachmentList } from './AttachmentList';
import { visibleUserText, type MessageGroup } from './chatMessagePresentation';
import type { I18nContextValue } from './layout/I18nContext';

interface ChatMessagesPanelProps {
  run?: RunSummary | null;
  runSteps?: RunStep[];
  onViewRun?: () => void;
  onViewReference: (reference: ContextReference) => void;
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

export type SetupStep = {
  key: string;
  label: string;
  state: 'done' | 'pending';
};

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

interface MessageBodyProps {
  onViewReference: (reference: ContextReference) => void;
  markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'];
  msg: Message;
  renderPlainAssistant?: boolean;
  t: I18nContextValue['t'];
  toRenderableMarkdown: (content?: string) => string;
}

const MessageBody = React.memo(function MessageBody({
  onViewReference,
  markdownComponents,
  msg,
  renderPlainAssistant = false,
  t,
  toRenderableMarkdown
}: MessageBodyProps) {
  const shouldRenderPrewrap = msg.role === 'user' || msg.role === 'tool' || renderPlainAssistant;

  if (shouldRenderPrewrap) {
    return (
      <div className="message-prewrap">
        {msg.role === 'user' ? visibleUserText(msg.content || '', msg.attachments) : msg.content}
        <AttachmentList attachments={msg.attachments} compact />
        {msg.references?.length ? <div className="context-reference-list">{msg.references.map((reference) => <button type="button" onClick={() => onViewReference(reference)} className="context-reference-chip" key={reference.id} title={reference.path}>{reference.kind === 'directory' ? '▤' : '▧'} {reference.name}</button>)}</div> : null}
        {msg.details && (
          <details className="message-details">
            <summary className="message-summary">{t('chat.details')}</summary>
            <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
        {toRenderableMarkdown(msg.content)}
      </ReactMarkdown>
    </div>
  );
});

interface MessageRowProps extends MessageBodyProps {
  className?: string;
}

const MessageRow = React.memo(function MessageRow({
  className = '',
  onViewReference,
  markdownComponents,
  msg,
  renderPlainAssistant,
  t,
  toRenderableMarkdown
}: MessageRowProps) {
  return (
    <div className={`message ${msg.role} ${className}`}>
      <div className="message-content">
        <MessageBody
          onViewReference={onViewReference}
          markdownComponents={markdownComponents}
          msg={msg}
          renderPlainAssistant={renderPlainAssistant}
          t={t}
          toRenderableMarkdown={toRenderableMarkdown}
        />
      </div>
    </div>
  );
});

export const ChatMessagesPanel = React.memo(function ChatMessagesPanel({
  run = null, runSteps = [], onViewRun,
  activeAgentName,
  containerRef,
  onViewReference,
  groupedMessages,
  loading,
  markdownComponents,
  messages,
  messagesEndRef,
  setupSteps,
  t,
  toRenderableMarkdown
}: ChatMessagesPanelProps) {
  const [now, setNow] = useState(Date.now);
  const isTimedRun = Boolean(run && ['running', 'waiting_approval'].includes(run.status));
  useEffect(() => {
    if (!isTimedRun) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.id, isTimedRun]);
  const latestUserGroup = groupedMessages.map(group => group.type).lastIndexOf('user');
  const activity = currentRunActivity(run, runSteps);
  const ActivityIcon = activity.icon === 'read' ? BookOpen : activity.icon === 'terminal' ? Terminal : activity.icon === 'search' ? Search : activity.icon === 'tool' ? Wrench : null;
  const elapsed = run ? runElapsedSeconds(run, now) : 0;
  const duration = elapsed >= 60 ? t('progress.minutesSeconds', { minutes: Math.floor(elapsed / 60), seconds: elapsed % 60 }) : t('progress.seconds', { seconds: elapsed });
  const summaryKey = run?.status === 'cancelled' ? 'progress.cancelled' : run?.status === 'failed' ? 'progress.failed' : run?.status === 'paused' ? 'progress.pausedDuration' : 'progress.elapsed';
  const isSetupReady = setupSteps.length > 0 && setupSteps.every((step) => step.state === 'done');
  return (
    <div ref={containerRef} className="messages-container">
      {messages.length === 0 && (
        <div className={`chat-empty-state ${isSetupReady ? 'is-ready' : ''}`}>
          <h2 className="chat-empty-title">{t('chat.startTaskTitle')}</h2>
          <p className="chat-empty-description">{t(isSetupReady ? 'chat.startTaskDescription' : 'chat.welcomeDesc')}</p>
          {isSetupReady ? <p className="chat-ready-status"><IconCheck size={13}/>{t('chat.readyToStart', { name: activeAgentName })}</p> : <div className="chat-setup-checklist" aria-label={t('chat.setupTitle')}>
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
          }
        </div>
      )}
      {groupedMessages.map((group, groupIdx) => {
        if (group.type === 'process') {
          // The current round has a single duration link to its full execution record.
          if ((run || loading) && groupIdx > latestUserGroup) return null;
          return <details key={`group-${groupIdx}`} className="conversation-process">
            <summary>{t('progress.history')}<ChevronRight size={13}/></summary>
            {group.messages.map((msg, i) => <MessageRow key={i} onViewReference={onViewReference} markdownComponents={markdownComponents} msg={msg} renderPlainAssistant t={t} toRenderableMarkdown={toRenderableMarkdown}/>) }
          </details>;
        }

        return group.messages.map((msg, i) => {
          if (msg.role === 'assistant' && !msg.content?.trim() && !msg.attachments?.length && !msg.references?.length) return null;
          const isLatestGroup = groupIdx === groupedMessages.length - 1;
          const isLatestMessage = i === group.messages.length - 1;
          const renderStreamingText = loading && isLatestGroup && isLatestMessage && msg.role === 'assistant';

          return (
            <React.Fragment key={`msg-${groupIdx}-${i}`}><MessageRow
              onViewReference={onViewReference}
              markdownComponents={markdownComponents}
              msg={msg}
              renderPlainAssistant={renderStreamingText}
              t={t}
              toRenderableMarkdown={toRenderableMarkdown}
            />
            {groupIdx === latestUserGroup && run && <button type="button" className="conversation-run-summary" data-run-summary={run.status} onClick={onViewRun} aria-label={`${t(summaryKey, { duration })} · ${t('workbench.details')}`}>
              {t(summaryKey, { duration })}<ChevronRight size={14}/>
            </button>}
            </React.Fragment>
          );
        });
      })}
      {(loading || isRunUnsettled(run)) && messages.length > 0 && <div className="conversation-activity" role="status" aria-live="polite" data-run-activity>{ActivityIcon && <ActivityIcon size={16}/>}<span>{t(activity.key)}{activity.target ? ` ${activity.target}` : ''}</span></div>}
      <div ref={messagesEndRef} />
    </div>
  );
});
