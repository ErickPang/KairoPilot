import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ConversationNavigationEntry } from '../../shared/contracts';
import type { useConversationFeed } from '../hooks/useConversationFeed';
import { useConversationNavigation } from '../hooks/useConversationNavigation';
import { useTranslation } from '../hooks/useTranslation';

interface Props {
  sessionId: string | null;
  feed: ReturnType<typeof useConversationFeed>;
  containerRef: RefObject<HTMLDivElement>;
  onNavigate?: () => void;
}

export function ConversationNavigation({ sessionId, feed, containerRef, onNavigate }: Props) {
  const { t } = useTranslation();
  const index = useConversationNavigation(sessionId, feed.data);
  const [active, setActive] = useState('');
  const [preview, setPreview] = useState<{ entry: ConversationNavigationEntry; top: number }>();
  const [highlight, setHighlight] = useState('');
  const railRef = useRef<HTMLElement>(null);
  const tooltipId = useId();
  const { navigationTarget, finishNavigation } = feed;

  useEffect(() => { setPreview(undefined); setActive(''); setHighlight(''); }, [sessionId]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      const top = container.getBoundingClientRect().top + 48;
      const rounds = [...container.querySelectorAll<HTMLElement>('[data-conversation-round]')];
      let current = rounds[0];
      for (const round of rounds) {
        if (round.getBoundingClientRect().top <= top) current = round;
        else break;
      }
      if (container.scrollTop > 0 && container.scrollHeight - container.scrollTop - container.clientHeight < 4) current = rounds[rounds.length - 1];
      setActive(current?.dataset.conversationRound || '');
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    container.querySelectorAll('[data-conversation-round]').forEach(round => resize.observe(round));
    container.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); container.removeEventListener('scroll', schedule); };
  }, [containerRef, feed.data]);

  useEffect(() => {
    if (!navigationTarget) return;
    const container = containerRef.current;
    const round = [...(container?.querySelectorAll<HTMLElement>('[data-conversation-round]') || [])]
      .find(element => element.dataset.conversationRound === navigationTarget.runId);
    if (!container || !round) return;
    container.scrollTo({ top: container.scrollTop + round.getBoundingClientRect().top - container.getBoundingClientRect().top - 24, behavior: 'instant' });
    setHighlight(navigationTarget.runId);
    finishNavigation();
  }, [navigationTarget, containerRef, feed.data, finishNavigation]);
  useEffect(() => {
    const container = containerRef.current;
    if (!highlight || !container) return;
    const round = [...container.querySelectorAll<HTMLElement>('[data-conversation-round]')].find(element => element.dataset.conversationRound === highlight);
    round?.classList.add('is-navigation-target');
    const timer = window.setTimeout(() => { round?.classList.remove('is-navigation-target'); setHighlight(''); }, 1600);
    return () => { window.clearTimeout(timer); round?.classList.remove('is-navigation-target'); };
  }, [highlight, containerRef]);
  useEffect(() => {
    const rail = railRef.current;
    const button = [...(rail?.querySelectorAll<HTMLButtonElement>('[data-navigation-run]') || [])].find(element => element.dataset.navigationRun === active);
    if (!rail || !button || rail.matches(':hover') || rail.contains(document.activeElement)) return;
    rail.scrollTop = Math.max(0, button.offsetTop - rail.clientHeight / 2);
  }, [active, index.entries.length]);

  const showPreview = (entry: ConversationNavigationEntry, button: HTMLButtonElement) => {
    const viewport = containerRef.current?.parentElement;
    if (!viewport) return;
    const offset = button.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    setPreview({ entry, top: Math.max(8, Math.min(offset - 40, viewport.clientHeight - 130)) });
  };
  if (!index.entries.length && !index.error) return null;
  const previewEntry = preview && (index.entries.find(entry => entry.runId === preview.entry.runId) || preview.entry);
  const status = (entry: ConversationNavigationEntry) => t(
    entry.status === 'failed' ? 'conversation.failed' : entry.status === 'cancelled' ? 'conversation.cancelled' :
      entry.status === 'waiting_approval' ? 'progress.waiting' : entry.status === 'paused' ? 'progress.paused' :
        entry.status === 'completed' ? 'conversation.noAnswer' : 'progress.thinking');
  return <>
    <nav className="conversation-navigation" aria-label={t('conversation.navigation')} ref={railRef}
      onMouseLeave={() => setPreview(undefined)} onKeyDown={event => {
        if (event.key === 'Escape') { setPreview(undefined); return; }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-navigation-run]')];
        const position = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, position + (event.key === 'ArrowUp' ? -1 : 1)));
        event.preventDefault(); buttons[next]?.focus();
      }}>
      {index.before && <button type="button" className="conversation-navigation-more" disabled={index.loadingEarlier} onClick={() => void index.earlier()} aria-label={t('conversation.earlier')} title={t('conversation.earlier')}>⋯</button>}
      {index.error && <button type="button" className="conversation-navigation-more" onClick={index.retry} aria-label={t('conversation.retry')} title={t('conversation.retry')}>!</button>}
      {index.entries.map(entry => <button key={entry.runId} type="button" data-navigation-run={entry.runId}
        className={`conversation-navigation-tick${preview?.entry.runId === entry.runId ? ' is-previewed' : ''}`} aria-current={active === entry.runId ? 'location' : undefined}
        aria-label={t('conversation.jump', { question: entry.question || t('conversation.attachment') })}
        aria-describedby={preview?.entry.runId === entry.runId ? tooltipId : undefined}
        onMouseEnter={event => showPreview(entry, event.currentTarget)} onFocus={event => showPreview(entry, event.currentTarget)} onBlur={() => setPreview(undefined)}
        onClick={() => { onNavigate?.(); feed.jumpTo(entry.runId); setPreview(undefined); }}><span/></button>)}
    </nav>
    {preview && previewEntry && <div id={tooltipId} role="tooltip" className="conversation-navigation-preview" style={{ top: preview.top }}>
      <strong>{previewEntry.question.replace(/\s+/g, ' ').trim() || t('conversation.attachment')}</strong>
      <p>{previewEntry.status === 'completed' ? previewEntry.answer.replace(/\s+/g, ' ').trim() || status(previewEntry) : status(previewEntry)}</p>
    </div>}
  </>;
}
