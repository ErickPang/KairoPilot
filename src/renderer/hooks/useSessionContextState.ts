import { useCallback, useRef, useState } from 'react';
import { SessionContextState, SessionContextUpdate } from '../types';

function createDefaultSessionContext(): SessionContextState {
  return {
    activeAgentId: null,
    activeSessionId: null,
    appNotice: null,
    confirmationRequest: null,
    latestRun: null,
  };
}

export function useSessionContextState() {
  const [sessionContext, setSessionContext] = useState<SessionContextState>(createDefaultSessionContext);

  const sessionContextRef = useRef(sessionContext);
  const getSessionContext = useCallback(() => sessionContextRef.current, []);

  const updateSessionContext = useCallback((patch: SessionContextUpdate) => {
    const current = sessionContextRef.current;
    const nextPatch = typeof patch === 'function' ? patch(current) : patch;
    const next = { ...current, ...nextPatch };
    sessionContextRef.current = next;
    setSessionContext(next);
  }, []);

  return {
    sessionContext,
    getSessionContext,
    updateSessionContext
  };
}
