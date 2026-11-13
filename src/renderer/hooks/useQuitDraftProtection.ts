import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { flushSync } from 'react-dom';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import type { ComposerHandle } from './useTaskDraft';
import { DraftQuitError, isDraftConflict } from './draftSaveQueue';

export function useQuitDraftProtection(composer: MutableRefObject<ComposerHandle | null>) {
  const [isQuitPending, setIsQuitPending] = useState(false);
  const requests = useRef(new Set<string>());
  const activeRequest = useRef<string | null>(null);
  useEffect(() => {
    const removeRequest = window.kairo.on(KAIRO_EVENT.appBeforeQuit, (value) => {
      if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') return;
      const id = (value as { id: string }).id;
      if (requests.current.has(id)) return;
      requests.current.add(id);
      activeRequest.current = id;
      flushSync(() => setIsQuitPending(true));
      void (async () => {
        try {
          if (!composer.current) throw new DraftQuitError('not_ready');
          await composer.current.flushForQuit();
          const accepted = await window.kairo.invoke(KAIRO_INVOKE.appQuitDraftResponse, { id, saved: true });
          if (!accepted && activeRequest.current === id) setIsQuitPending(false);
        } catch (error) {
          if (activeRequest.current === id) setIsQuitPending(false);
          const reason = error instanceof DraftQuitError ? error.reason : isDraftConflict(error) ? 'conflict' : 'save_failed';
          await window.kairo.invoke(KAIRO_INVOKE.appQuitDraftResponse, { id, saved: false, reason });
        }
      })().catch(() => { if (activeRequest.current === id) setIsQuitPending(false); });
    });
    const removeCancelled = window.kairo.on(KAIRO_EVENT.appQuitCancelled, () => { activeRequest.current = null; requests.current.clear(); setIsQuitPending(false); });
    return () => { removeRequest(); removeCancelled(); };
  }, [composer]);
  return isQuitPending;
}
