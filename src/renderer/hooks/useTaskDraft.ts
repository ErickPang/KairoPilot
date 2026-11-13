import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ContextReference, TaskDraft, TaskDraftInput, RuntimeUpdateEvent } from '../../shared/contracts';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import { useTranslation } from './useTranslation';
import { DraftSaveQueue, DraftQuitError, isDraftConflict } from './draftSaveQueue';

export interface ComposerHandle {
  flush: () => Promise<number | undefined>;
  flushForQuit: () => Promise<void>;
  addReference: (path: string) => Promise<void>;
}

type LocalDraft = { input: string; attachments: ChatAttachment[]; references: ContextReference[] };

export function useTaskDraft(sessionId: string | null, input: string, setInput: (value: string) => void) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [references, setReferences] = useState<ContextReference[]>([]);
  const [ready, setReady] = useState(!sessionId);
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<'load' | 'save' | 'conflict' | null>(null);
  const [remoteDraft, setRemoteDraft] = useState<TaskDraft | null>(null);
  const [localRecovery, setLocalRecovery] = useState<LocalDraft | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [saveEpoch, setSaveEpoch] = useState(0);
  const alive = useRef(true);
  const readyRef = useRef(!sessionId);
  const paused = useRef(false);
  const sending = useRef(false);
  const pendingReferences = useRef(0);
  const activeSend = useRef<{acknowledged:boolean;resolve:()=>void}|null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const acceptance = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const latest = useRef<TaskDraftInput>({ input, referenceIds: [], attachmentIds: [] });
  const local = useRef<LocalDraft>({ input, attachments, references });
  latest.current = { input, referenceIds: references.map((item) => item.id), attachmentIds: attachments.map((item) => item.id) };
  local.current = { input, attachments, references };
  const saver = useRef<DraftSaveQueue>();
  if (!saver.current) saver.current = new DraftSaveQueue(async (revision, data) => {
    if (!sessionId) throw new Error('Task required.');
    return window.kairo.invoke(KAIRO_INVOKE.chatSaveDraft, { sessionId, revision, data });
  });
  const queue = saver.current;

  const applyDraft = useCallback((draft: LocalDraft) => {
    latest.current = { input: draft.input, referenceIds: draft.references.map((item) => item.id), attachmentIds: draft.attachments.map((item) => item.id) };
    setInput(draft.input); setAttachments(draft.attachments); setReferences(draft.references);
  }, [setInput]);

  const loadDraft = useCallback(async () => {
    if (!sessionId) { setStatus('saved'); return; }
    setIsRecovering(true); setStatus('loading'); paused.current = true;
    try {
      await queue.idle();
      const draft = await window.kairo.invoke(KAIRO_INVOKE.chatGetDraft, sessionId);
      if (!alive.current) return;
      queue.adopt(draft.revision, draft);
      applyDraft(draft); readyRef.current = true; setReady(true); paused.current = false;
      setStatus('saved'); setErrorKind(null); setRemoteDraft(null);
      setError(draft.missingAttachmentIds.length ? t('workbench.draft.missingAttachments') : '');
    } catch (reason) {
      if (alive.current) { setStatus('error'); setErrorKind('load'); setError(String(reason)); }
      throw reason;
    } finally { if (alive.current) setIsRecovering(false); }
  }, [applyDraft, queue, sessionId, t]);

  useEffect(() => {
    alive.current = true;
    loading.current = loadDraft();
    void loading.current.catch(() => undefined);
    return () => { alive.current = false; };
    // ChatInterface is keyed by task. Never rehydrate over edits on a language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const flush = useCallback(async () => {
    if (!sessionId) return undefined;
    if (!readyRef.current) throw new Error(t('workbench.draft.notLoaded'));
    try {
      setStatus('saving');
      const revision = await queue.save(latest.current);
      if (alive.current) { setStatus(queue.isSettled(latest.current) ? 'saved' : 'saving'); setError(''); setErrorKind(null); }
      return revision;
    } catch (reason) {
      paused.current = true;
      if (alive.current) { setStatus('error'); setErrorKind(isDraftConflict(reason) ? 'conflict' : 'save'); setError(String(reason)); }
      throw reason;
    }
  }, [queue, sessionId, t]);

  useEffect(() => {
    if (!ready || !sessionId || sending.current || paused.current) return;
    if (queue.isSettled(latest.current)) { setStatus('saved'); return; }
    setStatus('saving');
    const timer = window.setTimeout(() => { if (!sending.current && !paused.current) void flush().catch(() => undefined); }, 350);
    return () => window.clearTimeout(timer);
  }, [input, attachments, references, ready, sessionId, flush, saveEpoch, queue]);

  useEffect(() => window.kairo.on(KAIRO_EVENT.agentUpdate, (raw) => {
    const event = raw as RuntimeUpdateEvent;
    if (event.type !== 'draft-accepted' || event.sessionId !== sessionId || !sending.current) return;
    if(activeSend.current)activeSend.current.acknowledged = true; sending.current = false;
    queue.adopt(event.revision, { input: '', referenceIds: [], attachmentIds: [] });
    latest.current = { ...latest.current, referenceIds: latest.current.referenceIds.filter((id) => !event.referenceIds.includes(id)), attachmentIds: latest.current.attachmentIds.filter((id) => !event.attachmentIds.includes(id)) };
    setAttachments((items) => items.filter((item) => !event.attachmentIds.includes(item.id)));
    setReferences((items) => items.filter((item) => !event.referenceIds.includes(item.id)));
    setStatus('saved'); acceptance.current?.resolve(); acceptance.current = null;
  }), [queue, sessionId]);

  const retry = useCallback(async () => {
    if (!readyRef.current) { loading.current = loadDraft(); await loading.current; return; }
    if (errorKind === 'conflict') return;
    paused.current = false; await flush();
  }, [errorKind, flush, loadDraft]);

  const inspectConflict = useCallback(async () => {
    if (!sessionId) return;
    setIsRecovering(true); paused.current = true;
    try {
      await queue.idle();
      const draft = await window.kairo.invoke(KAIRO_INVOKE.chatGetDraft, sessionId);
      if (alive.current) { setRemoteDraft(draft); setError(''); }
    } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setIsRecovering(false); }
  }, [queue, sessionId]);

  const resolveConflict = useCallback(async (keepLocal: boolean) => {
    if (!remoteDraft) return;
    setIsRecovering(true);
    try {
      await queue.idle();
      if (!alive.current) return;
      queue.adopt(remoteDraft.revision, remoteDraft);
      if (keepLocal) { paused.current = false; await flush(); }
      else {
        setLocalRecovery(local.current);
        applyDraft(remoteDraft); paused.current = false; setError(''); setErrorKind(null); setStatus('saved');
      }
      setRemoteDraft(null);
    } catch { /* flush retains the current input and reports a new conflict. */ }
    finally { if (alive.current) setIsRecovering(false); }
  }, [applyDraft, flush, queue, remoteDraft]);

  const restoreLocal = useCallback(() => {
    if (!localRecovery) return;
    applyDraft(localRecovery); setLocalRecovery(null); setSaveEpoch((value) => value + 1);
  }, [applyDraft, localRecovery]);

  const flushForQuit = useCallback(async () => {
    if (pendingReferences.current > 0) throw new DraftQuitError('preparation_pending');
    if (!sessionId) {
      if (latest.current.input.trim()) {
        setError(t('workbench.draft.untitledQuit')); setStatus('error');
        throw new DraftQuitError('unsaved_input');
      }
      return;
    }
    try { if (loading.current) await loading.current; }
    catch { throw new DraftQuitError('not_ready'); }
    if (acceptance.current) await acceptance.current.promise;
    try { await flush(); }
    catch (reason) { throw new DraftQuitError(isDraftConflict(reason) ? 'conflict' : 'save_failed'); }
  }, [flush, sessionId, t]);

  const addReference = useCallback(async (path: string) => {
    if (!sessionId || !readyRef.current) throw new Error(t('workbench.draft.notLoaded'));
    pendingReferences.current += 1;
    try {
      const reference = await window.kairo.invoke(KAIRO_INVOKE.chatCreateReference, { sessionId, path });
      if (alive.current) setReferences((items) => items.some((item) => item.id === reference.id) ? items : [...items, reference]);
    } finally { pendingReferences.current -= 1; }
  }, [sessionId, t]);

  const send = useCallback(async (execute: (draftRevision?: number) => Promise<boolean | void>) => {
    if (sending.current || !readyRef.current) return;
    sending.current = true;
    let resolveAcceptance!: () => void;
    const ticket={acknowledged:false,resolve:()=>resolveAcceptance()};activeSend.current=ticket;
    acceptance.current = { promise: new Promise<void>((resolve) => { resolveAcceptance = resolve; }), resolve: () => resolveAcceptance() };
    try {
      const submitted=latest.current;
      const revision = await flush();
      const accepted = await execute(revision);
      if (!alive.current) return;
      if (sessionId && !ticket.acknowledged && activeSend.current===ticket) {
        const stored = await window.kairo.invoke(KAIRO_INVOKE.chatGetDraft, sessionId);
        queue.adopt(stored.revision, stored);
      }
      if (accepted === true && !ticket.acknowledged && activeSend.current===ticket) { setAttachments(items=>items.filter(item=>!submitted.attachmentIds.includes(item.id))); setReferences(items=>items.filter(item=>!submitted.referenceIds.includes(item.id))); }
    } catch (reason) { if (alive.current) { setStatus('error'); setError(String(reason)); } }
    finally {
      resolveAcceptance();
      if(activeSend.current===ticket){sending.current=false;acceptance.current=null;activeSend.current=null;}
      if (alive.current) setSaveEpoch((value) => value + 1);
    }
  }, [flush, queue, sessionId]);

  const dismissConflict = useCallback(() => setRemoteDraft(null), []);

  return { currentInput: input, dismissConflict, attachments, setAttachments, references, setReferences, ready, status, error, errorKind, isRecovering, remoteDraft, localRecovery, retry, inspectConflict, resolveConflict, restoreLocal, flush, flushForQuit, addReference, send };
}
