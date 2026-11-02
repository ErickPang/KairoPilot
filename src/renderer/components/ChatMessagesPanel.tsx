import { useTranslation } from '../hooks/useTranslation';
import type { useConversationFeed } from '../hooks/useConversationFeed';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { ConversationProcess } from './ConversationProcess';
import React, { useEffect, useState } from 'react';
import { Wrench, ChevronRight, Search, BookOpen, SquareTerminal } from 'lucide-react';
import { isRunUnsettled } from '../hooks/runtimeEventUtils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../types';
import type { ContextReference, RunSummary, ConversationItem } from '../../shared/contracts';
import { AttachmentList } from './AttachmentList';
import { visibleUserText } from './chatMessagePresentation';
import type { I18nContextValue } from './layout/I18nContext';

interface ChatMessagesPanelProps {
  sessionId: string | null;
  run: RunSummary | null;
  feed: ReturnType<typeof useConversationFeed>;
  onViewReference: (reference: ContextReference) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  loading: boolean;
  markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  t: I18nContextValue['t'];
  toRenderableMarkdown: (content?: string) => string;
}

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
  toRenderableMarkdown
}: MessageBodyProps) {
  const shouldRenderPrewrap = msg.role === 'user' || msg.role === 'tool' || renderPlainAssistant;

  if (shouldRenderPrewrap) {
    return (
      <div className="message-prewrap">
        {msg.role === 'user' ? visibleUserText(msg.content || '', msg.attachments) : msg.content}
        <AttachmentList attachments={msg.attachments} compact />
        {msg.references?.length ? <div className="context-reference-list">{msg.references.map((reference) => <button type="button" onClick={() => onViewReference(reference)} className="context-reference-chip" key={reference.id} title={reference.path}>{reference.kind === 'directory' ? '▤' : '▧'} {reference.name}</button>)}</div> : null}

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

export const ChatMessagesPanel = React.memo(function ChatMessagesPanel(props: ChatMessagesPanelProps) {
  const { sessionId, run, feed, containerRef, messagesEndRef, loading, t } = props;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!loading && !isRunUnsettled(run)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [loading, run]);
  const row = (item: ConversationItem) => <MessageRow key={item.id} msg={{ role: item.kind === 'user' ? 'user' : 'assistant', content: item.content, attachments: item.attachments, references: item.references }} onViewReference={props.onViewReference} markdownComponents={props.markdownComponents} t={t} toRenderableMarkdown={props.toRenderableMarkdown} renderPlainAssistant={item.status === 'running'}/>;
  const rounds = feed.data?.rounds || [];
  return <div ref={containerRef} className="messages-container">
    {feed.error && <p role="alert" className="workbench-error">{feed.error}</p>}
    {(feed.data?.before || feed.before) && <div className="workbench-history-toolbar">
      <button disabled={!feed.data?.before} onClick={feed.earlier}>{t('workbench.viewHistory')}</button>
      {feed.before && <button onClick={feed.recent}>{t('workbench.returnRecent')}</button>}
    </div>}
    {!rounds.length && !loading && <div className="chat-empty-state"><h2>{t('chat.startTaskTitle')}</h2><p>{t('chat.startTaskDescription')}</p></div>}
    {rounds.map(round => <React.Fragment key={round.run.id}>
      {round.items.filter(item => item.kind === 'user').map(row)}
      <ConversationProcess run={round.run} now={now} live={isRunUnsettled(round.run) && round.run.status !== 'paused'}>
        <div className="conversation-process-body">
          {round.items.filter(item => item.kind !== 'user' && item.kind !== 'final').map(item => item.kind === 'tool' ? <ToolActivity key={item.id} item={item} sessionId={sessionId!}/> : row(item))}
          {round.run.error && <p className="workbench-error" role="alert">{round.run.error}</p>}
          {isRunUnsettled(round.run) && !round.items.some(item => item.status === 'running' && (item.kind === 'tool' || item.kind === 'draft')) && <div className="conversation-activity" role="status" data-run-activity>{t(round.run.status === 'waiting_approval' ? 'progress.waiting' : round.run.status === 'paused' ? 'progress.paused' : 'progress.thinking')}</div>}
        </div>
      </ConversationProcess>
      {round.items.filter(item => item.kind === 'final').map(item => <div className="conversation-final-answer" key={item.id}>{row(item)}</div>)}
    </React.Fragment>)}
    <div ref={messagesEndRef}/>
  </div>;
});

export function ToolActivity({ item, sessionId }: { item: ConversationItem; sessionId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<{ output?: string; error?: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (open) void window.kairo.invoke(KAIRO_INVOKE.chatConversationDetails, { sessionId, itemId: item.id }).then(value => { if (!cancelled) setDetails(value as { output?: string; error?: string }); }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [open, item.id, item.status, sessionId]);
  const activity = item.activity || { action: 'tool', target: item.content, icon: 'tool' };
  const Icon = activity.icon === 'search' ? Search : activity.icon === 'read' ? BookOpen : activity.icon === 'terminal' ? SquareTerminal : Wrench;
  const state = item.status === 'running' ? 'running' : item.status === 'failed' ? 'failed' : item.status === 'cancelled' ? 'cancelled' : 'completed';
  const label = state === 'failed' || state === 'cancelled' ? t(`progress.action.${state}`, { target: activity.target || item.content }) : t(`progress.action.${activity.action}.${state}`, { target: activity.target });
  return <details className="conversation-tool" data-tool-activity={item.id} data-tool-status={item.status} open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary {...(item.status === 'running' ? { 'data-run-activity': true, role: 'status' } : {})}><Icon size={15}/><span>{label}</span>{item.status !== 'running' && <ChevronRight size={13}/>}</summary>
    {open && <>{error && <p role="alert">{error}</p>}{details?.error && <p role="alert">{details.error}</p>}<pre>{details === undefined ? '…' : details.output || (!details.error ? t('progress.action.done') : '')}</pre></>}
  </details>;
}
