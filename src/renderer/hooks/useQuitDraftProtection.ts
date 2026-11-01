import { useEffect, useState, type MutableRefObject } from 'react';
import { flushSync } from 'react-dom';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import type { ComposerHandle } from './useTaskDraft';

export function useQuitDraftProtection(composer: MutableRefObject<ComposerHandle | null>) {
  const [isQuitPending, setIsQuitPending] = useState(false);
  useEffect(() => {
    const removeRequest = window.kairo.on(KAIRO_EVENT.appBeforeQuit, (value) => {
      if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') return;
      const id = (value as { id: string }).id;
      flushSync(() => setIsQuitPending(true));
      void (async () => {
        try {
          if (!composer.current) throw new Error('Composer unavailable.');
          await composer.current.flushForQuit();
          await window.kairo.invoke(KAIRO_INVOKE.appQuitDraftResponse, { id, saved: true });
        } catch {
          setIsQuitPending(false);
          await window.kairo.invoke(KAIRO_INVOKE.appQuitDraftResponse, { id, saved: false });
        }
      })().catch(() => setIsQuitPending(false));
    });
    const removeCancelled = window.kairo.on(KAIRO_EVENT.appQuitCancelled, () => setIsQuitPending(false));
    return () => { removeRequest(); removeCancelled(); };
  }, [composer]);
  return isQuitPending;
}
